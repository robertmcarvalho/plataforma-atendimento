import type { BillingCycle } from './billingApi';

/** Read cycle from URL; accepts legacy `cycle_id`, prefers `cycle`. */
export function readCycleParam(searchParams: { get: (key: string) => string | null }): string {
  return searchParams.get('cycle') || searchParams.get('cycle_id') || '';
}

/** Write only `cycle`; always drop legacy `cycle_id`. */
export function writeCycleParam(params: URLSearchParams, cycleId: string | null | undefined) {
  params.delete('cycle_id');
  if (cycleId) params.set('cycle', cycleId);
  else params.delete('cycle');
}

/**
 * Replace the query string only when it actually changes.
 * Prevents Chrome "Throttling navigation" loops from redundant router.replace calls.
 */
export function replaceQueryIfChanged(
  router: { replace: (href: string, options?: { scroll?: boolean }) => void },
  pathname: string,
  currentSearch: string,
  nextParams: URLSearchParams
): boolean {
  const next = nextParams.toString();
  if (next === currentSearch) return false;
  router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  return true;
}

/** Most recent open cycle, else first cycle, else empty. */
export function pickDefaultOpenCycleId(cycles: BillingCycle[]): string {
  const open = cycles
    .filter((c) => c.status === 'open')
    .sort((a, b) => String(b.apuracao_end).localeCompare(String(a.apuracao_end)));
  if (open[0]) return open[0].id;
  const sorted = [...cycles].sort((a, b) => String(b.apuracao_end).localeCompare(String(a.apuracao_end)));
  return sorted[0]?.id || '';
}
