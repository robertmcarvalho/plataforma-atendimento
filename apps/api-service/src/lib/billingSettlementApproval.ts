import { supabase } from './supabase';
import { applyCycleFinancialCoopSideEffects } from './billingDriverFinancialLedger';
import {
  deleteRegenerablePharmacyInvoices,
  generateCycleInvoices,
  resolveInvoicePharmacyIdsForRegen,
} from './billingInvoiceEngine';
import { generateDriverPayablesFromCycle } from './billingPayablesEngine';
import { autoExportPixBatchAfterApproval } from './billingPixBatchExport';
import { recalculateCycleSettlements } from './billingSettlementEngine';

export { deleteRegenerablePharmacyInvoices } from './billingInvoiceEngine';

export type SettlementApprovalSideEffects = {
  invoices_generated: number;
  payables_generated: number;
  financial_coop_effects: { quota_integralizations: number; financial_recoveries: number };
  settlements_recalculated?: number;
  warnings: string[];
  pix_batch: Awaited<ReturnType<typeof autoExportPixBatchAfterApproval>> | null;
};

export async function runSettlementApprovalSideEffects(input: {
  workspaceId: string;
  cycleId: string;
  actorId: string;
  regeneratePharmacyIds?: string[];
  exportPixBatch?: boolean;
}): Promise<SettlementApprovalSideEffects> {
  const warnings: string[] = [];
  let invoicesGenerated = 0;
  let payablesGenerated = 0;
  let financialCoopEffects = { quota_integralizations: 0, financial_recoveries: 0 };
  let pixBatch: SettlementApprovalSideEffects['pix_batch'] = null;
  const forcePharmacyIds = new Set<string>();

  for (const pharmacyId of input.regeneratePharmacyIds || []) {
    try {
      const ids = await resolveInvoicePharmacyIdsForRegen(input.workspaceId, input.cycleId, pharmacyId);
      for (const id of ids) forcePharmacyIds.add(id);
      await deleteRegenerablePharmacyInvoices(input.workspaceId, input.cycleId, pharmacyId);
    } catch (err) {
      warnings.push(
        err instanceof Error
          ? `Faturas da farmácia ${pharmacyId} não puderam ser regeneradas: ${err.message}`
          : `Faturas da farmácia ${pharmacyId} não puderam ser regeneradas.`
      );
    }
  }

  try {
    const inv = await generateCycleInvoices(input.workspaceId, input.cycleId, {
      forcePharmacyIds: [...forcePharmacyIds],
    });
    invoicesGenerated = inv.invoices;
  } catch (err) {
    warnings.push(err instanceof Error ? `Faturas não geradas: ${err.message}` : 'Faturas não geradas.');
  }

  try {
    financialCoopEffects = await applyCycleFinancialCoopSideEffects(supabase, {
      workspaceId: input.workspaceId,
      billingCycleId: input.cycleId,
      actorId: input.actorId,
    });
  } catch (err) {
    warnings.push(
      err instanceof Error ? `Efeitos financeiros cooperativos: ${err.message}` : 'Efeitos financeiros cooperativos falharam.'
    );
  }

  try {
    const ap = await generateDriverPayablesFromCycle(input.workspaceId, input.cycleId);
    payablesGenerated = ap.payables;
  } catch (err) {
    warnings.push(err instanceof Error ? `APs não gerados: ${err.message}` : 'APs não gerados.');
  }

  if (input.exportPixBatch !== false && payablesGenerated > 0) {
    try {
      pixBatch = await autoExportPixBatchAfterApproval(input.workspaceId, input.cycleId, input.actorId);
    } catch (err) {
      warnings.push(err instanceof Error ? `PIX não exportado: ${err.message}` : 'PIX não exportado.');
    }
  }

  return {
    invoices_generated: invoicesGenerated,
    payables_generated: payablesGenerated,
    financial_coop_effects: financialCoopEffects,
    warnings,
    pix_batch: pixBatch,
  };
}

export async function approvePharmacyCycleSettlements(input: {
  workspaceId: string;
  cycleId: string;
  pharmacyId: string;
  actorId: string;
}): Promise<{ updated: number; side_effects: SettlementApprovalSideEffects }> {
  const now = new Date().toISOString();

  const { data: pendingRows, error: pendingErr } = await supabase
    .from('billing_settlements')
    .select('id, status')
    .eq('workspace_id', input.workspaceId)
    .eq('billing_cycle_id', input.cycleId)
    .eq('pharmacy_id', input.pharmacyId)
    .in('status', ['open', 'in_review']);
  if (pendingErr) throw new Error(pendingErr.message);
  if (!pendingRows?.length) {
    return {
      updated: 0,
      side_effects: {
        invoices_generated: 0,
        payables_generated: 0,
        financial_coop_effects: { quota_integralizations: 0, financial_recoveries: 0 },
        settlements_recalculated: 0,
        warnings: [],
        pix_batch: null,
      },
    };
  }

  try {
    await deleteRegenerablePharmacyInvoices(input.workspaceId, input.cycleId, input.pharmacyId);
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `Não foi possível atualizar as faturas antes de aprovar: ${err.message}`
        : 'Não foi possível atualizar as faturas antes de aprovar.'
    );
  }

  let settlementsRecalculated = 0;
  try {
    const recalc = await recalculateCycleSettlements(input.workspaceId, input.cycleId, {
      pharmacyId: input.pharmacyId,
    });
    settlementsRecalculated = recalc.settlements;
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `Não foi possível recalcular com o cadastro atual antes de aprovar: ${err.message}`
        : 'Não foi possível recalcular com o cadastro atual antes de aprovar.'
    );
  }

  const { data: openRows, error: openErr } = await supabase
    .from('billing_settlements')
    .update({ status: 'in_review', submitted_at: now, submitted_by: input.actorId, updated_at: now })
    .eq('workspace_id', input.workspaceId)
    .eq('billing_cycle_id', input.cycleId)
    .eq('pharmacy_id', input.pharmacyId)
    .eq('status', 'open')
    .select('id');
  if (openErr) throw new Error(openErr.message);

  const { data: approvedRows, error: approveErr } = await supabase
    .from('billing_settlements')
    .update({ status: 'approved', approved_at: now, approved_by: input.actorId, updated_at: now })
    .eq('workspace_id', input.workspaceId)
    .eq('billing_cycle_id', input.cycleId)
    .eq('pharmacy_id', input.pharmacyId)
    .eq('status', 'in_review')
    .select('id');
  if (approveErr) throw new Error(approveErr.message);

  const updated = (openRows?.length || 0) + (approvedRows?.length || 0);
  if (!updated) {
    return {
      updated: 0,
      side_effects: {
        invoices_generated: 0,
        payables_generated: 0,
        financial_coop_effects: { quota_integralizations: 0, financial_recoveries: 0 },
        settlements_recalculated: settlementsRecalculated,
        warnings: [],
        pix_batch: null,
      },
    };
  }

  const sideEffects = await runSettlementApprovalSideEffects({
    workspaceId: input.workspaceId,
    cycleId: input.cycleId,
    actorId: input.actorId,
    regeneratePharmacyIds: [input.pharmacyId],
    exportPixBatch: false,
  });

  return {
    updated,
    side_effects: {
      ...sideEffects,
      settlements_recalculated: settlementsRecalculated,
    },
  };
}
