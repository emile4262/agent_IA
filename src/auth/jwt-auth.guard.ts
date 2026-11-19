import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { UserRole } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import type { AccessTokenPayload } from './auth.service';
import { ALLOW_PENDING_PASSWORD_KEY } from './decorators/allow-pending-password.decorator';
import type { AuthUser } from './decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { ROLES_KEY } from './decorators/roles.decorator';

/**
 * Garde appliquée à toute l'API. Sauf pour les routes @Public(), elle exige :
 * 1. un jeton d'accès valide (en-tête « Authorization: Bearer … ») ;
 * 2. un compte qui existe toujours et n'est pas désactivé (vérifié à chaque requête) ;
 * 3. un mot de passe provisoire déjà changé, sauf sur les routes @AllowPendingPassword() ;
 * 4. le bon rôle, si la route est marquée @Roles(...).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Connexion requise.');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Jeton invalide ou expiré.');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.active) {
      throw new UnauthorizedException('Compte introuvable ou désactivé.');
    }
    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, targets)) {
      throw new ForbiddenException('Changez d’abord votre mot de passe provisoire (POST /auth/change-password).');
    }

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException('Accès réservé à l’administrateur.');
    }

    request.user = { id: user.id as string, role: user.role };
    return true;
  }
}
