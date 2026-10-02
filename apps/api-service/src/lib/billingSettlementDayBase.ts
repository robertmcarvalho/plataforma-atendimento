import { writeAuditLog } from './auditLog';
import { supabase } from './supabase';
import {
  DAY_BASE_ALLOCATION_RULE,
  DAY_BASE_PAY_TRACK,
  dayBaseLinesForPair,
  type DayBaseDayOverlay,
  type SettlementLineLike,
} from './billingSettlementDayBaseCore';

export {
  DAY_BASE_ALLOCATION_RULE,
  DAY_BASE_PAY_TRACK,
  dayBaseLinesForPair,
  type DayBaseDayOverlay,
  type SettlementLineLike,
};

export async function loadDayBaseDayOverlays(
  workspaceId: string,
  cycleId: string,
  pharmacyId?: string
): Promise<DayBaseDayOverlay[]> {
  let query = supabase
    .from('billing_settlement_day_base_days')
    .select('id, driver_id, pharmacy_id, event_date, amount_cents')
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .eq('active', true);
  if (pharmacyId) query = query.eq('pharmacy_id', pharmacyId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    id: String(row.id),
    driverId: String(row.driver_id),
    pharmacyId: String(row.pharmacy_id),
    eventDate: String(row.event_date).slice(0, 10),
    amountCents: Math.max(0, Number(row.amount_cents || 0)),
  }));
}

export async function upsertDayBaseDay(input: {
  workspaceId: string;
  cycleId: string;
  pharmacyId: string;
  driverId: string;
  eventDate: string;
  /** Repasse ao entregador (cobrança da farmácia vem do cadastro no recálculo). */
  amountCents: number;
  actorId: string;
  active?: boolean;
}): Promise<{ id: string }> {
  const eventDate = String(input.eventDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new Error('Data inválida');
  const amountCents = Math.max(0, Math.round(Number(input.amountCents || 0)));
  const active = input.active !== false;

  const { data: settlements, error: stErr } = await supabase
    .from('billing_settlements')
    .select('id, status')
    .eq('workspace_id', input.workspaceId)
    .eq('billing_cycle_id', input.cycleId)
    .eq('pharmacy_id', input.pharmacyId)
    .eq('driver_id', input.driverId);
  if (stErr) throw new Error(stErr.message);
  if (!settlements?.length) throw new Error('Acerto do entregador não encontrado nesta farmácia.');
  if (settlements.some((row) => !['open', 'in_review'].includes(String(row.status)))) {
    throw new Error('Estorne o acerto aprovado antes de ajustar a diária-base.');
  }

  const { data, error } = await supabase
    .from('billing_settlement_day_base_days')
    .upsert(
      {
        workspace_id: input.workspaceId,
        billing_cycle_id: input.cycleId,
        pharmacy_id: input.pharmacyId,
        driver_id: input.driverId,
        event_date: eventDate,
        amount_cents: amountCents,
        created_by: input.actorId || null,
        active,
      },
      { onConflict: 'workspace_id,billing_cycle_id,pharmacy_id,driver_id,event_date' }
    )
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    workspace_id: input.workspaceId,
    actor_id: input.actorId,
    action: active ? 'billing.settlement.day_base.upsert' : 'billing.settlement.day_base.deactivate',
    entity_type: 'billing_settlement_day_base_days',
    entity_id: data?.id || null,
    metadata: {
      cycle_id: input.cycleId,
      pharmacy_id: input.pharmacyId,
      driver_id: input.driverId,
      event_date: eventDate,
      amount_cents: amountCents,
      active,
    },
  });

  return { id: String(data?.id || '') };
}
