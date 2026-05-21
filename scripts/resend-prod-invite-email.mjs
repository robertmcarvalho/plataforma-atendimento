#!/usr/bin/env node
/**
 * Reenvia convite (nova senha temporária + e-mail) em produção.
 * Uso: CONFIRM_PROD_RESEND_INVITE=true node scripts/resend-prod-invite-email.mjs --email natobruno29@gmail.com
 */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadProductionApiEnv, assertProductionTarget } from './lib/loadProdEnv.mjs';

const WORKSPACE_ID = '6cce454c-5bd2-4333-9dc4-a107ff10649e';
const LOGIN_URL = 'https://www.aetheraai.online/login';

function parseEmail() {
  const i = process.argv.indexOf('--email');
  const email = (i >= 0 ? process.argv[i + 1] : '').trim().toLowerCase();
  if (!email) throw new Error('Use --email usuario@exemplo.com');
  return email;
}

function decryptSecret(stored) {
  if (!stored || !stored.startsWith('{')) return stored;
  try {
    const parsed = JSON.parse(stored);
    if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) return stored;
    const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim();
    if (!raw) return '';
    const key = crypto.createHash('sha256').update(raw).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

function generateTemporaryPassword(length = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function main() {
  if (process.env.CONFIRM_PROD_RESEND_INVITE !== 'true') {
    throw new Error('Defina CONFIRM_PROD_RESEND_INVITE=true');
  }
  const email = parseEmail();
  loadProductionApiEnv();
  process.env.CONFIRM_PRODUCTION_TARGET = 'true';
  const url = process.env.SUPABASE_URL || '';
  assertProductionTarget(url);

  const { spawnSync } = await import('node:child_process');
  const gcloud = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  const keyRes = spawnSync(
    gcloud,
    ['secrets', 'versions', 'access', 'latest', '--secret=integrations-encryption-key', '--project=rh-coopmob-bot'],
    { encoding: 'utf8', shell: process.platform === 'win32' }
  );
  if (keyRes.status !== 0) throw new Error('integrations-encryption-key');
  process.env.INTEGRATIONS_ENCRYPTION_KEY = keyRes.stdout.trim();

  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: user, error: userErr } = await sb
    .from('users')
    .select('id, name, email, username')
    .ilike('email', email)
    .maybeSingle();
  if (userErr || !user) throw new Error(userErr?.message || 'Usuário não encontrado');

  const { data: channel } = await sb
    .from('workspace_channels')
    .select('id, credentials, config')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('channel_type', 'email')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!channel) throw new Error('Canal de e-mail não encontrado');

  const c = channel.credentials || {};
  const smtpPass = decryptSecret(String(c.smtp_pass || ''));
  if (!smtpPass) throw new Error('Senha SMTP do canal indisponível');

  const tempPassword = generateTemporaryPassword();

  const nodemailer = (await import('nodemailer')).default;
  const port = Number(c.smtp_port || 465);
  const transport = nodemailer.createTransport({
    host: String(c.smtp_host || 'smtps.uhserver.com'),
    port,
    secure: port === 465,
    auth: { user: String(c.smtp_user || c.from_email), pass: smtpPass },
  });

  const workspaceName = 'Flux Farma';
  const subject = 'Bem-vindo(a) à Aethera — seus dados de acesso';
  const text = [
    `Olá ${user.name},`,
    '',
    `Sua conta na plataforma (${workspaceName}) está pronta.`,
    `Acesse: ${LOGIN_URL}`,
    `E-mail: ${user.email}`,
    `Senha temporária: ${tempPassword}`,
    '',
    'Altere a senha em Configurações → Perfil após entrar.',
  ].join('\n');

  try {
    await transport.sendMail({
    from: `Atendimento Flux Farma <${c.from_email || c.smtp_user}>`,
    to: user.email,
    subject,
    text,
    html: `<p>Olá <strong>${user.name}</strong>,</p><p>Acesse <a href="${LOGIN_URL}">${LOGIN_URL}</a></p><p>E-mail: ${user.email}<br/>Senha temporária: <code>${tempPassword}</code></p>`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha SMTP';
    await sb.from('email_delivery_log').insert({
      workspace_id: WORKSPACE_ID,
      template_key: 'user_invite_resend',
      recipient: user.email,
      status: 'failed',
      error_message: msg,
      metadata: { source: 'workspace', channel_id: channel.id, script: 'resend-prod-invite-email' },
    });
    throw e;
  }

  const { error: authErr } = await sb.auth.admin.updateUserById(user.id, { password: tempPassword });
  if (authErr) throw new Error(authErr.message);

  await sb
    .from('users')
    .update({ must_change_password: true, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  await sb.from('email_delivery_log').insert({
    workspace_id: WORKSPACE_ID,
    template_key: 'user_invite_resend',
    recipient: user.email,
    status: 'sent',
    metadata: { subject, source: 'workspace', channel_id: channel.id, script: 'resend-prod-invite-email' },
  });

  console.log(JSON.stringify({ ok: true, email: user.email, user_id: user.id, channel_id: channel.id }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
