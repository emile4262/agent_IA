import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import type { Env } from '../config/env.validation';
import { InvitationsModule } from '../invitations/invitations.module';
import { MailModule } from '../mail/mail.module';
import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { AdminSeeder } from './admin-seeder';
import { AuthController } from './auth.controller';
import { ACCESS_TOKEN_TTL_SECONDS, AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Token, TokenSchema } from './schemas/token.schema';

@Module({
  imports: [
    UsersModule,
    MailModule,
    InvitationsModule,
    SettingsModule,
    MongooseModule.forFeature([{ name: Token.name, schema: TokenSchema }]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AdminSeeder,
    // Protège toutes les routes de l'API par défaut (voir @Public()).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
