import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_PASSWORD_KEY = 'allowPendingPassword';

/**
 * Route utilisable même si le compte doit encore changer son mot de passe provisoire
 * (mustChangePassword). Toutes les autres routes renvoient 403 tant que ce n'est pas fait.
 */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);
