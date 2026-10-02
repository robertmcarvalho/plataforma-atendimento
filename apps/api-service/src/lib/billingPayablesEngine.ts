import { supabase } from './supabase';
import { normalizePaymentPolicy, resolveCostCenterDueDates } from './billingPaymentPolicy';
import { addBillingAuditNotification } from './billingAuditNotifications';
import { ensureCorporateCostCenterId } from './billingCostCenters';
import { isBillingCapitalSeparationEnabled } from './billingCapitalSeparation';
import { settlementDailyDriverAmountOutsideWeeklyPix } from './billingPayablesDailyExclude';

export type PixBatchRow = {
  payable_id?: string;
  beneficiary_type?: string;
  driver_id: string;
  name: string;
  cpf: string | null;
  pix_key_type: string | null;
  pix_key: string | null;
  amount_cents: number;
  payment_date: string | null;
  original_payment_date: string | null;
  payment_adjustment_reason: string | null;
  reference: string;
  warnings: string[];
};

export { settlementDailyDriverAmountOutsideWeeklyPix } from './billingPayablesDailyExclude';

export async function generateDriverPayablesFromCycle(
  workspaceId: string,
  cycleId: string
): Promise<{ payables: number }> {
  const { data: cycle, error: cycleErr } = await supabase
    .from('billing_cycles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', cycleId)
    .maybeSingle();
  if (cycleErr) throw new Error(cycleErr.message);
  if (!cycle) throw new Error('Ciclo não encontrado');

  const { data: settlements, error: stErr } = await supabase
    .from('billing_settlements')
    .select(
      'id, driver_id, pharmacy_id, net_driver_payout_cents, operational_net_driver_payout_cents, financial_deduction_cents, pharmacies(id, billing_cost_center_id, billing_cost_centers!billing_cost_center_id(*)), billing_settlement_lines(kind, driver_amount_cents, metadata)'
    )
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .in('status', ['approved', 'paid']);
  if (stErr) throw new Error(stErr.message);
  if (!settlements?.length) return { payables: 0 };

  const { data: invoices, error: invErr } = await supabase
    .from('billing_invoices')
    .select('pharmacy_id, status, amount_paid_cents, total_cents')
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId);
  if (invErr) throw new Error(invErr.message);

  const invoicePaidByPharmacy = new Map<string, boolean>();
  for (const invoice of invoices || []) {
    const pharmacyId = String(invoice.pharmacy_id);
    const paid = String(invoice.status) === 'paid' || Number(invoice.amount_paid_cents) >= Number(invoice.total_cents);
    invoicePaidByPharmacy.set(pharmacyId, invoicePaidByPharmacy.has(pharmacyId) ? Boolean(invoicePaidByPharmacy.get(pharmacyId)) && paid : paid);
  }

  const byDriverDueDate = new Map<
    string,
    {
      driverId: string;
      amountCents: number;
      dueDate: string;
      originalDueDates: string[];
      adjustmentReasons: string[];
      blocked: boolean;
      blockReasons: string[];
      pharmacyIds: string[];
      costCenterIds: string[];
      operationalCents: number;
      financialDeductionCents: number;
      excludedDailyCents: number;
    }
  >();
  for (const row of settlements) {
    const id = String(row.driver_id);
    const pharmacyId = String(row.pharmacy_id);
    const pharmacy = Array.isArray(row.pharmacies) ? row.pharmacies[0] : row.pharmacies;
    const rawCc = pharmacy?.billing_cost_centers;
    const cc = Array.isArray(rawCc) ? rawCc[0] : rawCc;
    const policy = normalizePaymentPolicy(cc || null);
    const { driverPayment } = await resolveCostCenterDueDates({
      workspaceId,
      cycleEndIso: String(cycle.apuracao_end).slice(0, 10),
      policy,
    });
    const shouldBlock =
      policy.block_c6_without_invoice_payment &&
      policy.driver_payment_release_condition !== 'none' &&
      policy.driver_payment_release_condition !== 'manager_release' &&
      !invoicePaidByPharmacy.get(pharmacyId);
    // Diárias da trilha Diárias (PIX terça) nunca entram no AP semanal — nem em acertos
    // legados que ainda carregam o repasse na linha. A diária-base de escala
    // (`pay_track: 'thursday_settlement'`) é paga aqui e não é subtraída.
    const dailyInNetCents = settlementDailyDriverAmountOutsideWeeklyPix(row.billing_settlement_lines);
    const weeklyNetCents = Math.max(0, Number(row.net_driver_payout_cents) - dailyInNetCents);
    const weeklyOperationalCents = Math.max(
      0,
      Number(row.operational_net_driver_payout_cents || row.net_driver_payout_cents) - dailyInNetCents
    );
    const key = `${id}:${driverPayment.effectiveDate}`;
    const bucket =
      byDriverDueDate.get(key) ||
      {
        driverId: id,
        amountCents: 0,
        dueDate: driverPayment.effectiveDate,
        originalDueDates: [],
        adjustmentReasons: [],
        blocked: false,
        blockReasons: [],
        pharmacyIds: [],
        costCenterIds: [],
        operationalCents: 0,
        financialDeductionCents: 0,
        excludedDailyCents: 0,
      };
    bucket.amountCents += weeklyNetCents;
    bucket.operationalCents += weeklyOperationalCents;
    bucket.financialDeductionCents += Number(row.financial_deduction_cents || 0);
    bucket.excludedDailyCents += dailyInNetCents;
    if (driverPayment.originalDate !== driverPayment.effectiveDate) {
      bucket.originalDueDates.push(driverPayment.originalDate);
      bucket.adjustmentReasons.push(driverPayment.reason || 'holiday_or_non_business_day');
    }
    if (shouldBlock) {
      bucket.blocked = true;
      bucket.blockReasons.push(`Fatura da farmácia ${pharmacyId} sem baixa`);
    }
    bucket.pharmacyIds.push(pharmacyId);
    if (pharmacy?.billing_cost_center_id) bucket.costCenterIds.push(String(pharmacy.billing_cost_center_id));
    byDriverDueDate.set(key, bucket);
  }
  const now = new Date().toISOString();

  const { data: alreadyPaidRows, error: alreadyPaidErr } = await supabase
    .from('billing_payables')
    .select('beneficiary_id, due_date, effective_due_date')
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .eq('beneficiary_type', 'driver')
    .gt('amount_paid_cents', 0);
  if (alreadyPaidErr) throw new Error(alreadyPaidErr.message);

  const alreadyPaidKeys = new Set(
    (alreadyPaidRows || []).map((row) => `${row.beneficiary_id}:${String(row.effective_due_date || row.due_date).slice(0, 10)}`)
  );

  await supabase
    .from('billing_payables')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .eq('beneficiary_type', 'driver')
    .in('status', ['draft', 'approved'])
    .eq('amount_paid_cents', 0)
    .or('origin_type.is.null,origin_type.neq.financial_daily');

  let count = 0;
  for (const bucket of byDriverDueDate.values()) {
    if (bucket.amountCents <= 0) continue;
    if (alreadyPaidKeys.has(`${bucket.driverId}:${bucket.dueDate}`)) continue;
    const uniqueCostCenterIds = [...new Set(bucket.costCenterIds)];
    let costCenterId: string | null =
      uniqueCostCenterIds.length === 1 ? uniqueCostCenterIds[0] : null;
    if (isBillingCapitalSeparationEnabled() && bucket.financialDeductionCents > 0) {
      costCenterId = await ensureCorporateCostCenterId(workspaceId, 'coop');
    }

    const { data: driver } = await supabase
      .from('drivers')
      .select('name')
      .eq('id', bucket.driverId)
      .maybeSingle();

    const { error } = await supabase.from('billing_payables').insert({
      workspace_id: workspaceId,
      beneficiary_type: 'driver',
      beneficiary_id: bucket.driverId,
      legal_entity_type: 'coop',
      cost_center_id: costCenterId,
      billing_cycle_id: cycleId,
      origin_type: 'cycle_settlement',
      origin_id: cycleId,
      description: `Acerto semanal — ${driver?.name || bucket.driverId} — ciclo ${cycle.label || cycleId}`,
      amount_cents: bucket.amountCents,
      gross_amount_cents: bucket.operationalCents,
      compensated_amount_cents: bucket.financialDeductionCents,
      net_amount_cents: bucket.amountCents,
      status: 'approved',
      due_date: bucket.dueDate,
      original_due_date: bucket.originalDueDates[0] || bucket.dueDate,
      effective_due_date: bucket.dueDate,
      scheduled_payment_date: bucket.dueDate,
      payment_method: 'pix',
      batch_eligible: true,
      payment_batch_status: 'pending',
      payment_blocked: bucket.blocked,
      block_reason: bucket.blockReasons.join('; ') || null,
      metadata: {
        payment_kind: 'weekly_settlement',
        pharmacy_ids: [...new Set(bucket.pharmacyIds)],
        cost_center_ids: uniqueCostCenterIds,
        operational_cents: bucket.operationalCents,
        financial_deduction_cents: bucket.financialDeductionCents,
        excluded_financial_daily_cents: bucket.excludedDailyCents,
        dre_scope: bucket.financialDeductionCents > 0 ? 'outside_margin' : 'operational',
        original_due_dates: [...new Set(bucket.originalDueDates)],
        driver_payment_adjustment_reasons: [...new Set(bucket.adjustmentReasons)],
        driver_payment_adjustment_reason: bucket.adjustmentReasons[0] || null,
      },
      approved_at: now,
      updated_at: now,
    });
    if (error) throw new Error(error.message);
    if (bucket.adjustmentReasons.length) {
      await addBillingAuditNotification({
        workspaceId,
        billingCycleId: cycleId,
        driverId: bucket.driverId,
        severity: 'info',
        code: 'DRIVER_PAYMENT_DATE_ADJUSTED',
        title: 'Data de pagamento ajustada',
        message: `Pagamento do entregador ajustado de ${bucket.originalDueDates[0]} para ${bucket.dueDate}.`,
        metadata: {
          original_due_dates: [...new Set(bucket.originalDueDates)],
          effective_due_date: bucket.dueDate,
          reasons: [...new Set(bucket.adjustmentReasons)],
        },
      });
    }
    if (bucket.blocked) {
      await addBillingAuditNotification({
        workspaceId,
        billingCycleId: cycleId,
        driverId: bucket.driverId,
        severity: 'critical',
        code: 'C6_BLOCKED_INVOICE_NOT_PAID',
        title: 'Pagamento bloqueado por fatura sem baixa',
        message: `AP do entregador bloqueado para C6: ${bucket.blockReasons.join('; ')}.`,
        metadata: {
          due_date: bucket.dueDate,
          pharmacy_ids: [...new Set(bucket.pharmacyIds)],
          block_reasons: bucket.blockReasons,
        },
      });
    }
    count += 1;
  }

  return { payables: count };
}

