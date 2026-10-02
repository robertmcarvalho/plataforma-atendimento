import type { SupabaseClient } from '@supabase/supabase-js';
import {
  mergeDiscountRulesFromJson,
  parseLegacyAbsenceEventDate,
  parseLegacyAbsenceReason,
} from '@plataforma/financial-cycle';
import { computeFinancialEntryFields } from './financialEntryFactory';
import { generateInstallments } from './financialInstallments';

export type RecalculateOptions = {
  workspace_id: string;
  dry_run?: boolean;
  types?: string[];
  since?: string;
  limit?: number;
};

export type RecalculateResult = {
  processed: number;
  updated: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
};

export async function recalculateFinancialEntries(
  db: SupabaseClient,
  opts: RecalculateOptions
): Promise<RecalculateResult> {
  const rules = await (async () => {
    const { data } = await db
      .from('app_settings')
      .select('value')
      .eq('workspace_id', opts.workspace_id)
      .eq('key', 'financial_discount_rules')
      .maybeSingle();
    return mergeDiscountRulesFromJson(data?.value ?? null);
  })();

  let query = db
    .from('financial_entries')
    .select(
      `id, type, description, notes, total_amount, installments_count, frequency,
      start_date, status, created_at, event_date, apuracao_start, apuracao_end,
      coverage_of_entry:financial_entries!coverage_of_entry_id(event_date)`
    )
    .eq('workspace_id', opts.workspace_id)
    .order('created_at', { ascending: true });

  if (opts.types?.length) query = query.in('type', opts.types);
  if (opts.since) query = query.gte('created_at', `${opts.since}T00:00:00.000Z`);
  if (opts.limit) query = query.limit(opts.limit);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const result: RecalculateResult = { processed: 0, updated: 0, skipped: 0, errors: [] };

  for (const row of rows || []) {
    result.processed++;
    const id = String(row.id);
    try {
      const type = String(row.type);
      const createdAt = new Date(String(row.created_at));
      let eventDate = row.event_date ? String(row.event_date).slice(0, 10) : null;
      let notes = row.notes ? String(row.notes) : null;
      const coverageEntry = Array.isArray(row.coverage_of_entry)
        ? row.coverage_of_entry[0]
        : row.coverage_of_entry;

      if (type === 'absence') {
        if (!eventDate) eventDate = parseLegacyAbsenceEventDate(String(row.description || ''));
        if (!eventDate) {
          result.skipped++;
          result.errors.push({ id, error: 'event_date não inferível' });
          continue;
        }
        if (!notes) {
          const legacy = parseLegacyAbsenceReason(String(row.description || ''));
          if (legacy) notes = legacy;
        }
      } else if (type === 'daily' && !eventDate && coverageEntry?.event_date) {
        eventDate = String(coverageEntry.event_date).slice(0, 10);
      }

      const computed = computeFinancialEntryFields(
        {
          workspace_id: opts.workspace_id,
          created_by: '',
          driver_id: '',
          pharmacy_id: '',
          type,
          total_amount: Number(row.total_amount) || 0,
          installments_count: Number(row.installments_count) || 1,
          frequency: String(row.frequency || 'weekly'),
          event_date: eventDate ?? undefined,
          start_date: row.start_date ? String(row.start_date).slice(0, 10) : undefined,
          notes,
          status: String(row.status),
          created_at_iso: createdAt.toISOString(),
        },
        rules,
        createdAt
      );

      const patch = {
        description: computed.description,
        start_date: computed.start_date,
        installment_amount: computed.installment_amount,
        notes: computed.notes,
        event_date: computed.event_date,
        apuracao_start: computed.apuracao_start,
        apuracao_end: computed.apuracao_end,
        updated_at: new Date().toISOString(),
      };

      if (!opts.dry_run) {
        const { error: upErr } = await db.from('financial_entries').update(patch).eq('id', id);
        if (upErr) throw new Error(upErr.message);

        await db.from('financial_installments').delete().eq('entry_id', id);
        const instRows = generateInstallments(
          id,
          computed.start_date,
          Number(row.installments_count) || 1,
          computed.installment_amount,
          String(row.frequency || 'weekly'),
          String(row.type || 'other'),
          rules
        ).map((inst) => ({ ...inst, workspace_id: opts.workspace_id }));
        if (instRows.length) {
          const { error: instErr } = await db.from('financial_installments').insert(instRows);
          if (instErr) throw new Error(instErr.message);
        }
      }

      result.updated++;
    } catch (e) {
      result.skipped++;
      result.errors.push({ id, error: e instanceof Error ? e.message : 'erro' });
    }
  }

  return result;
}
