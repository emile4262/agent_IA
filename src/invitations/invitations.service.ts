import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';
import { randomToken, sha256 } from '../common/tokens';
import { MailService } from '../mail/mail.service';
import { invitationEmail } from '../mail/mail.templates';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import type { CreateInviteLinkDto } from './dto/invitations.dto';
import { Invitation, type InvitationDocument } from './schemas/invitation.schema';
import { InviteLink, type InviteLinkDocument } from './schemas/invite-link.schema';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface InvitationView {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'expired';
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface InviteLinkView {
  id: string;
  code: string;
  label: string;
  status: 'active' | 'expired' | 'full';
  uses: number;
  maxUses: number | null;
  expiresAt: Date | null;
  createdAt: Date;
}

/** Résultat du contrôle d'accès à l'inscription. */
export interface Admission {
  /** true si la personne a reçu une invitation à cette adresse : inutile de la reconfirmer. */
  emailVerified: boolean;
  /** Rend la place réservée si la création du compte échoue (e-mail déjà pris…). */
  release: () => Promise<void>;
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @InjectModel(Invitation.name) private readonly invitationModel: Model<Invitation>,
    @InjectModel(InviteLink.name) private readonly inviteLinkModel: Model<InviteLink>,
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Décide si une inscription est autorisée et réserve la place :
   * - invitation personnelle : utilisable une fois, seulement avec l'adresse invitée ;
   * - lien partagé : compte une inscription de plus (dans la limite fixée) ;
   * - sans code : seulement si l'admin a ouvert les inscriptions (mode « open »).
   */
  async admit(email: string, invitationToken?: string, inviteCode?: string): Promise<Admission> {
    if (invitationToken && inviteCode) {
      throw new BadRequestException('Indiquez soit invitationToken, soit inviteCode, pas les deux.');
    }
    const now = new Date();

    if (invitationToken) {
      const invitation = await this.invitationModel.findOneAndUpdate(
        { tokenHash: sha256(invitationToken), email: email.toLowerCase(), usedAt: null, expiresAt: { $gt: now } },
        { $set: { usedAt: now } },
      );
      if (!invitation) {
        throw new BadRequestException(
          'Invitation invalide, expirée, déjà utilisée ou envoyée à une autre adresse e-mail.',
        );
      }
      return {
        emailVerified: true,
        release: async () => {
          await this.invitationModel.updateOne({ _id: invitation._id }, { $set: { usedAt: null } });
        },
      };
    }

    if (inviteCode) {
      const link = await this.inviteLinkModel.findOneAndUpdate(
        {
          code: inviteCode,
          $and: [
            { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
            { $or: [{ maxUses: null }, { $expr: { $lt: ['$uses', '$maxUses'] } }] },
          ],
        },
        { $inc: { uses: 1 } },
      );
      if (!link) {
        throw new BadRequestException('Lien d’inscription invalide, expiré ou complet.');
      }
      return {
        emailVerified: false,
        release: async () => {
          await this.inviteLinkModel.updateOne({ _id: link._id }, { $inc: { uses: -1 } });
        },
      };
    }

    const { registrationMode } = await this.settingsService.get();
    if (registrationMode !== 'open') {
      throw new ForbiddenException('Les inscriptions se font uniquement sur invitation.');
    }
    return { emailVerified: false, release: async () => {} };
  }

  /** Envoie une invitation personnelle ; une invitation encore en attente pour la même adresse est remplacée. */
  async invite(adminId: string, email: string): Promise<InvitationView> {
    if (await this.usersService.existsByEmail(email)) {
      throw new ConflictException('Un compte existe déjà avec cette adresse e-mail.');
    }
    const admin = await this.usersService.findById(adminId);
    const inviterName = admin ? `${admin.firstName} ${admin.lastName}`.trim() : 'L’administrateur';

    await this.invitationModel.deleteMany({ email, usedAt: null });
    const token = randomToken();
    const invitation = await this.invitationModel.create({
      email,
      tokenHash: sha256(token),
      invitedBy: adminId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    });

    try {
      await this.mailService.send(invitationEmail(email, inviterName, token));
    } catch (error) {
      this.logger.error(`Invitation non envoyée à ${email}`, error instanceof Error ? error.stack : error);
      await invitation.deleteOne();
      throw new ServiceUnavailableException('L’e-mail d’invitation n’a pas pu être envoyé. Réessayez plus tard.');
    }
    return InvitationsService.toInvitationView(invitation);
  }

  async listInvitations(): Promise<InvitationView[]> {
    const invitations = await this.invitationModel.find().sort({ createdAt: -1 }).exec();
    return invitations.map((invitation) => InvitationsService.toInvitationView(invitation));
  }

  /** Supprime une invitation : si elle n'a pas encore servi, son code ne marche plus. */
  async revokeInvitation(id: string): Promise<void> {
    const deleted = isValidObjectId(id) ? await this.invitationModel.findByIdAndDelete(id) : null;
    if (!deleted) {
      throw new NotFoundException('Invitation introuvable.');
    }
  }

  async createLink(adminId: string, dto: CreateInviteLinkDto): Promise<InviteLinkView> {
    const link = await this.inviteLinkModel.create({
      code: randomToken(12),
      label: dto.label ?? '',
      createdBy: adminId,
      maxUses: dto.maxUses ?? null,
      expiresAt: dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * DAY_MS) : null,
    });
    return InvitationsService.toLinkView(link);
  }

  async listLinks(): Promise<InviteLinkView[]> {
    const links = await this.inviteLinkModel.find().sort({ createdAt: -1 }).exec();
    return links.map((link) => InvitationsService.toLinkView(link));
  }

  /** Supprime un lien : son code ne permet plus de s'inscrire. Les comptes déjà créés restent. */
  async deleteLink(id: string): Promise<void> {
    const deleted = isValidObjectId(id) ? await this.inviteLinkModel.findByIdAndDelete(id) : null;
    if (!deleted) {
      throw new NotFoundException('Lien d’inscription introuvable.');
    }
  }

  static toInvitationView(invitation: InvitationDocument): InvitationView {
    const status = invitation.usedAt ? 'accepted' : invitation.expiresAt <= new Date() ? 'expired' : 'pending';
    return {
      id: invitation.id as string,
      email: invitation.email,
      status,
      expiresAt: invitation.expiresAt,
      usedAt: invitation.usedAt,
      createdAt: invitation.createdAt,
    };
  }

  static toLinkView(link: InviteLinkDocument): InviteLinkView {
    const status =
      link.expiresAt && link.expiresAt <= new Date()
        ? 'expired'
        : link.maxUses !== null && link.uses >= link.maxUses
          ? 'full'
          : 'active';
    return {
      id: link.id as string,
      code: link.code,
      label: link.label,
      status,
      uses: link.uses,
      maxUses: link.maxUses,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
    };
  }
}
