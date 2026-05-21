/** Response from GET /api/financial/summary */
export type FinancialMonthSummary = {
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

export type FinancialWeeklyDailyEntry = {
  id: string;
  start_date: string;
  total_amount: number;
  description: string | null;
};

export type FinancialWeeklyDiscountBucket = {
  label: string;
  amount: number;
  count: number;
  last_date: string | null;
};

/** Response of GET /api/financial/weekly-summary (formato pós-catálogo dinâmico de tipos). */
export type FinancialWeeklySummary = {
  driver_id: string;
  current_week: {
    start: string;
    end: string;
    daily_total: number;
    daily_entries: FinancialWeeklyDailyEntry[];
  };
  cycle: {
    start: string;
    end: string;
    weekly_revenue: number;
    discounts_total: number;
    discounts_breakdown: Record<string, FinancialWeeklyDiscountBucket>;
  };
  net_estimated: number;
};
