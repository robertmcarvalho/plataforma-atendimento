import { supabase } from './supabase';

export type HolidayPolicy = 'previous_business_day' | 'next_business_day' | 'keep_requires_approval';
export type DriverPaymentReleaseCondition =
  | 'invoice_paid'
  | 'manager_release'
  | 'invoice_paid_or_manager_release'
  | 'none';

export type BillingCostCenterPaymentPolicy = {
  id: string | null;
  invoice_due_weekday: number;
  invoice_due_week_offset: number;
  driver_payment_weekday: number;
  driver_payment_week_offset: number;
  driver_payment_release_condition: DriverPaymentReleaseCondition;
  allow_partial_driver_payment: boolean;
  block_c6_without_invoice_payment: boolean;
  invoice_holiday_policy: HolidayPolicy;
  driver_payment_holiday_policy: HolidayPolicy;
  require_manager_release_reason: boolean;
  default_coverage_daily_billing_treatment: 'charge_pharmacy' | 'absorb_operation' | 'pending_audit';
};

export type ResolvedBillingDate = {
  originalDate: string;
  effectiveDate: string;
  adjusted: boolean;
  reason: string | null;
};

const DEFAULT_POLICY: BillingCostCenterPaymentPolicy = {
  id: null,
  invoice_due_weekday: 3,
  invoice_due_week_offset: 0,
  driver_payment_weekday: 4,
  driver_payment_week_offset: 0,
  driver_payment_release_condition: 'invoice_paid_or_manager_release',
  allow_partial_driver_payment: false,
  block_c6_without_invoice_payment: true,
  invoice_holiday_policy: 'next_business_day',
  driver_payment_holiday_policy: 'previous_business_day',
  require_manager_release_reason: true,
  default_coverage_daily_billing_treatment: 'pending_audit',
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function weekdayDateInPaymentWeek(cycleEndIso: string, weekdayUi: number, weekOffset: number): string {
  const end = new Date(`${cycleEndIso.slice(0, 10)}T12:00:00.000Z`);
  const endJs = end.getUTCDay();
  const mondayAfterClose = new Date(end);
  mondayAfterClose.setUTCDate(end.getUTCDate() + ((8 - endJs) % 7 || 7) + weekOffset * 7);
  const target = new Date(mondayAfterClose);
  target.setUTCDate(mondayAfterClose.getUTCDate() + Math.max(0, Math.min(6, weekdayUi - 1)));
  return isoDate(target);
}

function isWeekend(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00.000Z`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export async function loadBillingHolidays(workspaceId: string, startIso: string, endIso: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('billing_holidays')
    .select('holiday_date')
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .gte('holiday_date', startIso)
    .lte('holiday_date', endIso);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((row) => String(row.holiday_date).slice(0, 10)));
}

function isBusinessDay(iso: string, holidays: Set<string>): boolean {
  return !isWeekend(iso) && !holidays.has(iso);
}

export async function resolveBusinessDate(
  workspaceId: string,
  originalDate: string,
  policy: HolidayPolicy
): Promise<ResolvedBillingDate> {
  if (policy === 'keep_requires_approval') {
    return { originalDate, effectiveDate: originalDate, adjusted: false, reason: null };
  }

  const windowStart = addDays(originalDate, -10);
  const windowEnd = addDays(originalDate, 10);
  const holidays = await loadBillingHolidays(workspaceId, windowStart, windowEnd);
  if (isBusinessDay(originalDate, holidays)) {
    return { originalDate, effectiveDate: originalDate, adjusted: false, reason: null };
  }

  const direction = policy === 'previous_business_day' ? -1 : 1;
  let cursor = originalDate;
  for (let i = 0; i < 14; i += 1) {
    cursor = addDays(cursor, direction);
    if (isBusinessDay(cursor, holidays)) {
      return {
        originalDate,
        effectiveDate: cursor,
        adjusted: true,
        reason: holidays.has(originalDate) ? 'holiday' : 'non_business_day',
      };
    }
  }

  return { originalDate, effectiveDate: originalDate, adjusted: false, reason: 'no_business_day_found' };
}

export function normalizePaymentPolicy(row: Record<string, unknown> | null | undefined): BillingCostCenterPaymentPolicy {
  if (!row) return { ...DEFAULT_POLICY };
  return {
    id: row.id ? String(row.id) : null,
    invoice_due_weekday: Number(row.invoice_due_weekday ?? DEFAULT_POLICY.invoice_due_weekday),
    invoice_due_week_offset: Number(row.invoice_due_week_offset ?? DEFAULT_POLICY.invoice_due_week_offset),
    driver_payment_weekday: Number(row.driver_payment_weekday ?? DEFAULT_POLICY.driver_payment_weekday),
    driver_payment_week_offset: Number(row.driver_payment_week_offset ?? DEFAULT_POLICY.driver_payment_week_offset),
    driver_payment_release_condition:
      (row.driver_payment_release_condition as DriverPaymentReleaseCondition) ||
      DEFAULT_POLICY.driver_payment_release_condition,
    allow_partial_driver_payment: row.allow_partial_driver_payment === true,
    block_c6_without_invoice_payment: row.block_c6_without_invoice_payment !== false,
    invoice_holiday_policy: (row.invoice_holiday_policy as HolidayPolicy) || DEFAULT_POLICY.invoice_holiday_policy,
    driver_payment_holiday_policy:
      (row.driver_payment_holiday_policy as HolidayPolicy) || DEFAULT_POLICY.driver_payment_holiday_policy,
    require_manager_release_reason: row.require_manager_release_reason !== false,
    default_coverage_daily_billing_treatment:
      (row.default_coverage_daily_billing_treatment as BillingCostCenterPaymentPolicy['default_coverage_daily_billing_treatment']) ||
      DEFAULT_POLICY.default_coverage_daily_billing_treatment,
  };
}

export async function resolveCostCenterPolicy(
  workspaceId: string,
  costCenterId: string | null | undefined
): Promise<BillingCostCenterPaymentPolicy> {
  if (!costCenterId) return { ...DEFAULT_POLICY };
  const { data, error } = await supabase
    .from('billing_cost_centers')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', costCenterId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizePaymentPolicy(data as Record<string, unknown> | null);
}

export async function resolveCostCenterDueDates(input: {
  workspaceId: string;
  cycleEndIso: string;
  policy: BillingCostCenterPaymentPolicy;
}): Promise<{ invoice: ResolvedBillingDate; driverPayment: ResolvedBillingDate }> {
  const invoiceOriginal = weekdayDateInPaymentWeek(
    input.cycleEndIso,
    input.policy.invoice_due_weekday,
    input.policy.invoice_due_week_offset
  );
  const driverOriginal = weekdayDateInPaymentWeek(
    input.cycleEndIso,
    input.policy.driver_payment_weekday,
    input.policy.driver_payment_week_offset
  );

  const [invoice, driverPayment] = await Promise.all([
    resolveBusinessDate(input.workspaceId, invoiceOriginal, input.policy.invoice_holiday_policy),
    resolveBusinessDate(input.workspaceId, driverOriginal, input.policy.driver_payment_holiday_policy),
  ]);

  return { invoice, driverPayment };
}
