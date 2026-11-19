import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signature du lien de désinscription : le lien reste valable sans rien stocker en base,
 * et personne ne peut désinscrire un autre compte sans l'avoir reçu.
 * Changer JWT_ACCESS_SECRET invalide les liens des e-mails déjà envoyés.
 */
export function unsubscribeSignature(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(`unsubscribe:${userId}`).digest('base64url');
}

export function unsubscribeLink(appUrl: string, userId: string, secret: string): string {
  return `${appUrl}/unsubscribe?u=${userId}&t=${unsubscribeSignature(userId, secret)}`;
}

/** Comparaison en temps constant, pour ne pas laisser deviner la signature caractère par caractère. */
export function isValidUnsubscribe(userId: unknown, signature: unknown, secret: string): userId is string {
  if (typeof userId !== 'string' || typeof signature !== 'string' || !/^[a-f0-9]{24}$/i.test(userId)) {
    return false;
  }
  const expected = Buffer.from(unsubscribeSignature(userId, secret));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
