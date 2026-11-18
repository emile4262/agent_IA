import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../users/schemas/user.schema';

export const ROLES_KEY = 'roles';

/** Réserve une route (ou tout un contrôleur) aux rôles indiqués, par exemple @Roles('admin'). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
