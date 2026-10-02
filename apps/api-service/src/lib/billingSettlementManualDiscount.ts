import { resolveSplitPercentages, splitAmountCents } from '@plataforma/billing-engine';
import { supabase } from './supabase';
import {
  computeSettlementPayoutBreakdown,
  DRE_SCOPE_OPERATIONAL,
  settlementLineMetadata,
} from './billingCapitalSeparation';
import { writeAuditLog } from './auditLog';
import {
  classifySettlementDiscountCents,
  isManualDiscountLine,
  MANUAL_DISCOUNT_SOURCE,
  PHARMACY_GROUP_SCOPE,
  type SettlementDiscountLine,
} from './billingSettlementDiscountClassification';
import {
  pickAnchorSettlement,
  snapshotFromManualDiscountLine,
  type ManualDiscountSnapshot,
} from './billingSettlementManualDiscountHelpers';

export {
  MANUAL_DISCOUNT_SOURCE,
  PHARMACY_GROUP_SCOPE,
  isManualDiscountLine,
  isPharmacyGroupManualDiscount,
  classifySettlementDiscountCents,
} from './billingSettlementDiscountClassification';
export {
  pickAnchorSettlement,
  snapshotFromManualDiscountLine,
  type ManualDiscountSnapshot,
} from './billingSettlementManualDiscountHelpers';

type SettlementLineRow = SettlementDiscountLine & {
  id: string;
  description: string | null;
  pharmacy_amount_cents: number;
};

type CostCenterSplitRow = { split_coop_pct: number | null; split_flux_pct: number | null };
type PharmacySplitRow = {
  contract_scope: 'flux_only' | 'coop_only' | 'both' | string | null;
  split_coop_pct: number | null;
  split_flux_pct: number | null;
  billing_cost_centers?: CostCenterSplitRow | CostCenterSplitRow[] | null;
};

type SettlementAnchorRow = {
  id: string;
  status: string;
  driver_id: string;
  drivers?: { name?: string } | { name?: string }[] | null;
};

function normalizeCostCenterSplit(
  costCenter: CostCenterSplitRow | CostCenterSplitRow[] | null | undefined
): CostCenterSplitRow | null {
  if (!costCenter) return null;
  return Array.isArray(costCenter) ? costCenter[0] ?? null : costCenter;
}

export async function loadManualDiscountSnapshots(
  workspaceId: string,
  cycleId: string,
  pharmacyId?: string
): Promise<ManualDiscountSnapshot[]> {
  let settlementQuery = supabase
    .from('billing_settlements')
    .select('id, driver_id, pharmacy_id, billing_settlement_lines(*)')
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId);
  if (pharmacyId) settlementQuery = settlementQuery.eq('pharmacy_id', pharmacyId);

  const { data, error } = await settlementQuery;
  if (error) throw new Error(error.message);

  const snapshots: ManualDiscountSnapshot[] = [];
  for (const settlement of data || []) {
    for (const line of (settlement.billing_settlement_lines || []) as SettlementLineRow[]) {
      if (!isManualDiscountLine(line)) continue;
      snapshots.push(snapshotFromManualDiscountLine(settlement, line));
    }
  }
  return snapshots;
}

