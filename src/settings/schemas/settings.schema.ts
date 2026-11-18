import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * open : tout le monde peut s'inscrire.
 * invitation : inscription seulement avec une invitation ou un lien partagé par l'admin.
 */
export const REGISTRATION_MODES = ['open', 'invitation'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

/** Réglages de la plateforme : un seul document, identifié par key = 'global'. */
@Schema({ collection: 'settings', timestamps: true })
export class Settings {
  @Prop({ required: true, unique: true })
  key!: string;

  @Prop({ type: String, enum: REGISTRATION_MODES, default: 'open' })
  registrationMode!: RegistrationMode;
}

export const SettingsSchema = SchemaFactory.createForClass(Settings);
