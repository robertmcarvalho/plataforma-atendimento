import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildAbsenceApuracao,
  buildSystemDescription,
  mergeDiscountRulesFromJson,
  resolveDailyPaymentDate,
  summarizeRuleForType,
  type DiscountRule,
} from '@plataforma/financial-cycle';
import { FinancialEntryStatus } from '@plataforma/operational-notes';
import { generateInstallments } from './financialInstallments';

export type FinancialEntryInsertInput = {
  workspace_id: string;
  created_by: string;
  driver_id: string;
  pharmacy_id: string;
  type: string;
  total_amount: number;
  installments_count: number;
  frequency: string;
  event_date?: string;
  start_date?: string;
  notes?: string | null;
  description?: string | null;
  status?: string;
  created_at_iso?: string;
};

export type ComputedFinancialEntry = {
  description: string;
  start_date: string;
  installment_amount: number;
  status: string;
  notes: string | null;
  event_date: string | null;
  apuracao_start: string | null;
  apuracao_end: string | null;
};

async function loadMergedDiscountRules(db: SupabaseClient, workspaceId: string) {
  const { data } = await db
    .from('app_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('key', 'financial_discount_rules')
    .maybeSingle();
  return mergeDiscountRulesFromJson(data?.value ?? null);
}

export function computeFinancialEntryFields(
  input: FinancialEntryInsertInput,
  rules: Record<string, DiscountRule>,
  createdAt: Date
): ComputedFinancialEntry {
  const rule = rules[input.type] ?? mergeDiscountRulesFromJson(null)[input.type];
  const ruleSummary = summarizeRuleForType(input.type, rules);
  const createdIso = input.created_at_iso ?? createdAt.toISOString();
  const notes = input.notes?.trim() || null;

  if (input.type === 'daily') {
    const dailyRule = rules.daily;
    const paymentDate = resolveDailyPaymentDate(createdAt, dailyRule);
    const installment_amount = Number((input.total_amount / input.installments_count).toFixed(2));
    return {
      description: buildSystemDescription({
        entryType: 'daily',
        createdAtIso: createdIso,
        paymentDateIso: paymentDate,
        ruleSummary,
      }),
      start_date: paymentDate,
      installment_amount,
      status: input.status ?? FinancialEntryStatus.PENDING_APPROVAL,
      notes,
      event_date: input.event_date && /^\d{4}-\d{2}-\d{2}$/.test(input.event_date) ? input.event_date : null,
      apuracao_start: null,
      apuracao_end: null,
    };
  }

  if (input.type === 'absence') {
    const eventDate = input.event_date;
    if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      throw new Error('event_date obrigatório para falta (YYYY-MM-DD)');
    }
    const ap = buildAbsenceApuracao(eventDate, rules.absence);
    return {
      description: buildSystemDescription({
        entryType: 'absence',
        createdAtIso: createdIso,
        paymentDateIso: ap.paymentDate,
        apuracao: ap,
        ruleSummary,
      }),
      start_date: ap.paymentDate,
      installment_amount: 0,
      status: input.status ?? 'active',
      notes,
      event_date: eventDate,
      apuracao_start: ap.apuracaoStart,
      apuracao_end: ap.apuracaoEnd,
    };
  }

  const start_date =
    input.start_date && /^\d{4}-\d{2}-\d{2}$/.test(input.start_date)
      ? input.start_date
      : input.event_date && /^\d{4}-\d{2}-\d{2}$/.test(input.event_date)
        ? input.event_date
        : createdIso.slice(0, 10);
  const installment_amount = Number((input.total_amount / input.installments_count).toFixed(2));
  return {
    description:
      input.description?.trim() ||
      buildSystemDescription({
        entryType: input.type,
        createdAtIso: createdIso,
        paymentDateIso: start_date,
        ruleSummary,
      }),
    start_date,
    installment_amount,
    status: input.status ?? 'active',
    notes,
    event_date: input.event_date ?? null,
    apuracao_start: null,
    apuracao_end: null,
  };
}

export async function insertFinancialEntryWithInstallments(
  db: SupabaseClient,
  input: FinancialEntryInsertInput
): Promise<{ entry: Record<string, unknown>; installments_created: number }> {
  const rules = await loadMergedDiscountRules(db, input.workspace_id);
  const createdAt = input.created_at_iso ? new Date(input.created_at_iso) : new Date();
  const computed = computeFinancialEntryFields(input, rules, createdAt);

  const row = {
    workspace_id: input.workspace_id,
    driver_id: input.driver_id,
    pharmacy_id: input.pharmacy_id,
    type: input.type,
    description: computed.description,
    total_amount: input.total_amount,
    installments_count: input.installments_count,
    installment_amount: computed.installment_amount,
    frequency: input.frequency,
    start_date: computed.start_date,
    status: computed.status,
    notes: computed.notes,
    event_date: computed.event_date,
    apuracao_start: computed.apuracao_start,
    apuracao_end: computed.apuracao_end,
    created_by: input.created_by,
  };

  const { data: entry, error } = await db.from('financial_entries').insert(row).select().single();
  if (error) throw new Error(error.message);

  const instRows = generateInstallments(
    String(entry.id),
    computed.start_date,
    input.installments_count,
    computed.installment_amount,
    input.frequency,
    input.type,
    rules
  ).map((inst) => ({ ...inst, workspace_id: input.workspace_id }));

  if (instRows.length) {
    const { error: instErr } = await db.from('financial_installments').insert(instRows);
    if (instErr) throw new Error(instErr.message);
  }

  return { entry: entry as Record<string, unknown>, installments_created: instRows.length };
}
