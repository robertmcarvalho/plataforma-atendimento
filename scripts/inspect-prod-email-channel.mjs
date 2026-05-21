#!/usr/bin/env node
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadProductionApiEnv, assertProductionTarget } from './lib/loadProdEnv.mjs';

function decryptSecret(stored) {
  if (!stored || !stored.startsWith('{')) return { kind: 'plain', len: String(stored).length };
  try {
    const parsed = JSON.parse(stored);
    const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim();
    if (!raw) return { kind: 'encrypted', len: 0 };
    const key = crypto.createHash('sha256').update(raw).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return { kind: 'encrypted', len: dec.length, last2: dec.slice(-2) };
  } catch {
    return { kind: 'encrypted', error: true };
  }
}

loadProductionApiEnv();
process.env.CONFIRM_PRODUCTION_TARGET = 'true';
assertProductionTarget(process.env.SUPABASE_URL);

const { spawnSync } = await import('node:child_process');
const gcloud = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
const keyRes = spawnSync(
  gcloud,
  ['secrets', 'versions', 'access', 'latest', '--secret=integrations-encryption-key', '--project=rh-coopmob-bot'],
  { encoding: 'utf8', shell: process.platform === 'win32' }
);
process.env.INTEGRATIONS_ENCRYPTION_KEY = keyRes.stdout.trim();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data } = await sb
  .from('workspace_channels')
  .select('id, credentials, config, provider, updated_at')
  .eq('workspace_id', '6cce454c-5bd2-4333-9dc4-a107ff10649e')
  .eq('channel_type', 'email')
  .maybeSingle();

const credKeys = data ? Object.keys(data.credentials || {}) : [];
const passMeta = data?.credentials?.smtp_pass ? decryptSecret(String(data.credentials.smtp_pass)) : null;

const smtpSecretRes = spawnSync(
  gcloud,
  ['secrets', 'versions', 'access', 'latest', '--secret=smtp-pass', '--project=rh-coopmob-bot'],
  { encoding: 'utf8', shell: process.platform === 'win32' }
);

console.log(
  JSON.stringify(
    {
      channel_id: data?.id,
      provider: data?.provider,
      updated_at: data?.updated_at,
      credential_keys: credKeys,
      smtp_host: data?.credentials?.smtp_host,
      smtp_user: data?.credentials?.smtp_user,
      smtp_pass: passMeta,
      gcp_smtp_pass_len: (smtpSecretRes.stdout || '').trim().length,
      gcp_smtp_pass_matches_channel:
        passMeta?.kind === 'encrypted' &&
        smtpSecretRes.stdout?.trim().length === passMeta.len,
    },
    null,
    2
  )
);
