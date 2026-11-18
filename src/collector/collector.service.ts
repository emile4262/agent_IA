import { ConflictException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter } from 'mongoose';
import { schedule, type ScheduledTask } from 'node-cron';
import { Article, MAX_SUMMARY_ATTEMPTS, type ArticleDocument } from '../articles/schemas/article.schema';
import type { Env } from '../config/env.validation';
import { SourcesService } from '../sources/sources.service';
import { MAX_ARTICLE_AGE_MS, readFeed } from './feed-reader';
import { SummarizerService, SummarizerUnavailableError } from './summarizer.service';

/** Petits lots : l'IA omet moins d'articles. */
const BATCH_SIZE = 4;
/** Plafond de résumés par collecte ; le reste attend la suivante. */
const MAX_SUMMARIES_PER_RUN = 40;
const TIMEZONE = 'Africa/Abidjan';

export interface CollectReport {
  startedAt: Date;
  durationMs: number;
  sources: number;
  sourcesFailed: number;
  newArticles: number;
  summarized: number;
  failed: number;
  /** Articles qui restent à résumer après cette collecte. */
  pending: number;
  /** Raison de l'arrêt des résumés (IA non configurée, quota…), sinon null. */
  summariesStopped: string | null;
}

/**
 * Collecte mutualisée : lit chaque source active une fois pour tout le monde,
 * enregistre les nouveaux articles, puis fait résumer et noter ceux qui sont en attente.
 */
@Injectable()
export class CollectorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CollectorService.name);
  private task: ScheduledTask | null = null;
  private running = false;
  private lastReport: CollectReport | null = null;

  constructor(
    @InjectModel(Article.name) private readonly articleModel: Model<Article>,
    private readonly sourcesService: SourcesService,
    private readonly summarizer: SummarizerService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const expression = this.config.get('COLLECT_CRON', { infer: true });
    if (!expression) {
      this.logger.warn('Collecte automatique désactivée (COLLECT_CRON=off).');
      return;
    }
    this.task = schedule(
      expression,
      async () => {
        await this.run().catch((error: unknown) => this.logger.error(`Collecte interrompue : ${String(error)}`));
      },
      { timezone: TIMEZONE, noOverlap: true, name: 'collecte' },
    );
    this.logger.log(`Collecte automatique planifiée : « ${expression} » (${TIMEZONE}).`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.task?.destroy();
  }

  get status() {
    return {
      running: this.running,
      schedule: this.config.get('COLLECT_CRON', { infer: true }),
      summariesEnabled: this.summarizer.enabled,
      lastReport: this.lastReport,
    };
  }

  /** Lance une collecte complète ; une seule à la fois. */
  async run(): Promise<CollectReport> {
    if (this.running) {
      throw new ConflictException('Une collecte est déjà en cours.');
    }
    this.running = true;
    const startedAt = new Date();
    try {
      const { sources, sourcesFailed, newArticles } = await this.collect();
      const { summarized, failed, stopped } = await this.summarizePending();
      const pending = await this.articleModel.countDocuments(CollectorService.toSummarizeFilter());
      const report: CollectReport = {
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
        sources,
        sourcesFailed,
        newArticles,
        summarized,
        failed,
        pending,
        summariesStopped: stopped,
      };
      this.lastReport = report;
      this.logger.log(
        `Collecte : ${newArticles} nouvel(s) article(s) sur ${sources} source(s) (${sourcesFailed} en erreur), ` +
          `${summarized} résumé(s), ${failed} échec(s), ${pending} en attente.`,
      );
      return report;
    } finally {
      this.running = false;
    }
  }

  /** Lit toutes les sources actives en parallèle et enregistre les articles jamais vus. */
  private async collect(): Promise<{ sources: number; sourcesFailed: number; newArticles: number }> {
    const sources = await this.sourcesService.findActive();
    const results = await Promise.all(
      sources.map(async (source) => {
        try {
          const items = await readFeed(source.feedUrl);
          let added = 0;
          if (items.length > 0) {
            const result = await this.articleModel.bulkWrite(
              items.map(({ url, ...item }) => ({
                updateOne: {
                  filter: { url },
                  update: { $setOnInsert: { ...item, sourceId: source._id } },
                  upsert: true,
                },
              })),
              { ordered: false },
            );
            added = result.upsertedCount;
          }
          await this.sourcesService.recordFetch(source.id as string, null);
          return { ok: true, added };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Flux illisible « ${source.name} » : ${message}`);
          await this.sourcesService.recordFetch(source.id as string, message.slice(0, 500));
          return { ok: false, added: 0 };
        }
      }),
    );
    return {
      sources: sources.length,
      sourcesFailed: results.filter((result) => !result.ok).length,
      newArticles: results.reduce((total, result) => total + result.added, 0),
    };
  }

  /** Résume les articles en attente ou en échec, par lots, les plus récents d'abord. */
  private async summarizePending(): Promise<{ summarized: number; failed: number; stopped: string | null }> {
    if (!this.summarizer.enabled) {
      return { summarized: 0, failed: 0, stopped: 'GEMINI_API_KEY absent : résumés désactivés.' };
    }
    const queue = await this.articleModel
      .find(CollectorService.toSummarizeFilter())
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(MAX_SUMMARIES_PER_RUN)
      .exec();

    let summarized = 0;
    let failed = 0;
    for (let offset = 0; offset < queue.length; offset += BATCH_SIZE) {
      const batch = queue.slice(offset, offset + BATCH_SIZE);
      try {
        const summaries = await this.summarizer.summarize(
          batch.map((article) => ({ url: article.url, title: article.title, snippet: article.snippet })),
        );
        for (const article of batch) {
          const summary = summaries.get(article.url);
          if (summary) {
            article.set({ ...summary, status: 'summarized', summarizedAt: new Date(), lastError: null });
            summarized += 1;
          } else {
            CollectorService.markFailed(article, 'Article absent de la réponse de l’IA.');
            failed += 1;
          }
          article.attempts += 1;
          await article.save();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const article of batch) {
          CollectorService.markFailed(article, message);
          article.attempts += 1;
          await article.save();
        }
        failed += batch.length;
        if (error instanceof SummarizerUnavailableError) {
          this.logger.error(`Résumés interrompus : ${message}`);
          return { summarized, failed, stopped: message };
        }
        this.logger.warn(`Lot en échec, réessayé à la prochaine collecte : ${message}`);
      }
    }
    return { summarized, failed, stopped: null };
  }

  /** Articles récents à (re)résumer. */
  private static toSummarizeFilter(): QueryFilter<Article> {
    return {
      createdAt: { $gte: new Date(Date.now() - MAX_ARTICLE_AGE_MS) },
      $or: [{ status: 'pending' }, { status: 'failed', attempts: { $lt: MAX_SUMMARY_ATTEMPTS } }],
    };
  }

  private static markFailed(article: ArticleDocument, error: string): void {
    article.status = 'failed';
    article.lastError = error.slice(0, 500);
  }
}
