import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * login_failed = mauvais mot de passe ou compte désactivé (POST /auth/login → 401) ;
 * rate_limited = trop de requêtes (429) ;
 * access_denied = route d'administration refusée (403) ;
 * unknown_route = adresse inexistante, typique des robots qui cherchent des failles (404 sans route).
 */
export const SECURITY_EVENT_TYPES = ['login_failed', 'rate_limited', 'access_denied', 'unknown_route'] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];
export type SecurityEventDocument = HydratedDocument<SecurityEvent>;

/** Conservation des événements : au-delà, MongoDB les supprime tout seul. */
export const SECURITY_EVENT_RETENTION_DAYS = 30;

/**
 * Événements regroupés par type, adresse IP et minute : une attaque de 10 000 requêtes
 * ne crée que quelques documents, avec le nombre total dans count.
 */
@Schema({ collection: 'security_events' })
export class SecurityEvent {
  @Prop({ type: String, enum: SECURITY_EVENT_TYPES, required: true })
  type!: SecurityEventType;

  @Prop({ required: true })
  ip!: string;

  /** Début de la minute de regroupement. */
  @Prop({ required: true })
  minute!: Date;

  @Prop({ default: 0 })
  count!: number;

  /** Comptes visés (connexion) et adresses demandées : quelques exemples, pas la liste complète. */
  @Prop({ type: [String], default: () => [] })
  emails!: string[];

  @Prop({ type: [String], default: () => [] })
  paths!: string[];

  @Prop({ required: true })
  lastAt!: Date;
}

export const SecurityEventSchema = SchemaFactory.createForClass(SecurityEvent);
SecurityEventSchema.index({ type: 1, ip: 1, minute: 1 }, { unique: true });
SecurityEventSchema.index({ minute: 1 }, { expireAfterSeconds: SECURITY_EVENT_RETENTION_DAYS * 24 * 60 * 60 });
