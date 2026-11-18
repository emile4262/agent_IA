import { randomBytes } from 'node:crypto';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { UsersService } from '../users/users.service';
import { hashPassword } from './password';

/**
 * Au démarrage de l'API : si aucun administrateur n'existe (premier lancement),
 * crée le compte défini par ADMIN_EMAIL / ADMIN_PASSWORD dans .env.
 * Sans ADMIN_PASSWORD, un mot de passe aléatoire est généré et affiché une seule fois.
 * Dans les deux cas, l'admin devra le changer (POST /auth/change-password).
 */
@Injectable()
export class AdminSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeeder.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (await this.usersService.hasAdmin()) {
      return;
    }

    const email = this.config.get('ADMIN_EMAIL', { infer: true });
    const configuredPassword = this.config.get('ADMIN_PASSWORD', { infer: true });
    const password = configuredPassword ?? randomBytes(12).toString('base64url');

    await this.usersService.create({
      email,
      firstName: 'Admin',
      lastName: 'Plateforme',
      passwordHash: await hashPassword(password),
      role: 'admin',
      mustChangePassword: true,
    });

    this.logger.warn(`Premier lancement : compte administrateur créé pour « ${email} ».`);
    if (configuredPassword) {
      this.logger.warn('Mot de passe : celui de ADMIN_PASSWORD dans .env. Changez-le via POST /auth/change-password.');
    } else {
      // Affiché une seule fois : ce mot de passe n'est stocké nulle part en clair.
      this.logger.warn(`Mot de passe provisoire : ${password}`);
      this.logger.warn('Notez-le maintenant et changez-le via POST /auth/change-password.');
    }
  }
}
