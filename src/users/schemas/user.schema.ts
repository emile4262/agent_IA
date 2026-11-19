import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Preferences, PreferencesSchema } from './preferences.schema';

export type UserRole = 'user' | 'admin';
export type UserDocument = HydratedDocument<User>;

/** Une personne inscrite sur la plateforme. */
@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  /** Mot de passe haché avec bcrypt. Jamais renvoyé par défaut (select: false). */
  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ required: true, trim: true })
  firstName!: string;

  @Prop({ trim: true, default: '' })
  lastName!: string;

  @Prop({ type: String, enum: ['user', 'admin'], default: 'user', immutable: true })
  role!: UserRole;

  @Prop({ default: false })
  emailVerified!: boolean;

  @Prop({ default: false })
  mustChangePassword!: boolean;

  @Prop({ default: true })
  active!: boolean;

  /** Choix de veille ; les comptes créés avant la phase 2 reçoivent les valeurs par défaut à la lecture. */
  @Prop({ type: PreferencesSchema, default: () => ({}) })
  preferences!: Preferences;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
