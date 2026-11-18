import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '../../users/schemas/user.schema';

/** Utilisateur extrait du jeton d'accès par JwtAuthGuard. */
export interface AuthUser {
  id: string;
  role: UserRole;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => context.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
