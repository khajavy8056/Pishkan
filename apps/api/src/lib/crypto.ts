import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../env.js';

/* ------------------------------- identifiers ------------------------------ */

const ALPHABET = '0123456789abcdefghijkmnpqrstuvwxyz';

export function id(prefix: string): string {
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function numericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, '0');
}

/* -------------------------------- passwords ------------------------------- */

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/* --------------------------------- hashing -------------------------------- */

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hmac(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/* ------------------------------- encryption ------------------------------- */

/**
 * Integration credentials (SMS keys, gateway keys, SMTP password, ...) are
 * encrypted at rest with AES-256-GCM. The key never leaves the server and is
 * supplied through APP_ENCRYPTION_KEY by the installer.
 */
function encryptionKeyBuffer(): Buffer {
  const raw = env.encryptionKey;
  if (raw && raw.length >= 32) return crypto.createHash('sha256').update(raw).digest();
  if (env.isProd) throw new Error('APP_ENCRYPTION_KEY is required in production');
  // Development/test fallback — deterministic per machine, never used in prod.
  return crypto.createHash('sha256').update('pishkan-dev-insecure-key').digest();
}

export function encryptSecret(plain: string): string {
  if (plain === '' || plain === null || plain === undefined) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKeyBuffer(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

export function decryptSecret(payload: string | null | undefined): string {
  if (!payload) return '';
  if (!payload.startsWith('v1:')) return payload; // legacy / plaintext-migrated value
  const [, ivB64, tagB64, dataB64] = payload.split(':');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKeyBuffer(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** Mask a secret for display: never reveal more than the last 4 characters. */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `••••••••${value.slice(-4)}`;
}
