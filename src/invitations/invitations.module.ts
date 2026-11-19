import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailModule } from '../mail/mail.module';
import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { AdminInvitationsController, AdminInviteLinksController } from './admin-invitations.controller';
import { InvitationsService } from './invitations.service';
import { Invitation, InvitationSchema } from './schemas/invitation.schema';
import { InviteLink, InviteLinkSchema } from './schemas/invite-link.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invitation.name, schema: InvitationSchema },
      { name: InviteLink.name, schema: InviteLinkSchema },
    ]),
    UsersModule,
    SettingsModule,
    MailModule,
  ],
  controllers: [AdminInvitationsController, AdminInviteLinksController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
