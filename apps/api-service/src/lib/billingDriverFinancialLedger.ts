import type { SupabaseClient } from '@supabase/supabase-js';
import {
  financialLedgerEntryTypeForSlug,
  isFinancialCoopDiscountSlug,
  FINANCIAL_COOP_SETTLEMENT_LINE_KINDS,
} from './billingCapitalSeparation';
import { syncQuotaInstallmentPayment } from './billingQuotaLedger';

type Db = SupabaseClient;

export type FinancialCoopSettlementLine = {
  kind: string;
  amount_cents: number;
  description: string | null;
  installment_id: string;
  entry_type_slug: string;
};

async function markInstallmentPaid(
  db: Db,
  workspaceId: string,
  installmentId: string,
  actorId: string | null
): Promise<void> {
  const { data: installment, error: loadErr } = await db
    .from('financial_installments')
    .select('id, status, entry_id')
    .eq('workspace_id', workspaceId)
    .eq('id', installmentId)
    .maybeSingle();
  if (loadErr) throw new Error(loadErr.message);
  if (!installment || String(installment.status) === 'paid') return;

  const { error: updErr } = await db
    .from('financial_installments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      paid_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', installmentId)
    .eq('status', 'pending');
  if (updErr) throw new Error(updErr.message);

  const { data: siblings } = await db
    .from('financial_installments')
    .select('status')
    .eq('workspace_id', workspaceId)
    .eq('entry_id', installment.entry_id);
  const allPaid = (siblings || []).every((row) => String(row.status) === 'paid');
  if (allPaid) {
    await db
      .from('financial_entries')
      .update({ status: 'settled', updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', installment.entry_id);
  }
}

export async function recordFinancialCoopRecovery(
  db: Db,
  input: {
    workspaceId: string;
    driverId: string;
    line: FinancialCoopSettlementLine;
    billingCycleId: string;
    settlementId: string;
    actorId?: string | null;
  }
): Promise<void> {
  const entryType = financialLedgerEntryTypeForSlug(input.line.entry_type_slug);
  const { error } = await db.from('billing_driver_financial_ledger_entries').insert({
    workspace_id: input.workspaceId,
    driver_id: input.driverId,
    entry_type: entryType,
    amount_cents: input.line.amount_cents,
    source_installment_id: input.line.installment_id,
    source_entry_id: null,
    billing_cycle_id: input.billingCycleId,
    settlement_id: input.settlementId,
    description: input.line.description || entryType,
    metadata: { settlement_line_kind: input.line.kind },
    created_by: input.actorId || null,
  });
  if (error && error.code !== '23505') throw new Error(error.message);
}

export async function applyCycleFinancialCoopSideEffects(
  db: Db,
  input: {
    workspaceId: string;
    billingCycleId: string;
    actorId?: string | null;
  }
): Promise<{ quota_integralizations: number; financial_recoveries: number }> {
  const { data: settlements, error: stErr } = await db
    .from('billing_settlements')
    .select('id, driver_id')
    .eq('workspace_id', input.workspaceId)
    .eq('billing_cycle_id', input.billingCycleId);
  if (stErr) throw new Error(stErr.message);
  if (!settlements?.length) return { quota_integralizations: 0, financial_recoveries: 0 };

  const settlementIds = settlements.map((row) => String(row.id));
  const { data: lines, error: lineErr } = await db
    .from('billing_settlement_lines')
    .select('settlement_id, kind, description, driver_amount_cents, metadata')
    .in('settlement_id', settlementIds)
    .lt('driver_amount_cents', 0);
  if (lineErr) throw new Error(lineErr.message);

  const settlementById = new Map(settlements.map((row) => [String(row.id), row]));
  let quotaIntegralizations = 0;
  let financialRecoveries = 0;

  for (const line of lines || []) {
    const meta = (line.metadata || {}) as Record<string, unknown>;
    if (meta.dre_scope !== 'outside_margin') continue;
    const installmentId = meta.financial_installment_id ? String(meta.financial_installment_id) : '';
    if (!installmentId) continue;

    const settlement = settlementById.get(String(line.settlement_id));
    if (!settlement) continue;

    const driverId = String(settlement.driver_id);
    const amountCents = Math.abs(Number(line.driver_amount_cents || 0));
    const slug = String(meta.financial_entry_type || line.kind || '');

    await markInstallmentPaid(db, input.workspaceId, installmentId, input.actorId || null);

    if (String(line.kind) === 'quota' || slug === 'quota') {
      const synced = await syncQuotaInstallmentPayment(db, {
        workspaceId: input.workspaceId,
        installmentId,
        actorId: input.actorId || null,
      });
      if (synced) quotaIntegralizations += 1;
      continue;
    }

    if (isFinancialCoopDiscountSlug(slug) || FINANCIAL_COOP_SETTLEMENT_LINE_KINDS.has(String(line.kind))) {
      await recordFinancialCoopRecovery(db, {
        workspaceId: input.workspaceId,
        driverId,
        billingCycleId: input.billingCycleId,
        settlementId: String(line.settlement_id),
        actorId: input.actorId || null,
        line: {
          kind: String(line.kind),
          amount_cents: amountCents,
          description: line.description ? String(line.description) : null,
          installment_id: installmentId,
          entry_type_slug: slug || String(line.kind),
        },
      });
      financialRecoveries += 1;
    }
  }

  return { quota_integralizations: quotaIntegralizations, financial_recoveries: financialRecoveries };
}
