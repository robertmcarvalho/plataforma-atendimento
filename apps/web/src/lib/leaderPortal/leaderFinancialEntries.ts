export type LeaderEntryStatus =
  | 'pending_approval'
  | 'approved_pending_payment'
  | 'overdue'
  | 'paid'
  | 'rejected'
  | 'cancelled'
  | 'informed';

export type LeaderFinancialEntry = {
  id: string;
  type: string;
  occurrence_kind: string | null;
  event_date: string | null;
  amount: number;
  created_at: string;
  payment_date: string | null;
  leader_status: LeaderEntryStatus;
  leader_status_label: string;
  cancel_reason: string | null;
  rejection_reason: string | null;
  coverage_of_entry_id: string | null;
  linked_entry_id?: string | null;
  driver: { id: string; name: string } | null;
  pharmacy: { id: string; trade_name: string } | null;
  can_cancel: boolean;
};

export type LeaderAuditTimelineItem = {
  at: string;
  label: string;
  detail?: string | null;
};

export type LeaderFinancialEntryDetail = LeaderFinancialEntry & {
  notes: string | null;
  description: string | null;
  shift: string | null;
  installments: Array<{
    id: string;
    installment_number: number;
    due_date: string;
    amount: number;
    status: string;
    paid_at: string | null;
  }>;
  coverage_of_entry: {
    id: string;
    type: string;
    occurrence_kind: string | null;
    event_date: string | null;
    status: string;
    notes: string | null;
    driver: { id: string; name: string } | null;
  } | null;
  linked_daily_entries: Array<{
    id: string;
    status: string;
    amount: number;
    driver: { id: string; name: string } | null;
  }>;
  audit_timeline: LeaderAuditTimelineItem[];
};

export type LeaderFinancialListParams = {
  page?: number;
  limit?: number;
  status_group?: 'open' | 'all' | 'done' | 'cancelled';
  occurrence_type?: 'all' | 'contracted_daily' | 'coverage_daily' | 'unexcused' | 'day_off';
  date_field?: 'event' | 'created';
  date_from?: string;
  date_to?: string;
  pharmacy_id?: string;
  driver_id?: string;
};

export type LeaderFinancialListResult = {
  entries: LeaderFinancialEntry[];
  total: number;
  page: number;
  limit: number;
};

export function leaderOccurrenceTypeLabel(
  entry: Pick<LeaderFinancialEntry, 'type' | 'occurrence_kind' | 'coverage_of_entry_id'>,
) {
  if (entry.type === 'daily') {
    if (entry.occurrence_kind === 'contracted_daily') return 'Diária contratada';
    if (entry.coverage_of_entry_id) return 'Diária de cobertura';
    return 'Diária';
  }
  if (entry.occurrence_kind === 'day_off') return 'Folga';
  if (entry.occurrence_kind === 'unexcused') return 'Falta';
  return entry.type;
}

export function leaderStatusTone(status: string): string {
  switch (status) {
    case 'pending_approval':
      return 'bg-warning/15 text-warning';
    case 'approved_pending_payment':
    case 'overdue':
      return 'bg-primary/15 text-primary';
    case 'paid':
      return 'bg-success/15 text-success';
    case 'rejected':
    case 'cancelled':
      return 'bg-destructive/15 text-destructive';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export function formatLeaderAuditItem(item: LeaderAuditTimelineItem): string {
  const date = new Date(item.at);
  const dateStr = Number.isNaN(date.getTime())
    ? item.at
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  if (item.detail) return `${item.label} em ${dateStr} — motivo: ${item.detail}`;
  return `${item.label} em ${dateStr}`;
}
