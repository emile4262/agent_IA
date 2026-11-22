import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Delivery } from '../digest/schemas/delivery.schema';
import { TOPICS, type Topic } from '../sources/topics';
import { FREQUENCIES, type Frequency } from '../users/schemas/preferences.schema';
import { User } from '../users/schemas/user.schema';
import { UsersService, type AdminUserView } from '../users/users.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Nombre de jours de la courbe des inscriptions. */
const SIGNUP_DAYS = 30;

export interface DashboardView {
  users: {
    total: number;
    active: number;
    disabled: number;
    verified: number;
    unverified: number;
    admins: number;
    /** Mot de passe provisoire pas encore changé. */
    pendingPassword: number;
    new7d: number;
    new30d: number;
    /** Comptes connectés au moins une fois ces 7 derniers jours. */
    seen7d: number;
    neverSeen: number;
  };
  digests: {
    /** Comptes actifs dont la veille est envoyée / en pause. */
    active: number;
    paused: number;
    byFrequency: Record<Frequency, number>;
    byTopic: Record<Topic, number>;
    topKeywords: { keyword: string; users: number }[];
  };
  deliveries: {
    sent7d: number;
    failed7d: number;
    manual7d: number;
    lastSentAt: Date | null;
  };
  /** Inscriptions par jour (AAAA-MM-JJ, UTC) sur les 30 derniers jours. */
  signups: { day: string; count: number }[];
  recentUsers: AdminUserView[];
}

/** Chiffres clés pour le tableau de bord de l'administrateur. */
@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Delivery.name) private readonly deliveryModel: Model<Delivery>,
  ) {}

  async overview(): Promise<DashboardView> {
    const now = Date.now();
    const days7 = new Date(now - 7 * DAY_MS);
    const days30 = new Date(now - 30 * DAY_MS);
    const signupStart = new Date(now - (SIGNUP_DAYS - 1) * DAY_MS);
    signupStart.setUTCHours(0, 0, 0, 0);
    // Les comptes créés avant l'ajout des préférences n'ont pas le champ : ils comptent comme actifs.
    const digestOn = { active: true, 'preferences.active': { $ne: false } };

    const [
      total, active, verified, admins, pendingPassword, new7d, new30d, seen7d, neverSeen,
      digestsActive, digestsPaused, frequencies, topics, keywords, signups, recent,
      sent7d, failed7d, manual7d, lastSent,
    ] = await Promise.all([
      this.userModel.countDocuments(),
      this.userModel.countDocuments({ active: true }),
      this.userModel.countDocuments({ emailVerified: true }),
      this.userModel.countDocuments({ role: 'admin' }),
      this.userModel.countDocuments({ mustChangePassword: true }),
      this.userModel.countDocuments({ createdAt: { $gte: days7 } }),
      this.userModel.countDocuments({ createdAt: { $gte: days30 } }),
      this.userModel.countDocuments({ lastSeenAt: { $gte: days7 } }),
      this.userModel.countDocuments({ lastSeenAt: null }),
      this.userModel.countDocuments(digestOn),
      this.userModel.countDocuments({ active: true, 'preferences.active': false }),
      this.countBy<Frequency>('$preferences.frequency', digestOn),
      this.countBy<Topic>('$preferences.topics', digestOn, true),
      this.userModel
        .aggregate<{ _id: string; users: number }>([
          { $match: digestOn },
          { $unwind: '$preferences.keywords' },
          { $group: { _id: { $toLower: '$preferences.keywords' }, users: { $sum: 1 } } },
          { $sort: { users: -1, _id: 1 } },
          { $limit: 10 },
        ])
        .exec(),
      this.userModel
        .aggregate<{ _id: string; count: number }>([
          { $match: { createdAt: { $gte: signupStart } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        ])
        .exec(),
      this.userModel.find().sort({ createdAt: -1 }).limit(5).exec(),
      this.deliveryModel.countDocuments({ status: 'sent', createdAt: { $gte: days7 } }),
      this.deliveryModel.countDocuments({ status: 'failed', createdAt: { $gte: days7 } }),
      this.deliveryModel.countDocuments({ kind: 'manual', createdAt: { $gte: days7 } }),
      this.deliveryModel.findOne({ status: 'sent' }).sort({ sentAt: -1 }).select('sentAt').lean().exec(),
    ]);

    const signupsByDay = new Map(signups.map((s) => [s._id, s.count]));
    return {
      users: {
        total,
        active,
        disabled: total - active,
        verified,
        unverified: total - verified,
        admins,
        pendingPassword,
        new7d,
        new30d,
        seen7d,
        neverSeen,
      },
      digests: {
        active: digestsActive,
        paused: digestsPaused,
        byFrequency: Object.fromEntries(FREQUENCIES.map((f) => [f, frequencies.get(f) ?? 0])) as Record<Frequency, number>,
        byTopic: Object.fromEntries(TOPICS.map((t) => [t, topics.get(t) ?? 0])) as Record<Topic, number>,
        topKeywords: keywords.map((k) => ({ keyword: k._id, users: k.users })),
      },
      deliveries: { sent7d, failed7d, manual7d, lastSentAt: lastSent?.sentAt ?? null },
      signups: Array.from({ length: SIGNUP_DAYS }, (_, i) => {
        const day = new Date(signupStart.getTime() + i * DAY_MS).toISOString().slice(0, 10);
        return { day, count: signupsByDay.get(day) ?? 0 };
      }),
      recentUsers: recent.map((user) => UsersService.toAdminView(user)),
    };
  }

  /** Nombre de comptes par valeur d'un champ des préférences (unwind pour un tableau). */
  private async countBy<T extends string>(field: string, match: object, unwind = false): Promise<Map<T, number>> {
    const rows = await this.userModel
      .aggregate<{ _id: T; count: number }>([
        { $match: match },
        ...(unwind ? [{ $unwind: field }] : []),
        { $group: { _id: field, count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((row) => [row._id, row.count]));
  }
}
