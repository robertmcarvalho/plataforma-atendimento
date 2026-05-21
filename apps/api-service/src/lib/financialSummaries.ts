import { supabase } from './supabase';
import { loadEntryTypes, type FinancialEntryType } from './financialEntryTypes';

export function monthBoundsUtc(month: string): { startIso: string; endIso: string; startDate: string; endDate: string } {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

interface WeekBoundsMonSun {
  startDate: string;
  endDate: string;
  startIso: string;
  endIso: string;
}

interface WeekPaymentBounds {
  tuesdayDate: string;
  thursdayDate: string;
}

/** Retorna a data referência (UTC noon) e o dia da semana (0=Dom...6=Sab) para cálculos de janela. */
function refUtcNoon(referenceDateIso?: string): Date {
  const ref = referenceDateIso ? new Date(`${referenceDateIso}T12:00:00.000Z`) : new Date();
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 12, 0, 0));
}

/** Semana atual Seg→Dom da data de referência. */
export function currentWeekBoundsMonSun(referenceDateIso?: string): WeekBoundsMonSun {
  const ref = refUtcNoon(referenceDateIso);
  const day = ref.getUTCDay();
  const offsetToMonday = (day + 6) % 7; // Seg=0, Dom=6
  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() - offsetToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return buildBoundsMonSun(monday, sunday);
}

/** Semana fechada anterior Seg→Dom da data de referência. */
export function previousClosedCycleBoundsMonSun(referenceDateIso?: string): WeekBoundsMonSun {
  const cur = currentWeekBoundsMonSun(referenceDateIso);
  const prevMonday = new Date(`${cur.startDate}T12:00:00.000Z`);
  prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
  const prevSunday = new Date(prevMonday);
  prevSunday.setUTCDate(prevMonday.getUTCDate() + 6);
  return buildBoundsMonSun(prevMonday, prevSunday);
}

function buildBoundsMonSun(monday: Date, sunday: Date): WeekBoundsMonSun {
  const startIso = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 0, 0, 0)).toISOString();
  const endIso = new Date(Date.UTC(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate(), 23, 59, 59, 999)).toISOString();
  return {
    startDate: monday.toISOString().slice(0, 10),
    endDate: sunday.toISOString().slice(0, 10),
    startIso,
    endIso,
  };
}

export function currentWeekPaymentBounds(referenceDateIso?: string): WeekPaymentBounds {
  const cur = currentWeekBoundsMonSun(referenceDateIso);
  const monday = new Date(`${cur.startDate}T12:00:00.000Z`);
  const tuesday = new Date(monday);
  tuesday.setUTCDate(monday.getUTCDate() + 1);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  return {
    tuesdayDate: tuesday.toISOString().slice(0, 10),
    thursdayDate: thursday.toISOString().slice(0, 10),
  };
}

export type MonthlyDriverSummary = {
  driver_id: string;
  month: string;
  range_start: string;
  range_end: string;
  total_debits: number;
  total_paid: number;
  pending_installments_count: number;
  pending_installments_amount: number;
  entries_by_type: Record<string, number>;
  next_pending_installment: {
    id: string;
    amount: number;
    due_date: string;
    entry_id: string;
  } | null;
};

export async function buildMonthlyDriverSummary(driver_id: string, month: string): Promise<MonthlyDriverSummary> {
  const { startIso, endIso, startDate, endDate } = monthBoundsUtc(month);

  const debitStatuses = ['active', 'settled', 'pending_approval', 'approved'];

  const { data: entriesInMonth, error: entErr } = await supabase
    .from('financial_entries')
    .select('id, total_amount, type, status, created_at')
    .eq('driver_id', driver_id)
    .gte('created_at', startIso)
    .lte('created_at', endIso);
  if (entErr) throw new Error(entErr.message);

  const rows = entriesInMonth || [];
  let total_debits = 0;
  const entries_by_type: Record<string, number> = {};
  for (const row of rows) {
    if (!debitStatuses.includes(String(row.status))) continue;
    const amt = Number(row.total_amount) || 0;
    total_debits += amt;
    const t = String(row.type || 'other');
    entries_by_type[t] = (entries_by_type[t] || 0) + amt;
  }

  const { data: entryIdsRows } = await supabase.from('financial_entries').select('id').eq('driver_id', driver_id);
  const entryIds = (entryIdsRows || []).map((r: { id: string }) => r.id);

  let total_paid = 0;
  let pending_installments_count = 0;
  let pending_installments_amount = 0;
  let next_pending_installment: MonthlyDriverSummary['next_pending_installment'] = null;

  if (entryIds.length > 0) {
    const { data: installments, error: instErr } = await supabase
      .from('financial_installments')
      .select('id, amount, due_date, status, paid_at, entry_id')
      .in('entry_id', entryIds);
    if (instErr) throw new Error(instErr.message);

    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();

    for (const inst of installments || []) {
      const paidAtRaw = inst.paid_at ? new Date(String(inst.paid_at)).getTime() : null;
      if (inst.status === 'paid' && paidAtRaw != null && paidAtRaw >= startMs && paidAtRaw <= endMs) {
        total_paid += Number(inst.amount) || 0;
      }
      if (inst.status === 'pending') {
        const due = String(inst.due_date);
        if (due <= endDate) {
          pending_installments_count += 1;
          pending_installments_amount += Number(inst.amount) || 0;
        }
        const candidate = {
          id: String(inst.id),
          amount: Number(inst.amount) || 0,
          due_date: due,
          entry_id: String(inst.entry_id),
        };
        if (!next_pending_installment || due < next_pending_installment.due_date) {
          next_pending_installment = candidate;
        }
      }
    }
  }

  return {
    driver_id,
    month,
    range_start: startDate,
    range_end: endDate,
    total_debits,
    total_paid,
    pending_installments_count,
    pending_installments_amount,
    entries_by_type,
    next_pending_installment,
  };
}

