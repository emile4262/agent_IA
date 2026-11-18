import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // Vérifie le corps des requêtes à partir des DTO et refuse les champs inconnus.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, stopAtFirstError: true }),
  );

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });

  // Documentation interactive pour tester l'API depuis le navigateur (désactivée en production).
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
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
  Logger.log(`Documentation Swagger : http://localhost:${port}/docs`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : error, undefined, 'Bootstrap');
  process.exit(1);
});