export async function buildPixBatchPreview(workspaceId: string, cycleId: string): Promise<{
  rows: PixBatchRow[];
  batches: {
    payment_date: string;
    original_payment_dates: string[];
    adjustment_reasons: string[];
    rows: PixBatchRow[];
    total_cents: number;
    blocked_count: number;
  }[];
  total_cents: number;
  cycle_label: string | null;
}> {
  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('label')
    .eq('workspace_id', workspaceId)
    .eq('id', cycleId)
    .maybeSingle();

  const { data: payables, error } = await supabase
    .from('billing_payables')
    .select(
      'id, beneficiary_id, amount_cents, amount_paid_cents, status, due_date, original_due_date, effective_due_date, metadata, payment_blocked, block_reason, origin_type'
    )
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .eq('beneficiary_type', 'driver')
    .in('status', ['approved', 'paid']);
  if (error) throw new Error(error.message);

  const rows: PixBatchRow[] = [];
  let total = 0;

  for (const p of payables || []) {
    // Diárias (terça) têm trilha própria — nunca entram no lote PIX do acerto semanal.
    if (String(p.origin_type || '') === 'financial_daily') continue;
    const meta =
      p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)
        ? (p.metadata as Record<string, unknown>)
        : {};
    if (String(meta.payment_kind || '') === 'daily') continue;

    const balance = Number(p.amount_cents) - Number(p.amount_paid_cents);
    if (balance <= 0) continue;

    const { data: driver } = await supabase
      .from('drivers')
      .select('name, cpf, pix_key, pix_key_type')
      .eq('id', p.beneficiary_id)
      .maybeSingle();

    const warnings: string[] = [];
    if (!driver?.pix_key) warnings.push('PIX não cadastrado');
    if (!driver?.cpf) warnings.push('CPF ausente');
    if (p.payment_blocked) warnings.push(`Pagamento bloqueado: ${p.block_reason || 'pendência de liberação'}`);

    const originalPaymentDate = p.original_due_date ? String(p.original_due_date).slice(0, 10) : null;
    const effectivePaymentDate = (p.effective_due_date || p.due_date) ? String(p.effective_due_date || p.due_date).slice(0, 10) : null;
    const adjustmentReason =
      originalPaymentDate && effectivePaymentDate && originalPaymentDate !== effectivePaymentDate
        ? String(meta.driver_payment_adjustment_reason || meta.payment_adjustment_reason || 'holiday_or_non_business_day')
        : null;

    rows.push({
      driver_id: String(p.beneficiary_id),
      name: driver?.name || '—',
      cpf: driver?.cpf ? String(driver.cpf) : null,
      pix_key_type: driver?.pix_key_type ? String(driver.pix_key_type) : null,
      pix_key: driver?.pix_key ? String(driver.pix_key) : null,
      amount_cents: balance,
      payment_date: effectivePaymentDate,
      original_payment_date: originalPaymentDate,
      payment_adjustment_reason: adjustmentReason,
      reference: `${cycleId.slice(0, 8)}-${String(p.beneficiary_id).slice(0, 8)}-${String(effectivePaymentDate || '').replace(/-/g, '')}`,
      warnings,
    });
    if (!warnings.includes('PIX não cadastrado') && !warnings.some((w) => w.startsWith('Pagamento bloqueado'))) {
      total += balance;
    }
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const byDate = new Map<string, PixBatchRow[]>();
  for (const row of rows) {
    const date = row.payment_date || 'sem-data';
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(row);
  }
  const batches = [...byDate.entries()]
    .map(([payment_date, batchRows]) => ({
      payment_date,
      original_payment_dates: [
        ...new Set(batchRows.map((row) => row.original_payment_date).filter((date): date is string => Boolean(date))),
      ],
      adjustment_reasons: [
        ...new Set(batchRows.map((row) => row.payment_adjustment_reason).filter((reason): reason is string => Boolean(reason))),
      ],
      rows: batchRows,
      total_cents: batchRows.reduce(
        (sum, row) =>
          !row.warnings.includes('PIX não cadastrado') && !row.warnings.some((w) => w.startsWith('Pagamento bloqueado'))
            ? sum + row.amount_cents
            : sum,
        0
      ),
      blocked_count: batchRows.filter((row) => row.warnings.some((w) => w.startsWith('Pagamento bloqueado'))).length,
    }))
    .sort((a, b) => a.payment_date.localeCompare(b.payment_date));

  return { rows, batches, total_cents: total, cycle_label: cycle?.label || null };
}

