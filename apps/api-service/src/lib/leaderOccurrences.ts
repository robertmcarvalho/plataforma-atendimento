import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAbsenceApuracao, mergeDiscountRulesFromJson } from '@plataforma/financial-cycle';
import {
  FinancialEntryStatus,
  OccurrenceKind as OccurrenceKindValues,
  type OccurrenceKindValue,
} from '@plataforma/operational-notes';
import { insertFinancialEntryWithInstallments } from './financialEntryFactory';

export type OccurrenceKind = OccurrenceKindValue;
export type OccurrenceSource = 'leader' | 'financial' | 'attendant';

export type OccurrenceInput = {
  workspace_id: string;
  created_by: string;
  driver_id: string;
  pharmacy_ids: string[];
  event_date: string;
  shift?: 'full' | 'morning' | 'afternoon' | 'night';
  occurrence_kind: OccurrenceKind;
  has_coverage: boolean;
  coverage?: {
    covering_driver_id: string;
    amount: number;
    notes?: string;
  };
  /** Obrigatório quando occurrence_kind = contracted_daily */
  contracted_daily?: {
    amount: number;
    notes?: string;
  };
  reason?: string;
  source?: OccurrenceSource;
};

export type OccurrenceResult = {
  absence_entries: Array<Record<string, unknown>>;
  coverage_daily_entries: Array<Record<string, unknown>>;
  installments_created: number;
};

async function loadDiscountRules(db: SupabaseClient, workspaceId: string) {
  const { data } = await db
    .from('app_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('key', 'financial_discount_rules')
    .maybeSingle();
  return mergeDiscountRulesFromJson(data?.value ?? null);
}

/** event_date não pode ser futura; ciclo permanece aberto até o dia de pagamento (quinta após o ciclo seg–dom). */
export function assertEventDateInOpenCycle(eventDateIso: string, rules: ReturnType<typeof mergeDiscountRulesFromJson>) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDateIso)) {
    throw new Error('event_date inválido (YYYY-MM-DD)');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (eventDateIso > today) {
    throw new Error('Data do evento não pode ser no futuro.');
  }
  const ap = buildAbsenceApuracao(eventDateIso, rules.absence);
  if (today > ap.paymentDate) {
    throw new Error('Ciclo de apuração desta data já foi fechado. Informe uma data no ciclo em aberto.');
  }
}

function coverageNotesDefault(kindLabel: string, source: OccurrenceSource, roleLabel: string): string {
  const origin =
    source === 'financial' ? 'financeiro' : source === 'attendant' ? 'analista (cobrindo líder)' : 'líder';
  return `Cobertura (${roleLabel}) — ${kindLabel} registrada pelo ${origin}.`;
}

function coverageRoleLabel(kind: OccurrenceKind): string {
  return kind === OccurrenceKindValues.DAY_OFF ? 'folguista' : 'diarista';
}

function occurrenceKindLabel(kind: OccurrenceKind): string {
  if (kind === OccurrenceKindValues.DAY_OFF) return 'Folga';
  if (kind === OccurrenceKindValues.CONTRACTED_DAILY) return 'Diária contratada (trabalhou)';
  return 'Falta';
}

function uniqueIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

async function resolvePharmacyContext(
  db: SupabaseClient,
  workspaceId: string,
  pharmacyIdsInput: string[]
) {
  const pharmacyIds = uniqueIds(pharmacyIdsInput);
  if (!pharmacyIds.length) throw new Error('Informe ao menos uma farmácia.');

  const { data: pharmacyRows, error: pharmacyErr } = await db
    .from('pharmacies')
    .select('id, trade_name, legal_name')
    .eq('workspace_id', workspaceId)
    .in('id', pharmacyIds);
  if (pharmacyErr) throw new Error(pharmacyErr.message);

  const pharmacyById = new Map((pharmacyRows || []).map((row) => [String(row.id), row]));
  const missingPharmacy = pharmacyIds.find((id) => !pharmacyById.has(id));
  if (missingPharmacy) throw new Error('Farmácia inválida ou fora do workspace.');

  const pharmacyNames = pharmacyIds.map((id) => {
    const row = pharmacyById.get(id);
    return String(row?.trade_name || row?.legal_name || id).trim();
  });
  const linkedPharmaciesNote =
    pharmacyNames.length > 1 ? `Farmácias vinculadas: ${pharmacyNames.join(', ')}.` : null;

  return {
    pharmacyIds,
    primaryPharmacyId: pharmacyIds[0]!,
    linkedPharmaciesNote,
  };
}

async function insertContractedDaily(
  db: SupabaseClient,
  input: OccurrenceInput,
  source: OccurrenceSource
): Promise<OccurrenceResult> {
  if (input.has_coverage) {
    throw new Error('Diária contratada não usa cobridor. Desmarque a cobertura.');
  }
  const amount = Number(input.contracted_daily?.amount);
  if (!(amount > 0)) throw new Error('Valor da diária contratada deve ser maior que zero.');

  const rules = await loadDiscountRules(db, input.workspace_id);
  assertEventDateInOpenCycle(input.event_date, rules);
  const { primaryPharmacyId, linkedPharmaciesNote } = await resolvePharmacyContext(
    db,
    input.workspace_id,
    input.pharmacy_ids
  );

  const shiftNote = input.shift ? `Turno: ${input.shift}. ` : '';
  const kindLabel = occurrenceKindLabel(OccurrenceKindValues.CONTRACTED_DAILY);
  const origin =
    source === 'financial' ? 'financeiro' : source === 'attendant' ? 'analista (cobrindo líder)' : 'líder';
  const baseNotes = [
    shiftNote,
    input.reason?.trim(),
    input.contracted_daily?.notes?.trim(),
  ]
    .filter(Boolean)
    .join('')
    .trim();
  const notes = [
    baseNotes || `${kindLabel} registrada pelo ${origin}.`,
    linkedPharmaciesNote,
  ]
    .filter(Boolean)
    .join(' ');

  const dailyResult = await insertFinancialEntryWithInstallments(db, {
    workspace_id: input.workspace_id,
    created_by: input.created_by,
    driver_id: input.driver_id,
    pharmacy_id: primaryPharmacyId,
    type: 'daily',
    total_amount: amount,
    installments_count: 1,
    frequency: 'weekly',
    event_date: input.event_date,
    notes,
    status: FinancialEntryStatus.PENDING_APPROVAL,
  });

  const dailyId = String(dailyResult.entry.id);
  const dailyPatch = {
    occurrence_kind: OccurrenceKindValues.CONTRACTED_DAILY,
    coverage_of_entry_id: null,
    updated_at: new Date().toISOString(),
  };
  await db.from('financial_entries').update(dailyPatch).eq('id', dailyId);

  return {
    absence_entries: [],
    coverage_daily_entries: [{ ...dailyResult.entry, ...dailyPatch }],
    installments_created: dailyResult.installments_created,
  };
}

