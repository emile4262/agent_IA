import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';
import { TOPICS, type Topic } from '../../sources/topics';

export const ARTICLE_STATUSES = ['pending', 'summarized', 'failed'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
/** Un article en échec est réessayé à chaque collecte, jusqu'à ce nombre d'essais. */
export const MAX_SUMMARY_ATTEMPTS = 3;
export type ArticleDocument = HydratedDocument<Article>;

/**
 * Un article lu dans un flux RSS. Collecté et résumé une seule fois pour tous les utilisateurs ;
 * le tri par note se fait ensuite pour chacun (phase 4).
 */
@Schema({ timestamps: true })
export class Article {
  @Prop({ required: true, unique: true })
  url!: string;

  @Prop({ type: Types.ObjectId, ref: 'Source', required: true })
  sourceId!: Types.ObjectId;

  @Prop({ required: true })
  title!: string;

  @Prop({ default: '' })
  snippet!: string;

  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  @Prop({ type: String, enum: ARTICLE_STATUSES, default: 'pending' })
  status!: ArticleStatus;

  @Prop({ default: 0 })
  attempts!: number;

  @Prop({ type: String, default: null })
  lastError!: string | null;

  @Prop({ type: String, default: null })
  titleFr!: string | null;

  @Prop({ type: String, enum: [...TOPICS, null], default: null })
  topic!: Topic | null;

  @Prop({ type: String, default: null })
  summary!: string | null;

  /** Pertinence technique de 1 à 10. */
  @Prop({ type: Number, default: null })
  score!: number | null;

  @Prop({ type: Date, default: null })
  summarizedAt!: Date | null;

  createdAt!: Date;
}

export const ArticleSchema = SchemaFactory.createForClass(Article);
// File d'attente des résumés, et sélection des articles prêts (phase 4).
ArticleSchema.index({ status: 1, createdAt: -1 });
ArticleSchema.index({ status: 1, summarizedAt: -1, score: -1 });
