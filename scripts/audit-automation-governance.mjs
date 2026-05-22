#!/usr/bin/env node
import { Client } from 'pg';
import { tryReadDbUrl } from './lib/readDbUrl.mjs';

const dbUrl = tryReadDbUrl();
if (!dbUrl) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'read-only',
        skipped: true,
        reason:
          'SUPABASE_DB_URL not configured (CI/local without .secrets). Run with DB credentials locally or in deploy smoke.',
        official_runtime_order: [
          'workspace_channels.config',
          'conversation_flow_bindings',
          'conversation_flow_definitions',
          'automation_rules',
          'fallback_legado',
        ],
        legacy_writes_frozen_by_default: process.env.ALLOW_LEGACY_AUTOMATION_WRITES !== 'true',
        generated_at: new Date().toISOString(),
        inventory: null,
      },
      null,
      2
    )
  );
  process.exit(0);
}

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function count(table, where = 'true') {
  try {
    const { rows } = await client.query(`select workspace_id::text, count(*)::int as count from public.${table} where ${where} group by workspace_id order by workspace_id nulls first`);
    return rows;
  } catch (error) {
    return [{ error: error.message }];
  }
}

await client.connect();
try {
  const inventory = {
    ok: true,
    mode: 'read-only',
    official_runtime_order: [
      'workspace_channels.config',
      'conversation_flow_bindings',
      'conversation_flow_definitions',
      'automation_rules',
      'fallback_legado',
    ],
    legacy_writes_frozen_by_default: process.env.ALLOW_LEGACY_AUTOMATION_WRITES !== 'true',
    generated_at: new Date().toISOString(),
    inventory: {
      workspace_channels: await count('workspace_channels'),
      conversation_flow_bindings: await count('conversation_flow_bindings'),
      conversation_flow_definitions: await count('conversation_flow_definitions'),
      automation_rules: await count('automation_rules'),
      routing_rules_legacy: await count('routing_rules'),
      bot_flows_legacy: await count('bot_flows'),
    },
  };
  console.log(JSON.stringify(inventory, null, 2));
} finally {
  await client.end();
}
