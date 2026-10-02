import { writeAuditLog } from './auditLog';
import { supabase } from './supabase';

export type MgPeriodMultiplier = 0.5 | 1 | 2;

export type MgOverlay = {
  id: string;
  driverId: string;
  pharmacyId: string;
  multiplier: MgPeriodMultiplier;
  justification: string;
};

export function parseMgMultiplier(raw: unknown): MgPeriodMultiplier | null {
  const n = Number(raw);
  if (n === 0.5 || n === 1 || n === 2) return n;
  return null;
}

export async function loadMgOverlays(
  workspaceId: string,
  cycleId: string,
  pharmacyId?: string
): Promise<MgOverlay[]> {
  let query = supabase
    .from('billing_settlement_mg_overlays')
    .select('id, driver_id, pharmacy_id, multiplier, justification')
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .eq('active', true);
  if (pharmacyId) query = query.eq('pharmacy_id', pharmacyId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || [])
    .map((row) => {
      const multiplier = parseMgMultiplier(row.multiplier);
      if (!multiplier) return null;
      return {
        id: String(row.id),
        driverId: String(row.driver_id),
        pharmacyId: String(row.pharmacy_id),
        multiplier,
        justification: String(row.justification || ''),
      } satisfies MgOverlay;
    })
    .filter((row): row is MgOverlay => Boolean(row));
}

/** Aplica fator só no repasse da linha de MG; cobrança farmácia permanece. */
export function applyMgMultiplierToLines<T extends { kind: string; driver_amount_cents: number; metadata?: Record<string, unknown> }>(
  lines: T[],
  multiplier: MgPeriodMultiplier
): T[] {
  if (multiplier === 1) return lines;
  return lines.map((line) => {
    if (line.kind !== 'minimum_guarantee') return line;
    const baseDriver = Math.max(0, Math.round(Number(line.driver_amount_cents || 0)));
    const nextDriver = Math.round(baseDriver * multiplier);
    return {
      ...line,
      driver_amount_cents: nextDriver,
      metadata: {
        ...(line.metadata || {}),
        mg_period_multiplier: multiplier,
        mg_driver_amount_before_multiplier_cents: baseDriver,
      },
    };
  });
}

export async function upsertMgOverlay(input: {
  workspaceId: string;
  cycleId: string;
  pharmacyId: string;
  driverId: string;
  multiplier: MgPeriodMultiplier;
  justification: string;
  actorId: string;
}): Promise<{ id: string }> {
  const justification = String(input.justification || '').trim();
  if (justification.length < 3) throw new Error('Justificativa obrigatória para o multiplicador de MG.');

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
    throw new Error('Estorne o acerto aprovado antes de ajustar o multiplicador de MG.');
  }

  const { data, error } = await supabase
    .from('billing_settlement_mg_overlays')
    .upsert(
      {
        workspace_id: input.workspaceId,
        billing_cycle_id: input.cycleId,
        pharmacy_id: input.pharmacyId,
        driver_id: input.driverId,
        multiplier: input.multiplier,
        justification,
        created_by: input.actorId || null,
        updated_at: new Date().toISOString(),
        active: true,
      },
      { onConflict: 'workspace_id,billing_cycle_id,pharmacy_id,driver_id' }
    )
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    workspace_id: input.workspaceId,
    actor_id: input.actorId,
    action: 'billing.settlement.mg_adjust',
    entity_type: 'billing_settlement_mg_overlays',
    entity_id: data?.id || null,
    metadata: {
      cycle_id: input.cycleId,
      pharmacy_id: input.pharmacyId,
      driver_id: input.driverId,
      multiplier: input.multiplier,
      justification,
    },
  });

  return { id: String(data?.id || '') };
}
