import { applyDecorators } from '@nestjs/common';
import { Throttle, type ThrottlerModuleOptions } from '@nestjs/throttler';

const MINUTE_MS = 60_000;

/** Toutes les routes : 100 requêtes par minute et par adresse IP. */
const DEFAULT_LIMIT = 100;
/** Routes sensibles (connexion, inscription, mot de passe) : 10 essais par quart d'heure. */
const SENSITIVE_LIMIT = 10;
const SENSITIVE_TTL_MS = 15 * MINUTE_MS;

export function rateLimitOptions(enabled: boolean): ThrottlerModuleOptions {
  return {
    throttlers: [{ name: 'default', limit: DEFAULT_LIMIT, ttl: MINUTE_MS }],
    errorMessage: 'Trop de requêtes. Réessayez dans quelques minutes.',
    skipIf: () => !enabled,
  };
}

/** Limite stricte, comptée séparément pour chaque route, contre les essais de mots de passe en série. */
export const SensitiveThrottle = (): MethodDecorator & ClassDecorator =>
  applyDecorators(Throttle({ default: { limit: SENSITIVE_LIMIT, ttl: SENSITIVE_TTL_MS } }));

/**
 * Connexion : compte par adresse IP et par e-mail. Un attaquant ne peut pas essayer plus de
 * 10 mots de passe sur un compte, sans bloquer les collègues qui partagent la même connexion.
 */
export const LoginThrottle = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    Throttle({
      default: {
        limit: SENSITIVE_LIMIT,
        ttl: SENSITIVE_TTL_MS,
        getTracker: (req: { ip?: string; body?: { email?: unknown } }) => {
          const email = req.body?.email;
          const account = typeof email === 'string' ? email.trim().toLowerCase() : '';
          return `${req.ip ?? ''}|${account}`;
        },
      },
    }),
  );
