import { supabase } from './supabase';
import {
  buildC6PixBatchXlsx,
  c6PixPartFilenameSuffix,
  chunkRowsForC6PixFile,
  resolveCyclePaymentDateIso,
} from './billingC6PixExport';
import { pixBatchToCsvWithTemplate } from './billingPixExportTemplates';
import {
  buildPixBatchPreview,
  recordPixBatchExport,
  type PixBatchRow,
} from './billingPayablesEngine';
import type { PixExportTemplate } from './billingTreasuryEngine';

async function buildC6BatchParts(params: {
  rows: PixBatchRow[];
  cycleLabel: string | null;
  paymentDate: string;
  filenameBase: string;
  skippedNoPix: number;
  description?: string;
}): Promise<PixBatchExportResult[]> {
  const chunks = chunkRowsForC6PixFile(params.rows);
  const parts: PixBatchExportResult[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    const xlsx = await buildC6PixBatchXlsx(chunk, params.cycleLabel, params.paymentDate, {
      description: params.description,
    });
    parts.push({
      template: 'c6',
      file_format: 'xlsx',
      row_count: chunk.length,
      total_cents: chunk.reduce((sum, row) => sum + row.amount_cents, 0),
      skipped_no_pix: i === 0 ? params.skippedNoPix : 0,
      xlsx_base64: xlsx.toString('base64'),
      filename: `${params.filenameBase}${c6PixPartFilenameSuffix(i, chunks.length)}.xlsx`,
      payment_date: params.paymentDate,
    });
  }
  return parts;
}

export type PixBatchExportResult = {
  template: PixExportTemplate;
  file_format: 'csv' | 'xlsx';
  row_count: number;
  total_cents: number;
  skipped_no_pix: number;
  csv?: string;
  xlsx_base64?: string;
  filename: string;
  payment_date?: string | null;
  batches?: PixBatchExportResult[];
};

export type GeneralPixBatchFilters = {
  paymentDate?: string | null;
  legalEntityType?: 'coop' | 'flux' | null;
  bankAccountId?: string | null;
  beneficiaryType?: string | null;
  costCenterId?: string | null;
  payableIds?: string[];
  /** Quando true, inclui APs de diárias (financial_daily). Default: false — trilha própria. */
  includeFinancialDaily?: boolean;
};

export async function resolvePixExportTemplate(
  workspaceId: string,
  bankAccountId?: string
): Promise<PixExportTemplate> {
  if (bankAccountId) {
    const { data: account } = await supabase
      .from('billing_bank_accounts')
      .select('pix_export_template')
      .eq('workspace_id', workspaceId)
      .eq('id', bankAccountId)
      .maybeSingle();
    if (account?.pix_export_template) {
      return account.pix_export_template as PixExportTemplate;
    }
  }

  const { data: defaultAccount } = await supabase
    .from('billing_bank_accounts')
    .select('pix_export_template')
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .eq('is_default', true)
    .maybeSingle();
  if (defaultAccount?.pix_export_template) {
    return defaultAccount.pix_export_template as PixExportTemplate;
  }

  const envTemplate = process.env.BILLING_DEFAULT_PIX_TEMPLATE;
  if (envTemplate) return envTemplate as PixExportTemplate;
  return 'c6';
}

async function beneficiaryForPayable(payable: {
  beneficiary_type: string;
  beneficiary_id: string | null;
  description: string | null;
  pix_key: string | null;
  pix_key_type: string | null;
}) {
  if (payable.pix_key) {
    return {
      name: payable.description || payable.beneficiary_id || 'Beneficiário',
      cpf: null,
      pix_key: payable.pix_key,
      pix_key_type: payable.pix_key_type,
    };
  }
  if (!payable.beneficiary_id) {
    return { name: payable.description || 'Beneficiário operacional', cpf: null, pix_key: null, pix_key_type: null };
  }
  const tableByType: Record<string, { table: string; name: string; cpf?: string }> = {
    driver: { table: 'drivers', name: 'name', cpf: 'cpf' },
    supplier: { table: 'billing_suppliers', name: 'name', cpf: 'cpf_cnpj' },
    internal_provider: { table: 'billing_internal_providers', name: 'legal_name', cpf: 'cpf_cnpj' },
    shareholder: { table: 'billing_shareholders', name: 'legal_name', cpf: 'cpf_cnpj' },
    commercial_partner: { table: 'billing_commercial_partners', name: 'legal_name', cpf: 'cpf_cnpj' },
    leader: { table: 'leaders', name: 'name', cpf: 'cpf' },
  };
  const cfg = tableByType[payable.beneficiary_type];
  if (!cfg) return { name: payable.description || payable.beneficiary_id, cpf: null, pix_key: null, pix_key_type: null };
  const { data } = await supabase
    .from(cfg.table)
    .select('*')
    .eq('id', payable.beneficiary_id)
    .maybeSingle();
  const row = (data || {}) as Record<string, unknown>;
  return {
    name: row[cfg.name] ? String(row[cfg.name]) : payable.description || payable.beneficiary_id,
    cpf: cfg.cpf && row[cfg.cpf] ? String(row[cfg.cpf]) : null,
    pix_key: row.pix_key ? String(row.pix_key) : null,
    pix_key_type: row.pix_key_type ? String(row.pix_key_type) : null,
  };
}

