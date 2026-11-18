import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type InviteLinkDocument = HydratedDocument<InviteLink>;

/**
 * Lien d'inscription à partager (groupe WhatsApp, affiche…), utilisable par plusieurs personnes.
 * Le code est gardé en clair pour que l'admin puisse le recopier ; il ne donne accès
 * qu'à l'inscription, jamais à un compte existant.
 */
@Schema({ collection: 'invite_links', timestamps: { createdAt: true, updatedAt: false } })
export class InviteLink {
  @Prop({ required: true, unique: true })
  code!: string;

  /** Pour s'y retrouver : « Promo 2026 », « Groupe WhatsApp dev »… */
  @Prop({ trim: true, default: '' })
  label!: string;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  createdBy!: Types.ObjectId;

  /** Nombre maximal d'inscriptions ; null = illimité. */
  @Prop({ type: Number, default: null })
  maxUses!: number | null;

  @Prop({ default: 0 })
  uses!: number;

  /** null = sans date d'expiration. */
  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;

  createdAt!: Date;
}

export const InviteLinkSchema = SchemaFactory.createForClass(InviteLink);
