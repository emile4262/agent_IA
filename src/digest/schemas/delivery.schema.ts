import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';
import type { Topic } from '../../sources/topics';

export const DELIVERY_KINDS = ['scheduled', 'manual'] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];
export const DELIVERY_STATUSES = ['sending', 'sent', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type DeliveryDocument = HydratedDocument<Delivery>;

/** Copie de l'article au moment de l'envoi : l'historique reste lisible même si l'article change. */
@Schema({ _id: false })
export class DeliveredArticle {
  @Prop({ type: Types.ObjectId, required: true })
  articleId!: Types.ObjectId;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  url!: string;

  @Prop({ type: String, required: true })
  topic!: Topic;

  /** Mot-clé de l'utilisateur qui a fait choisir l'article, null s'il vient d'un sujet fixe. */
  @Prop({ type: String, default: null })
  keyword!: string | null;

  @Prop({ required: true })
  score!: number;

  @Prop({ required: true })
  summary!: string;
}

const DeliveredArticleSchema = SchemaFactory.createForClass(DeliveredArticle);

/** Un envoi de veille à un utilisateur. */
@Schema({ timestamps: true })
export class Delivery {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  /** Jour de la veille « AAAA-MM-JJ », dans le fuseau de l'utilisateur. */
  @Prop({ required: true })
  digestDate!: string;

  /** scheduled = envoi automatique (un par jour au plus), manual = POST /digest/send-now. */
  @Prop({ type: String, enum: DELIVERY_KINDS, required: true })
  kind!: DeliveryKind;

  /** sending = en cours (réservé), sent = envoyé, failed = échec (réessayé jusqu'à MAX_DELIVERY_ATTEMPTS). */
  @Prop({ type: String, enum: DELIVERY_STATUSES, default: 'sending' })
  status!: DeliveryStatus;

  @Prop({ default: 1 })
  attempts!: number;

  @Prop({ type: String, default: null })
  error!: string | null;

  @Prop({ type: [DeliveredArticleSchema], default: [] })
  articles!: DeliveredArticle[];

  @Prop({ type: Date, default: null })
  sentAt!: Date | null;

  createdAt!: Date;
}

export const DeliverySchema = SchemaFactory.createForClass(Delivery);
// Un seul envoi automatique par utilisateur et par jour, même si deux vérifications se chevauchent.
DeliverySchema.index(
  { userId: 1, digestDate: 1 },
  { unique: true, partialFilterExpression: { kind: 'scheduled' } },
);
DeliverySchema.index({ userId: 1, createdAt: -1 });
