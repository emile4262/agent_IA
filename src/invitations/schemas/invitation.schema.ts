import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type InvitationDocument = HydratedDocument<Invitation>;

/**
 * Invitation personnelle envoyée par e-mail à une adresse précise, valable une seule fois.
 * Comme les autres jetons, seule l'empreinte SHA-256 du code est stockée.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Invitation {
  @Prop({ required: true, lowercase: true, trim: true, index: true })
  email!: string;

  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  invitedBy!: Types.ObjectId;

  @Prop({ required: true })
  expiresAt!: Date;

  /** Date d'inscription de la personne invitée ; null tant que l'invitation n'a pas servi. */
  @Prop({ type: Date, default: null })
  usedAt!: Date | null;

  createdAt!: Date;
}

export const InvitationSchema = SchemaFactory.createForClass(Invitation);
