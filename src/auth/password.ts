import { randomBytes } from 'node:crypto';
import { compare, hash, hashSync } from 'bcryptjs';

const BCRYPT_ROUNDS = 12;
// Comparé quand l'e-mail n'existe pas, pour que la réponse prenne le même temps
// et ne révèle pas quelles adresses sont inscrites.
const DUMMY_HASH = hashSync(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string | undefined): Promise<boolean> {
  return compare(password, passwordHash ?? DUMMY_HASH);
}
