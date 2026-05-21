import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function encryptionKey(): Buffer | null {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

function requireEncryptionKeyForProduction(): Buffer | null {
  const key = encryptionKey();
  if (!key && process.env.NODE_ENV === 'production') {
    throw new Error('INTEGRATIONS_ENCRYPTION_KEY must be set in production.');
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const key = requireEncryptionKeyForProduction();
  if (!key || !plain) return plain;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  });
}

export function decryptSecret(stored: string): string {
  if (!stored || !stored.startsWith('{')) return stored;
  try {
    const parsed = JSON.parse(stored) as { v?: number; iv?: string; tag?: string; data?: string };
    if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) return stored;
    const key = requireEncryptionKeyForProduction();
    if (!key) return '';
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final(),
    ]);
    return dec.toString('utf8');
  } catch {
    return '';
  }
}

export function maskSecret(value: string | null | undefined, visible = 4): string | null {
  if (!value) return null;
  const v = String(value);
  if (v.length <= visible) return '••••';
  return `••••${v.slice(-visible)}`;
}
