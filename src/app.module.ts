import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { validateEnv, type Env } from './config/env.validation';
import { HealthModule } from './health/health.module';

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
    HealthModule,
  ],
})
export class AppModule {}
