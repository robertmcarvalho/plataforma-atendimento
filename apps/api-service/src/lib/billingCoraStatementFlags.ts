/** Feature flags do sync de extrato Cora (sem deps de Supabase). */

import type { BillingCoraEntityType } from './billingCoraTypes';

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return defaultValue;
}

/** Master do job de sync (além de BILLING_CORA_ENABLED). Default false. */
export function isCoraStatementSyncEnabled(): boolean {
  return envFlag('BILLING_CORA_STATEMENT_SYNC_ENABLED', false);
}

/** Persistência + auto-reconcile. Default false = smoke read-only. */
export function isCoraStatementSyncWriteEnabled(): boolean {
  return envFlag('BILLING_CORA_STATEMENT_SYNC_WRITE', false);
}

/** Auto-reconcile após import (só se write on). Default true quando write. */
export function isCoraStatementSyncAutoReconcileEnabled(): boolean {
  return envFlag('BILLING_CORA_STATEMENT_SYNC_AUTO_RECONCILE', true);
}

/** MVP: só Flux. Coop fica documentado/hook. */
export function coraStatementSyncEntities(): BillingCoraEntityType[] {
  const raw = process.env.BILLING_CORA_STATEMENT_SYNC_ENTITIES?.trim();
  if (!raw) return ['flux'];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is BillingCoraEntityType => s === 'flux' || s === 'coop');
}
