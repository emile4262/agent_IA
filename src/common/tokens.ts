import { createHash, randomBytes } from 'node:crypto';

/** Jeton aléatoire utilisable dans une URL. */
export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/** Empreinte stockée en base à la place du jeton lui-même. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