export async function buildGeneralPixBatchPreview(workspaceId: string, filters: GeneralPixBatchFilters) {
  let query = supabase
    .from('billing_payables')
    .select(
      'id, beneficiary_type, beneficiary_id, description, amount_cents, amount_paid_cents, status, due_date, scheduled_payment_date, effective_due_date, legal_entity_type, cost_center_id, payment_method, payment_bank_account_id, pix_key, pix_key_type, batch_eligible, payment_blocked, block_reason, payment_batch_status, origin_type, metadata'
    )
    .eq('workspace_id', workspaceId)
    .in('status', ['approved'])
    .eq('payment_method', 'pix')
    .eq('batch_eligible', true)
    .neq('payment_batch_status', 'exported')
    .order('scheduled_payment_date', { ascending: true });

  if (filters.paymentDate) query = query.eq('scheduled_payment_date', filters.paymentDate);
  if (filters.legalEntityType) query = query.eq('legal_entity_type', filters.legalEntityType);
  if (filters.bankAccountId) query = query.eq('payment_bank_account_id', filters.bankAccountId);
  if (filters.beneficiaryType) query = query.eq('beneficiary_type', filters.beneficiaryType);
  if (filters.costCenterId) query = query.eq('cost_center_id', filters.costCenterId);
  if (filters.payableIds?.length) query = query.in('id', filters.payableIds);
  if (!filters.includeFinancialDaily) {
    query = query.or('origin_type.is.null,origin_type.neq.financial_daily');
  }

  const { data: payables, error } = await query;
  if (error) throw new Error(error.message);

  const rows: PixBatchRow[] = [];
  let total = 0;
  for (const payable of payables || []) {
    if (!filters.includeFinancialDaily) {
      const meta =
        payable.metadata && typeof payable.metadata === 'object' && !Array.isArray(payable.metadata)
          ? (payable.metadata as Record<string, unknown>)
          : {};
      if (String(payable.origin_type || '') === 'financial_daily' || String(meta.payment_kind || '') === 'daily') {
        continue;
      }
    }
    const balance = Number(payable.amount_cents || 0) - Number(payable.amount_paid_cents || 0);
    if (balance <= 0) continue;
    const beneficiary = await beneficiaryForPayable({
      beneficiary_type: String(payable.beneficiary_type),
      beneficiary_id: payable.beneficiary_id ? String(payable.beneficiary_id) : null,
      description: payable.description ? String(payable.description) : null,
      pix_key: payable.pix_key ? String(payable.pix_key) : null,
      pix_key_type: payable.pix_key_type ? String(payable.pix_key_type) : null,
    });
    const warnings: string[] = [];
    if (!beneficiary.pix_key) warnings.push('PIX não cadastrado');
    if (payable.payment_blocked) warnings.push(`Pagamento bloqueado: ${payable.block_reason || 'pendência de liberação'}`);
    const paymentDate = String(payable.scheduled_payment_date || payable.effective_due_date || payable.due_date || '').slice(0, 10) || null;
    rows.push({
      payable_id: String(payable.id),
      beneficiary_type: String(payable.beneficiary_type),
      driver_id: payable.beneficiary_id ? String(payable.beneficiary_id) : String(payable.id),
      name: beneficiary.name,
      cpf: beneficiary.cpf,
      pix_key_type: beneficiary.pix_key_type,
      pix_key: beneficiary.pix_key,
      amount_cents: balance,
      payment_date: paymentDate,
      original_payment_date: payable.due_date ? String(payable.due_date).slice(0, 10) : null,
      payment_adjustment_reason: null,
      reference: `ap-${String(payable.id).slice(0, 8)}-${String(paymentDate || '').replace(/-/g, '')}`,
      warnings,
    });
    if (!warnings.length) total += balance;
  }

  return {
    rows: rows.sort((a, b) => (a.payment_date || '').localeCompare(b.payment_date || '') || a.name.localeCompare(b.name, 'pt-BR')),
    total_cents: total,
    cycle_label: null,
    batches: groupRowsByPaymentDate(rows).map((group) => ({
      payment_date: group.paymentDate,
      original_payment_dates: [...new Set(group.rows.map((row) => row.original_payment_date).filter((date): date is string => Boolean(date)))],
      adjustment_reasons: [],
      rows: group.rows,
      total_cents: exportableRows(group.rows).reduce((sum, row) => sum + row.amount_cents, 0),
      blocked_count: group.rows.filter((row) => row.warnings.some((warning) => warning.startsWith('Pagamento bloqueado'))).length,
    })),
  };
}

