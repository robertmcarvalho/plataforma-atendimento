#!/usr/bin/env node
/**
 * Sincroniza Secret Manager smtp-pass com a senha SMTP do canal de e-mail em produção.
 * Uso:
 *   CONFIRM_PROD_SMTP_SYNC=true node scripts/sync-prod-smtp-pass-from-channel.mjs
 *   CONFIRM_PROD_SMTP_SYNC=true SMTP_PASS_PLAIN='senha-uol' node scripts/sync-prod-smtp-pass-from-channel.mjs --plain
 */
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadProductionApiEnv, assertProductionTarget } from './lib/loadProdEnv.mjs';

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
    const dec = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final(),
    ]);
    return dec.toString('utf8');
  } catch {
    return '';
  }
}

const GCP_PROJECT = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const DEFAULT_WORKSPACE = '6cce454c-5bd2-4333-9dc4-a107ff10649e';
const GCLOUD = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';

function runGcloud(args, input) {
  const res = spawnSync(GCLOUD, args, {
    encoding: 'utf8',
    input,
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    throw new Error((res.stderr || res.stdout || 'gcloud failed').trim());
  }
  return (res.stdout || '').trim();
}

function parseWorkspaceId() {
  const i = process.argv.indexOf('--workspace-id');
  return (i >= 0 ? process.argv[i + 1] : DEFAULT_WORKSPACE).trim();
}

function loadEncryptionKey() {
  if (process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim()) {
    return process.env.INTEGRATIONS_ENCRYPTION_KEY.trim();
  }
  return runGcloud([
    'secrets',
    'versions',
    'access',
    'latest',
    '--secret=integrations-encryption-key',
    `--project=${GCP_PROJECT}`,
  ]);
}

function updateSmtpPassSecret(password) {
  return runGcloud(
    ['secrets', 'versions', 'add', 'smtp-pass', `--project=${GCP_PROJECT}`, '--data-file=-'],
    password
  );
}

async function main() {
  if (process.env.CONFIRM_PROD_SMTP_SYNC !== 'true') {
    throw new Error('Defina CONFIRM_PROD_SMTP_SYNC=true');
  }

  const workspaceId = parseWorkspaceId();
  loadProductionApiEnv();
  process.env.CONFIRM_PRODUCTION_TARGET = 'true';
  const url = process.env.SUPABASE_URL || '';
  assertProductionTarget(url);

  process.env.INTEGRATIONS_ENCRYPTION_KEY = loadEncryptionKey();

  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: row, error } = await sb
    .from('workspace_channels')
    .select('id, display_name, provider, credentials, config, is_default, is_active')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'email')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) throw new Error(`Canal de e-mail ativo não encontrado no workspace ${workspaceId}`);

  const creds = row.credentials || {};
  const usePlain = process.argv.includes('--plain');
  let smtpPass = process.env.SMTP_PASS_PLAIN?.trim() || '';
  if (usePlain) {
    if (!smtpPass) throw new Error('Use SMTP_PASS_PLAIN com --plain');
  } else {
    const rawPass = creds.smtp_pass;
    if (!rawPass || typeof rawPass !== 'string') {
      throw new Error('Canal sem smtp_pass — salve a senha em Configurações → Canais → E-mail');
    }
    smtpPass = decryptSecret(rawPass);
    if (!smtpPass) throw new Error('smtp_pass vazio após descriptografia');
  }

  const smtpUser = String(creds.smtp_user || creds.from_email || '').trim();
  const smtpHost = String(creds.smtp_host || '').trim();
  if (!smtpUser || !smtpHost) throw new Error('Canal de e-mail incompleto (host/usuário)');

  const versionOut = updateSmtpPassSecret(smtpPass);

  console.log(
    JSON.stringify(
      {
        ok: true,
        project: GCP_PROJECT,
        workspace_id: workspaceId,
        channel_id: row.id,
        channel_name: row.display_name,
        smtp_host: smtpHost,
        smtp_user: smtpUser,
        secret: 'smtp-pass',
        gcloud: versionOut.split('\n').filter(Boolean).slice(-1)[0] || 'version added',
        password_length: smtpPass.length,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
