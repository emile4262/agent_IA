import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { TOPICS, type Topic } from '../topics';

export type SourceDocument = HydratedDocument<Source>;

/** Un flux RSS du catalogue, géré par l'administrateur. */
@Schema({ timestamps: true })
export class Source {
  /** Ex. « dev.to · DevOps ». */
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, unique: true, trim: true })
  feedUrl!: string;

  @Prop({ type: String, enum: TOPICS, required: true })
  topic!: Topic;

  /** Une source désactivée n'est plus lue ni proposée aux utilisateurs. */
  @Prop({ default: true })
  active!: boolean;

  /** Rempli par la collecte (phase 3). */
  @Prop({ type: Date, default: null })
  lastFetchedAt!: Date | null;

  @Prop({ type: String, default: null })
  lastError!: string | null;

  createdAt!: Date;
}

export const SourceSchema = SchemaFactory.createForClass(Source);
