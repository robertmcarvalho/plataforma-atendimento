#!/usr/bin/env node
/**
 * Aplica migrations billing (084–112 + 104 + 105) em PRODUÇÃO (omhlb).
 *
 * Dry-run (padrão):
 *   node scripts/db/apply-billing-migrations-prod.mjs
 *   npm run billing:migrate:prod
 *
 * Execução real:
 *   $env:CONFIRM_PRODUCTION_BILLING_MIGRATIONS = "true"
 *   node scripts/db/apply-billing-migrations-prod.mjs --execute
 *   npm run billing:migrate:prod:execute
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';
import { assertProductionTarget, resolveProductionDbUrl } from '../lib/loadProdEnv.mjs';

const execute = process.argv.includes('--execute');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

/** Ordem obrigatória. 104 não tem script npm dev; 105 é rateio de diárias. */
const MIGRATION_PLAN = [
  { file: '084_billing_foundation.sql', marker: { table: 'billing_cost_centers' } },
  { file: '085_billing_cycles_deliveries_settlements.sql', marker: { table: 'billing_cycles' } },
  { file: '086_billing_mg_pool_invoices.sql', marker: { table: 'billing_invoices' } },
  { file: '087_billing_payables_expenses.sql', marker: { table: 'billing_expenses' } },
  { file: '088_billing_monthly_reports.sql', marker: { table: 'billing_monthly_report_runs' } },
  { file: '089_billing_company_payroll.sql', marker: { table: 'billing_internal_providers' } },
  { file: '091_billing_commercial_partners_commissions.sql', marker: { table: 'billing_commercial_partners' } },
  { file: '092_billing_leader_flux_commission.sql', marker: { table: 'billing_leader_commission_rules' } },
  { file: '093_billing_treasury_bank_accounts.sql', marker: { table: 'billing_bank_accounts' } },
  { file: '094_billing_c6_pix_template.sql', marker: { column: ['billing_bank_accounts', 'pix_export_template'] } },
  { file: '095_billing_dre_managerial.sql', marker: { table: 'billing_dre_accounts' } },
  { file: '100_billing_pharmacy_daily_charges.sql', marker: { column: ['pharmacies', 'daily_billing_enabled'] } },
  { file: '101_billing_mg_dailies_payment_policy.sql', marker: { column: ['financial_entries', 'daily_billing_treatment'] } },
  { file: '102_billing_driver_offboarding_preview.sql', marker: { table: 'billing_driver_offboarding_previews' } },
  { file: '103_billing_cost_center_cnpj.sql', marker: { column: ['billing_cost_centers', 'cnpj'] } },
  { file: '104_billing_cost_center_payables.sql', marker: { column: ['billing_cost_centers', 'corporate_entity_type'] } },
  { file: '105_pharmacy_daily_billing_share_group.sql', marker: { table: 'billing_daily_share_groups' } },
  { file: '106_billing_cost_center_billing_pharmacy.sql', marker: { column: ['billing_cost_centers', 'billing_pharmacy_id'] } },
  { file: '107_billing_ledgers_and_expense_catalog.sql', marker: { table: 'billing_quota_accounts' } },
  { file: '108_billing_bank_statement_importers.sql', marker: { table: 'billing_bank_statement_formats' } },
  { file: '109_billing_management_classification.sql', marker: { column: ['billing_expense_types', 'management_group'] } },
  { file: '110_billing_financial_guards_rls.sql', marker: { function: 'billing_register_invoice_payment' } },
  { file: '111_billing_payment_schedule_and_batches.sql', marker: { table: 'billing_payment_batch_export_payables' } },
  { file: '112_billing_capital_separation.sql', marker: { table: 'billing_driver_financial_ledger_entries' } },
  { file: '119_billing_settlement_exclusions.sql', marker: { table: 'billing_settlement_exclusions' } },
];

async function tableExists(client, table) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS ok`,
    [table]
  );
  return Boolean(rows[0]?.ok);
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS ok`,
    [table, column]
  );
  return Boolean(rows[0]?.ok);
}

async function functionExists(client, name) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = $1
     ) AS ok`,
    [name]
  );
  return Boolean(rows[0]?.ok);
}

async function markerApplied(client, marker) {
  if (marker.table) return tableExists(client, marker.table);
  if (marker.column) {
    const [table, column] = marker.column;
    return columnExists(client, table, column);
  }
  if (marker.function) return functionExists(client, marker.function);
  return false;
}

function refFromUrl(url) {
  return url.match(/db\.([a-z0-9]+)\.supabase\.co/i)?.[1] || url.match(/postgres\.([a-z0-9]+)/i)?.[1] || '?';
}

if (execute && process.env.CONFIRM_PRODUCTION_BILLING_MIGRATIONS !== 'true') {
  console.error('Defina CONFIRM_PRODUCTION_BILLING_MIGRATIONS=true para executar em produção.');
  process.exit(1);
}

process.env.CONFIRM_PRODUCTION_TARGET = 'true';
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

const missingFiles = MIGRATION_PLAN.filter((m) => !fs.existsSync(path.join(migrationsDir, m.file))).map((m) => m.file);
if (missingFiles.length) {
  console.error('Arquivos SQL ausentes:', missingFiles.join(', '));
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const report = {
  mode: execute ? 'execute' : 'dry-run',
  target_ref: refFromUrl(dbUrl),
  at: new Date().toISOString(),
  migrations: [],
  summary: { pending: 0, skipped: 0, applied: 0, failed: 0 },
};

try {
  for (const step of MIGRATION_PLAN) {
    const sqlPath = path.join(migrationsDir, step.file);
    const already = await markerApplied(client, step.marker);
    const entry = {
      file: step.file,
      marker: step.marker,
      status: already ? 'skip_already_applied' : execute ? 'pending' : 'would_apply',
    };

    if (already) {
      report.summary.skipped += 1;
      report.migrations.push(entry);
      continue;
    }

    if (!execute) {
      report.summary.pending += 1;
      report.migrations.push(entry);
      continue;
    }

    const sql = fs.readFileSync(sqlPath, 'utf8');
    const started = Date.now();
    try {
      await execSqlStatements(client, sql);
      const verified = await markerApplied(client, step.marker);
      entry.status = verified ? 'applied' : 'applied_unverified_marker';
      entry.duration_ms = Date.now() - started;
      report.summary.applied += 1;
    } catch (err) {
      entry.status = 'failed';
      entry.error = err instanceof Error ? err.message : String(err);
      entry.duration_ms = Date.now() - started;
      report.summary.failed += 1;
      report.migrations.push(entry);
      break;
    }

    report.migrations.push(entry);
  }

  const billingCount = await client.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE 'billing_%'`
  );

  report.post_check = {
    billing_tables: billingCount.rows[0]?.n ?? 0,
  };

  const outDir = path.join(repoRoot, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const suffix = execute ? 'execute' : 'dry-run';
  const outPath = path.join(outDir, `billing-migrations-prod-${suffix}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
  console.error(`\nRelatório: ${outPath}`);

  if (!execute) {
    console.error('\nDry-run. Para aplicar em produção:');
    console.error('  $env:CONFIRM_PRODUCTION_BILLING_MIGRATIONS = "true"');
    console.error('  npm run billing:migrate:prod:execute');
  }

  if (report.summary.failed > 0) process.exit(1);
} finally {
  await client.end();
}
