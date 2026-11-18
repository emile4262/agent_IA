import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

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

  /** Obligatoire à l'inscription (RegisterDto) ; vide pour les comptes créés avant son ajout. */
  @Prop({ trim: true, default: '' })
  lastName!: string;

  /** Fixé à la création (« user » par défaut) et non modifiable ensuite (immutable). */
  @Prop({ type: String, enum: ['user', 'admin'], default: 'user', immutable: true })
  role!: UserRole;

  /** Passe à true quand la personne clique sur le lien de confirmation (étape 1.2). */
  @Prop({ default: false })
  emailVerified!: boolean;

  /** true pour l'admin créé au premier lancement, tant qu'il n'a pas choisi son propre mot de passe. */
  @Prop({ default: false })
  mustChangePassword!: boolean;

  /** Un compte désactivé ne peut plus se connecter ni recevoir la veille. */
  @Prop({ default: true })
  active!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
