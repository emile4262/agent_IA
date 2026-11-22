import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { SECURITY_EVENT_TYPES, SecurityEvent, type SecurityEventType } from './schemas/security-event.schema';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Exemples gardés (comptes visés, adresses demandées). */
const MAX_SAMPLES = 10;

export interface SecurityIpView {
  ip: string;
  total: number;
  byType: Record<SecurityEventType, number>;
  emails: string[];
  paths: string[];
  firstAt: Date;
  lastAt: Date;
}

export interface SecuritySummary {
  days: number;
  total: number;
  byType: Record<SecurityEventType, number>;
  /** Un point par jour (AAAA-MM-JJ, UTC), du plus ancien au plus récent. */
  timeline: { day: string; byType: Record<SecurityEventType, number> }[];
  /** Adresses IP les plus actives, de la plus suspecte à la moins suspecte. */
  topIps: SecurityIpView[];
  /** Comptes visés par des mots de passe erronés, avec le nombre d'adresses IP différentes. */
  targetedEmails: { email: string; attempts: number; ips: number }[];
}

const emptyCounts = (): Record<SecurityEventType, number> =>
  Object.fromEntries(SECURITY_EVENT_TYPES.map((type) => [type, 0])) as Record<SecurityEventType, number>;

/** Journal des comportements suspects (robots, essais de mots de passe), pour le tableau de bord. */
@Injectable()
export class SecurityService {
  private readonly logger = new Logger('Sécurité');

  constructor(@InjectModel(SecurityEvent.name) private readonly eventModel: Model<SecurityEvent>) {}

  /** Enregistre un événement sans jamais faire échouer ni ralentir la requête en cours. */
  record(type: SecurityEventType, ip: string, details: { email?: string; path?: string } = {}): void {
    const now = new Date();
    const minute = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    const samples: Record<string, { $each: string[]; $slice: number }> = {};
    if (details.email) samples.emails = { $each: [details.email], $slice: -MAX_SAMPLES };
    if (details.path) samples.paths = { $each: [details.path], $slice: -MAX_SAMPLES };
    const upsert = () =>
      this.eventModel
        .updateOne(
          { type, ip, minute },
          { $inc: { count: 1 }, $set: { lastAt: now }, ...(Object.keys(samples).length > 0 ? { $push: samples } : {}) },
          { upsert: true },
        )
        .exec();
    upsert()
      // Deux créations simultanées du même document : la seconde échoue sur l'index unique, on la rejoue en mise à jour.
      .catch((error: unknown) => ((error as { code?: number }).code === 11000 ? upsert() : Promise.reject(error)))
      .catch((error: unknown) => this.logger.warn(`Événement non enregistré : ${error instanceof Error ? error.message : String(error)}`));
  }

  async summary(days: number): Promise<SecuritySummary> {
    const since = new Date(Date.now() - days * DAY_MS);
    const events = await this.eventModel.find({ minute: { $gte: since } }).sort({ minute: 1 }).lean().exec();

    const byType = emptyCounts();
    const timeline = new Map<string, Record<SecurityEventType, number>>();
    for (let i = days - 1; i >= 0; i--) {
      timeline.set(new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10), emptyCounts());
    }
    const ips = new Map<string, SecurityIpView>();
    const targeted = new Map<string, { attempts: number; ips: Set<string> }>();

    for (const event of events) {
      byType[event.type] += event.count;
      const day = timeline.get(event.minute.toISOString().slice(0, 10));
      if (day) day[event.type] += event.count;

      let ip = ips.get(event.ip);
      if (!ip) {
        ip = { ip: event.ip, total: 0, byType: emptyCounts(), emails: [], paths: [], firstAt: event.minute, lastAt: event.lastAt };
        ips.set(event.ip, ip);
      }
      ip.total += event.count;
      ip.byType[event.type] += event.count;
      if (event.lastAt > ip.lastAt) ip.lastAt = event.lastAt;
      for (const email of event.emails) {
        if (!ip.emails.includes(email) && ip.emails.length < MAX_SAMPLES) ip.emails.push(email);
        if (event.type === 'login_failed') {
          const entry = targeted.get(email) ?? { attempts: 0, ips: new Set<string>() };
          entry.attempts += 1;
          entry.ips.add(event.ip);
          targeted.set(email, entry);
        }
      }
      for (const path of event.paths) {
        if (!ip.paths.includes(path) && ip.paths.length < MAX_SAMPLES) ip.paths.push(path);
      }
    }

    return {
      days,
      total: Object.values(byType).reduce((sum, n) => sum + n, 0),
      byType,
      timeline: [...timeline].map(([day, counts]) => ({ day, byType: counts })),
      topIps: [...ips.values()].sort((a, b) => b.total - a.total).slice(0, 20),
      targetedEmails: [...targeted]
        .map(([email, entry]) => ({ email, attempts: entry.attempts, ips: entry.ips.size }))
        .sort((a, b) => b.attempts - a.attempts)
        .slice(0, 10),
    };
  }
}
