import type { SupabaseClient } from '@supabase/supabase-js';
import { addBillingAuditNotification } from './billingAuditNotifications';
import { recalculateCycleSettlements } from './billingSettlementEngine';
import { addQuotaLedgerEntry, syncDriverPaidQuotaIntegralizations } from './billingQuotaLedger';
import { completeOffboardingFinancialTask, loadOffboardingConference } from './billingOffboardingConference';
import { ensureCorporateCostCenterId } from './billingCostCenters';
import { DRE_SCOPE_OUTSIDE_MARGIN, isBillingCapitalSeparationEnabled, isFinancialCoopDiscountSlug, DRE_SCOPE_OPERATIONAL, syncOffboardingPreviewTotals } from './billingCapitalSeparation';

type PreviewLine = {
  kind: string;
  label: string;
  amount_cents: number;
  source_id?: string | null;
  metadata?: Record<string, unknown>;
};

export type BillingDriverOffboardingPreviewPayload = {
  driver: { id: string; name: string; cpf: string | null; pix_key: string | null; pix_key_type?: string | null };
  last_worked_at: string;
  open_cycles: Array<{ id: string; label: string | null; apuracao_start: string; apuracao_end: string; delivery_count: number }>;
  ended_pharmacy_ids: string[];
  gross_lines: PreviewLine[];
  discount_lines: PreviewLine[];
  pending_quota_lines: PreviewLine[];
  existing_payables: PreviewLine[];
  warnings: string[];
  totals: {
    gross_cents: number;
    discount_cents: number;
    net_cents: number;
    operational_gross_cents?: number;
    capital_gross_cents?: number;
    operational_discount_cents?: number;
    capital_discount_cents?: number;
  };
  conference_state?: {
    checked_at: string | null;
    checked_by: string | null;
    notes: string | null;
    quota_decisions: Record<string, 'waived' | 'kept' | 'compensated'>;
  };
};

export type BillingDriverOffboardingPreviewResult = {
  id: string;
  driver_id: string;
  gross_cents: number;
  discount_cents: number;
  net_cents: number;
  payload: BillingDriverOffboardingPreviewPayload;
};

function moneyToCents(value: unknown): number {
  return Math.round(Number(value || 0) * 100);
}

