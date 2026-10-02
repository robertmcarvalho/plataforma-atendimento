#!/usr/bin/env node
/**
 * Aponta produção (Cloud Run + secrets locais) para Supabase plataforma_atendimento (omhlb…).
 * Não pausa nem altera outros projetos (ex.: dash_financeiro).
 *
 *   node scripts/flip-production-to-plataforma-atendimento.mjs
 *   $env:CONFIRM_FLIP_PROD_DATABASE="true"
 *   node scripts/flip-production-to-plataforma-atendimento.mjs --execute --update-gcloud
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import pg from 'pg';
const TARGET_REF = 'omhlbavfsttwcnybzvcd';
const LEGACY_REF = 'ojzzxqqatqncchnspkch';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = process.argv.includes('--execute');
const updateGcloud = process.argv.includes('--update-gcloud');
const secretsDir = path.join(repoRoot, '.secrets');

const apiEnvPath = path.join(repoRoot, 'apps', 'api-service', '.env');
if (!existsSync(apiEnvPath)) throw new Error('apps/api-service/.env ausente');

function loadEnvFile(filePath) {
  const out = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

const webEnvPath = path.join(repoRoot, 'apps', 'web', '.env.local');

const sourcePaths = [
  apiEnvPath,
  path.join(secretsDir, 'staging-api.env'),
].filter((p) => existsSync(p));

let sourceEnv = null;
let sourcePath = null;
for (const p of sourcePaths) {
  const candidate = loadEnvFile(p);
  const url = (candidate.SUPABASE_URL || '').trim();
  if (url.includes(TARGET_REF)) {
    sourceEnv = candidate;
    sourcePath = p;
    break;
  }
}
if (!sourceEnv) {
  throw new Error(
    `Nenhum env com ${TARGET_REF} encontrado. Verifique apps/api-service/.env ou .secrets/staging-api.env`,
  );
}

const supabaseUrl = (sourceEnv.SUPABASE_URL || '').trim();
const serviceKey = (sourceEnv.SUPABASE_SERVICE_ROLE_KEY || '').trim();
let anonKey = (sourceEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || sourceEnv.SUPABASE_ANON_KEY || '').trim();
if (!anonKey && existsSync(webEnvPath)) {
  anonKey = (loadEnvFile(webEnvPath).NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
}
if (!anonKey) {
  console.warn('AVISO: NEXT_PUBLIC_SUPABASE_ANON_KEY vazio — preencha apps/web/.env.local antes do build web.');
}

const devDbUrl = path.join(secretsDir, 'supabase-db-url.txt');
if (!existsSync(devDbUrl)) throw new Error('.secrets/supabase-db-url.txt ausente');

async function snapshotDb(dbUrl) {
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const tables = ['workspaces', 'users', 'pharmacies', 'drivers', 'leaders', 'workspace_channels', 'conversations'];
  const counts = {};
  for (const t of tables) {
    try {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM public.${t}`);
      counts[t] = rows[0].c;
    } catch (e) {
      counts[t] = `error: ${e.message}`;
    }
  }
  await client.end();
  return counts;
}

const targetCounts = await snapshotDb(readFileSync(devDbUrl, 'utf8').trim());

let legacyCounts = null;
let legacyStatus = 'not_checked';
const prodDbPath = path.join(secretsDir, 'production-db-url.txt');
if (existsSync(prodDbPath)) {
  const legacyUrl = readFileSync(prodDbPath, 'utf8').trim();
  if (legacyUrl.includes(LEGACY_REF)) {
    try {
      legacyCounts = await snapshotDb(legacyUrl);
      legacyStatus = 'reachable';
    } catch (e) {
      legacyStatus = `unreachable: ${e.message}`;
    }
  }
}

const plan = {
  mode: execute ? 'execute' : 'dry-run',
  source_env_file: sourcePath,
  target_ref: TARGET_REF,
  target_dashboard_name: 'plataforma_atendimento',
  legacy_ref: LEGACY_REF,
  legacy_status: legacyStatus,
  target_counts: targetCounts,
  legacy_counts: legacyCounts,
  dash_financeiro: 'não alterado por este script',
  note: 'Com ojzzx pausado, os dados em plataforma_atendimento passam a ser a fonte de produção. Reative ojzzx só para export pontual (script migrate-prod-legacy-ojzzx).',
};

if (!execute) {
  console.log(JSON.stringify({ ok: true, dryRun: true, plan }, null, 2));
  console.log('\nExecute: CONFIRM_FLIP_PROD_DATABASE=true node scripts/flip-production-to-plataforma-atendimento.mjs --execute --update-gcloud');
  process.exit(0);
}

if (process.env.CONFIRM_FLIP_PROD_DATABASE !== 'true') {
  throw new Error('Defina CONFIRM_FLIP_PROD_DATABASE=true');
}

mkdirSync(secretsDir, { recursive: true });

writeFileSync(
  path.join(secretsDir, 'production-api.env'),
  [
    `# Produção → plataforma_atendimento (${TARGET_REF})`,
    `SUPABASE_URL=${supabaseUrl}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
    `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
    anonKey ? `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}` : '',
    '',
  ]
    .filter(Boolean)
    .join('\n'),
  'utf8'
);

copyFileSync(devDbUrl, path.join(secretsDir, 'production-db-url.txt'));
writeFileSync(path.join(secretsDir, 'production-supabase-project-ref.txt'), `${TARGET_REF}\n`, 'utf8');

if (existsSync(path.join(secretsDir, 'production-api.env.ojzzx-backup')) === false && existsSync(prodDbPath)) {
  try {
    copyFileSync(path.join(secretsDir, 'production-api.env'), path.join(secretsDir, 'production-api.env.ojzzx-backup'));
  } catch {
    /* first run may not have had production-api.env */
  }
}

writeFileSync(
  path.join(repoRoot, 'reports', 'web-build-substitutions.json'),
  JSON.stringify(
    {
      api: 'https://flux-farma-api-713561463013.us-central1.run.app',
      url: supabaseUrl.replace(/\/$/, ''),
      anon: anonKey,
    },
    null,
    2
  ) + '\n',
  'utf8'
);

writeFileSync(
  path.join(repoRoot, 'reports', 'production-database-flip.json'),
  JSON.stringify({ flipped_at: new Date().toISOString(), ...plan }, null, 2),
  'utf8'
);

if (updateGcloud) {
  const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
  const tmpUrl = path.join(secretsDir, '.tmp-supabase-url.txt');
  const tmpSr = path.join(secretsDir, '.tmp-supabase-sr.txt');
  writeFileSync(tmpUrl, supabaseUrl, 'utf8');
  writeFileSync(tmpSr, serviceKey, 'utf8');
  execSync(`gcloud secrets versions add supabase-url --data-file="${tmpUrl}" --project=${project}`, { stdio: 'inherit' });
  execSync(`gcloud secrets versions add supabase-sr --data-file="${tmpSr}" --project=${project}`, { stdio: 'inherit' });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      ...plan,
      updated_local: [
        '.secrets/production-api.env',
        '.secrets/production-db-url.txt',
        '.secrets/production-supabase-project-ref.txt',
        'reports/web-build-substitutions.json',
      ],
      gcloud_secrets_updated: updateGcloud,
      next: [
        'npm run deploy:production-api (ou deploy-production-api.ps1)',
        'rebuild/deploy flux-farma-web com reports/web-build-substitutions.json',
        'Login em https://www.aetheraai.com.br',
      ],
    },
    null,
    2
  )
);
