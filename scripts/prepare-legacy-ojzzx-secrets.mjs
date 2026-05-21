#!/usr/bin/env node
/**
 * Restaura credenciais do Supabase legado (ojzzx) a partir do Secret Manager (versão 1, pré-cutover).
 * Não altera produção atual (omhlb).
 *
 *   node scripts/prepare-legacy-ojzzx-secrets.mjs
 *
 * Depois, no Dashboard Supabase, **reative** o projeto plataforma-atendimento-staging (ojzzx)
 * e salve o pooler em `.secrets/legacy-db-url.txt` (Connection string → URI, porta 6543).
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LEGACY_REF = 'ojzzxqqatqncchnspkch';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secretsDir = path.join(repoRoot, '.secrets');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';

function gcloudSecret(name, version = '1') {
  return execSync(`gcloud secrets versions access ${version} --secret=${name} --project=${project}`, {
    encoding: 'utf8',
  }).trim();
}

const url = gcloudSecret('supabase-url');
const serviceKey = gcloudSecret('supabase-sr');
if (!url.includes(LEGACY_REF)) {
  throw new Error(`supabase-url v1 não é ojzzx: ${url}`);
}

mkdirSync(secretsDir, { recursive: true });
const legacyApiPath = path.join(secretsDir, 'legacy-api.env');
writeFileSync(
  legacyApiPath,
  [
    `# Legado (ojzzx) — exportado do Secret Manager v1`,
    `SUPABASE_URL=${url}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
    '',
  ].join('\n'),
  'utf8'
);

const legacyDbPath = path.join(secretsDir, 'legacy-db-url.txt');
const note = existsSync(legacyDbPath)
  ? 'já existe'
  : 'CRIAR: cole a connection string do pooler (ojzzx) quando o projeto estiver ativo';

console.log(
  JSON.stringify(
    {
      ok: true,
      legacy_api_env: legacyApiPath,
      legacy_db_url: legacyDbPath,
      legacy_db_url_status: note,
      next: [
        'Supabase Dashboard → projeto ojzzx (plataforma-atendimento-staging) → Restore/Unpause',
        'Settings → Database → Connection string (Transaction pooler) → salvar em .secrets/legacy-db-url.txt',
        'npm run migrate:legacy-ojzzx-to-prod',
      ],
    },
    null,
    2
  )
);
