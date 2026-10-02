import { dailyDriverReferenceCents, type DailyPayTrack } from '@plataforma/billing-engine';

export const PAYSLIP_TRACKS = ['weekly', 'daily'] as const;
export type PayslipTrack = (typeof PAYSLIP_TRACKS)[number];

export const DEFAULT_PAYSLIP_TEMPLATE_NAME = 'flux_holerite_pagamento';
export const DEFAULT_PAYSLIP_TEMPLATE_LANGUAGE = 'pt_BR';
export const PAYSLIP_TEMPLATE_SETTING_KEY = 'billing_payslip_whatsapp_template';
export const PAYSLIP_SUPPORT_PHONE_SETTING_KEY = 'billing_payslip_support_phone';

export const DISCOUNT_KINDS_ONCE = new Set(['quota', 'advance', 'uniform', 'bag', 'digital_cert']);

export const DISCOUNT_LABELS: Record<string, string> = {
  quota: 'Cota cooperativa',
  advance: 'Adiantamento',
  uniform: 'Uniforme',
  bag: 'Bag',
  digital_cert: 'Certificado digital',
};

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'segunda',
  2: 'terça',
  3: 'quarta',
  4: 'quinta',
  5: 'sexta',
  6: 'sábado',
  7: 'domingo',
};

