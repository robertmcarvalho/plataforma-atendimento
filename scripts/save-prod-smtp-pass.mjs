#!/usr/bin/env node
/**
 * Grava senha SMTP em Secret Manager (smtp-pass) e no canal de e-mail do workspace em produção.
 * Não imprime a senha. Uso:
 *   CONFIRM_PROD_SMTP_SAVE=true SMTP_PASS_PLAIN='***' node scripts/save-prod-smtp-pass.mjs
 */
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadProductionApiEnv, assertProductionTarget } from './lib/loadProdEnv.mjs';

const GCP_PROJECT = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const WORKSPACE_ID = '6cce454c-5bd2-4333-9dc4-a107ff10649e';
const GCLOUD = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';

function runGcloud(args, input) {
  const res = spawnSync(GCLOUD, args, {
    encoding: 'utf8',
    input,
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) throw new Error((res.stderr || res.stdout || 'gcloud failed').trim());
  return (res.stdout || '').trim();
}

function encryptSecret(plain) {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim();
  if (!raw || !plain) throw new Error('INTEGRATIONS_ENCRYPTION_KEY ou senha ausente');
  const key = crypto.createHash('sha256').update(raw).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  });
}

async function main() {
  if (process.env.CONFIRM_PROD_SMTP_SAVE !== 'true') {
    throw new Error('Defina CONFIRM_PROD_SMTP_SAVE=true');
  }
  const plain = process.env.SMTP_PASS_PLAIN?.trim();
  if (!plain) throw new Error('Defina SMTP_PASS_PLAIN');

  loadProductionApiEnv();
  process.env.CONFIRM_PRODUCTION_TARGET = 'true';
  assertProductionTarget(process.env.SUPABASE_URL || '');

  process.env.INTEGRATIONS_ENCRYPTION_KEY = runGcloud([
    'secrets',
    'versions',
    'access',
    'latest',
    '--secret=integrations-encryption-key',
    `--project=${GCP_PROJECT}`,
  ]);

  const secretOut = runGcloud(
    ['secrets', 'versions', 'add', 'smtp-pass', `--project=${GCP_PROJECT}`, '--data-file=-'],
    plain
  );

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: channel, error: chErr } = await sb
    .from('workspace_channels')
    .select('id, credentials')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('channel_type', 'email')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (chErr || !channel) throw new Error(chErr?.message || 'Canal de e-mail não encontrado');

  const credentials = { ...(channel.credentials || {}), smtp_pass: encryptSecret(plain) };
  const { error: upErr } = await sb
    .from('workspace_channels')
    .update({ credentials, updated_at: new Date().toISOString() })
    .eq('id', channel.id);
  if (upErr) throw new Error(upErr.message);

  console.log(
    JSON.stringify(
      {
        ok: true,
        gcp_secret: 'smtp-pass',
        gcp_version: secretOut.split('\n').filter(Boolean).pop() || 'added',
        channel_id: channel.id,
        password_length: plain.length,
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
