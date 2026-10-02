import ExcelJS from 'exceljs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchesConferenceDate, conferenceWeekdayUiFromRef, type DiscountRule } from '@plataforma/financial-cycle';

const FINANCIAL_ENTRY_COVERAGE_SELECT = `
        coverage_of_entry:financial_entries!coverage_of_entry_id(
          id, type, occurrence_kind, event_date, status, notes,
          absence_disposition, proposed_discount_amount,
          drivers(id, name)
        )`;

const FINANCIAL_PHARMACY_LIST_SELECT = `pharmacies(id, trade_name, leader_id)`;

export type DailyExportFilters = {
  payment_date?: string;
  pharmacy_id?: string;
  leader_id?: string;
  driver_id?: string;
  status?: string;
  installment_status?: 'all' | 'pending' | 'paid' | 'discounted';
};

import {
  financialEntryExportStatusLabel,
  isOpenInstallmentStatus,
  isPayableFinancialEntryStatus,
} from './financialEntryStatus';

const INST_STATUS_PT: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  overdue: 'Atrasado',
  cancelled: 'Cancelado',
};

const BILLING_TREATMENT_PT: Record<string, string> = {
  charge_pharmacy: 'Cobrar farmácia',
  absorb_operation: 'Absorver operação',
  pending_audit: 'Pendente auditoria',
};

const OCCURRENCE_PT: Record<string, string> = {
  day_off: 'Folga',
  unexcused: 'Falta injustificada',
  coverage: 'Cobertura',
  contracted_daily: 'Diária contratada',
};

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function formatDateTimeBrSp(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

function matchesInstallmentFilter(
  entry: Record<string, unknown>,
  refDate: string | undefined,
  filter: DailyExportFilters['installment_status'],
): boolean {
  if (!filter || filter === 'all' || !refDate) return true;
  const installments = (entry.financial_installments as Array<{ due_date: string; status: string }>) || [];
  const onRef = installments.filter((i) => i.due_date === refDate);
  if (!onRef.length) return false;
  if (filter === 'pending') return onRef.some((i) => isOpenInstallmentStatus(i.status));
  if (filter === 'paid') return onRef.some((i) => i.status === 'paid');
  return true;
}

function matchesConference(entry: Record<string, unknown>, paymentDate: string | undefined, rules: Record<string, DiscountRule>) {
  if (!paymentDate) return true;
  return matchesConferenceDate(
    {
      type: String(entry.type),
      created_at: String(entry.created_at),
      start_date: String(entry.start_date || '').slice(0, 10),
      event_date: entry.event_date ? String(entry.event_date).slice(0, 10) : null,
      financial_installments: (entry.financial_installments as Array<{ due_date: string; status: string }>) || [],
    },
    paymentDate,
    rules,
  );
}

const EXPORT_COLUMNS = [
  'ID lançamento',
  'Status',
  'Motivo rejeição',
  'Entregador',
  'CPF',
  'Telefone',
  'Chave PIX',
  'Farmácia',
  'Líder operação',
  'Data evento (escala)',
  'Data pagamento',
  'Valor total (R$)',
  'Parcelas',
  'Valor parcela (R$)',
  'Vencimento parcela',
  'Status parcela',
  'Baixa em',
  'Descrição sistema',
  'Motivo / notas',
  'Tipo ocorrência',
  'Falta vinculada (ID)',
  'Falta vinculada (entregador)',
  'Tratamento cobrança farmácia',
  'Valor cobrança farmácia (R$)',
  'Notas cobrança',
  'Criado em',
  'Criado por',
  'Aprovado em',
  'Aprovado por',
] as const;

const EXPORT_PAGE_SIZE = 1000;

type DailyEntryFetchFilters = {
  driver_id?: string;
  status?: string;
  pharmacy_id?: string;
  leaderPharmacyIds?: string[] | null;
};

/** Paginated fetch — PostgREST caps each response at ~1000 rows. */
export async function fetchAllDailyEntriesForExport(
  db: SupabaseClient,
  workspaceId: string,
  listSelect: string,
  filters: DailyEntryFetchFilters,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  for (;;) {
    let query = db
      .from('financial_entries')
      .select(listSelect)
      .eq('workspace_id', workspaceId)
      .eq('type', 'daily')
      .order('created_at', { ascending: false })
      .range(offset, offset + EXPORT_PAGE_SIZE - 1);

    if (filters.driver_id) query = query.eq('driver_id', filters.driver_id);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.pharmacy_id) query = query.eq('pharmacy_id', filters.pharmacy_id);
    if (filters.leaderPharmacyIds) query = query.in('pharmacy_id', filters.leaderPharmacyIds);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = (data || []) as unknown as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < EXPORT_PAGE_SIZE) break;
    offset += EXPORT_PAGE_SIZE;
    if (offset > 50_000) break;
  }
  return rows;
}