async function loadCyclePaymentDate(workspaceId: string, cycleId: string): Promise<string> {
  const { data: cycle, error } = await supabase
    .from('billing_cycles')
    .select('payment_date, apuracao_end')
    .eq('workspace_id', workspaceId)
    .eq('id', cycleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!cycle) throw new Error('Ciclo não encontrado');
  return resolveCyclePaymentDateIso(
    cycle.payment_date ? String(cycle.payment_date) : null,
    String(cycle.apuracao_end)
  );
}

function exportableRows(rows: PixBatchRow[]): PixBatchRow[] {
  return rows.filter((r) => !r.warnings.includes('PIX não cadastrado') && !r.warnings.some((w) => w.startsWith('Pagamento bloqueado')));
}

function groupRowsByPaymentDate(rows: PixBatchRow[]): Array<{ paymentDate: string; rows: PixBatchRow[] }> {
  const grouped = new Map<string, PixBatchRow[]>();
  for (const row of rows) {
    const key = row.payment_date || 'sem-data';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }
  return [...grouped.entries()]
    .map(([paymentDate, batchRows]) => ({ paymentDate, rows: batchRows }))
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));
}

export async function exportPixBatchForCycle(
  workspaceId: string,
  cycleId: string,
  actorId: string,
  options?: { bankAccountId?: string; autoGenerated?: boolean; record?: boolean }
): Promise<PixBatchExportResult | null> {
  const preview = await buildPixBatchPreview(workspaceId, cycleId);
  if (!preview.rows.length) return null;

  const template = await resolvePixExportTemplate(workspaceId, options?.bankAccountId);
  const groups = groupRowsByPaymentDate(preview.rows);
  const cycleSuffix = cycleId.slice(0, 8);
  const fallbackPaymentDateIso = await loadCyclePaymentDate(workspaceId, cycleId);

  const batches: PixBatchExportResult[] = [];
  for (const group of groups) {
    const exportable = exportableRows(group.rows);
    if (!exportable.length) continue;
    const skippedNoPix = group.rows.length - exportable.length;
    const paymentDate = group.paymentDate === 'sem-data' ? fallbackPaymentDateIso : group.paymentDate;
    const totalCents = exportable.reduce((sum, row) => sum + row.amount_cents, 0);

    if (options?.record !== false) {
      await recordPixBatchExport(
        workspaceId,
        cycleId,
        actorId,
        group.rows,
        totalCents,
        {
          template,
          auto_generated: options?.autoGenerated ?? false,
          file_format: template === 'c6' ? 'xlsx' : 'csv',
          payment_dates: [paymentDate],
        },
        paymentDate
      );
    }

    if (template === 'c6') {
      const parts = await buildC6BatchParts({
        rows: exportable,
        cycleLabel: preview.cycle_label,
        paymentDate,
        filenameBase: `c6-pix-lote-${cycleSuffix}-${paymentDate}`,
        skippedNoPix,
      });
      batches.push(...parts);
    } else {
      const csv = pixBatchToCsvWithTemplate(exportable, preview.cycle_label, template);
      batches.push({
        template,
        file_format: 'csv',
        row_count: exportable.length,
        total_cents: totalCents,
        skipped_no_pix: skippedNoPix,
        csv,
        filename: `pix-lote-${cycleSuffix}-${paymentDate}.csv`,
        payment_date: paymentDate,
      });
    }
  }

  if (!batches.length) return null;
  const totalCents = batches.reduce((sum, batch) => sum + batch.total_cents, 0);
  const rowCount = batches.reduce((sum, batch) => sum + batch.row_count, 0);
  const skippedNoPix = batches.reduce((sum, batch) => sum + batch.skipped_no_pix, 0);

  return {
    template,
    file_format: batches[0]!.file_format,
    row_count: rowCount,
    total_cents: totalCents,
    skipped_no_pix: skippedNoPix,
    filename: batches.length === 1 ? batches[0]!.filename : `pix-lotes-${cycleSuffix}.json`,
    payment_date: batches.length === 1 ? batches[0]!.payment_date : null,
    csv: batches.length === 1 ? batches[0]!.csv : undefined,
    xlsx_base64: batches.length === 1 ? batches[0]!.xlsx_base64 : undefined,
    batches,
  };
}

