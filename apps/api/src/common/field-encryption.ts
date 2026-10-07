import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

// No-ops if FIELD_ENCRYPTION_KEY isn't set, same placeholder-credential pattern used
// elsewhere in this app — but unlike those, this key is free to generate locally
// (see README/.env.example), so there's no reason to ever leave it unset in production.
function getKey(): Buffer | null {
  const key = process.env.FIELD_ENCRYPTION_KEY;
  if (!key) return null;
  return Buffer.from(key, 'hex');
}

export function encryptField(
  plaintext: string | null | undefined,
): string | null | undefined {
  if (plaintext === null || plaintext === undefined) return plaintext;
  const key = getKey();
  if (!key) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    'enc',
    iv.toString('hex'),
    tag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

export function decryptField(
  value: string | null | undefined,
): string | null | undefined {
  if (!value || !value.startsWith('enc:')) return value;
  const key = getKey();
  if (!key) return value;
  const [, ivHex, tagHex, dataHex] = value.split(':');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function decryptUserPhone<T extends { phone?: string | null }>(
  user: T,
): T {
  return { ...user, phone: decryptField(user.phone) };
}
