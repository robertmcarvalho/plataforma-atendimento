export type DiscountRuleKind =
  | 'exact'
  | 'weekly'
  | 'monthly'
  | 'monthly_weekday'
  | 'immediate'
  | 'apuracao_cycle';

export interface DiscountRule {
  type: string;
  kind: DiscountRuleKind;
  daysOfWeek: number[];
  dayOfMonth: number;
  monthlyNth: number;
  monthlyWeekday: number;
  submissionCutoffHour?: number;
  submissionCutoffDay?: number;
}

export interface WeekBounds {
  startDate: string;
  endDate: string;
}

export interface ApuracaoContext {
  eventDate: string;
  apuracaoStart: string;
  apuracaoEnd: string;
  paymentDate: string;
}

export interface ConferenceEntryLike {
  type: string;
  created_at: string;
  start_date: string;
  event_date?: string | null;
  financial_installments?: Array<{ due_date: string; amount?: number }>;
}

export interface SystemDescriptionContext {
  entryType: string;
  createdAtIso: string;
  paymentDateIso: string;
  timezone?: string;
  apuracao?: ApuracaoContext;
  ruleSummary: string;
  extraLine?: string;
}
