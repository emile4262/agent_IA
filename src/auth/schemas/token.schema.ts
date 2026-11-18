import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

/**
 * refresh : jeton de renouvellement de session (7 jours).
 * email_verification : lien de confirmation de l'adresse (24 heures).
 * password_reset : code de réinitialisation du mot de passe (1 heure).
 */
export type TokenType = 'refresh' | 'email_verification' | 'password_reset';
export type TokenDocument = HydratedDocument<Token>;

/**
 * Jeton à usage unique. Seule son empreinte SHA-256 est stockée :
 * une fuite de la base ne permet pas de réutiliser les jetons.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Token {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: ['refresh', 'email_verification', 'password_reset'], required: true })
  type!: TokenType;

  @Prop({ required: true, unique: true })
  tokenHash!: string;

  /** MongoDB supprime automatiquement le document une fois cette date passée (index TTL). */
  @Prop({ required: true, expires: 0 })
  expiresAt!: Date;
}

export const TokenSchema = SchemaFactory.createForClass(Token);
