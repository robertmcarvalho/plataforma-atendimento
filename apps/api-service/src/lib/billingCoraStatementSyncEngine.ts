/**
 * Sync diário extrato + saldo Cora (MVP Flux).
 * Flags: BILLING_CORA_STATEMENT_SYNC_ENABLED / BILLING_CORA_STATEMENT_SYNC_WRITE (default false).
 * Coop: fora do escopo — entities = ['flux'] apenas.
 */

import {
  getCoraConfigForEntity,
  isBillingCoraEnabled,
  resolveEffectiveCoraClientId,
  BillingCoraConfigError,
} from './billingCoraConfig';
import { BillingCoraClient, BillingCoraClientError } from './billingCoraClient';
import { loadCoraMtlsMaterial, BillingCoraSecretsError } from './billingCoraSecrets';
import {
  mapCoraStatementEntriesToImportRows,
  resolveCoraStatementSyncWindow,
} from './billingCoraStatementMapper';
import {
  isCoraStatementSyncAutoReconcileEnabled,
  isCoraStatementSyncEnabled,
  isCoraStatementSyncWriteEnabled,
  coraStatementSyncEntities,
} from './billingCoraStatementFlags';
import {
  autoReconcileImportedMovements,
  importBankMovements,
  type BankMovementImportRow,
  type BankStatementFormat,
} from './billingTreasuryEngine';
import { addBillingAuditNotification } from './billingAuditNotifications';
import type { BillingCoraEntityType } from './billingCoraTypes';

export {
  isCoraStatementSyncEnabled,
  isCoraStatementSyncWriteEnabled,
  isCoraStatementSyncAutoReconcileEnabled,
  coraStatementSyncEntities,
} from './billingCoraStatementFlags';

type SupabaseClient = typeof import('./supabase').supabase;

async function getSupabase(): Promise<SupabaseClient> {
  const mod = await import('./supabase');
  return mod.supabase;
}

export class BillingCoraStatementSyncError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = 'BillingCoraStatementSyncError';
    this.status = status;
    this.code = code;
  }
}

export type CoraStatementSyncStatus = {
  entity_type: BillingCoraEntityType;
  config_id: string;
  bank_account_id: string | null;
  last_end_date: string | null;
  last_success_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_balance_cents: number | null;
  last_imported: number | null;
  last_skipped: number | null;
  last_window_start: string | null;
  last_window_end: string | null;
  flags: {
    cora_enabled: boolean;
    sync_enabled: boolean;
    sync_write: boolean;
    auto_reconcile: boolean;
  };
};

export type CoraStatementSyncResult = {
  ok: boolean;
  dry_run: boolean;
  entity_type: BillingCoraEntityType;
  window: { start: string; end: string };
  balance_cents: number | null;
  statement_end_balance_cents: number | null;
  balance_divergence_cents: number | null;
  entries_fetched: number;
  rows_mapped: number;
  imported: number;
  skipped: number;
  reconciled: number;
  reconcile_pending: number;
  cursor_advanced: boolean;
  message?: string;
};

async function resolveWorkspaceId(explicit?: string | null): Promise<string> {
  if (explicit) return explicit;
  const fromEnv = process.env.FLUX_SYNC_WORKSPACE_ID?.trim();
  if (fromEnv) return fromEnv;
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('workspaces')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new BillingCoraStatementSyncError(error.message, 500);
  if (!data?.id) throw new BillingCoraStatementSyncError('Nenhum workspace encontrado', 500);
  return String(data.id);
}

