import { createHash, randomBytes } from 'node:crypto';
import { CONTRACT_REQUIRED_FIELD_KEYS } from './contractFields';

export function generateDataRequestToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashDataRequestToken(token);
  return { token, tokenHash };
}

export function hashDataRequestToken(token: string): string {
  return createHash('sha256').update(String(token || '').trim()).digest('hex');
}

export function commercialDataRequestTtlDays(): number {
  const n = Number(process.env.COMMERCIAL_DATA_REQUEST_TTL_DAYS || 7);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

export function defaultRequiredFields(): string[] {
  return [...CONTRACT_REQUIRED_FIELD_KEYS];
}
