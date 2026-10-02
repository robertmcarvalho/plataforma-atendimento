/**
 * Aplica migrations 021–027 (SaaS multi-workspace + catálogos + flow engine + canais/provisionamento/motor).
 * Uso: node scripts/ensure-workspace-saas-migrations.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const files = [
  '021_workspace_tenancy.sql',
  '022_workspace_catalogs.sql',
  '023_workspace_roles_and_sectors.sql',
  '024_conversation_flow_engine.sql',
  '025_channel_connections_saas.sql',
  '026_users_provisioning.sql',
  '027_attendance_motor.sql',
];

const client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  for (const file of files) {
    const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', file), 'utf8');
    console.log(`Aplicando ${file}...`);
    await client.query('begin');
    try {
      await execSqlStatements(client, sql);
      await client.query('commit');
      console.log(`OK: ${file}`);
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    }
  }
  console.log('Todas as migrations SaaS (021–027) aplicadas.');
} catch (e) {
  console.error(e?.message || e);
  process.exit(1);
} finally {
  await client.end();
}
