import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';

// OWASP-recommended minimums for argon2id (2024 guidance): >=19 MiB memory, >=2 iterations.
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export function isLegacyBcryptHash(hash: string): boolean {
  return (
    hash.startsWith('$2a$') ||
    hash.startsWith('$2b$') ||
    hash.startsWith('$2y$')
  );
}

// Accounts created before the Argon2id migration still have bcrypt hashes. Verify against
// whichever algorithm produced the stored hash — the caller is responsible for re-hashing
// with hashPassword() on a successful legacy verify, since that's the only point we ever
// have the plaintext password again.
export function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  if (isLegacyBcryptHash(hash)) {
    return bcrypt.compare(password, hash);
  }
  return argon2.verify(hash, password);
}
