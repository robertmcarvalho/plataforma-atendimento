export type ReportMetas = {
  tmr: number;
  tma: number;
  slaPct: number;
  csat: number;
  fcrPct: number;
  reaberturaPct: number;
};

export const DEFAULT_REPORT_METAS: ReportMetas = {
  tmr: 120,
  tma: 1200,
  slaPct: 95,
  csat: 4.5,
  fcrPct: 75,
  reaberturaPct: 10,
};

export type MetaStatus = 'ok' | 'warn' | 'bad';

export function fmtSec(s: number): string {
  if (!s || s < 0) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function statusMeta(valor: number, meta: number, sentido: 'menor' | 'maior'): MetaStatus {
  if (sentido === 'menor') {
    if (valor <= meta) return 'ok';
    if (valor <= meta * 1.15) return 'warn';
    return 'bad';
  }
  if (valor >= meta) return 'ok';
  if (valor >= meta * 0.9) return 'warn';
  return 'bad';
}

export function metaStatusClass(status: MetaStatus): string {
  if (status === 'ok') return 'text-success';
  if (status === 'warn') return 'text-warning';
  return 'text-destructive';
}

export function buildReportQuery(params: Record<string, string | number | boolean | undefined | null | string[]>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) q.set(k, v.join(','));
      continue;
    }
    q.set(k, String(v));
  }
  return q.toString();
}

export async function downloadReportExport(query: string) {
  const api = (await import('@/lib/api')).default;
  const res = await api.get(`/api/reports/export?${query}`, { responseType: 'blob' });
  const blob = res.data as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `relatorio-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
