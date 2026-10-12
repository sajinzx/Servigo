import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

/**
 * Payout details (UPI id, bank account) are stored encrypted with AES-256-GCM.
 * The key lives only in the API's environment, never in the database, so a
 * database leak alone does not expose them.
 *
 * Format: base64(version(1) | iv(12) | tag(16) | ciphertext)
 */
const VERSION = 1;

export function parseKey(b64: string): Buffer {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes, base64 encoded');
  return key;
}

export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decrypt(token: string, key: Buffer): string {
  const raw = Buffer.from(token, 'base64');
  if (raw[0] !== VERSION) throw new Error('unknown ciphertext version');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(1, 13));
  decipher.setAuthTag(raw.subarray(13, 29));
  return Buffer.concat([decipher.update(raw.subarray(29)), decipher.final()]).toString('utf8');
}

/**
 * Keyed hash used to spot the same payout account on two applications without
 * decrypting anything. Normalised so spacing and case do not hide a duplicate.
 */
export function fingerprint(value: string, key: Buffer): string {
  const normalised = value.replace(/\s+/g, '').toLowerCase();
  return createHmac('sha256', key).update(`payout:${normalised}`).digest('hex');
}

export const last4 = (value: string) => value.replace(/\s+/g, '').slice(-4);