export async function recomputeSettlementTotalsFromLines(
  workspaceId: string,
  settlementId: string
): Promise<void> {
  const { data: settlement, error: settlementErr } = await supabase
    .from('billing_settlements')
    .select(
      'id, workspace_id, billing_cycle_id, driver_id, pharmacy_id, driver_payout_cents, status, pharmacies(contract_scope, split_coop_pct, split_flux_pct, billing_cost_centers!billing_cost_center_id(split_coop_pct, split_flux_pct))'
    )
    .eq('workspace_id', workspaceId)
    .eq('id', settlementId)
    .maybeSingle();
  if (settlementErr) throw new Error(settlementErr.message);
  if (!settlement) throw new Error('Acerto não encontrado');

  const { data: lines, error: linesErr } = await supabase
    .from('billing_settlement_lines')
    .select('id, kind, description, pharmacy_amount_cents, driver_amount_cents, metadata')
    .eq('settlement_id', settlementId);
  if (linesErr) throw new Error(linesErr.message);

  const lineRows = (lines || []) as SettlementLineRow[];
  const pharmacyRaw = (settlement as unknown as { pharmacies?: PharmacySplitRow | PharmacySplitRow[] | null }).pharmacies;
  const pharmacy = Array.isArray(pharmacyRaw) ? pharmacyRaw[0] : pharmacyRaw;
  if (!pharmacy) throw new Error('Farmácia do acerto não encontrada');
  const costCenter = normalizeCostCenterSplit(pharmacy.billing_cost_centers);

  const pharmacyChargeCents = Math.max(
    0,
    lineRows.reduce((sum, line) => sum + Number(line.pharmacy_amount_cents || 0), 0)
  );
  const { operationalDiscountsCents, financialDeductionCents } = classifySettlementDiscountCents(lineRows);
  const payout = computeSettlementPayoutBreakdown({
    driverPayoutCents: Number(settlement.driver_payout_cents || 0),
    driverExtras: 0,
    operationalDiscountsCents,
    financialDeductionCents,
  });
  const split = resolveSplitPercentages({
    contractScope: (pharmacy.contract_scope as 'flux_only' | 'coop_only' | 'both' | null) || 'both',
    pharmacySplitCoopPct: pharmacy.split_coop_pct != null ? Number(pharmacy.split_coop_pct) : null,
    pharmacySplitFluxPct: pharmacy.split_flux_pct != null ? Number(pharmacy.split_flux_pct) : null,
    costCenterSplitCoopPct:
      costCenter?.split_coop_pct != null
        ? Number(costCenter.split_coop_pct)
        : null,
    costCenterSplitFluxPct:
      costCenter?.split_flux_pct != null
        ? Number(costCenter.split_flux_pct)
        : null,
  });
  const splitAmounts = splitAmountCents(pharmacyChargeCents, split);

  const { error: updateErr } = await supabase
    .from('billing_settlements')
    .update({
      pharmacy_charge_cents: pharmacyChargeCents,
      coop_cents: splitAmounts.coopCents,
      flux_cents: splitAmounts.fluxCents,
      discounts_cents: payout.discounts_cents,
      operational_net_driver_payout_cents: payout.operational_net_driver_payout_cents,
      financial_deduction_cents: payout.financial_deduction_cents,
      net_driver_payout_cents: payout.net_driver_payout_cents,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', settlementId);
  if (updateErr) throw new Error(updateErr.message);
}

export async function applyManualDiscountSnapshots(
  workspaceId: string,
  settlementId: string,
  snapshots: ManualDiscountSnapshot[]
): Promise<void> {
  if (!snapshots.length) return;
  const { error: lineErr } = await supabase.from('billing_settlement_lines').insert(
    snapshots.map((snapshot) => ({
      settlement_id: settlementId,
      kind: snapshot.kind,
      description: snapshot.description,
      pharmacy_amount_cents: snapshot.pharmacy_amount_cents,
      driver_amount_cents: snapshot.driver_amount_cents,
      metadata: snapshot.metadata,
    }))
  );
  if (lineErr) throw new Error(lineErr.message);
  await recomputeSettlementTotalsFromLines(workspaceId, settlementId);
}

async function loadEditablePharmacySettlements(
  workspaceId: string,
  cycleId: string,
  pharmacyId: string
): Promise<SettlementAnchorRow[]> {
  const { data, error } = await supabase
    .from('billing_settlements')
    .select('id, status, driver_id, drivers(name)')
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .eq('pharmacy_id', pharmacyId)
    .in('status', ['open', 'in_review']);
  if (error) throw new Error(error.message);
  return (data || []) as SettlementAnchorRow[];
}

/** Desconto manual no grupo de acerto da farmácia — reduz faturamento, não o repasse. */
export async function addPharmacyManualDiscount(input: {
  workspaceId: string;
  cycleId: string;
  pharmacyId: string;
  actorId: string;
  amountCents: number;
  justification: string;
}): Promise<{ line_id: string; settlement_id: string }> {
  const amountCents = Math.round(Number(input.amountCents));
  const justification = String(input.justification || '').trim();
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Informe um valor de desconto maior que zero.');
  }
  if (!justification) {
    throw new Error('Justificativa obrigatória para desconto manual.');
  }

  const settlements = await loadEditablePharmacySettlements(
    input.workspaceId,
    input.cycleId,
    input.pharmacyId
  );
  if (!settlements.length) {
    throw new Error('Não há acertos abertos ou em revisão para esta farmácia no ciclo.');
  }

  const anchor = pickAnchorSettlement(settlements);
  if (!anchor) throw new Error('Não foi possível localizar o acerto âncora da farmácia.');

  const now = new Date().toISOString();
  const metadata = settlementLineMetadata(DRE_SCOPE_OPERATIONAL, {
    source: MANUAL_DISCOUNT_SOURCE,
    scope: PHARMACY_GROUP_SCOPE,
    target: 'pharmacy',
    pharmacy_id: input.pharmacyId,
    billing_cycle_id: input.cycleId,
    justification,
    created_by: input.actorId,
    created_at: now,
  });
  const description = `Desconto manual (fatura): ${justification}`;

  const { data: line, error: lineErr } = await supabase
    .from('billing_settlement_lines')
    .insert({
      settlement_id: anchor.id,
      kind: 'adjustment',
      description,
      pharmacy_amount_cents: -amountCents,
      driver_amount_cents: 0,
      metadata,
    })
    .select('id')
    .single();
  if (lineErr) throw new Error(lineErr.message);

  await recomputeSettlementTotalsFromLines(input.workspaceId, anchor.id);

  await writeAuditLog({
    actor_id: input.actorId,
    workspace_id: input.workspaceId,
    action: 'billing.settlement.manual_discount',
    entity_type: 'billing_settlement',
    entity_id: anchor.id,
    metadata: {
      line_id: line.id,
      amount_cents: amountCents,
      scope: PHARMACY_GROUP_SCOPE,
      target: 'pharmacy',
      justification,
      billing_cycle_id: input.cycleId,
      pharmacy_id: input.pharmacyId,
      anchor_settlement_id: anchor.id,
    },
  });

  return { line_id: String(line.id), settlement_id: String(anchor.id) };
}
