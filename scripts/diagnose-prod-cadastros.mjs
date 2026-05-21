#!/usr/bin/env node
import { Client } from 'pg';
import { loadProductionApiEnv, resolveProductionDbUrl, assertProductionTarget } from './lib/loadProdEnv.mjs';

delete process.env.SUPABASE_DB_URL;
loadProductionApiEnv();
process.env.CONFIRM_PRODUCTION_TARGET = 'true';
const cs = resolveProductionDbUrl();
assertProductionTarget(cs);

const c = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await c.connect();

const report = { at: new Date().toISOString(), ref: 'ojzzxqqatqncchnspkch' };

report.workspaces = (await c.query(
  `SELECT id, slug, display_name, created_at FROM public.workspaces ORDER BY created_at`
)).rows;

report.users = (await c.query(
  `SELECT id, email, name, platform_role, role_id, is_active FROM public.users ORDER BY email`
)).rows;

report.memberships = (await c.query(
  `SELECT wm.workspace_id, w.slug, wm.user_id, u.email, wm.is_default, wm.is_active
   FROM public.workspace_memberships wm
   JOIN public.users u ON u.id = wm.user_id
   JOIN public.workspaces w ON w.id = wm.workspace_id`
)).rows;

for (const table of ['drivers', 'leaders', 'pharmacies']) {
  const byWs = await c.query(
    `SELECT workspace_id, COUNT(*)::int AS c FROM public.${table} GROUP BY workspace_id ORDER BY c DESC`
  );
  const nullWs = await c.query(`SELECT COUNT(*)::int AS c FROM public.${table} WHERE workspace_id IS NULL`);
  report[table] = { by_workspace: byWs.rows, null_workspace_id: nullWs.rows[0].c };
  const labelCol = table === 'pharmacies' ? 'trade_name' : 'name';
  report[`${table}_sample`] = (
    await c.query(
      `SELECT id, ${labelCol} AS label, workspace_id FROM public.${table} ORDER BY created_at NULLS LAST LIMIT 8`
    )
  ).rows;
}

report.conversations = (
  await c.query(`SELECT workspace_id, COUNT(*)::int AS c FROM public.conversations GROUP BY workspace_id`)
).rows;

report.test_users = (
  await c.query(
    `SELECT email FROM public.users WHERE email ILIKE '%@fluxfarma.local%' OR email ILIKE 'dev-admin@%' OR email ILIKE '%test%'`
  )
).rows;

report.leaders_detail = (
  await c.query(`SELECT id, name, email, phone, workspace_id, user_id, status FROM public.leaders ORDER BY name LIMIT 20`)
).rows;

await c.end();
console.log(JSON.stringify(report, null, 2));
