import { supabase } from './supabase';
import {
  buildC6PixBatchXlsx,
  c6PixPartFilenameSuffix,
  chunkRowsForC6PixFile,
} from './billingC6PixExport';
import type { PixBatchRow } from './billingPayablesEngine';
import {
  resolvePixExportTemplate,
  type PixBatchExportResult,
} from './billingPixBatchExport';
import { pixBatchToCsvWithTemplate } from './billingPixExportTemplates';

const VERIFIED_DAILY_STATUSES = ['active', 'approved', 'settled'];
/** Parcelas ainda abertas — alinhado a isOpenInstallmentStatus (UI "Pendente"). */
const OPEN_INSTALLMENT_STATUSES = ['pending', 'overdue'];

function moneyToCents(amount: number): number {
  return Math.round(Number(amount || 0) * 100);
}

export type DailyPixPreview = {
  payment_date: string;
  rows: PixBatchRow[];
  total_cents: number;
  pending_count: number;
  skipped_no_pix: number;
  pending_approval_count: number;
};

type PharmacyCostCenterJoin = {
  id: string;
  billing_cost_center_id: string | null;
};

type DriverJoin = {
  id: string;
  name: string | null;
  cpf: string | null;
  pix_key: string | null;
  pix_key_type: string | null;
};

type InstallmentJoinRow = {
  id: string;
  amount: number;
  due_date: string;
  status: string;
  financial_entries: {
    id: string;
    type: string;
    status: string;
    description: string | null;
    driver_id: string | null;
    pharmacy_id?: string | null;
    drivers: DriverJoin | DriverJoin[] | null;
    pharmacies?: PharmacyCostCenterJoin | PharmacyCostCenterJoin[] | null;
  } | null;
};

function asOnePharmacy(
  raw: PharmacyCostCenterJoin | PharmacyCostCenterJoin[] | null | undefined
): PharmacyCostCenterJoin | null {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] || null : raw;
}

function asOneDriver(raw: DriverJoin | DriverJoin[] | null | undefined): DriverJoin | null {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] || null : raw;
}

function resolveCostCenterIdFromEntry(
  entry: InstallmentJoinRow['financial_entries']
): string | null {
  const pharmacy = asOnePharmacy(entry?.pharmacies);
  const ccId = pharmacy?.billing_cost_center_id ? String(pharmacy.billing_cost_center_id) : null;
  return ccId || null;
}

/** Diárias aprovadas com parcela na data — base do lote PIX de terça. */
export async function buildDailyPixPreview(
  workspaceId: string,
  paymentDate: string,
  options?: { includePaid?: boolean }
): Promise<DailyPixPreview> {
  const date = String(paymentDate).slice(0, 10);
  let query = supabase
    .from('financial_installments')
    .select(
      `
      id, amount, due_date, status,
      financial_entries!inner(
        id, type, status, description, driver_id,
        drivers(id, name, cpf, pix_key, pix_key_type)
      )
    `
    )
    .eq('workspace_id', workspaceId)
    .eq('due_date', date)
    .eq('financial_entries.type', 'daily')
    .in('financial_entries.status', VERIFIED_DAILY_STATUSES);

  if (!options?.includePaid) {
    query = query.in('status', OPEN_INSTALLMENT_STATUSES);
  } else {
    query = query.in('status', [...OPEN_INSTALLMENT_STATUSES, 'paid']);
  }

  const { data, error } = await query.order('due_date');
  if (error) throw new Error(error.message);

  const { count: pendingApprovalCount } = await supabase
    .from('financial_entries')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('type', 'daily')
    .eq('status', 'pending_approval')
    .eq('start_date', date);

  /** Agrupa por entregador na data (um PIX por pessoa). */
  const byDriver = new Map<
    string,
    {
      driverId: string;
      name: string;
      cpf: string | null;
      pix_key: string | null;
      pix_key_type: string | null;
      amount_cents: number;
      installmentIds: string[];
      descriptions: string[];
    }
  >();

  for (const raw of (data || []) as unknown as InstallmentJoinRow[]) {
    const entry = raw.financial_entries;
    const driver = asOneDriver(entry?.drivers);
    const driverId = String(entry?.driver_id || driver?.id || '');
    if (!driverId) continue;
    const amountCents = moneyToCents(Number(raw.amount));
    if (amountCents <= 0) continue;

    const existing = byDriver.get(driverId);
    if (existing) {
      existing.amount_cents += amountCents;
      existing.installmentIds.push(raw.id);
      if (entry?.description) existing.descriptions.push(String(entry.description));
      continue;
    }
    byDriver.set(driverId, {
      driverId,
      name: String(driver?.name || 'Entregador'),
      cpf: driver?.cpf ? String(driver.cpf) : null,
      pix_key: driver?.pix_key ? String(driver.pix_key) : null,
      pix_key_type: driver?.pix_key_type ? String(driver.pix_key_type) : null,
      amount_cents: amountCents,
      installmentIds: [raw.id],
      descriptions: entry?.description ? [String(entry.description)] : [],
    });
  }

  const rows: PixBatchRow[] = [...byDriver.values()].map((bucket) => {
    const warnings: string[] = [];
    if (!bucket.pix_key) warnings.push('PIX não cadastrado');
    return {
      driver_id: bucket.driverId,
      name: bucket.name,
      cpf: bucket.cpf,
      pix_key: bucket.pix_key,
      pix_key_type: bucket.pix_key_type,
      amount_cents: bucket.amount_cents,
      payment_date: date,
      original_payment_date: date,
      payment_adjustment_reason: null,
      reference: `diarias:${date}:${bucket.driverId}`,
      warnings,
      beneficiary_type: 'driver',
    };
  });

  rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const exportable = rows.filter((r) => !r.warnings.includes('PIX não cadastrado'));
  return {
    payment_date: date,
    rows,
    total_cents: exportable.reduce((sum, r) => sum + r.amount_cents, 0),
    pending_count: rows.length,
    skipped_no_pix: rows.length - exportable.length,
    pending_approval_count: pendingApprovalCount || 0,
  };
}

