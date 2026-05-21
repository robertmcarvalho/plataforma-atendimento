#!/usr/bin/env node
/** Testa SMTP do canal de e-mail em produção (sem enviar convite). */
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadProductionApiEnv, assertProductionTarget } from './lib/loadProdEnv.mjs';

function decryptSecret(stored) {
  if (!stored?.startsWith('{')) return stored;
  const parsed = JSON.parse(stored);
  const key = crypto.createHash('sha256').update(process.env.INTEGRATIONS_ENCRYPTION_KEY.trim()).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

loadProductionApiEnv();
process.env.CONFIRM_PRODUCTION_TARGET = 'true';
assertProductionTarget(process.env.SUPABASE_URL);

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
const { data: ch } = await sb
  .from('workspace_channels')
  .select('credentials')
  .eq('channel_type', 'email')
  .eq('is_active', true)
  .limit(1)
  .maybeSingle();

const c = ch.credentials;
const nodemailer = (await import('nodemailer')).default;
const port = Number(c.smtp_port || 465);
const transport = nodemailer.createTransport({
  host: String(c.smtp_host),
  port,
  secure: port === 465,
  auth: { user: String(c.smtp_user), pass: decryptSecret(String(c.smtp_pass)) },
});
await transport.verify();
console.log(JSON.stringify({ ok: true, smtp_verify: 'success' }, null, 2));