function mapSyncStatus(row: Record<string, unknown>, entityType: BillingCoraEntityType): CoraStatementSyncStatus {
  return {
    entity_type: entityType,
    config_id: String(row.id),
    bank_account_id: row.bank_account_id != null ? String(row.bank_account_id) : null,
    last_end_date:
      row.statement_sync_last_end_date != null
        ? String(row.statement_sync_last_end_date).slice(0, 10)
        : null,
    last_success_at:
      row.statement_sync_last_success_at != null ? String(row.statement_sync_last_success_at) : null,
    last_status: row.statement_sync_last_status != null ? String(row.statement_sync_last_status) : null,
    last_error: row.statement_sync_last_error != null ? String(row.statement_sync_last_error) : null,
    last_balance_cents:
      row.statement_sync_last_balance_cents != null
        ? Number(row.statement_sync_last_balance_cents)
        : null,
    last_imported:
      row.statement_sync_last_imported != null ? Number(row.statement_sync_last_imported) : null,
    last_skipped:
      row.statement_sync_last_skipped != null ? Number(row.statement_sync_last_skipped) : null,
    last_window_start:
      row.statement_sync_last_window_start != null
        ? String(row.statement_sync_last_window_start).slice(0, 10)
        : null,
    last_window_end:
      row.statement_sync_last_window_end != null
        ? String(row.statement_sync_last_window_end).slice(0, 10)
        : null,
    flags: {
      cora_enabled: isBillingCoraEnabled(),
      sync_enabled: isCoraStatementSyncEnabled(),
      sync_write: isCoraStatementSyncWriteEnabled(),
      auto_reconcile: isCoraStatementSyncAutoReconcileEnabled(),
    },
  };
}

export async function getCoraStatementSyncStatus(params?: {
  workspaceId?: string;
  entityType?: BillingCoraEntityType;
}): Promise<CoraStatementSyncStatus> {
  const workspaceId = await resolveWorkspaceId(params?.workspaceId);
  const entityType = params?.entityType || 'flux';
  if (entityType === 'coop') {
    throw new BillingCoraStatementSyncError(
      'Sync extrato Cora Coop fora do MVP — configure mTLS + client_id depois.',
      400,
      'coop_out_of_scope'
    );
  }
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('billing_cora_configs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('entity_type', entityType)
    .maybeSingle();
  if (error) throw new BillingCoraStatementSyncError(error.message, 500);
  if (!data) throw new BillingCoraStatementSyncError('Config Cora não encontrada', 404);
  return mapSyncStatus(data as Record<string, unknown>, entityType);
}

async function persistSyncOutcome(configId: string, patch: Record<string, unknown>): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from('billing_cora_configs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', configId);
  if (error) throw new BillingCoraStatementSyncError(error.message, 500);
}

async function buildClientForEntity(workspaceId: string, entityType: BillingCoraEntityType) {
  const config = await getCoraConfigForEntity(workspaceId, entityType);
  if (!config) throw new BillingCoraStatementSyncError('Config Cora não encontrada', 404);
  if (!config.enabled) {
    throw new BillingCoraStatementSyncError(
      'Config Cora da entidade desabilitada na UI.',
      403,
      'config_disabled'
    );
  }
  const clientId = resolveEffectiveCoraClientId(config);
  if (!clientId) {
    throw new BillingCoraStatementSyncError('client_id Cora ausente.', 400, 'missing_client_id');
  }
  const secretRef = config.mtls_secret_ref || 'cora-flux-mtls';
  const material = loadCoraMtlsMaterial(secretRef);
  const client = new BillingCoraClient({
    environment: config.environment,
    clientId,
    material,
  });
  return { config, client };
}

/**
 * Executa sync Flux (MVP). dry_run força read-only mesmo com WRITE flag.
 * write efetiva só se BILLING_CORA_STATEMENT_SYNC_WRITE=true e dry_run=false.
 */