export async function exportDailyPixBatch(
  workspaceId: string,
  paymentDate: string,
  options?: { bankAccountId?: string }
): Promise<PixBatchExportResult | null> {
  const preview = await buildDailyPixPreview(workspaceId, paymentDate);
  const exportable = preview.rows.filter((r) => !r.warnings.includes('PIX não cadastrado'));
  if (!exportable.length) return null;

  const template = await resolvePixExportTemplate(workspaceId, options?.bankAccountId);
  const date = preview.payment_date;
  const totalCents = exportable.reduce((sum, r) => sum + r.amount_cents, 0);

  if (template === 'c6') {
    const chunks = chunkRowsForC6PixFile(exportable);
    const batches: PixBatchExportResult[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      const xlsx = await buildC6PixBatchXlsx(chunk, null, date, {
        description: 'REPASSE DIARIAS',
      });
      batches.push({
        template,
        file_format: 'xlsx',
        row_count: chunk.length,
        total_cents: chunk.reduce((sum, row) => sum + row.amount_cents, 0),
        skipped_no_pix: i === 0 ? preview.skipped_no_pix : 0,
        xlsx_base64: xlsx.toString('base64'),
        filename: `c6-pix-diarias-${date}${c6PixPartFilenameSuffix(i, chunks.length)}.xlsx`,
        payment_date: date,
      });
    }
    return {
      template,
      file_format: 'xlsx',
      row_count: exportable.length,
      total_cents: totalCents,
      skipped_no_pix: preview.skipped_no_pix,
      xlsx_base64: batches.length === 1 ? batches[0]!.xlsx_base64 : undefined,
      filename:
        batches.length === 1 ? batches[0]!.filename : `c6-pix-diarias-${date}-lotes.json`,
      payment_date: date,
      batches,
    };
  }

  const csv = pixBatchToCsvWithTemplate(exportable, null, template, {
    description: 'REPASSE DIARIAS',
  });
  return {
    template,
    file_format: 'csv',
    row_count: exportable.length,
    total_cents: totalCents,
    skipped_no_pix: preview.skipped_no_pix,
    csv,
    filename: `pix-diarias-${date}.csv`,
    payment_date: date,
  };
}