function sumLines(lines: PreviewLine[]): number {
  return lines.reduce((sum, line) => sum + Math.max(0, Number(line.amount_cents || 0)), 0);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function entryLabel(type: string): string {
  if (type === 'daily') return 'Diária aprovada';
  if (type === 'absence') return 'Falta/desconto';
  if (type === 'quota') return 'Cota';
  if (type === 'advance') return 'Adiantamento';
  if (type === 'uniform') return 'Uniforme';
  if (type === 'bag') return 'Bag';
  return type || 'Lançamento financeiro';
}

const VERIFIED_ENTRY_STATUSES = new Set(['active', 'approved', 'settled']);
const DISCOUNT_ENTRY_TYPES = new Set(['absence', 'advance', 'uniform', 'bag', 'digital_cert', 'fine']);

export function syncOffboardingPreviewPayloadTotals(payload: BillingDriverOffboardingPreviewPayload) {
  payload.totals = syncOffboardingPreviewTotals({
    gross_lines: payload.gross_lines,
    discount_lines: payload.discount_lines,
  });
  return payload.totals;
}

export async function createDriverOffboardingPreview(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    driverId: string;
    lastWorkedAt: string;
    actorId?: string | null;
    taskId?: string | null;
    endedPharmacyIds?: string[];
  }
): Promise<BillingDriverOffboardingPreviewResult> {
  const lastWorkedAt = input.lastWorkedAt.slice(0, 10);
  const { data: driver, error: driverErr } = await db
    .from('drivers')
    .select('id, name, cpf, pix_key, pix_key_type')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.driverId)
    .maybeSingle();
  if (driverErr) throw new Error(driverErr.message);
  if (!driver) throw new Error('Entregador não encontrado para prévia de desligamento');

  const warnings: string[] = [];
  if (!driver.cpf) warnings.push('CPF ausente para pagamento/relatórios.');
  if (!driver.pix_key) warnings.push('Chave PIX ausente para geração do C6.');

  const cycleStartWindow = addDays(lastWorkedAt, -21);
  const { data: cycles, error: cyclesErr } = await db
    .from('billing_cycles')
    .select('id, label, apuracao_start, apuracao_end, status')
    .eq('workspace_id', input.workspaceId)
    .eq('status', 'open')
    .gte('apuracao_end', cycleStartWindow)
    .lte('apuracao_start', lastWorkedAt)
    .order('apuracao_start', { ascending: true });
  if (cyclesErr) throw new Error(cyclesErr.message);

  const cycleIds = (cycles || []).map((cycle) => String(cycle.id));
  if (cycleIds.length) {
    warnings.push(
      'Há ciclo de apuração em aberto neste período. Antes de liberar o pagamento, confira se todas as entregas já foram importadas (Flux, planilha ou lançamento manual).'
    );
  }

  const openCycles = (cycles || []).map((cycle) => ({
    id: String(cycle.id),
    label: cycle.label ? String(cycle.label) : null,
    apuracao_start: String(cycle.apuracao_start).slice(0, 10),
    apuracao_end: String(cycle.apuracao_end).slice(0, 10),
    delivery_count: 0,
  }));

  const deliveryCountByCycle = new Map<string, number>();
  if (cycleIds.length) {
    const { data: deliveries, error: delErr } = await db
      .from('billing_delivery_records')
      .select('billing_cycle_id')
      .eq('workspace_id', input.workspaceId)
      .eq('driver_id', input.driverId)
      .eq('cancelled', false)
      .in('billing_cycle_id', cycleIds);
    if (delErr) throw new Error(delErr.message);
    for (const row of deliveries || []) {
      const key = String(row.billing_cycle_id);
      deliveryCountByCycle.set(key, (deliveryCountByCycle.get(key) || 0) + 1);
    }
    for (const cycle of openCycles) cycle.delivery_count = deliveryCountByCycle.get(cycle.id) || 0;
  }

  const grossLines: PreviewLine[] = [];
  const discountLines: PreviewLine[] = [];
  const pendingQuotaLines: PreviewLine[] = [];
  const existingPayables: PreviewLine[] = [];

  const { data: quotaAccount, error: quotaAccountErr } = await db
    .from('billing_quota_accounts')
    .select('id, balance_cents, integralized_cents, compensated_cents, refunded_cents, adjusted_cents')
    .eq('workspace_id', input.workspaceId)
    .eq('driver_id', input.driverId)
    .maybeSingle();
  if (quotaAccountErr) throw new Error(quotaAccountErr.message);

  let quotaSnapshot = quotaAccount;
  let quotaBalanceCents = Number(quotaAccount?.balance_cents || 0);
  if (quotaBalanceCents <= 0) {
    const synced = await syncDriverPaidQuotaIntegralizations(db, {
      workspaceId: input.workspaceId,
      driverId: input.driverId,
      actorId: input.actorId || null,
    });
    quotaBalanceCents = synced.balance_cents;
    const { data: refreshed } = await db
      .from('billing_quota_accounts')
      .select('id, balance_cents, integralized_cents, compensated_cents, refunded_cents, adjusted_cents')
      .eq('workspace_id', input.workspaceId)
      .eq('driver_id', input.driverId)
      .maybeSingle();
    if (refreshed) {
      quotaSnapshot = refreshed;
      quotaBalanceCents = Math.max(
        Number(refreshed.balance_cents || 0),
        Number(refreshed.integralized_cents || 0) +
          Number(refreshed.adjusted_cents || 0) -
          Number(refreshed.compensated_cents || 0) -
          Number(refreshed.refunded_cents || 0)
      );
    }
  } else {
    quotaBalanceCents = Math.max(
      quotaBalanceCents,
      Number(quotaAccount?.integralized_cents || 0) +
        Number(quotaAccount?.adjusted_cents || 0) -
        Number(quotaAccount?.compensated_cents || 0) -
        Number(quotaAccount?.refunded_cents || 0)
    );
  }
  const refundIntegralizedQuota = quotaBalanceCents > 0;

  if (refundIntegralizedQuota && cycleIds.length) {
    for (const cycleId of cycleIds) {
      await recalculateCycleSettlements(input.workspaceId, cycleId);
    }
    warnings.push('Acertos de ciclo recalculados sem desconto de cota; as cotas integralizadas serão restituídas neste desligamento.');
  }

  if (cycleIds.length) {
    const { data: settlements, error: settErr } = await db
      .from('billing_settlements')
      .select(
        'id, billing_cycle_id, pharmacy_id, net_driver_payout_cents, operational_net_driver_payout_cents, applied_mg, status'
      )
      .eq('workspace_id', input.workspaceId)
      .eq('driver_id', input.driverId)
      .in('billing_cycle_id', cycleIds);
    if (settErr) throw new Error(settErr.message);

    const settlementIds = (settlements || []).map((row) => String(row.id));
    const linesBySettlement = new Map<string, Array<Record<string, unknown>>>();
    if (settlementIds.length) {
      const { data: settlementLines, error: linesErr } = await db
        .from('billing_settlement_lines')
        .select('id, settlement_id, kind, description, pharmacy_amount_cents, driver_amount_cents')
        .in('settlement_id', settlementIds);
      if (linesErr) throw new Error(linesErr.message);
      for (const line of settlementLines || []) {
        const key = String(line.settlement_id);
        const bucket = linesBySettlement.get(key) || [];
        bucket.push(line as Record<string, unknown>);
        linesBySettlement.set(key, bucket);
      }
    }

    for (const row of settlements || []) {
      const lines = linesBySettlement.get(String(row.id)) || [];
      const amount = Number(
        row.operational_net_driver_payout_cents || row.net_driver_payout_cents || 0
      );
      if (amount <= 0 && !lines.length) continue;
      grossLines.push({
        kind: 'open_cycle_settlement',
        label: `Acerto de ciclo aberto${row.applied_mg ? ' com MG' : ''}`,
        amount_cents: amount,
        source_id: String(row.id),
        metadata: {
          billing_cycle_id: row.billing_cycle_id,
          pharmacy_id: row.pharmacy_id,
          status: row.status,
          net_driver_payout_cents: Number(row.net_driver_payout_cents || 0),
          operational_net_driver_payout_cents: amount,
          settlement_lines: lines,
        },
      });
    }
  }

  const { data: entries, error: entriesErr } = await db
    .from('financial_entries')
    .select('id, type, description, total_amount, status, start_date, event_date')
    .eq('workspace_id', input.workspaceId)
    .eq('driver_id', input.driverId)
    .neq('status', 'cancelled');
  if (entriesErr) throw new Error(entriesErr.message);

  const entryIds = (entries || []).map((entry) => String(entry.id));
  const entryTypeById = new Map<string, string>();
  const entryDescriptionById = new Map<string, string | null>();
  for (const entry of entries || []) {
    entryTypeById.set(String(entry.id), String(entry.type || ''));
    entryDescriptionById.set(String(entry.id), entry.description ? String(entry.description) : null);
    if (!VERIFIED_ENTRY_STATUSES.has(String(entry.status || ''))) continue;
    const type = String(entry.type || '');
    const eventDate = String(entry.event_date || entry.start_date || '').slice(0, 10);
    if (eventDate && eventDate > lastWorkedAt) continue;
    const amount = moneyToCents(entry.total_amount);
    if (type === 'daily') {
      grossLines.push({
        kind: 'daily',
        label: entry.description ? String(entry.description) : entryLabel(type),
        amount_cents: amount,
        source_id: String(entry.id),
      });
    } else if (DISCOUNT_ENTRY_TYPES.has(type)) {
      if (refundIntegralizedQuota && type === 'quota') continue;
      discountLines.push({
        kind: type,
        label: entry.description ? String(entry.description) : entryLabel(type),
        amount_cents: amount,
        source_id: String(entry.id),
        metadata: {
          dre_scope: type === 'absence' ? DRE_SCOPE_OPERATIONAL : isFinancialCoopDiscountSlug(type) ? DRE_SCOPE_OUTSIDE_MARGIN : DRE_SCOPE_OPERATIONAL,
        },
      });
    }
  }

  if (entryIds.length) {
    const { data: installments, error: instErr } = await db
      .from('financial_installments')
      .select('id, entry_id, amount, due_date, status')
      .eq('workspace_id', input.workspaceId)
      .in('entry_id', entryIds)
      .eq('status', 'pending');
    if (instErr) throw new Error(instErr.message);
    for (const inst of installments || []) {
      const type = entryTypeById.get(String(inst.entry_id)) || '';
      if (type !== 'quota') continue;
      pendingQuotaLines.push({
        kind: 'quota_pending',
        label: entryDescriptionById.get(String(inst.entry_id)) || 'Cota pendente',
        amount_cents: moneyToCents(inst.amount),
        source_id: String(inst.id),
        metadata: { entry_id: inst.entry_id, due_date: inst.due_date },
      });
    }
  }

  if (refundIntegralizedQuota) {
    grossLines.push({
      kind: 'quota_refund',
      label: 'Cotas integralizadas a restituir',
      amount_cents: quotaBalanceCents,
      source_id: quotaSnapshot?.id ? String(quotaSnapshot.id) : null,
      metadata: {
        integralized_cents: Number(quotaSnapshot?.integralized_cents || 0),
        compensated_cents: Number(quotaSnapshot?.compensated_cents || 0),
        refunded_cents: Number(quotaSnapshot?.refunded_cents || 0),
        legal_basis: 'Restituição de capital integralizado no desligamento do cooperado',
      },
    });
    warnings.push(
      'Cotas integralizadas serão restituídas; descontos de cota no ciclo e no financeiro foram neutralizados nesta prévia.'
    );
  }

  const { data: payables, error: payablesErr } = await db
    .from('billing_payables')
    .select('id, description, amount_cents, amount_paid_cents, status, due_date')
    .eq('workspace_id', input.workspaceId)
    .eq('beneficiary_type', 'driver')
    .eq('beneficiary_id', input.driverId)
    .in('status', ['draft', 'approved']);
  if (payablesErr) throw new Error(payablesErr.message);
  for (const payable of payables || []) {
    const balance = Number(payable.amount_cents || 0) - Number(payable.amount_paid_cents || 0);
    if (balance <= 0) continue;
    existingPayables.push({
      kind: 'existing_payable',
      label: payable.description ? String(payable.description) : 'AP já existente',
      amount_cents: balance,
      source_id: String(payable.id),
      metadata: { due_date: payable.due_date, status: payable.status },
    });
  }

  if (pendingQuotaLines.length) {
    warnings.push(
      'Há parcelas de cota em aberto. Na aba Pendências, defina o que fazer com cada uma: cancelar cobrança, compensar no acerto ou manter pendente.'
    );
  }
  if (existingPayables.length) {
    warnings.push(
      'Já existem pagamentos em aberto para este entregador. Evite gerar um pagamento duplicado no acerto final.'
    );
  }

  const totals = syncOffboardingPreviewPayloadTotals({
    driver: {
      id: String(driver.id),
      name: String(driver.name),
      cpf: driver.cpf ? String(driver.cpf) : null,
      pix_key: driver.pix_key ? String(driver.pix_key) : null,
      pix_key_type: driver.pix_key_type ? String(driver.pix_key_type) : null,
    },
    last_worked_at: lastWorkedAt,
    open_cycles: openCycles,
    ended_pharmacy_ids: input.endedPharmacyIds || [],
    gross_lines: grossLines,
    discount_lines: discountLines,
    pending_quota_lines: pendingQuotaLines,
    existing_payables: existingPayables,
    warnings,
    totals: { gross_cents: 0, discount_cents: 0, net_cents: 0 },
  });

  const payload: BillingDriverOffboardingPreviewPayload = {
    driver: {
      id: String(driver.id),
      name: String(driver.name),
      cpf: driver.cpf ? String(driver.cpf) : null,
      pix_key: driver.pix_key ? String(driver.pix_key) : null,
      pix_key_type: driver.pix_key_type ? String(driver.pix_key_type) : null,
    },
    last_worked_at: lastWorkedAt,
    open_cycles: openCycles,
    ended_pharmacy_ids: input.endedPharmacyIds || [],
    gross_lines: grossLines,
    discount_lines: discountLines,
    pending_quota_lines: pendingQuotaLines,
    existing_payables: existingPayables,
    warnings,
    totals,
  };

  const { data: preview, error: previewErr } = await db
    .from('billing_driver_offboarding_previews')
    .insert({
      workspace_id: input.workspaceId,
      driver_id: input.driverId,
      task_id: input.taskId || null,
      last_worked_at: lastWorkedAt,
      gross_cents: totals.gross_cents,
      discount_cents: totals.discount_cents,
      net_cents: totals.net_cents,
      payload,
      created_by: input.actorId || null,
      updated_at: new Date().toISOString(),
    })
    .select('id, driver_id, gross_cents, discount_cents, net_cents, payload')
    .single();
  if (previewErr) throw new Error(previewErr.message);

  if (warnings.length) {
    await addBillingAuditNotification({
      workspaceId: input.workspaceId,
      driverId: input.driverId,
      severity: warnings.some((w) => w.includes('ciclo aberto')) ? 'critical' : 'warning',
      code: 'DRIVER_OFFBOARDING_PREVIEW_WARNINGS',
      title: 'Prévia de desligamento com pendências',
      message: `${driver.name}: ${warnings.join(' ')}`,
      metadata: { preview_id: preview.id, warnings },
    });
  }

  return {
    id: String(preview.id),
    driver_id: String(preview.driver_id),
    gross_cents: Number(preview.gross_cents || 0),
    discount_cents: Number(preview.discount_cents || 0),
    net_cents: Number(preview.net_cents || 0),
    payload: preview.payload as BillingDriverOffboardingPreviewPayload,
  };
}

