import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TOPICS, type Topic } from '../../sources/topics';

export const FREQUENCIES = ['daily', 'weekdays', 'weekly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** Choix de veille d'un utilisateur. Les valeurs par défaut s'appliquent dès l'inscription. */
@Schema({ _id: false })
export class Preferences {
  @Prop({ type: [String], enum: TOPICS, default: () => ['Backend', 'DevOps', 'IA'] })
  topics!: Topic[];

  @Prop({ type: [Types.ObjectId], default: null })
  sourceIds!: Types.ObjectId[] | null;

  @Prop({ type: [String], default: () => [] })
  keywords!: string[];

  @Prop({ default: 5 })
  minScore!: number;

  @Prop({ default: 10 })
  maxArticles!: number;

  @Prop({ default: '08:00' })
  sendTime!: string;

  @Prop({ default: 'Africa/Abidjan' })
  timezone!: string;

  @Prop({ type: String, enum: FREQUENCIES, default: 'daily' })
  frequency!: Frequency;

  @Prop({ default: true })
  active!: boolean;
}

export const PreferencesSchema = SchemaFactory.createForClass(Preferences);