/** Cria payables idempotentes a partir das diárias aprovadas na data (para baixa/conciliação). */
export async function syncDailyPayablesFromFinancial(
  workspaceId: string,
  paymentDate: string
): Promise<{ created: number; existing: number; payables: string[] }> {
  const date = String(paymentDate).slice(0, 10);
  const { data: installments, error } = await supabase
    .from('financial_installments')
    .select(
      `
      id, amount, due_date, status,
      financial_entries!inner(
        id, type, status, description, driver_id, pharmacy_id,
        drivers(id, name, pix_key, pix_key_type),
        pharmacies(id, billing_cost_center_id)
      )
    `
    )
    .eq('workspace_id', workspaceId)
    .eq('due_date', date)
    .in('status', OPEN_INSTALLMENT_STATUSES)
    .eq('financial_entries.type', 'daily')
    .in('financial_entries.status', VERIFIED_DAILY_STATUSES);
  if (error) throw new Error(error.message);

  let created = 0;
  let existing = 0;
  const payableIds: string[] = [];
  const now = new Date().toISOString();

  for (const raw of (installments || []) as unknown as InstallmentJoinRow[]) {
    const entry = raw.financial_entries;
    const driver = asOneDriver(entry?.drivers);
    const driverId = String(entry?.driver_id || driver?.id || '');
    if (!driverId) continue;
    const amountCents = moneyToCents(Number(raw.amount));
    if (amountCents <= 0) continue;

    const pharmacy = asOnePharmacy(entry?.pharmacies);
    const costCenterId = resolveCostCenterIdFromEntry(entry);
    const pharmacyId = pharmacy?.id
      ? String(pharmacy.id)
      : entry?.pharmacy_id
        ? String(entry.pharmacy_id)
        : null;

    const { data: already } = await supabase
      .from('billing_payables')
      .select('id, cost_center_id')
      .eq('workspace_id', workspaceId)
      .eq('origin_type', 'financial_daily')
      .eq('origin_id', raw.id)
      .maybeSingle();

    if (already?.id) {
      // Preenche centro de custo se o payable antigo nasceu sem ele (UPDATE aditivo).
      if (!already.cost_center_id && costCenterId) {
        await supabase
          .from('billing_payables')
          .update({ cost_center_id: costCenterId, updated_at: now })
          .eq('workspace_id', workspaceId)
          .eq('id', already.id)
          .is('cost_center_id', null);
      }
      existing += 1;
      payableIds.push(String(already.id));
      continue;
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('billing_payables')
      .insert({
        workspace_id: workspaceId,
        beneficiary_type: 'driver',
        beneficiary_id: driverId,
        legal_entity_type: 'coop',
        cost_center_id: costCenterId,
        description: `Diária — ${driver?.name || driverId} — ${date}`,
        amount_cents: amountCents,
        gross_amount_cents: amountCents,
        compensated_amount_cents: 0,
        net_amount_cents: amountCents,
        status: 'approved',
        due_date: date,
        original_due_date: date,
        effective_due_date: date,
        scheduled_payment_date: date,
        payment_method: 'pix',
        batch_eligible: true,
        payment_batch_status: 'pending',
        payment_blocked: false,
        block_reason: null,
        origin_type: 'financial_daily',
        origin_id: raw.id,
        pix_key: driver?.pix_key || null,
        pix_key_type: driver?.pix_key_type || null,
        metadata: {
          financial_entry_id: entry?.id,
          financial_installment_id: raw.id,
          payment_kind: 'daily',
          pharmacy_id: pharmacyId,
          cost_center_id: costCenterId,
        },
        approved_at: now,
        updated_at: now,
      })
      .select('id')
      .single();

    if (insertErr) throw new Error(insertErr.message);
    created += 1;
    if (inserted?.id) payableIds.push(String(inserted.id));
  }

  return { created, existing, payables: payableIds };
}

/**
 * Preenche cost_center_id em payables financial_daily que nasceram sem centro de custo.
 * Apenas UPDATE aditivo (só onde cost_center_id IS NULL).
 */
export async function backfillFinancialDailyPayableCostCenters(
  workspaceId: string,
  options?: { dueDate?: string; limit?: number }
): Promise<{ scanned: number; updated: number; skipped_no_pharmacy_cc: number }> {
  const limit = Math.min(Math.max(options?.limit || 500, 1), 2000);
  let query = supabase
    .from('billing_payables')
    .select('id, origin_id, due_date')
    .eq('workspace_id', workspaceId)
    .eq('origin_type', 'financial_daily')
    .is('cost_center_id', null)
    .order('due_date', { ascending: false })
    .limit(limit);

  if (options?.dueDate) {
    query = query.eq('due_date', String(options.dueDate).slice(0, 10));
  }

  const { data: payables, error } = await query;
  if (error) throw new Error(error.message);

  let updated = 0;
  let skippedNoPharmacyCc = 0;
  const now = new Date().toISOString();

  for (const payable of payables || []) {
    const installmentId = payable.origin_id ? String(payable.origin_id) : '';
    if (!installmentId) {
      skippedNoPharmacyCc += 1;
      continue;
    }

    const { data: inst } = await supabase
      .from('financial_installments')
      .select(
        `
        id,
        financial_entries!inner(
          pharmacy_id,
          pharmacies(id, billing_cost_center_id)
        )
      `
      )
      .eq('workspace_id', workspaceId)
      .eq('id', installmentId)
      .maybeSingle();

    const entry = inst?.financial_entries as InstallmentJoinRow['financial_entries'] | InstallmentJoinRow['financial_entries'][] | null;
    const entryOne = Array.isArray(entry) ? entry[0] : entry;
    const costCenterId = resolveCostCenterIdFromEntry(entryOne || null);
    if (!costCenterId) {
      skippedNoPharmacyCc += 1;
      continue;
    }

    const { error: updErr } = await supabase
      .from('billing_payables')
      .update({ cost_center_id: costCenterId, updated_at: now })
      .eq('workspace_id', workspaceId)
      .eq('id', payable.id)
      .is('cost_center_id', null);

    if (updErr) throw new Error(updErr.message);
    updated += 1;
  }

  return {
    scanned: (payables || []).length,
    updated,
    skipped_no_pharmacy_cc: skippedNoPharmacyCc,
  };
}

/** Após baixa de payable de diária, marca a installment financeira como paga. */
export async function syncFinancialInstallmentPaidFromPayable(
  workspaceId: string,
  payable: { origin_type?: string | null; origin_id?: string | null; metadata?: Record<string, unknown> | null }
): Promise<void> {
  if (payable.origin_type !== 'financial_daily') return;
  const installmentId =
    (payable.origin_id && String(payable.origin_id)) ||
    (payable.metadata?.financial_installment_id ? String(payable.metadata.financial_installment_id) : '');
  if (!installmentId) return;

  await supabase
    .from('financial_installments')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', installmentId)
    .eq('status', 'pending');
}
