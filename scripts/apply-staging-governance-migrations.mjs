/**
 * Aplica as migrations enterprise 033-036 somente em staging, com dry-run por padrão.
 *
 * Dry-run governance:
 *   npm run staging:migrate:governance
 *
 * Dry-run completo em projeto staging novo:
 *   npm run staging:migrate:all
 *
 * Execução real governance:
 *   $env:STAGING_SUPABASE_DB_URL="postgresql://..."
 *   $env:CONFIRM_STAGING_MIGRATIONS="true"
 *   npm run staging:migrate:governance -- --execute
 *
 * Alternativa gitignored:
 *   .secrets/staging-supabase-db-url.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { execSqlStatements } from './lib/execSqlStatements.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const execute = process.argv.includes('--execute');
const all = process.argv.includes('--all');
const governanceFiles = [
  '033_workspace_governance_indexes.sql',
  '034_operational_global_tables_workspace_scope.sql',
  '035_enable_rls_baseline.sql',
  '036_progressive_rls_control.sql',
];
const files = all
  ? fs.readdirSync(path.join(repoRoot, 'supabase', 'migrations'))
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b))
  : governanceFiles;

function stagingDbUrl() {
  const value = process.env.STAGING_SUPABASE_DB_URL || process.env.STAGING_DATABASE_URL || process.env.MIGRATION_STAGING_DB_URL || '';
  if (value.trim()) return value.trim();

  const secretPath = path.join(repoRoot, '.secrets', 'staging-supabase-db-url.txt');
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, 'utf8').trim();
  }

  return '';
}

function targetFingerprint(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return {
      protocol: u.protocol,
      host: u.host,
      database: u.pathname.replace(/^\//, '') || '(default)',
      user: u.username || '(none)',
    };
  } catch {
    return { parse_error: true };
  }
}

function assertStagingExecution(rawUrl) {
  if (!execute) return;
  if (!rawUrl) {
    throw new Error('Defina STAGING_SUPABASE_DB_URL, STAGING_DATABASE_URL, MIGRATION_STAGING_DB_URL ou .secrets/staging-supabase-db-url.txt para executar.');
  }
  if (process.env.CONFIRM_STAGING_MIGRATIONS !== 'true') {
    throw new Error('Execução bloqueada: defina CONFIRM_STAGING_MIGRATIONS=true.');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Execução bloqueada: NODE_ENV=production.');
  }

  const lowered = rawUrl.toLowerCase();
  const explicitAllow = process.env.ALLOW_NON_STAGING_MIGRATION_TARGET === 'true';
  const stagingRef = fs.existsSync(path.join(secretsDir(), 'staging-supabase-project-ref.txt'))
    ? fs.readFileSync(path.join(secretsDir(), 'staging-supabase-project-ref.txt'), 'utf8').trim().toLowerCase()
    : '';
  const matchesCreatedStagingRef = Boolean(stagingRef && lowered.includes(stagingRef));
  if (!explicitAllow && !matchesCreatedStagingRef && !lowered.includes('staging') && !lowered.includes('stage')) {
    throw new Error(
      'Execução bloqueada: a URL não parece ser staging. Use uma URL de staging ou ALLOW_NON_STAGING_MIGRATION_TARGET=true após validação manual.'
    );
  }
}

function secretsDir() {
  return path.join(repoRoot, '.secrets');
}

function readMigration(file) {
  const fullPath = path.join(repoRoot, 'supabase', 'migrations', file);
  return fs.readFileSync(fullPath, 'utf8');
}

const rawUrl = stagingDbUrl();
assertStagingExecution(rawUrl);

console.log(JSON.stringify(
  {
    mode: execute ? 'execute' : 'dry-run',
    target: rawUrl ? targetFingerprint(rawUrl) : null,
    migrations: files,
    notes: [
      all ? 'Todas as migrations serão aplicadas em ordem alfabética/numérica em uma única transação.' : '033/034/035/036 serão aplicadas em uma única transação.',
      all ? 'Use este modo apenas para bootstrap de projeto staging vazio.' : '035 prepara policies e 036 desabilita RLS enforcement antes do commit.',
      'Faça snapshot/backup do banco de staging antes de executar com --execute.',
    ],
  },
  null,
  2
));

if (!execute) {
  console.log('DRY_RUN_ONLY — nenhuma alteração aplicada.');
  process.exit(0);
}

const client = new pg.Client({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  for (const file of files) {
    console.log(`Aplicando ${file}...`);
    await execSqlStatements(client, readMigration(file));
  }
  await client.query('commit');
  console.log(all ? 'OK: todas as migrations aplicadas em staging.' : 'OK: migrations governance 033-036 aplicadas em staging.');
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(all ? 'Falha ao aplicar todas as migrations:' : 'Falha ao aplicar migrations governance 033-036:', e?.message || e);
  process.exit(1);
} finally {
  await client.end();
}
