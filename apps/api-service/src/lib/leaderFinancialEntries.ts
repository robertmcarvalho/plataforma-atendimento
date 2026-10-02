import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FinancialEntryStatus,
  type OccurrenceKindValue,
} from '@plataforma/operational-notes';
import { insertFinancialEntryWithInstallments } from './financialEntryFactory';

export type LeaderFinancialInsertInput = {
  workspace_id: string;
  created_by: string;
  driver_id: string;
  pharmacy_id: string;
  type: 'absence' | 'daily';
  event_date?: string;
  reason?: string;
  description?: string;
  notes?: string;
  amount?: number;
  status?: string;
  occurrence_kind?: OccurrenceKindValue;
};

export type LeaderFinancialInsertResult = {
  entries: Array<Record<string, unknown>>;
  installments_created: number;
};

/**
 * Cria lançamento financeiro do portal do líder (motor de ciclo + parcelas).
 * Motivo do líder → notes; description gerada pelo sistema.
 */
export async function insertLeaderFinancialEntries(
  db: SupabaseClient,
  input: LeaderFinancialInsertInput
): Promise<LeaderFinancialInsertResult> {
  const notes = input.reason?.trim() || input.notes?.trim() || null;

  if (input.type === 'absence') {
    const result = await insertFinancialEntryWithInstallments(db, {
      workspace_id: input.workspace_id,
      created_by: input.created_by,
      driver_id: input.driver_id,
      pharmacy_id: input.pharmacy_id,
      type: 'absence',
      total_amount: 0,
      installments_count: 1,
      frequency: 'weekly',
      event_date: input.event_date,
      notes,
      status: input.status ?? FinancialEntryStatus.INFORMED,
    });
    const entry = result.entry;
    if (input.occurrence_kind && entry?.id) {
      await db
        .from('financial_entries')
        .update({ occurrence_kind: input.occurrence_kind, updated_at: new Date().toISOString() })
        .eq('id', String(entry.id));
    }
    return { entries: [result.entry], installments_created: result.installments_created };
  }

  const total = Number(input.amount || 0);
  if (!(total > 0)) throw new Error('Valor da diária inválido');

  const result = await insertFinancialEntryWithInstallments(db, {
    workspace_id: input.workspace_id,
    created_by: input.created_by,
    driver_id: input.driver_id,
    pharmacy_id: input.pharmacy_id,
    type: 'daily',
    total_amount: total,
    installments_count: 1,
    frequency: 'weekly',
    notes,
    status: FinancialEntryStatus.PENDING_APPROVAL,
  });
  return { entries: [result.entry], installments_created: result.installments_created };
}
