import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { rateLimitOptions } from './common/rate-limit';
import { validateEnv, type Env } from './config/env.validation';
import { AuthModule } from './auth/auth.module';
import { CollectorModule } from './collector/collector.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DigestModule } from './digest/digest.module';
import { HealthModule } from './health/health.module';
import { PreferencesModule } from './preferences/preferences.module';
import { SecurityModule } from './security/security.module';
import { SourcesModule } from './sources/sources.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Lit le fichier .env et vérifie les variables au démarrage.
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    // Connexion unique à MongoDB, partagée par tous les modules.
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGODB_URI', { infer: true }),
        serverSelectionTimeoutMS: 10_000,
      }),
    }),
    // Limite le nombre de requêtes par adresse IP (voir common/rate-limit.ts).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => rateLimitOptions(config.get('RATE_LIMIT', { infer: true })),
    }),
    HealthModule,
    UsersModule,
    AuthModule,
    SourcesModule,
    PreferencesModule,
    CollectorModule,
    DigestModule,
    SecurityModule,
    DashboardModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
