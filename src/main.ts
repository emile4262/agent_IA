import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  const config = app.get(ConfigService<Env, true>);

  // En-têtes de sécurité (anti-clickjacking, anti-sniffing, HSTS…) et masquage de « X-Powered-By ».
  app.use(helmet());
  // Derrière un hébergeur ou un load balancer : lire la vraie adresse IP pour la limite de requêtes.
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  // Seule l'interface web déclarée peut appeler l'API depuis un navigateur.
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], maxAge: 3600 });
  }

  // Vérifie le corps des requêtes à partir des DTO et refuse les champs inconnus.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, stopAtFirstError: true }),
  );

  const port = config.get('PORT', { infer: true });
  const withDocs = config.get('NODE_ENV', { infer: true }) !== 'production';

  // Documentation interactive pour tester l'API depuis le navigateur (désactivée en production).
  if (withDocs) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('API Veille technologique')
        .setDescription('Connectez-vous avec POST /auth/login, puis collez accessToken dans « Authorize ».')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document, { swaggerOptions: { persistAuthorization: true } });
  }

  await app.listen(port);

  Logger.log(`API démarrée sur http://localhost:${port} (vérification : GET /health)`, 'Bootstrap');
  if (withDocs) {
    Logger.log(`Documentation Swagger : http://localhost:${port}/docs`, 'Bootstrap');
  }
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : error, undefined, 'Bootstrap');
  process.exit(1);
});
