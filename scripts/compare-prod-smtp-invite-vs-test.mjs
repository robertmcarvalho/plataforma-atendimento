#!/usr/bin/env node
/** Compara envio SMTP teste vs convite com as mesmas credenciais do canal. */
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

async function transportFrom(c) {
  const nodemailer = (await import('nodemailer')).default;
  const port = Number(c.smtp_port || 465);
  return nodemailer.createTransport({
    host: String(c.smtp_host),
    port,
    secure: port === 465,
    requireTLS: port === 587 && Boolean(c.smtp_secure),
    auth: { user: String(c.smtp_user), pass: decryptSecret(String(c.smtp_pass)) },
  });
}

loadProductionApiEnv();
assertProductionTarget(process.env.SUPABASE_URL);
const gcloud = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
process.env.INTEGRATIONS_ENCRYPTION_KEY = spawnSync(
  gcloud,
  ['secrets', 'versions', 'access', 'latest', '--secret=integrations-encryption-key', '--project=rh-coopmob-bot'],
  { encoding: 'utf8', shell: process.platform === 'win32' }
).stdout.trim();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: ch } = await sb
  .from('workspace_channels')
  .select('credentials')
  .eq('id', '18926721-0c3f-4722-b09b-e423365d81fc')
  .single();

const c = ch.credentials;
const from = `Atendimento Flux Farma <${c.from_email}>`;
const transport = await transportFrom(c);
const to = process.argv[2] || 'natobruno29@gmail.com';

const results = {};
for (const kind of ['test', 'invite']) {
  try {
    if (kind === 'test') {
      await transport.sendMail({
        from,
        to,
        subject: 'Teste de conexão SMTP',
        html: '<p>Conexão de e-mail do workspace validada.</p>',
      });
    } else {
      await transport.sendMail({
        from,
        to,
        subject: 'Bem-vindo(a) à Aethera — seus dados de acesso',
        html: `<p>Olá <strong>Bruno</strong>,</p><p>Senha: <code>Test123!</code></p><p><a href="https://www.aetheraai.online/login">Entrar</a></p>`,
        text: 'Convite teste',
      });
    }
    results[kind] = 'sent';
  } catch (e) {
    results[kind] = e instanceof Error ? e.message : String(e);
  }
}
console.log(JSON.stringify(results, null, 2));
