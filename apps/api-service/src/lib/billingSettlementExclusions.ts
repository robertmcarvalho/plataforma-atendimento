import { writeAuditLog } from './auditLog';
import { supabase } from './supabase';
import {
  isExcludableLineKind,
  type SettlementExclusion,
  type SettlementExclusionScope,
} from './billingSettlementExclusionOverlay';

export {
  EXCLUDABLE_LINE_KINDS,
  applySettlementExclusionOverlay,
  driverIsFullyExcluded,
  exclusionMatchesLine,
  isExcludableLineKind,
  settlementLineFingerprint,
  type ExcludableLineKind,
  type ExcludableSettlementLine,
  type SettlementExclusion,
  type SettlementExclusionScope,
} from './billingSettlementExclusionOverlay';

export async function loadSettlementExclusions(
  workspaceId: string,
  cycleId: string,
  pharmacyId?: string
): Promise<SettlementExclusion[]> {
  let query = supabase
    .from('billing_settlement_exclusions')
    .select(
      'id, driver_id, pharmacy_id, scope, line_kind, line_fingerprint, justification, pharmacy_amount_cents_before, driver_amount_cents_before'
    )
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
    scope: row.scope === 'line' ? 'line' : 'driver',
    lineKind: row.line_kind ? String(row.line_kind) : null,
    lineFingerprint: row.line_fingerprint ? String(row.line_fingerprint) : null,
    justification: String(row.justification || ''),
    pharmacyAmountCentsBefore: Number(row.pharmacy_amount_cents_before || 0),
    driverAmountCentsBefore: Number(row.driver_amount_cents_before || 0),
  }));
}

export async function addSettlementExclusion(input: {
  workspaceId: string;
  cycleId: string;
  pharmacyId: string;
  driverId: string;
  actorId: string;
  scope: SettlementExclusionScope;
  justification: string;
  lineKind?: string | null;
  lineFingerprint?: string | null;
  pharmacyAmountCentsBefore?: number;
  driverAmountCentsBefore?: number;
  settlementId?: string | null;
  lineId?: string | null;
}): Promise<{ id: string }> {
  const justification = String(input.justification || '').trim();
  if (justification.length < 3) {
    throw new Error('Justificativa obrigatória para excluir do acerto.');
  }
  if (input.scope === 'line') {
    const kind = String(input.lineKind || '');
    if (!isExcludableLineKind(kind)) {
      throw new Error('Só é possível excluir linhas de entregas, MG ou diária.');
    }
  }

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
    throw new Error('Estorne o acerto aprovado antes de excluir linhas.');
  }

  const { data, error } = await supabase
    .from('billing_settlement_exclusions')
    .insert({
      workspace_id: input.workspaceId,
      billing_cycle_id: input.cycleId,
      pharmacy_id: input.pharmacyId,
      driver_id: input.driverId,
      settlement_id: input.settlementId || settlements[0]?.id || null,
      line_id: input.lineId || null,
      scope: input.scope,
      line_kind: input.scope === 'line' ? input.lineKind : null,
      line_fingerprint: input.scope === 'line' ? input.lineFingerprint || null : null,
      justification,
      pharmacy_amount_cents_before: input.pharmacyAmountCentsBefore || 0,
      driver_amount_cents_before: input.driverAmountCentsBefore || 0,
      created_by: input.actorId,
      active: true,
    })
    .select('id')
    .single();
  if (error) {
    if (String(error.code || '') === '23505' || String(error.message || '').toLowerCase().includes('duplicate')) {
      throw new Error('Esta exclusão já existe neste acerto e será preservada no recálculo.');
    }
    throw new Error(error.message);
  }

  await writeAuditLog({
    actor_id: input.actorId,
    workspace_id: input.workspaceId,
    action: 'billing.settlement.exclude',
    entity_type: 'billing_settlement_exclusion',
    entity_id: String(data.id),
    metadata: {
      billing_cycle_id: input.cycleId,
      pharmacy_id: input.pharmacyId,
      driver_id: input.driverId,
      scope: input.scope,
      line_kind: input.lineKind || null,
      line_fingerprint: input.lineFingerprint || null,
      justification,
      pharmacy_amount_cents_before: input.pharmacyAmountCentsBefore || 0,
      driver_amount_cents_before: input.driverAmountCentsBefore || 0,
    },
  });

  return { id: String(data.id) };
}