export async function runCoraStatementSync(params?: {
  workspaceId?: string;
  entityType?: BillingCoraEntityType;
  dryRun?: boolean;
  start?: string | null;
  end?: string | null;
  autoReconcile?: boolean;
  /** Ignora flag SYNC_ENABLED (smoke manual autenticado). */
  force?: boolean;
}): Promise<CoraStatementSyncResult> {
  const entityType = params?.entityType || 'flux';
  if (entityType !== 'flux') {
    throw new BillingCoraStatementSyncError(
      'MVP sync extrato: apenas Flux. Coop = hook futuro (mTLS + client_id).',
      400,
      'coop_out_of_scope'
    );
  }
  if (!isBillingCoraEnabled()) {
    throw new BillingCoraStatementSyncError(
      'BILLING_CORA_ENABLED=false — sync bloqueado.',
      403,
      'cora_disabled'
    );
  }
  if (!params?.force && !isCoraStatementSyncEnabled()) {
    throw new BillingCoraStatementSyncError(
      'BILLING_CORA_STATEMENT_SYNC_ENABLED=false — ative após smoke.',
      403,
      'sync_disabled'
    );
  }

  const workspaceId = await resolveWorkspaceId(params?.workspaceId);
  const writeWanted = isCoraStatementSyncWriteEnabled() && params?.dryRun !== true;
  const dryRun = !writeWanted;

  const supabase = await getSupabase();
  let configRow: Record<string, unknown>;
  let client: BillingCoraClient;
  try {
    const built = await buildClientForEntity(workspaceId, entityType);
    client = built.client;
    const { data, error } = await supabase
      .from('billing_cora_configs')
      .select('*')
      .eq('id', built.config.id)
      .single();
    if (error || !data) {
      throw new BillingCoraStatementSyncError(error?.message || 'Config não encontrada', 500);
    }
    configRow = data as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BillingCoraStatementSyncError) throw err;
    if (
      err instanceof BillingCoraConfigError ||
      err instanceof BillingCoraSecretsError ||
      err instanceof BillingCoraClientError
    ) {
      throw new BillingCoraStatementSyncError(
        err.message,
        (err as { status?: number }).status || 400
      );
    }
    throw err;
  }

  const bankAccountId =
    configRow.bank_account_id != null ? String(configRow.bank_account_id) : null;

  if (!dryRun && !bankAccountId) {
    throw new BillingCoraStatementSyncError(
      'bank_account_id ausente na config Cora Flux — configure a conta destino antes do write.',
      400,
      'missing_bank_account'
    );
  }

  const lastEnd =
    configRow.statement_sync_last_end_date != null
      ? String(configRow.statement_sync_last_end_date).slice(0, 10)
      : null;

  const window =
    params?.start && params?.end
      ? { start: String(params.start).slice(0, 10), end: String(params.end).slice(0, 10) }
      : resolveCoraStatementSyncWindow({ lastSuccessfulEndDate: lastEnd });

  let balanceCents: number | null = null;
  let statementEndBalance: number | null = null;
  let entriesFetched = 0;
  let rows: BankMovementImportRow[] = [];

  try {
    const balance = await client.getBalance();
    balanceCents = balance.balance;

    const { pages, entries } = await client.getStatementAll({
      start: window.start,
      end: window.end,
      // Cora docs: páginas grandes → 503/504; 50 é mais estável em prod.
      perPage: 50,
    });
    entriesFetched = entries.length;
    const lastPage = pages[pages.length - 1];
    if (lastPage?.end?.balance != null && Number.isFinite(Number(lastPage.end.balance))) {
      statementEndBalance = Number(lastPage.end.balance);
    }
    rows = mapCoraStatementEntriesToImportRows(entries);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await persistSyncOutcome(String(configRow.id), {
      statement_sync_last_status: 'failed',
      statement_sync_last_error: message.slice(0, 1000),
      statement_sync_last_window_start: window.start,
      statement_sync_last_window_end: window.end,
    });
    try {
      await addBillingAuditNotification({
        workspaceId,
        severity: 'critical',
        code: 'CORA_STATEMENT_SYNC_FAILED',
        title: 'Falha sync extrato Cora',
        message,
        metadata: { entity_type: entityType, window, dry_run: dryRun },
      });
    } catch {
      /* audit best-effort */
    }
    throw new BillingCoraStatementSyncError(message, 502, 'cora_api_error');
  }

  let divergence: number | null = null;
  if (balanceCents != null && statementEndBalance != null) {
    divergence = Math.abs(balanceCents - statementEndBalance);
    if (divergence > 100) {
      try {
        await addBillingAuditNotification({
          workspaceId,
          severity: 'warning',
          code: 'CORA_STATEMENT_BALANCE_DIVERGENCE',
          title: 'Divergência saldo Cora (balance vs statement.end)',
          message: `balance=${balanceCents} statement_end=${statementEndBalance} diff=${divergence} centavos`,
          metadata: {
            balance_cents: balanceCents,
            statement_end_balance_cents: statementEndBalance,
          },
        });
      } catch {
        /* ignore */
      }
    }
  }

  if (dryRun) {
    await persistSyncOutcome(String(configRow.id), {
      statement_sync_last_status: 'dry_run',
      statement_sync_last_error: null,
      statement_sync_last_balance_cents: balanceCents,
      statement_sync_last_imported: 0,
      statement_sync_last_skipped: 0,
      statement_sync_last_window_start: window.start,
      statement_sync_last_window_end: window.end,
    });
    return {
      ok: true,
      dry_run: true,
      entity_type: entityType,
      window,
      balance_cents: balanceCents,
      statement_end_balance_cents: statementEndBalance,
      balance_divergence_cents: divergence,
      entries_fetched: entriesFetched,
      rows_mapped: rows.length,
      imported: 0,
      skipped: 0,
      reconciled: 0,
      reconcile_pending: 0,
      cursor_advanced: false,
      message: 'Read-only OK — ative BILLING_CORA_STATEMENT_SYNC_WRITE para persistir.',
    };
  }

  const importResult = await importBankMovements(
    workspaceId,
    bankAccountId!,
    rows,
    'cora_api' as BankStatementFormat
  );

  let reconciled = 0;
  let reconcilePending = 0;
  const doReconcile =
    params?.autoReconcile !== false && isCoraStatementSyncAutoReconcileEnabled();
  if (doReconcile && importResult.movement_ids.length) {
    const toReconcile = importResult.movement_ids.slice(0, 200);
    reconcilePending = Math.max(0, importResult.movement_ids.length - toReconcile.length);
    const rec = await autoReconcileImportedMovements(workspaceId, toReconcile);
    reconciled = Number(rec.auto_reconciled || 0);
    if (reconcilePending > 0) {
      console.warn(
        `[cora-statement-sync] ${reconcilePending} movimentos acima do cap 200 — pendentes de auto-reconcile`
      );
    }
  }

  await persistSyncOutcome(String(configRow.id), {
    statement_sync_last_end_date: window.end,
    statement_sync_last_success_at: new Date().toISOString(),
    statement_sync_last_status: 'ok',
    statement_sync_last_error: null,
    statement_sync_last_balance_cents: balanceCents,
    statement_sync_last_imported: importResult.imported,
    statement_sync_last_skipped: importResult.skipped,
    statement_sync_last_window_start: window.start,
    statement_sync_last_window_end: window.end,
  });

  try {
    await addBillingAuditNotification({
      workspaceId,
      severity: 'info',
      code: 'CORA_STATEMENT_SYNC_OK',
      title: 'Sync extrato Cora OK',
      message: `imported=${importResult.imported} skipped=${importResult.skipped} balance=${balanceCents} window=${window.start}..${window.end}`,
      metadata: {
        entity_type: entityType,
        window,
        imported: importResult.imported,
        skipped: importResult.skipped,
        balance_cents: balanceCents,
        reconciled,
        reconcile_pending: reconcilePending,
        batch_id: importResult.batch_id,
      },
    });
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    dry_run: false,
    entity_type: entityType,
    window,
    balance_cents: balanceCents,
    statement_end_balance_cents: statementEndBalance,
    balance_divergence_cents: divergence,
    entries_fetched: entriesFetched,
    rows_mapped: rows.length,
    imported: importResult.imported,
    skipped: importResult.skipped,
    reconciled,
    reconcile_pending: reconcilePending,
    cursor_advanced: true,
  };
}

/** Job scheduler: itera entities MVP (só flux). */
export async function runCoraStatementSyncJob(): Promise<{
  ok: boolean;
  results: CoraStatementSyncResult[];
  skipped?: string;
}> {
  if (!isBillingCoraEnabled() || !isCoraStatementSyncEnabled()) {
    return {
      ok: true,
      results: [],
      skipped: 'flags off (BILLING_CORA_ENABLED or BILLING_CORA_STATEMENT_SYNC_ENABLED)',
    };
  }
  const results: CoraStatementSyncResult[] = [];
  for (const entity of coraStatementSyncEntities()) {
    if (entity === 'coop') {
      console.log('[cora-statement-sync] Coop out of scope — skip');
      continue;
    }
    results.push(await runCoraStatementSync({ entityType: entity }));
  }
  return { ok: results.every((r) => r.ok), results };
}
