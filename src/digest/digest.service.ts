import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model, type QueryFilter } from 'mongoose';
import { schedule, type ScheduledTask } from 'node-cron';
import { Article, type ArticleDocument } from '../articles/schemas/article.schema';
import type { Env } from '../config/env.validation';
import { digestEmail } from '../mail/mail.templates';
import { MailService } from '../mail/mail.service';
import { SourcesService } from '../sources/sources.service';
import type { Topic } from '../sources/topics';
import type { Frequency } from '../users/schemas/preferences.schema';
import { User, type UserDocument } from '../users/schemas/user.schema';
import type { Paginated } from '../users/users.service';
import { dueDigestDate, isSendingDay, localClock } from './schedule';
import { Delivery, type DeliveredArticle, type DeliveryDocument, type DeliveryKind, type DeliveryStatus } from './schemas/delivery.schema';

/** Seuls les articles collectés depuis moins longtemps sont proposés. */
const SELECTION_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Un article déjà envoyé à quelqu'un ne lui est pas renvoyé pendant cette durée. */
const ALREADY_SENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MANUAL_SENDS_PER_DAY = 3;
/** Un envoi automatique en échec est réessayé aux vérifications suivantes, jusqu'à ce nombre d'essais. */
export const MAX_DELIVERY_ATTEMPTS = 3;
const DUPLICATE_KEY = 11000;

export interface DigestArticleView {
  id: string;
  title: string;
  url: string;
  topic: Topic;
  /** Mot-clé qui a fait choisir l'article, null s'il vient d'un sujet fixe. */
  keyword: string | null;
  score: number;
  summary: string;
}

export interface DeliveryView {
  id: string;
  digestDate: string;
  kind: DeliveryKind;
  status: DeliveryStatus;
  attempts: number;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
  articles: DigestArticleView[];
}

export interface DigestToday {
  /** Aujourd'hui, dans le fuseau de l'utilisateur. */
  date: string;
  sendTime: string;
  timezone: string;
  frequency: Frequency;
  /** false = veille en pause. */
  active: boolean;
  /** Aujourd'hui est-il un jour d'envoi selon la fréquence choisie ? */
  sendingDay: boolean;
  /** Envoi automatique du jour, s'il a déjà eu lieu. */
  delivered: DeliveryView | null;
  /** Ce qui serait envoyé maintenant (articles déjà reçus exclus). */
  articles: DigestArticleView[];
}

export interface SendNowResult {
  message: string;
  delivery: DeliveryView | null;
}

export interface DigestRunReport {
  startedAt: Date;
  durationMs: number;
  /** Utilisateurs dont l'heure d'envoi est passée et qui n'ont pas encore reçu leur veille. */
  due: number;
  sent: number;
  failed: number;
  /** Aucun article ne correspondait : rien n'est envoyé, nouvel essai à la vérification suivante. */
  empty: number;
}

/**
 * Veille personnalisée : choisit pour chaque utilisateur les meilleurs articles déjà résumés,
 * selon ses préférences, et les lui envoie à son heure.
 */