export async function generatePayableFromOffboardingPreview(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    previewId: string;
    actorId: string;
    dueDate?: string | null;
  }
): Promise<{ payable_id: string; net_cents: number }> {
  const { data: preview, error: previewErr } = await db
    .from('billing_driver_offboarding_previews')
    .select('*')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.previewId)
    .maybeSingle();
  if (previewErr) throw new Error(previewErr.message);
  if (!preview) throw new Error('Prévia de desligamento não encontrada');
  if (preview.payable_id) return { payable_id: String(preview.payable_id), net_cents: Number(preview.net_cents || 0) };

  const conference = await loadOffboardingConference(db, input.workspaceId, input.previewId);
  if (!conference.checklist.can_generate_payable) {
    throw new Error(conference.checklist.blockers[0] || 'Conferência incompleta para gerar AP');
  }

  const netCents = Number(preview.net_cents || 0);
  if (netCents <= 0) throw new Error('Prévia sem saldo líquido a pagar');

  const payload = preview.payload as BillingDriverOffboardingPreviewPayload;
  const dueDate = input.dueDate || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const quotaLine = payload.gross_lines.find((line) => line.kind === 'quota_refund' && line.amount_cents > 0);
  const operationalGrossCents = (payload.gross_lines || [])
    .filter((line) => line.kind !== 'quota_refund')
    .reduce((sum, line) => sum + Number(line.amount_cents || 0), 0);
  const costCenterId =
    isBillingCapitalSeparationEnabled() && quotaLine
      ? await ensureCorporateCostCenterId(input.workspaceId, 'coop')
      : null;

  const { data: payable, error: payableErr } = await db
    .from('billing_payables')
    .insert({
      workspace_id: input.workspaceId,
      beneficiary_type: 'driver',
      beneficiary_id: preview.driver_id,
      legal_entity_type: 'coop',
      cost_center_id: costCenterId,
      description: `Acerto final de desligamento — ${payload.driver.name}`,
      amount_cents: netCents,
      gross_amount_cents: Number(preview.gross_cents || netCents),
      compensated_amount_cents: Number(preview.discount_cents || 0),
      net_amount_cents: netCents,
      status: 'draft',
      due_date: dueDate,
      original_due_date: dueDate,
      effective_due_date: dueDate,
      scheduled_payment_date: dueDate,
      payment_method: 'pix',
      pix_key: payload.driver.pix_key || null,
      pix_key_type: payload.driver.pix_key_type || null,
      batch_eligible: Boolean(payload.driver.pix_key),
      payment_batch_status: 'pending',
      category: 'driver_offboarding',
      origin_type: 'driver_offboarding',
      origin_id: input.previewId,
      metadata: {
        offboarding_preview_id: input.previewId,
        payload_summary: payload.totals,
        operational_cents: operationalGrossCents,
        quota_refund_cents: Number(quotaLine?.amount_cents || 0),
        dre_scope: quotaLine ? DRE_SCOPE_OUTSIDE_MARGIN : 'operational',
      },
      updated_at: now,
    })
    .select('id')
    .single();
  if (payableErr) throw new Error(payableErr.message);

  if (quotaLine) {
    await addQuotaLedgerEntry(db, {
      workspaceId: input.workspaceId,
      driverId: String(preview.driver_id),
      entryType: 'refund',
      amountCents: Number(quotaLine.amount_cents || 0),
      description: 'Devolução de cota no desligamento',
      offboardingPreviewId: input.previewId,
      actorId: input.actorId,
      metadata: { payable_id: payable.id },
    });
  }

  const { error: updErr } = await db
    .from('billing_driver_offboarding_previews')
    .update({
      status: 'payable_generated',
      payable_id: payable.id,
      approved_by: input.actorId,
      approved_at: now,
      updated_at: now,
    })
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.previewId);
  if (updErr) throw new Error(updErr.message);

  await completeOffboardingFinancialTask(db, input.workspaceId, preview.task_id ? String(preview.task_id) : null);

  return { payable_id: String(payable.id), net_cents: netCents };
}