export type WeeklyDriverSummary = {
  driver_id: string;
  current_week: {
    start: string;
    end: string;
    daily_total: number;
    daily_entries: Array<{
      id: string;
      start_date: string;
      total_amount: number;
      description: string | null;
    }>;
  };
  cycle: {
    start: string;
    end: string;
    weekly_revenue: number;
    discounts_total: number;
    discounts_breakdown: Record<string, { label: string; amount: number; count: number; last_date: string | null }>;
  };
  net_estimated: number;
};

export async function buildWeeklyDriverSummary(driver_id: string, reference_date?: string): Promise<WeeklyDriverSummary> {
  const currentWeek = currentWeekBoundsMonSun(reference_date);
  const currentWeekPayments = currentWeekPaymentBounds(reference_date);
  const cycle = previousClosedCycleBoundsMonSun(reference_date);

  const verifiedStatuses = ['approved', 'active', 'settled'];

  const entryTypes = await loadEntryTypes();
  const typesBySlug = new Map<string, FinancialEntryType>();
  for (const t of entryTypes) typesBySlug.set(t.slug, t);
  const discountSlugs = entryTypes.filter((t) => t.active && t.affects_net === 'discount').map((t) => t.slug);

  const { data: dailyEntries, error: dailyErr } = await supabase
    .from('financial_entries')
    .select('id, type, total_amount, status, start_date, description')
    .eq('driver_id', driver_id)
    .eq('type', 'daily')
    .gte('start_date', currentWeek.startDate)
    .lte('start_date', currentWeek.endDate);
  if (dailyErr) throw new Error(dailyErr.message);

  const verifiedDailies = (dailyEntries || []).filter((row) => verifiedStatuses.includes(String(row.status)));
  const verifiedDailiesTueThu = verifiedDailies.filter((row) => {
    const d = String(row.start_date || '');
    return d === currentWeekPayments.tuesdayDate || d === currentWeekPayments.thursdayDate;
  });
  const daily_total = verifiedDailiesTueThu.reduce((acc, row) => acc + (Number(row.total_amount) || 0), 0);
  const daily_entries = verifiedDailiesTueThu.map((row) => ({
    id: String(row.id),
    start_date: String(row.start_date),
    total_amount: Number(row.total_amount) || 0,
    description: row.description ? String(row.description) : null,
  }));

  const { data: cycleEntries, error: cycleErr } = await supabase
    .from('financial_entries')
    .select('id, type, total_amount, status, start_date')
    .eq('driver_id', driver_id)
    .gte('start_date', cycle.startDate)
    .lte('start_date', cycle.endDate);
  if (cycleErr) throw new Error(cycleErr.message);

  const discounts_breakdown: Record<string, { label: string; amount: number; count: number; last_date: string | null }> = {};
  for (const slug of discountSlugs) {
    const t = typesBySlug.get(slug)!;
    discounts_breakdown[slug] = { label: t.label, amount: 0, count: 0, last_date: null };
  }

  for (const row of cycleEntries || []) {
    if (!verifiedStatuses.includes(String(row.status))) continue;
    const slug = String(row.type || '');
    const bucket = discounts_breakdown[slug];
    if (!bucket) continue;
    const amount = Number(row.total_amount) || 0;
    bucket.amount += amount;
    bucket.count += 1;
    const dt = String(row.start_date || '').slice(0, 10);
    if (!bucket.last_date || dt > String(bucket.last_date)) {
      bucket.last_date = dt || null;
    }
  }

  const discounts_total = Object.values(discounts_breakdown).reduce((acc, row) => acc + row.amount, 0);

  let weekly_revenue = 0;
  try {
    const { data: revenueRows, error: revenueErr } = await supabase
      .from('financial_import_rows')
      .select('gross_amount, created_at')
      .eq('driver_id', driver_id)
      .gte('created_at', cycle.startIso)
      .lte('created_at', cycle.endIso);
    if (revenueErr) {
      const msg = String(revenueErr.message || '').toLowerCase();
      if (!msg.includes('does not exist') && !msg.includes('not found')) {
        throw new Error(revenueErr.message);
      }
    } else {
      weekly_revenue = (revenueRows || []).reduce((acc, row: { gross_amount?: unknown }) => acc + (Number(row.gross_amount) || 0), 0);
    }
  } catch (e) {
    if (e instanceof Error && !String(e.message).includes('does not exist')) throw e;
  }

  const net_estimated = weekly_revenue + daily_total - discounts_total;

  return {
    driver_id,
    current_week: {
      start: currentWeekPayments.tuesdayDate,
      end: currentWeekPayments.thursdayDate,
      daily_total,
      daily_entries,
    },
    cycle: {
      start: cycle.startDate,
      end: cycle.endDate,
      weekly_revenue,
      discounts_total,
      discounts_breakdown,
    },
    net_estimated,
  };
}