export function pixBatchToCsv(rows: PixBatchRow[], cycleLabel: string | null): string {
  const header = ['nome', 'cpf', 'tipo_chave_pix', 'chave_pix', 'valor', 'referencia', 'descricao'];
  const lines = [header.join(',')];
  const desc = cycleLabel ? `Repasse ciclo ${cycleLabel}` : 'Repasse ciclo';
  for (const row of rows) {
    if (row.warnings.includes('PIX não cadastrado')) continue;
    const valor = (row.amount_cents / 100).toFixed(2).replace('.', ',');
    lines.push(
      [
        `"${row.name.replace(/"/g, '""')}"`,
        row.cpf || '',
        row.pix_key_type || '',
        `"${(row.pix_key || '').replace(/"/g, '""')}"`,
        valor,
        row.reference,
        `"${desc}"`,
      ].join(',')
    );
  }
  return lines.join('\n');
}

export async function recordPixBatchExport(
  workspaceId: string,
  cycleId: string,
  actorId: string,
  rows: PixBatchRow[],
  totalCents: number,
  metadata: Record<string, unknown> = {},
  paymentDate?: string | null
) {
  const exportable = rows.filter(
    (r) => !r.warnings.includes('PIX não cadastrado') && !r.warnings.some((w) => w.startsWith('Pagamento bloqueado'))
  );
  const fileFormat = metadata.file_format === 'xlsx' ? 'xlsx' : 'csv';
  const { file_format: _fmt, ...rest } = metadata;
  const { data, error } = await supabase.from('billing_payment_batch_exports').insert({
    workspace_id: workspaceId,
    billing_cycle_id: cycleId,
    exported_by: actorId,
    total_cents: totalCents,
    row_count: exportable.length,
    file_format: fileFormat,
    payment_date: paymentDate || null,
    metadata: { skipped_no_pix: rows.length - exportable.length, ...rest },
  }).select('id').single();
  if (error) throw new Error(error.message);
  return String(data.id);
}
