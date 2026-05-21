export type ReportTargets = {
  tmr: number;
  tma: number;
  slaPct: number;
  csat: number;
  fcrPct: number;
  reaberturaPct: number;
};

export const DEFAULT_REPORT_TARGETS: ReportTargets = {
  tmr: 120,
  tma: 1200,
  slaPct: 95,
  csat: 4.5,
  fcrPct: 75,
  reaberturaPct: 10,
};

export function mergeReportTargets(raw: unknown): ReportTargets {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    tmr: Number(r.tmr) || DEFAULT_REPORT_TARGETS.tmr,
    tma: Number(r.tma) || DEFAULT_REPORT_TARGETS.tma,
    slaPct: Number(r.slaPct) || DEFAULT_REPORT_TARGETS.slaPct,
    csat: Number(r.csat) || DEFAULT_REPORT_TARGETS.csat,
    fcrPct: Number(r.fcrPct) || DEFAULT_REPORT_TARGETS.fcrPct,
    reaberturaPct: Number(r.reaberturaPct) || DEFAULT_REPORT_TARGETS.reaberturaPct,
  };
}