export async function insertOccurrence(db: SupabaseClient, input: OccurrenceInput): Promise<OccurrenceResult> {
  const source: OccurrenceSource = input.source ?? 'financial';

  if (input.occurrence_kind === OccurrenceKindValues.CONTRACTED_DAILY) {
    return insertContractedDaily(db, input, source);
  }

  const rules = await loadDiscountRules(db, input.workspace_id);
  assertEventDateInOpenCycle(input.event_date, rules);
  const { pharmacyIds, primaryPharmacyId, linkedPharmaciesNote } = await resolvePharmacyContext(
    db,
    input.workspace_id,
    input.pharmacy_ids
  );
  void pharmacyIds;

  if (input.has_coverage) {
    const cov = input.coverage;
    if (!cov?.covering_driver_id) throw new Error('Informe o entregador que cobriu.');
    if (cov.covering_driver_id === input.driver_id) {
      throw new Error('O cobridor deve ser diferente do ausente.');
    }
    const amount = Number(cov.amount);
    if (!(amount > 0)) throw new Error('Valor da diária de cobertura deve ser maior que zero.');
  }

  const absenceEntries: Array<Record<string, unknown>> = [];
  const dailyEntries: Array<Record<string, unknown>> = [];
  let installments_created = 0;

  const shiftNote = input.shift ? `Turno: ${input.shift}. ` : '';
  const kindLabel = occurrenceKindLabel(input.occurrence_kind);
  const roleLabel = coverageRoleLabel(input.occurrence_kind);
  const baseNotes = [shiftNote, input.reason?.trim()].filter(Boolean).join('').trim() || null;
  const isDayOff = input.occurrence_kind === OccurrenceKindValues.DAY_OFF;
  const coverageAmount = input.has_coverage && input.coverage ? Number(input.coverage.amount) : 0;

  const absenceNotes = [
    baseNotes ? `${kindLabel}. ${baseNotes}` : kindLabel,
    linkedPharmaciesNote,
  ].filter(Boolean).join(' ');
  const absenceResult = await insertFinancialEntryWithInstallments(db, {
    workspace_id: input.workspace_id,
    created_by: input.created_by,
    driver_id: input.driver_id,
    pharmacy_id: primaryPharmacyId,
    type: 'absence',
    total_amount: isDayOff ? 0 : input.has_coverage ? coverageAmount : 0,
    installments_count: 1,
    frequency: 'weekly',
    event_date: input.event_date,
    notes: absenceNotes,
    status: isDayOff ? FinancialEntryStatus.INFORMED : FinancialEntryStatus.PENDING_APPROVAL,
  });

  const absenceId = String(absenceResult.entry.id);
  const absencePatch: Record<string, unknown> = {
    occurrence_kind: input.occurrence_kind,
    updated_at: new Date().toISOString(),
  };

  if (!isDayOff) {
    absencePatch.absence_disposition = 'pending';
    if (input.has_coverage && coverageAmount > 0) {
      absencePatch.proposed_discount_amount = coverageAmount;
    }
  }

  await db.from('financial_entries').update(absencePatch).eq('id', absenceId);

  absenceEntries.push({ ...absenceResult.entry, ...absencePatch });
  installments_created += absenceResult.installments_created;

  if (input.has_coverage && input.coverage) {
    const coverageNotes = [
      input.coverage.notes?.trim() || coverageNotesDefault(kindLabel, source, roleLabel),
      linkedPharmaciesNote,
    ].filter(Boolean).join(' ');

    const dailyResult = await insertFinancialEntryWithInstallments(db, {
      workspace_id: input.workspace_id,
      created_by: input.created_by,
      driver_id: input.coverage.covering_driver_id,
      pharmacy_id: primaryPharmacyId,
      type: 'daily',
      total_amount: input.coverage.amount,
      installments_count: 1,
      frequency: 'weekly',
      event_date: input.event_date,
      notes: coverageNotes,
      status: FinancialEntryStatus.PENDING_APPROVAL,
    });

    const dailyId = String(dailyResult.entry.id);
    await db
      .from('financial_entries')
      .update({
        coverage_of_entry_id: absenceId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', dailyId);

    dailyEntries.push({ ...dailyResult.entry, coverage_of_entry_id: absenceId });
    installments_created += dailyResult.installments_created;
  }

  return {
    absence_entries: absenceEntries,
    coverage_daily_entries: dailyEntries,
    installments_created,
  };
}

export function occurrencePrimaryEntryId(result: OccurrenceResult): string {
  return String(result.absence_entries[0]?.id || result.coverage_daily_entries[0]?.id || '');
}
