import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeDiscountRulesFromJson } from './financialDiscountRules';
import { computeFinancialEntryFields } from './financialEntryFactory';
import { generateInstallments } from './financialInstallments';

export type AbsenceDispositionAction = 'excused' | 'discounted';

async function loadMergedDiscountRules(db: SupabaseClient, workspaceId: string) {
  const { data } = await db
    .from('app_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('key', 'financial_discount_rules')
    .maybeSingle();
  return mergeDiscountRulesFromJson(data?.value ?? null);
}

export async function applyAbsenceDisposition(
  db: SupabaseClient,
  input: {
    workspace_id: string;
    entry_id: string;
    actor_id: string;
    action: AbsenceDispositionAction;
    discount_amount?: number;
    notes?: string;
  }
): Promise<Record<string, unknown>> {
  const { data: existing, error: loadErr } = await db
    .from('financial_entries')
    .select('*, financial_installments(id, status)')
    .eq('workspace_id', input.workspace_id)
    .eq('id', input.entry_id)
    .single();

  if (loadErr || !existing) throw new Error('Lançamento não encontrado');
  if (String(existing.type) !== 'absence') throw new Error('Disposition só se aplica a lançamentos de falta.');
  if (String(existing.occurrence_kind || '') === 'day_off') {
    throw new Error('Folgas não possuem desconto ou abono.');
  }
  if (String(existing.occurrence_kind || '') !== 'unexcused') {
    throw new Error('Disposition só se aplica a faltas (unexcused).');
  }

  const disposition = String(existing.absence_disposition || 'pending');
  if (disposition === 'discounted' || disposition === 'excused') {
    throw new Error('Esta falta já teve decisão financeira registrada.');
  }

  const insts = (existing.financial_installments || []) as Array<{ id: string; status: string }>;
  if (insts.some((i) => i.status === 'paid')) {
    throw new Error('Não é possível alterar falta com parcelas já baixadas.');
  }

  const rules = await loadMergedDiscountRules(db, input.workspace_id);
  const eventDate = existing.event_date ? String(existing.event_date).slice(0, 10) : undefined;
  if (!eventDate) throw new Error('event_date ausente na falta.');

  const now = new Date().toISOString();

  if (input.action === 'excused') {
    const computed = computeFinancialEntryFields(
      {
        workspace_id: input.workspace_id,
        created_by: input.actor_id,
        driver_id: String(existing.driver_id),
        pharmacy_id: String(existing.pharmacy_id || ''),
        type: 'absence',
        total_amount: 0,
        installments_count: 1,
        frequency: String(existing.frequency || 'weekly'),
        event_date: eventDate,
        notes: existing.notes ? String(existing.notes) : null,
        status: 'informed',
      },
      rules,
      new Date(String(existing.created_at))
    );

    await db.from('financial_installments').delete().eq('entry_id', input.entry_id);

    const { data: updated, error: updErr } = await db
      .from('financial_entries')
      .update({
        total_amount: 0,
        installment_amount: 0,
        status: 'informed',
        absence_disposition: 'excused',
        disposition_by: input.actor_id,
        disposition_at: now,
        disposition_notes: input.notes?.trim() || null,
        description: computed.description,
        start_date: computed.start_date,
        apuracao_start: computed.apuracao_start,
        apuracao_end: computed.apuracao_end,
        updated_at: now,
      })
      .eq('workspace_id', input.workspace_id)
      .eq('id', input.entry_id)
      .select()
      .single();

    if (updErr) throw new Error(updErr.message);
    return updated as Record<string, unknown>;
  }

  const amount = Number(input.discount_amount);
  if (!(amount > 0)) throw new Error('Informe um valor de desconto maior que zero.');

  const computed = computeFinancialEntryFields(
    {
      workspace_id: input.workspace_id,
      created_by: input.actor_id,
      driver_id: String(existing.driver_id),
      pharmacy_id: String(existing.pharmacy_id || ''),
      type: 'absence',
      total_amount: amount,
      installments_count: Number(existing.installments_count) || 1,
      frequency: String(existing.frequency || 'weekly'),
      event_date: eventDate,
      notes: existing.notes ? String(existing.notes) : null,
      status: 'active',
    },
    rules,
    new Date(String(existing.created_at))
  );

  await db.from('financial_installments').delete().eq('entry_id', input.entry_id);

  const instRows = generateInstallments(
    input.entry_id,
    computed.start_date,
    Number(existing.installments_count) || 1,
    computed.installment_amount,
    String(existing.frequency || 'weekly'),
    'absence',
    rules
  ).map((inst) => ({ ...inst, workspace_id: input.workspace_id }));

  if (instRows.length) {
    const { error: instErr } = await db.from('financial_installments').insert(instRows);
    if (instErr) throw new Error(instErr.message);
  }

  const { data: updated, error: updErr } = await db
    .from('financial_entries')
    .update({
      total_amount: amount,
      installment_amount: computed.installment_amount,
      status: 'active',
      absence_disposition: 'discounted',
      disposition_by: input.actor_id,
      disposition_at: now,
      disposition_notes: input.notes?.trim() || null,
      description: computed.description,
      start_date: computed.start_date,
      apuracao_start: computed.apuracao_start,
      apuracao_end: computed.apuracao_end,
      updated_at: now,
    })
    .eq('workspace_id', input.workspace_id)
    .eq('id', input.entry_id)
    .select()
    .single();

  if (updErr) throw new Error(updErr.message);
  return updated as Record<string, unknown>;
}
