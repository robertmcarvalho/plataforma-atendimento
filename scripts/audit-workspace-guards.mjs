#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routesDir = path.join(root, 'apps', 'api-service', 'src', 'routes');
const tenantTables = new Set([
  'api_tokens',
  'app_settings',
  'audit_logs',
  'automation_rules',
  'automation_runs',
  'bot_flows',
  'bot_sessions',
  'campaign_dispatch_logs',
  'campaign_recipients',
  'campaigns',
  'contacts',
  'conversation_assignments',
  'conversation_flow_bindings',
  'conversation_flow_definitions',
  'conversation_flow_sessions',
  'conversation_flow_versions',
  'conversations',
  'driver_pharmacy_links',
  'drivers',
  'email_delivery_log',
  'financial_entries',
  'financial_exports',
  'financial_import_rows',
  'financial_imports',
  'financial_installments',
  'internal_chat_messages',
  'internal_notes',
  'leader_pharmacy_links',
  'leaders',
  'message_templates',
  'messages',
  'pending_tasks',
  'pharmacies',
  'pharmacy_sector_attendants',
  'processed_webhook_events',
  'roles',
  'routing_rules',
  'sectors',
  'sla_events',
  'sla_policies',
  'supply_requests',
  'ticket_events',
  'tickets',
  'user_channel_queue_assignments',
  'user_sectors',
  'workspace_channels',
  'workspace_demand_rules',
  'workspace_flow_messages',
  'workspace_memberships',
  'workspace_out_of_hours_rules',
  'workspace_profiles',
  'workspace_report_targets',
  'workspace_sector_demands',
  'workspace_sla_rules',
  'workspace_visible_sectors',
]);

const allowlist = [
  'auth.ts',
  'dev-bootstrap.ts',
  'platform.ts',
  'workspace.ts',
  'leader-portal.ts',
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const findings = [];
for (const file of walk(routesDir)) {
  const rel = path.relative(root, file).replaceAll(path.sep, '/');
  const name = path.basename(file);
  const source = fs.readFileSync(file, 'utf8');
  const usesTenantTable = [...tenantTables].some((table) => source.includes(`from('${table}')`) || source.includes(`from("${table}")`));
  if (!usesTenantTable || allowlist.includes(name)) continue;

  if (!source.includes('requireWorkspace(') && !source.includes('scopedQuery(') && !source.includes('scopedSelect(')) {
    findings.push({ file: rel, type: 'missing_requireWorkspace' });
  }

  const rawFromMatches = [...source.matchAll(/supabase\.from\(['"]([^'"]+)['"]\)/g)];
  for (const match of rawFromMatches) {
    const table = match[1];
    if (!tenantTables.has(table)) continue;
    const tail = source.slice(match.index || 0, (match.index || 0) + 700);
    if (!/\.eq\(['"]workspace_id['"]/.test(tail) && !/workspace_id/.test(tail)) {
      findings.push({ file: rel, table, type: 'supabase_from_without_workspace_scope_nearby' });
    }
  }
}

const result = {
  ok: findings.length === 0,
  mode: 'read-only',
  checked_at: new Date().toISOString(),
  findings,
};

console.log(JSON.stringify(result, null, 2));
if (findings.length) process.exitCode = 1;
