#!/usr/bin/env node
/**
 * E1 — Auditoria RLS: policies, rollout_control e tabelas sem índice workspace_id.
 * Uso: npm run db:audit:rls
 *      npm run prod:audit:rls
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';
import { assertProductionTarget, resolveProductionDbUrl } from '../lib/loadProdEnv.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const production = process.argv.includes('--production');
const dbUrl = production
  ? (assertProductionTarget(resolveProductionDbUrl(repoRoot)), resolveProductionDbUrl(repoRoot))
  : readDbUrl();

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  try {
    const tables = (
      await client.query(`
        SELECT
          c.table_name,
          bool_or(c.column_name = 'workspace_id') AS has_workspace_id,
          COALESCE(pc.relrowsecurity, false) AS rls_enabled
        FROM information_schema.columns c
        JOIN pg_class pc ON pc.relname = c.table_name
        JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
        WHERE c.table_schema = 'public' AND pc.relkind = 'r'
        GROUP BY c.table_name, pc.relrowsecurity
        ORDER BY c.table_name
      `)
    ).rows;

    const policies = (
      await client.query(`
        SELECT schemaname, tablename, policyname, roles, cmd
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename, policyname
      `)
    ).rows;

    const rollout = (
      await client.query(`
        SELECT table_name, desired_state, risk_level, validated_at
        FROM public.rls_rollout_control
        ORDER BY risk_level DESC, table_name
      `)
    ).rows;

    const tenantTables = tables.filter((t) => t.has_workspace_id);
    const rlsEnabled = tenantTables.filter((t) => t.rls_enabled);
    const rlsDisabled = tenantTables.filter((t) => !t.rls_enabled);

    const missingTenantPolicy = tenantTables
      .filter((t) => !policies.some((p) => p.tablename === t.table_name && p.policyname === 'tenant_member_access'))
      .map((t) => t.table_name);

    const missingServiceRolePolicy = tenantTables
      .filter((t) => !policies.some((p) => p.tablename === t.table_name && p.policyname === 'service_role_all'))
      .map((t) => t.table_name);

    console.log(
      JSON.stringify(
        {
          ok: true,
          target: production ? 'production' : 'default',
          summary: {
            tenant_tables: tenantTables.length,
            rls_enabled_tenant: rlsEnabled.length,
            rls_disabled_tenant: rlsDisabled.length,
            rollout_prepared: rollout.filter((r) => r.desired_state === 'prepared').length,
            rollout_enabled_staging: rollout.filter((r) => r.desired_state === 'enabled_staging').length,
            rollout_enabled_production: rollout.filter((r) => r.desired_state === 'enabled_production').length,
            missing_tenant_member_policy: missingTenantPolicy.length,
            missing_service_role_policy: missingServiceRolePolicy.length,
          },
          rls_enabled_tenant_tables: rlsEnabled.map((t) => t.table_name),
          missing_tenant_member_policy: missingTenantPolicy,
          missing_service_role_policy: missingServiceRolePolicy.slice(0, 30),
          rollout_sample: rollout.slice(0, 15),
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});
