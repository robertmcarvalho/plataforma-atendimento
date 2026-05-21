import { encryptSecret, decryptSecret } from './credentialsCrypto';
import { getLlmProviderDefinition, secretCredentialKeysForProvider } from './llmProviderCatalog';

/** Encripta apenas chaves marcadas como secret no catálogo. */
export function encryptLlmCredentialRecord(providerId: string, raw: Record<string, unknown>): Record<string, unknown> {
  const keys = secretCredentialKeysForProvider(providerId);
  const out = { ...raw };
  for (const key of keys) {
    const val = raw[key];
    if (typeof val === 'string' && val && !val.startsWith('{')) {
      out[key] = encryptSecret(val);
    }
  }
  return out;
}

export function decryptLlmCredentialRecord(providerId: string, raw: Record<string, unknown>): Record<string, unknown> {
  const keys = secretCredentialKeysForProvider(providerId);
  const out = { ...raw };
  for (const key of keys) {
    const val = raw[key];
    if (typeof val === 'string') out[key] = decryptSecret(val);
  }
  return out;
}

/** Plaintext credential strings para chamadas HTTP. */
export function flattenedCredentials(providerId: string, raw: Record<string, unknown>): Record<string, string> {
  const dec = decryptLlmCredentialRecord(providerId, raw);
  const out: Record<string, string> = {};
  const def = getLlmProviderDefinition(providerId);
  const keys = def ? def.credentialFields.map((f) => f.key) : ['api_key'];
  for (const k of keys) {
    const v = dec[k];
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}