export type PayslipLineLike = {
  kind?: string | null;
  description?: string | null;
  driver_amount_cents?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type DriverPayslipPharmacy = {
  id: string;
  name: string;
  mg_mode: string | null;
  earnings: {
    kind: 'minimum_guarantee' | 'deliveries' | 'other';
    description: string;
    amount_cents: number;
    delivery_count: number | null;
    active_days: number | null;
    total_days: number | null;
  } | null;
  absences: { description: string; amount_cents: number }[];
  dailies: {
    description: string;
    amount_cents: number;
    event_date: string | null;
    /** `thursday_settlement` sai no PIX de quinta; `financial_daily` sai no PIX de terça. */
    pay_track: DailyPayTrack;
  }[];
  subtotal_cents: number;
};

export type DriverPayslipCostCenter = {
  id: string | null;
  name: string;
  apuracao_start: string;
  apuracao_end: string;
  cycle_closes_weekday: number | null;
  boleto_due_date: string | null;
  driver_payment_date: string | null;
  invoice_due_week_offset: number;
  driver_payment_week_offset: number;
  schedule_note: string;
  pharmacies: DriverPayslipPharmacy[];
};

export type DriverPayslipRecentWeek = {
  label: string;
  amount_cents: number;
  is_current: boolean;
};

export type DriverPayslip = {
  payable_id: string;
  track: PayslipTrack;
  driver: {
    id: string;
    name: string;
    cpf_masked: string;
    phone: string | null;
    pix_key: string | null;
    pix_key_type: string | null;
  };
  cycle: {
    id: string;
    label: string | null;
    apuracao_start: string;
    apuracao_end: string;
  };
  pix: {
    payment_date: string | null;
    amount_cents: number;
    method: string;
  };
  totals: {
    cycle_total_cents: number;
    /** Diárias da trilha Diárias (PIX terça), fora de `thursday_pix_cents`. */
    dailies_cents: number;
    dailies_paid_cents: number;
    /** Diária-base de escala, já dentro de `thursday_pix_cents`. */
    weekly_dailies_cents: number;
    thursday_pix_cents: number;
    absences_cents: number;
    discounts_cents: number;
    earnings_cents: number;
  };
  cost_centers: DriverPayslipCostCenter[];
  discounts: { kind: string; label: string; description: string; amount_cents: number }[];
  dailies: {
    description: string;
    amount_cents: number;
    payment_date: string | null;
    pharmacy_name: string | null;
    paid: boolean;
  }[];
  recent_weeks: DriverPayslipRecentWeek[];
  send: {
    can_send: boolean;
    phone: string | null;
    last_sent_at: string | null;
    expires_at: string | null;
    public_url: string | null;
    revoked: boolean;
  };
  support_phone: string | null;
};

export function compactPayslipWeekLabel(label: string | null | undefined, endIso: string | null | undefined): string {
  if (label) return label.replace(/^ATIVMOB\s*/i, '').replace(/\s+/g, ' ').trim();
  if (!endIso) return 'Atual';
  const raw = String(endIso).slice(0, 10);
  const [, month, day] = raw.split('-');
  return day && month ? `${day}/${month}` : raw;
}

export function metaObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function payslipTtlDays(): number {
  const n = Number(process.env.BILLING_PAYSLIP_TTL_DAYS || 7);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

export function resolvePayslipTemplateName(settingValue?: unknown): string {
  const fromEnv = String(process.env.BILLING_PAYSLIP_WHATSAPP_TEMPLATE_NAME || '').trim();
  if (fromEnv) return fromEnv;
  if (typeof settingValue === 'string' && settingValue.trim()) return settingValue.trim();
  if (settingValue && typeof settingValue === 'object' && 'name' in settingValue) {
    const name = String((settingValue as { name?: unknown }).name || '').trim();
    if (name) return name;
  }
  return DEFAULT_PAYSLIP_TEMPLATE_NAME;
}

export function resolvePayslipTemplateLanguage(settingValue?: unknown): string {
  const fromEnv = String(process.env.BILLING_PAYSLIP_WHATSAPP_TEMPLATE_LANGUAGE || '').trim();
  if (fromEnv) return fromEnv;
  if (settingValue && typeof settingValue === 'object' && 'language' in settingValue) {
    const language = String((settingValue as { language?: unknown }).language || '').trim();
    if (language) return language;
  }
  return DEFAULT_PAYSLIP_TEMPLATE_LANGUAGE;
}

export function resolvePayslipSupportPhone(settingValue?: unknown): string | null {
  if (typeof settingValue === 'string') {
    const phone = settingValue.trim();
    return phone || null;
  }
  if (settingValue && typeof settingValue === 'object' && 'phone' in settingValue) {
    const phone = String((settingValue as { phone?: unknown }).phone || '').trim();
    return phone || null;
  }
  return null;
}

export function formatIsoDateBr(iso: string | null | undefined): string {
  const s = String(iso || '').slice(0, 10);
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}/${m}/${y}` : s;
}

export function formatBrlCents(cents: number): string {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function maskCpf(cpf: string | null | undefined): string {
  const digits = String(cpf || '').replace(/\D/g, '');
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length >= 4) return `***${digits.slice(-2)}`;
  return '***';
}

export function weekdayLabel(weekdayUi: number | null | undefined): string {
  return WEEKDAY_LABELS[Number(weekdayUi)] || '—';
}

export function weekOffsetLabel(offset: number): string {
  if (offset <= 0) return 'mesma semana após o fechamento';
  if (offset === 1) return 'semana seguinte';
  return `${offset} semanas depois`;
}

export function addIsoDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Cópia pura de `weekdayDateInPaymentWeek` (sem I/O) para datas do holerite/testes. */
export function payslipWeekdayDate(cycleEndIso: string, weekdayUi: number, weekOffset: number): string {
  const end = new Date(`${cycleEndIso.slice(0, 10)}T12:00:00.000Z`);
  const endJs = end.getUTCDay();
  const mondayAfterClose = new Date(end);
  mondayAfterClose.setUTCDate(end.getUTCDate() + ((8 - endJs) % 7 || 7) + weekOffset * 7);
  const target = new Date(mondayAfterClose);
  target.setUTCDate(mondayAfterClose.getUTCDate() + Math.max(0, Math.min(6, weekdayUi - 1)));
  return target.toISOString().slice(0, 10);
}

export function dailyCentsFromSettlementLine(line: PayslipLineLike): number {
  return dailyDriverReferenceCents(line);
}

export function computePayslipTotals(input: {
  thursdayPixCents: number;
  dailiesCents: number;
  dailiesPaidCents?: number;
}): { cycleTotalCents: number; thursdayPixCents: number; dailiesCents: number; dailiesPaidCents: number } {
  const dailiesCents = Math.max(0, Math.round(input.dailiesCents || 0));
  const thursdayPixCents = Math.max(0, Math.round(input.thursdayPixCents || 0));
  const dailiesPaidCents = Math.max(0, Math.round(input.dailiesPaidCents ?? dailiesCents));
  return {
    cycleTotalCents: thursdayPixCents + dailiesCents,
    thursdayPixCents,
    dailiesCents,
    dailiesPaidCents,
  };
}

export function isDriverPayslipPayable(row: { beneficiary_type?: string | null; origin_type?: string | null }): boolean {
  if (String(row.beneficiary_type || '') !== 'driver') return false;
  const origin = String(row.origin_type || '');
  return origin === 'cycle_settlement' || origin === 'financial_daily' || origin === '';
}

export function payslipTrackFromPayable(originType: string | null | undefined): PayslipTrack {
  return String(originType || '') === 'financial_daily' ? 'daily' : 'weekly';
}

export function payableNetAmount(row: { net_amount_cents?: number | null; amount_cents?: number | null }): number {
  return Math.max(0, Number(row.net_amount_cents ?? row.amount_cents ?? 0));
}

export function isFinancialDailyPayable(row: { origin_type?: string | null; metadata?: unknown }): boolean {
  if (String(row.origin_type || '') === 'financial_daily') return true;
  const meta = metaObject(row.metadata);
  return meta.payment_kind === 'daily';
}

export function costCenterScheduleNote(policy: {
  cycle_closes_weekday?: number | null;
  invoice_due_weekday: number;
  invoice_due_week_offset: number;
  driver_payment_weekday: number;
  driver_payment_week_offset: number;
}): string {
  const close = weekdayLabel(policy.cycle_closes_weekday ?? 7);
  const boleto = weekdayLabel(policy.invoice_due_weekday);
  const pix = weekdayLabel(policy.driver_payment_weekday);
  return `Fecha ${close} · boleto ${boleto} (${weekOffsetLabel(policy.invoice_due_week_offset)}) · PIX ${pix} (${weekOffsetLabel(policy.driver_payment_week_offset)})`;
}

export function buildPayslipTemplateParameters(
  payslip: Pick<DriverPayslip, 'pix' | 'totals'>,
  publicUrl: string
): string[] {
  return [
    formatIsoDateBr(payslip.pix.payment_date),
    formatBrlCents(payslip.totals.cycle_total_cents),
    formatBrlCents(payslip.totals.dailies_cents),
    formatBrlCents(payslip.pix.amount_cents),
    publicUrl,
  ];
}
