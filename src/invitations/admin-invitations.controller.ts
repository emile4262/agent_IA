import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateInvitationDto, CreateInviteLinkDto } from './dto/invitations.dto';
import { InvitationsService, type InvitationView, type InviteLinkView } from './invitations.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/invitations')
export class AdminInvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  /** Envoie par e-mail une invitation personnelle, valable 7 jours et une seule fois. */
  @Post()
  invite(@CurrentUser() admin: AuthUser, @Body() dto: CreateInvitationDto): Promise<InvitationView> {
    return this.invitationsService.invite(admin.id, dto.email);
  }

  /** Toutes les invitations, avec leur état : pending (en attente), accepted, expired. */
  @Get()
  list(): Promise<InvitationView[]> {
    return this.invitationsService.listInvitations();
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@Param('id') id: string): Promise<void> {
    return this.invitationsService.revokeInvitation(id);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/invite-links')
export class AdminInviteLinksController {
  constructor(private readonly invitationsService: InvitationsService) {}

  /** Crée un lien à partager ; les inscrits l'utilisent via le champ inviteCode de POST /auth/register. */
  @Post()
  create(@CurrentUser() admin: AuthUser, @Body() dto: CreateInviteLinkDto): Promise<InviteLinkView> {
    return this.invitationsService.createLink(admin.id, dto);
  }

  /** Tous les liens, avec leur état : active, expired, full (limite atteinte). */
  @Get()
  list(): Promise<InviteLinkView[]> {
    return this.invitationsService.listLinks();
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.invitationsService.deleteLink(id);
  }
}
