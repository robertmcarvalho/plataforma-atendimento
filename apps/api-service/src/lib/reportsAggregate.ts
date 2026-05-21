export type ReportRange = {
  since: string;
  until: string;
  prevSince: string;
  prevUntil: string;
  periodDays: number;
};

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

export type ConvReportRow = {
  id: string;
  status: string;
  opened_at: string;
  resolved_at: string | null;
  sla_first_response_at: string | null;
  sla_first_response_ok: boolean | null;
  sla_resolved_ok: boolean | null;
  ai_nps_predicted: number | null;
  tags: string[] | null;
  attendant_id: string | null;
  sector_id: string | null;
  demand_key?: string | null;
};

export function parseReportRange(query: Record<string, string | undefined>): ReportRange {
  const now = new Date();
  let start: Date;
  let end = new Date(now);

  if (query.start_date && query.end_date) {
    start = new Date(query.start_date);
    end = new Date(query.end_date);
  } else {
    const periodDays = Math.min(Math.max(Number(query.period) || 30, 1), 90);
    start = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
    return buildRange(start, end, periodDays);
  }

  const periodDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
  return buildRange(start, end, periodDays);
}

function buildRange(start: Date, end: Date, periodDays: number): ReportRange {
  const ms = Math.max(end.getTime() - start.getTime(), 60_000);
  const prevEnd = new Date(start.getTime());
  const prevStart = new Date(start.getTime() - ms);
  return {
    since: start.toISOString(),
    until: end.toISOString(),
    prevSince: prevStart.toISOString(),
    prevUntil: prevEnd.toISOString(),
    periodDays,
  };
}

export function aggregateConversations(rows: ConvReportRow[]): ReportKpis {
  const n = rows.length;
  if (!n) {
    return {
      tickets: 0,
      resolved: 0,
      tmr_seconds: 0,
      tma_seconds: 0,
      tme_seconds: 0,
      sla_pct: 0,
      csat_avg: null,
      fcr_pct: 0,
      reopen_pct: 0,
      transfer_pct: 0,
      messages_inbound: 0,
      messages_outbound: 0,
    };
  }

  let tmrSum = 0;
  let tmrCount = 0;
  let tmaSum = 0;
  let tmaCount = 0;
  let slaOk = 0;
  let csatSum = 0;
  let csatCount = 0;
  let resolved = 0;
  let reopen = 0;
  let fcr = 0;

  for (const row of rows) {
    if (row.status === 'resolved' || row.status === 'closed') resolved++;
    if (row.tags?.some((t) => String(t).toLowerCase().includes('reabert'))) reopen++;

    if (row.sla_first_response_at && row.opened_at) {
      const sec = (new Date(row.sla_first_response_at).getTime() - new Date(row.opened_at).getTime()) / 1000;
      if (sec >= 0) {
        tmrSum += sec;
        tmrCount++;
      }
    }

    if (row.resolved_at && row.opened_at) {
      const sec = (new Date(row.resolved_at).getTime() - new Date(row.opened_at).getTime()) / 1000;
      if (sec >= 0) {
        tmaSum += sec;
        tmaCount++;
        if (row.sla_resolved_ok) fcr++;
      }
    }

    if (row.sla_resolved_ok || row.sla_first_response_ok) slaOk++;
    if (row.ai_nps_predicted != null && Number.isFinite(Number(row.ai_nps_predicted))) {
      csatSum += Number(row.ai_nps_predicted);
      csatCount++;
    }
  }

  return {
    tickets: n,
    resolved,
    tmr_seconds: tmrCount ? Math.round(tmrSum / tmrCount) : 0,
    tma_seconds: tmaCount ? Math.round(tmaSum / tmaCount) : 0,
    tme_seconds: tmrCount ? Math.round(tmrSum / tmrCount) : 0,
    sla_pct: Math.round((slaOk / n) * 100),
    csat_avg: csatCount ? Number((csatSum / csatCount).toFixed(2)) : null,
    fcr_pct: tmaCount ? Math.round((fcr / tmaCount) * 100) : 0,
    reopen_pct: Math.round((reopen / n) * 100),
    transfer_pct: 0,
    messages_inbound: 0,
    messages_outbound: 0,
  };
}

type SeriesRow = ConvReportRow & {
  contacts?: { profile_type?: string } | { profile_type?: string }[] | null;
};

export function bucketTimeSeries(
  rows: SeriesRow[],
  granularity: 'day' | 'week' | 'month'
): Array<{ date: string; whatsapp: number; instagram: number; email: number; total: number }> {
  const buckets = new Map<string, { date: string; whatsapp: number; instagram: number; email: number; total: number }>();

  const fmt = (d: Date) => {
    if (granularity === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (granularity === 'week') {
      const onejan = new Date(d.getFullYear(), 0, 1);
      const w = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
      return `${d.getFullYear()}-S${w}`;
    }
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  for (const row of rows) {
    const k = fmt(new Date(row.opened_at));
    const b = buckets.get(k) || { date: k, whatsapp: 0, instagram: 0, email: 0, total: 0 };
    const contact = unwrapRelation(row.contacts);
    const ch = String(contact?.profile_type || 'whatsapp').toLowerCase();
    if (ch === 'instagram') b.instagram++;
    else if (ch === 'email') b.email++;
    else b.whatsapp++;
    b.total++;
    buckets.set(k, b);
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function deltaPct(curr: number, prev: number): number {
  if (!prev) return curr ? 100 : 0;
  return Number((((curr - prev) / prev) * 100).toFixed(1));
}

export function unwrapRelation<T>(val: T | T[] | null | undefined): T | null {
  if (val == null) return null;
  return Array.isArray(val) ? val[0] ?? null : val;
}
