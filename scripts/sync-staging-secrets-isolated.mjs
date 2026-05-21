#!/usr/bin/env node
/**
 * Isola staging do banco de produção sem criar novo projeto Supabase.
 * Staging passa a usar o projeto dev (omhlbavfsttwcnybzvcd); produção permanece em ojzzxqqatqncchnspkch.
 *
 *   node scripts/sync-staging-secrets-isolated.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnvFile } from './lib/loadApiEnv.mjs';

const repoRoot = process.cwd();
const secretsDir = path.join(repoRoot, '.secrets');
const PROD_REF = 'ojzzxqqatqncchnspkch';
const STAGING_REF = 'omhlbavfsttwcnybzvcd';

mkdirSync(secretsDir, { recursive: true });

const apiEnvPath = path.join(repoRoot, 'apps', 'api-service', '.env');
if (!existsSync(apiEnvPath)) throw new Error('apps/api-service/.env ausente');

const env = {};
parseEnvFile(apiEnvPath, true);
Object.assign(env, process.env);
const supabaseUrl = (env.SUPABASE_URL || '').trim();
const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const anonKey = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '').trim();

if (!supabaseUrl.includes(STAGING_REF)) {
  throw new Error(`apps/api-service/.env deve apontar para ${STAGING_REF} (staging isolado).`);
}

writeFileSync(
  path.join(secretsDir, 'staging-api.env'),
  [
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
writeFileSync(path.join(secretsDir, 'staging-supabase-project-ref.txt'), `${STAGING_REF}\n`, 'utf8');

const devDbUrl = path.join(secretsDir, 'supabase-db-url.txt');
const stagingDbUrl = path.join(secretsDir, 'staging-supabase-db-url.txt');
if (existsSync(devDbUrl)) {
  copyFileSync(devDbUrl, stagingDbUrl);
}

if (!existsSync(path.join(secretsDir, 'production-api.env'))) {
  throw new Error('Crie .secrets/production-api.env com credenciais de produção (ojzzx) antes de sincronizar.');
}
if (!existsSync(path.join(secretsDir, 'production-db-url.txt'))) {
  throw new Error('Crie .secrets/production-db-url.txt com pooler de produção antes de sincronizar.');
}

const prodApi = readFileSync(path.join(secretsDir, 'production-api.env'), 'utf8');
if (!prodApi.includes(PROD_REF)) {
  throw new Error(`production-api.env deve conter ref ${PROD_REF}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      staging_ref: STAGING_REF,
      production_ref: PROD_REF,
      updated: [
        '.secrets/staging-api.env',
        '.secrets/staging-supabase-project-ref.txt',
        '.secrets/staging-supabase-db-url.txt',
      ],
      note: 'Produção inalterada em production-api.env e production-db-url.txt',
    },
    null,
    2
  )
);