export async function exportGeneralPixBatch(
  workspaceId: string,
  actorId: string,
  filters: GeneralPixBatchFilters
): Promise<PixBatchExportResult | null> {
  const preview = await buildGeneralPixBatchPreview(workspaceId, filters);
  if (!preview.rows.length) return null;
  const exportable = exportableRows(preview.rows);
  if (!exportable.length) return null;

  const template = await resolvePixExportTemplate(workspaceId, filters.bankAccountId || undefined);
  const paymentDate = filters.paymentDate || exportable[0]?.payment_date || new Date().toISOString().slice(0, 10);
  const totalCents = exportable.reduce((sum, row) => sum + row.amount_cents, 0);
  const fileFormat = template === 'c6' ? 'xlsx' : 'csv';

  const { data: batch, error: batchErr } = await supabase
    .from('billing_payment_batch_exports')
    .insert({
      workspace_id: workspaceId,
      billing_cycle_id: null,
      exported_by: actorId,
      total_cents: totalCents,
      row_count: exportable.length,
      file_format: fileFormat,
      payment_date: paymentDate,
      bank_account_id: filters.bankAccountId || null,
      legal_entity_type: filters.legalEntityType || null,
      batch_kind: 'general_payables',
      metadata: {
        skipped_no_pix: preview.rows.length - exportable.length,
        filters,
        template,
      },
    })
    .select('id')
    .single();
  if (batchErr) throw new Error(batchErr.message);

  const links = exportable
    .filter((row) => row.payable_id)
    .map((row) => ({
      workspace_id: workspaceId,
      batch_export_id: batch.id,
      payable_id: row.payable_id,
      amount_cents: row.amount_cents,
    }));
  if (links.length) {
    const { error: linkErr } = await supabase.from('billing_payment_batch_export_payables').insert(links);
    if (linkErr) throw new Error(linkErr.message);

    const { error: payableErr } = await supabase
      .from('billing_payables')
      .update({
        payment_batch_status: 'exported',
        payment_batch_export_id: batch.id,
        payment_batch_exported_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .in('id', links.map((link) => link.payable_id));
    if (payableErr) throw new Error(payableErr.message);
  }

  const skippedNoPix = preview.rows.length - exportable.length;

  if (template === 'c6') {
    const batches = await buildC6BatchParts({
      rows: exportable,
      cycleLabel: null,
      paymentDate,
      filenameBase: `c6-pix-ap-${paymentDate}`,
      skippedNoPix,
    });
    return {
      template,
      file_format: 'xlsx',
      row_count: exportable.length,
      total_cents: totalCents,
      skipped_no_pix: skippedNoPix,
      filename: batches.length === 1 ? batches[0]!.filename : `c6-pix-ap-${paymentDate}-lotes.json`,
      payment_date: paymentDate,
      xlsx_base64: batches.length === 1 ? batches[0]!.xlsx_base64 : undefined,
      batches,
    };
  }

  const csv = pixBatchToCsvWithTemplate(exportable, null, template);
  return {
    template,
    file_format: 'csv',
    row_count: exportable.length,
    total_cents: totalCents,
    skipped_no_pix: skippedNoPix,
    filename: `pix-ap-${paymentDate}.csv`,
    payment_date: paymentDate,
    csv,
  };
}

export async function autoExportPixBatchAfterApproval(
  workspaceId: string,
  cycleId: string,
  actorId: string
): Promise<PixBatchExportResult | null> {
  return exportPixBatchForCycle(workspaceId, cycleId, actorId, { autoGenerated: true });
}