@Injectable()
export class DigestService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DigestService.name);
  private task: ScheduledTask | null = null;
  private running = false;
  /** Envois en cours, attendus à l'arrêt du serveur. */
  private current: Promise<unknown> | null = null;
  private stopping = false;

  constructor(
    @InjectModel(Delivery.name) private readonly deliveryModel: Model<Delivery>,
    @InjectModel(Article.name) private readonly articleModel: Model<Article>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly sourcesService: SourcesService,
    private readonly mailService: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const expression = this.config.get('DIGEST_CRON', { infer: true });
    if (!expression) {
      this.logger.warn('Envois automatiques désactivés (DIGEST_CRON=off).');
      return;
    }
    this.task = schedule(
      expression,
      async () => {
        this.current = this.runScheduled().catch((error: unknown) => this.logger.error(`Envois interrompus : ${String(error)}`));
        await this.current;
        this.current = null;
      },
      { noOverlap: true, name: 'envois' },
    );
    this.logger.log(`Envois automatiques vérifiés selon « ${expression} ».`);
  }

  /**
   * Arrêt du serveur (redéploiement) : plus de nouvel envoi, mais celui en cours se termine.
   * Sinon la veille resterait « en cours d'envoi » et ne serait jamais réessayée.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.task?.destroy();
    await this.current;
  }

  async today(userId: string): Promise<DigestToday> {
    const user = await this.getUserOrThrow(userId);
    const preferences = user.preferences;
    const { date } = localClock(new Date(), preferences.timezone);
    const [delivered, articles] = await Promise.all([
      this.deliveryModel.findOne({ userId: user._id, digestDate: date, kind: 'scheduled' }).exec(),
      this.select(user, await this.activeSourceIds()),
    ]);
    return {
      date,
      sendTime: preferences.sendTime,
      timezone: preferences.timezone,
      frequency: preferences.frequency,
      active: preferences.active,
      sendingDay: isSendingDay(date, preferences.frequency),
      delivered: delivered && DigestService.toDeliveryView(delivered),
      articles: articles.map((article) => DigestService.toArticleView(article, user)),
    };
  }

  async history(userId: string, page: number, limit: number): Promise<Paginated<DeliveryView>> {
    const filter = { userId: new Types.ObjectId(userId) };
    const [deliveries, total] = await Promise.all([
      this.deliveryModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.deliveryModel.countDocuments(filter),
    ]);
    return { items: deliveries.map((delivery) => DigestService.toDeliveryView(delivery)), total, page, limit };
  }

  /** Envoi immédiat, en plus de l'envoi automatique ; limité à MANUAL_SENDS_PER_DAY par jour. */
  async sendNow(userId: string): Promise<SendNowResult> {
    const user = await this.getUserOrThrow(userId);
    if (!user.emailVerified) {
      throw new ForbiddenException('Confirmez votre adresse e-mail avant de recevoir la veille.');
    }
    const { date } = localClock(new Date(), user.preferences.timezone);
    const sentToday = await this.deliveryModel.countDocuments({ userId: user._id, kind: 'manual', digestDate: date });
    if (sentToday >= MANUAL_SENDS_PER_DAY) {
      throw new HttpException(
        `Limite atteinte : ${MANUAL_SENDS_PER_DAY} envois manuels par jour. Réessayez demain.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const articles = await this.select(user, await this.activeSourceIds());
    if (articles.length === 0) {
      return { message: 'Aucun nouvel article ne correspond à vos préférences pour le moment.', delivery: null };
    }
    const delivery = await this.deliveryModel.create({
      userId: user._id,
      digestDate: date,
      kind: 'manual',
      articles: DigestService.snapshot(articles, user),
    });
    const sent = await this.deliver(delivery, user);
    return {
      message: sent ? 'Veille envoyée.' : 'L’envoi a échoué, réessayez plus tard.',
      delivery: DigestService.toDeliveryView(delivery),
    };
  }

  /** Envoie la veille à chaque utilisateur dont l'heure est passée. Appelé par la planification. */
  async runScheduled(now = new Date()): Promise<DigestRunReport> {
    if (this.running) {
      throw new ConflictException('Des envois sont déjà en cours.');
    }
    this.running = true;
    const report: DigestRunReport = { startedAt: now, durationMs: 0, due: 0, sent: 0, failed: 0, empty: 0 };
    try {
      const sourceIds = await this.activeSourceIds();
      const users = this.userModel
        .find({ active: true, emailVerified: true, 'preferences.active': { $ne: false } })
        .cursor();
      for await (const user of users) {
        if (this.stopping) {
          // Les veilles restantes partiront au redémarrage, dans le délai de grâce.
          break;
        }
        try {
          const outcome = await this.sendScheduled(user, sourceIds, now);
          if (outcome !== 'skipped') {
            report.due += 1;
            report[outcome] += 1;
          }
        } catch (error) {
          this.logger.error(`Veille de ${user.email} : ${String(error)}`);
        }
      }
      report.durationMs = Date.now() - now.getTime();
      if (report.due > 0) {
        this.logger.log(`Envois : ${report.sent} envoyée(s), ${report.failed} échec(s), ${report.empty} sans article.`);
      }
      return report;
    } finally {
      this.running = false;
    }
  }

  private async sendScheduled(
    user: UserDocument,
    sourceIds: Types.ObjectId[],
    now: Date,
  ): Promise<'sent' | 'failed' | 'empty' | 'skipped'> {
    const date = dueDigestDate(now, user.preferences);
    if (!date) {
      return 'skipped';
    }
    const existing = await this.deliveryModel.findOne({ userId: user._id, digestDate: date, kind: 'scheduled' }).exec();
    if (existing && (existing.status !== 'failed' || existing.attempts >= MAX_DELIVERY_ATTEMPTS)) {
      return 'skipped';
    }

    const articles = await this.select(user, sourceIds, now);
    if (articles.length === 0) {
      return 'empty';
    }

    // Réservation atomique : une seule vérification peut envoyer la veille du jour.
    const delivery = existing
      ? await this.deliveryModel
          .findOneAndUpdate(
            { _id: existing._id, status: 'failed', attempts: existing.attempts },
            { status: 'sending', error: null, articles: DigestService.snapshot(articles, user), $inc: { attempts: 1 } },
            { new: true },
          )
          .exec()
      : await this.deliveryModel
          .create({ userId: user._id, digestDate: date, kind: 'scheduled', articles: DigestService.snapshot(articles, user) })
          .catch((error: unknown) => {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY) {
              return null;
            }
            throw error;
          });
    if (!delivery) {
      return 'skipped';
    }
    return (await this.deliver(delivery, user)) ? 'sent' : 'failed';
  }

  /**
   * Articles résumés récents qui correspondent aux préférences, jamais reçus, les mieux notés d'abord :
   * ceux des sujets choisis venant des sources choisies, et ceux trouvés pour ses mots-clés.
   */
  private async select(user: UserDocument, activeSourceIds: Types.ObjectId[], now = new Date()): Promise<ArticleDocument[]> {
    const preferences = user.preferences;
    const chosen = preferences.sourceIds;
    const sourceIds = chosen === null ? activeSourceIds : activeSourceIds.filter((id) => chosen.some((c) => c.equals(id)));
    const matches: QueryFilter<Article>[] = [];
    if (preferences.topics.length > 0 && sourceIds.length > 0) {
      matches.push({ topic: { $in: preferences.topics }, sourceId: { $in: sourceIds } });
    }
    if (preferences.keywords.length > 0) {
      matches.push({ keywords: { $in: preferences.keywords } });
    }
    if (matches.length === 0) {
      return [];
    }
    const alreadySent = await this.deliveryModel.distinct('articles.articleId', {
      userId: user._id,
      status: 'sent',
      createdAt: { $gte: new Date(now.getTime() - ALREADY_SENT_WINDOW_MS) },
    });
    return this.articleModel
      .find({
        status: 'summarized',
        createdAt: { $gte: new Date(now.getTime() - SELECTION_WINDOW_MS) },
        score: { $gte: preferences.minScore },
        _id: { $nin: alreadySent },
        $or: matches,
      })
      .sort({ score: -1, publishedAt: -1 })
      .limit(preferences.maxArticles)
      .exec();
  }

  /** Envoie l'e-mail et enregistre le résultat ; renvoie false en cas d'échec. */
  private async deliver(delivery: DeliveryDocument, user: UserDocument): Promise<boolean> {
    try {
      await this.mailService.send(digestEmail(user.email, user.firstName, delivery.digestDate, delivery.articles));
      delivery.status = 'sent';
      delivery.sentAt = new Date();
      delivery.error = null;
    } catch (error) {
      this.logger.warn(`Envoi de la veille à ${user.email} en échec : ${String(error)}`);
      delivery.status = 'failed';
      delivery.error = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    }
    await delivery.save();
    return delivery.status === 'sent';
  }

  private async activeSourceIds(): Promise<Types.ObjectId[]> {
    return (await this.sourcesService.findActive()).map((source) => source._id);
  }

  private async getUserOrThrow(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }
    return user;
  }

  private static snapshot(articles: ArticleDocument[], user: UserDocument): DeliveredArticle[] {
    const followed = user.preferences.keywords;
    return articles.map((article) => ({
      articleId: article._id,
      title: article.titleFr ?? article.title,
      url: article.url,
      topic: article.topic!,
      keyword: article.keywords.find((keyword) => followed.includes(keyword)) ?? null,
      score: article.score!,
      summary: article.summary!,
    }));
  }

  static toArticleView(article: ArticleDocument, user: UserDocument): DigestArticleView {
    const [snapshot] = DigestService.snapshot([article], user);
    return { id: article.id as string, ...DigestService.withoutId(snapshot) };
  }

  static toDeliveryView(delivery: DeliveryDocument): DeliveryView {
    return {
      id: delivery.id as string,
      digestDate: delivery.digestDate,
      kind: delivery.kind,
      status: delivery.status,
      attempts: delivery.attempts,
      error: delivery.error,
      sentAt: delivery.sentAt,
      createdAt: delivery.createdAt,
      articles: delivery.articles.map((article) => ({
        id: article.articleId.toString(),
        ...DigestService.withoutId(article),
      })),
    };
  }

  private static withoutId(article: DeliveredArticle): Omit<DigestArticleView, 'id'> {
    return {
      title: article.title,
      url: article.url,
      topic: article.topic,
      keyword: article.keyword ?? null,
      score: article.score,
      summary: article.summary,
    };
  }
}