export async function buildFinancialDailiesXlsx(
  db: SupabaseClient,
  workspaceId: string,
  rules: Record<string, DiscountRule>,
  filters: DailyExportFilters,
): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
  let leaderPharmacyIds: string[] | null = null;
  if (filters.leader_id) {
    const { data: phRows, error: phErr } = await db
      .from('pharmacies')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('leader_id', filters.leader_id);
    if (phErr) throw new Error(phErr.message);
    leaderPharmacyIds = (phRows || []).map((p: { id: string }) => p.id);
    if (!leaderPharmacyIds.length) {
      return emptyWorkbook(filters.payment_date);
    }
  }

  const listSelect = [
    '*',
    'drivers(id, name, cpf, phone, pix_key)',
    FINANCIAL_PHARMACY_LIST_SELECT,
    'created_by_user:users!created_by(id, name)',
    'approved_by_user:users!approved_by(id, name)',
    'financial_installments(id, installment_number, amount, due_date, status, paid_at, reference, notes)',
    FINANCIAL_ENTRY_COVERAGE_SELECT,
  ].join(',\n');

  // PostgREST default max is 1000 rows. Oldest-first without pagination
  // silently drops recent diárias (prod already >1k), yielding header-only XLS.
  const rows = await fetchAllDailyEntriesForExport(db, workspaceId, listSelect, {
    driver_id: filters.driver_id,
    status: filters.status,
    pharmacy_id: filters.pharmacy_id,
    leaderPharmacyIds,
  });

  const leaderIds = new Set<string>();
  for (const row of rows) {
    const ph = row.pharmacies as { leader_id?: string } | null;
    if (ph?.leader_id) leaderIds.add(ph.leader_id);
  }
  const leaderNameById = new Map<string, string>();
  if (leaderIds.size) {
    const { data: leaders } = await db.from('users').select('id, name').in('id', [...leaderIds]);
    for (const u of leaders || []) leaderNameById.set(String(u.id), String(u.name || ''));
  }

  const paymentDate = filters.payment_date;
  const conferenceUi = paymentDate ? conferenceWeekdayUiFromRef(paymentDate, rules) : null;
  const filtered = rows.filter((row) => {
    if (paymentDate) {
      if (conferenceUi !== null) {
        if (!matchesConference(row, paymentDate, rules)) return false;
      } else {
        const installments = (row.financial_installments as Array<{ due_date: string }>) || [];
        if (!installments.some((i) => i.due_date === paymentDate)) return false;
      }
    }
    return matchesInstallmentFilter(row, paymentDate, filters.installment_status);
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Flux Farma';
  const ws = wb.addWorksheet('Diárias', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow([...EXPORT_COLUMNS]);
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };

  for (const row of filtered) {
    const driverRaw = row.drivers as
      | { name?: string; cpf?: string; phone?: string; pix_key?: string }
      | Array<{ name?: string; cpf?: string; phone?: string; pix_key?: string }>
      | null;
    const driver = Array.isArray(driverRaw) ? driverRaw[0] || null : driverRaw;
    const pharmacyRaw = row.pharmacies as
      | { trade_name?: string; leader_id?: string }
      | Array<{ trade_name?: string; leader_id?: string }>
      | null;
    const pharmacy = Array.isArray(pharmacyRaw) ? pharmacyRaw[0] || null : pharmacyRaw;
    const installments =
      (row.financial_installments as Array<{
        installment_number: number;
        amount: number;
        due_date: string;
        status: string;
        paid_at: string | null;
      }>) || [];
    const instOnDate = paymentDate
      ? installments.filter((i) => i.due_date === paymentDate)
      : installments.sort((a, b) => a.due_date.localeCompare(b.due_date));
    const inst = instOnDate[0] || installments[0];
    const coverage = row.coverage_of_entry as { id?: string; drivers?: { name?: string } } | null;
    const leaderName = pharmacy?.leader_id ? leaderNameById.get(pharmacy.leader_id) || '' : '';

    ws.addRow([
      row.id,
      financialEntryExportStatusLabel(String(row.status), row.rejection_reason as string | null),
      row.rejection_reason || '',
      driver?.name || '',
      driver?.cpf || '',
      driver?.phone || '',
      driver?.pix_key || '',
      pharmacy?.trade_name || '',
      leaderName,
      formatDateBr(row.event_date as string),
      formatDateBr(String(row.start_date || '').slice(0, 10)),
      Number(row.total_amount) || 0,
      row.installments_count ?? installments.length,
      inst ? Number(inst.amount) : Number(row.installment_amount) || 0,
      inst ? formatDateBr(inst.due_date) : '',
      inst ? INST_STATUS_PT[inst.status] || inst.status : '',
      inst?.paid_at ? formatDateTimeBrSp(inst.paid_at) : '',
      row.description || '',
      row.notes || '',
      row.occurrence_kind ? OCCURRENCE_PT[String(row.occurrence_kind)] || row.occurrence_kind : '',
      coverage?.id || row.coverage_of_entry_id || '',
      coverage?.drivers?.name || '',
      row.daily_billing_treatment
        ? BILLING_TREATMENT_PT[String(row.daily_billing_treatment)] || row.daily_billing_treatment
        : '',
      row.daily_pharmacy_charge_amount != null ? Number(row.daily_pharmacy_charge_amount) : '',
      row.daily_billing_notes || '',
      formatDateTimeBrSp(row.created_at as string),
      (row.created_by_user as { name?: string } | null)?.name || '',
      row.approved_at ? formatDateTimeBrSp(row.approved_at as string) : '',
      (row.approved_by_user as { name?: string } | null)?.name || '',
    ]);
  }

  ws.columns.forEach((col, idx) => {
    const wide = [18, 19, 25].includes(idx + 1);
    col.width = wide ? 42 : 16;
  });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const datePart = paymentDate || new Date().toISOString().slice(0, 10);
  return {
    buffer: buf,
    filename: `relatorio_diarias_${datePart}.xlsx`,
    rowCount: filtered.length,
  };
}

async function emptyWorkbook(paymentDate?: string) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Diárias');
  ws.addRow([...EXPORT_COLUMNS]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const datePart = paymentDate || new Date().toISOString().slice(0, 10);
  return { buffer: buf, filename: `relatorio_diarias_${datePart}.xlsx`, rowCount: 0 };
}
