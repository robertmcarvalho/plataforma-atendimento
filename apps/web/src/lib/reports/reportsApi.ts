import api from '@/lib/api';

export type ReportKpis = {
  tickets: number;
  resolved: number;
  tmr_seconds: number;
  tma_seconds: number;
  tme_seconds: number;
  sla_pct: number;
  csat_avg: number | null;
  fcr_pct: number;
  reopen_pct: number;
  transfer_pct: number;
  messages_inbound: number;
  messages_outbound: number;
};

export type ReportSummary = {
  period_days: number;
  since: string;
  until: string;
  kpis: ReportKpis;
  previous: ReportKpis | null;
  deltas: Record<string, number | null> | null;
  series: Array<{ date: string; whatsapp: number; instagram: number; email: number; total: number }>;
  by_sector: Array<{ name: string; count: number }>;
  by_tag: Array<{ name: string; count: number }>;
  by_channel: Array<{ channel: string; count: number }>;
  heatmap: { grid: number[][]; day_labels: string[]; hour_labels: number[] };
};

export type ReportTicket = {
  id: string;
  contact_name: string;
  status: string;
  channel: string;
  sector: string;
  attendant: string;
  attendant_id?: string | null;
  opened_at: string;
  resolved_at: string | null;
  tmr_seconds: number | null;
  sla_ok: boolean;
  csat: number | null;
  tags: string[];
  demand_key: string | null;
};

export type AttendantReport = {
  attendant: { id: string; name: string };
  total: number;
  resolved: number;
  sla_ok: number;
  avg_resolution_minutes: number | null;
  sla_compliance_rate: number;
};

export type ReportQuery = {
  period?: number;
  compare?: boolean;
  granularity?: 'day' | 'week' | 'month';
  search?: string;
};

function buildParams(q: ReportQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (q.period) params.period = String(q.period);
  if (q.compare) params.compare = '1';
  if (q.granularity) params.granularity = q.granularity;
  if (q.search?.trim()) params.search = q.search.trim();
  return params;
}

export async function fetchReportSummary(q: ReportQuery = {}): Promise<ReportSummary> {
  const { data } = await api.get<ReportSummary>('/api/reports/summary', { params: buildParams(q) });
  return data;
}

export async function fetchReportTickets(q: ReportQuery = {}): Promise<{ items: ReportTicket[]; total: number }> {
  const { data } = await api.get<{ items: ReportTicket[]; total: number }>('/api/reports/tickets', {
    params: buildParams(q),
  });
  return data;
}

export async function fetchAttendantRanking(period = 30): Promise<AttendantReport[]> {
  const { data } = await api.get<AttendantReport[]>('/api/reports/attendants', { params: { period: String(period) } });
  return data;
}

export async function downloadReportCsv(q: ReportQuery = {}): Promise<Blob> {
  const { data } = await api.get<Blob>('/api/reports/export', {
    params: buildParams(q),
    responseType: 'blob',
  });
  return data;
}

export function fmtSec(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}
