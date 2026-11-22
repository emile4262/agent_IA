import type { NextFunction, Request, Response } from 'express';
import type { SecurityService } from './security.service';

/** Longueur maximale d'une adresse demandée gardée en exemple. */
const MAX_PATH_LENGTH = 200;

/**
 * Observe chaque réponse et signale les comportements suspects au SecurityService.
 * Branché dans main.ts avant toutes les routes, pour voir aussi les adresses inexistantes.
 */
export function securityMonitor(security: SecurityService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', () => {
      const path = req.originalUrl.split('?')[0].slice(0, MAX_PATH_LENGTH);
      const ip = req.ip ?? 'inconnue';
      const status = res.statusCode;

      if (status === 429) {
        security.record('rate_limited', ip, { path });
      } else if (status === 401 && path === '/auth/login') {
        const email = (req.body as { email?: unknown } | undefined)?.email;
        security.record('login_failed', ip, {
          email: typeof email === 'string' ? email.trim().toLowerCase().slice(0, 100) : undefined,
        });
      } else if (status === 403 && path.startsWith('/admin')) {
        security.record('access_denied', ip, { path });
      } else if (status === 404 && !req.route) {
        // Aucune route ne correspond : robot qui cherche /wp-admin, /.env, /phpmyadmin…
        security.record('unknown_route', ip, { path });
      }
    });
    next();
  };
}
