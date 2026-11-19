import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';
import { TOPICS, type Topic } from '../../sources/topics';

export const ARTICLE_STATUSES = ['pending', 'summarized', 'failed'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
/** Un article en échec est réessayé à chaque collecte, jusqu'à ce nombre d'essais. */
export const MAX_SUMMARY_ATTEMPTS = 3;
export type ArticleDocument = HydratedDocument<Article>;

/**
 * Un article lu dans un flux RSS (une source, ou une recherche Google News par mot-clé).
 * Collecté et résumé une seule fois pour tous les utilisateurs ; le tri par note se fait ensuite pour chacun.
 */
@Schema({ timestamps: true })
export class Article {
  @Prop({ required: true, unique: true })
  url!: string;

  /** null = trouvé par une recherche par mot-clé, pas dans une source. */
  @Prop({ type: Types.ObjectId, ref: 'Source', default: null })
  sourceId!: Types.ObjectId | null;

  /** Mots-clés dont la recherche a trouvé cet article. */
  @Prop({ type: [String], default: () => [] })
  keywords!: string[];

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
ArticleSchema.index({ keywords: 1, status: 1 });
