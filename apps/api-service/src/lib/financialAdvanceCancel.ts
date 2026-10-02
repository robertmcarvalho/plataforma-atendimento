import type { SupabaseClient } from '@supabase/supabase-js';
import { FinancialEntryStatus } from '@plataforma/operational-notes';
import { writeAuditLog } from './auditLog';
import { isOpenInstallmentStatus } from './financialEntryStatus';

export const FINANCIAL_CANCEL_REASON_MIN_LEN = 10;

const CANCELLABLE_ENTRY_STATUSES = new Set<string>([
  FinancialEntryStatus.ACTIVE,
  FinancialEntryStatus.PARTIALLY_CANCELLED,
]);

export type CancelFinancialAdvanceResult = {
  entry_id: string;
  status: string;
  cancelled_installment_ids: string[];
  paid_installment_ids: string[];
};

export async function cancelFinancialAdvanceEntry(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    entryId: string;
    reason: string;
    actorId: string;
  }
): Promise<CancelFinancialAdvanceResult> {
  const reason = String(input.reason || '').trim();
  if (reason.length < FINANCIAL_CANCEL_REASON_MIN_LEN) {
    throw new Error(`Informe o motivo do cancelamento (mínimo ${FINANCIAL_CANCEL_REASON_MIN_LEN} caracteres).`);
  }

  const { data: entry, error: fetchErr } = await db
    .from('financial_entries')
    .select('id, type, status')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.entryId)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!entry) throw new Error('Lançamento não encontrado');
  if (String(entry.type) !== 'advance') {
    throw new Error('Cancelamento disponível apenas para adiantamentos.');
  }
  if (!CANCELLABLE_ENTRY_STATUSES.has(String(entry.status))) {
    throw new Error('Este lançamento não pode ser cancelado no status atual.');
  }

  const { data: installments, error: instErr } = await db
    .from('financial_installments')
    .select('id, status, installment_number, due_date, amount')
    .eq('workspace_id', input.workspaceId)
    .eq('entry_id', input.entryId)
    .order('installment_number');
  if (instErr) throw new Error(instErr.message);

  const rows = installments || [];
  const openRows = rows.filter((row) => isOpenInstallmentStatus(String(row.status)));
  if (!openRows.length) {
    throw new Error('Não há parcelas pendentes para cancelar.');
  }

  const now = new Date().toISOString();
  const openIds = openRows.map((row) => String(row.id));
  const { error: cancelInstErr } = await db
    .from('financial_installments')
    .update({ status: 'cancelled' })
    .eq('workspace_id', input.workspaceId)
    .in('id', openIds)
    .in('status', ['pending', 'overdue']);
  if (cancelInstErr) throw new Error(cancelInstErr.message);

  const paidIds = rows.filter((row) => String(row.status) === 'paid').map((row) => String(row.id));
  const nextStatus =
    paidIds.length > 0 ? FinancialEntryStatus.PARTIALLY_CANCELLED : FinancialEntryStatus.CANCELLED;

  const { error: updErr } = await db
    .from('financial_entries')
    .update({
      status: nextStatus,
      cancelled_by: input.actorId,
      cancelled_at: now,
      cancel_reason: reason,
      updated_at: now,
    })
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.entryId);
  if (updErr) throw new Error(updErr.message);

  await writeAuditLog({
    actor_id: input.actorId,
    action: 'financial_entries.cancelled',
    entity_type: 'financial_entry',
    entity_id: input.entryId,
    workspace_id: input.workspaceId,
    metadata: {
      cancel_reason: reason,
      entry_type: 'advance',
      cancelled_installment_ids: openIds,
      paid_installment_ids: paidIds,
      new_status: nextStatus,
    },
  });

  return {
    entry_id: input.entryId,
    status: nextStatus,
    cancelled_installment_ids: openIds,
    paid_installment_ids: paidIds,
  };
}
