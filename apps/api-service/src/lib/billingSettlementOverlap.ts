/** Vigência operacional do vínculo no ciclo de faturamento (MG proporcional). */

export function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export function daysInclusive(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T12:00:00.000Z`);
  const end = new Date(`${endIso}T12:00:00.000Z`);
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.max(0, diff);
}

export function overlapDays(
  cycleStart: string,
  cycleEnd: string,
  rangeStart: string | null,
  rangeEnd: string | null
): number {
  const effectiveStart = rangeStart && rangeStart > cycleStart ? rangeStart : cycleStart;
  const effectiveEnd = rangeEnd && rangeEnd < cycleEnd ? rangeEnd : cycleEnd;
  if (effectiveEnd < effectiveStart) return 0;
  return daysInclusive(effectiveStart, effectiveEnd);
}

export function minDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * Último dia vigente no ciclo.
 * 1) last_worked_at do desligamento (solicitação/aprovação)
 * 2) senão ended_at do vínculo
 * 3) senão fim do ciclo
 * inactive_at só corta (nunca zera dias já trabalhados).
 *
 * last_worked_at anterior ao started_at do vínculo é de emprego anterior — ignora.
 */
export function resolveOperationalLastDay(input: {
  cycleEnd: string;
  startedAt?: string | null;
  lastWorkedAt?: string | null;
  endedAt?: string | null;
  inactiveAt?: string | null;
}): string {
  const cycleEnd = dateOnly(input.cycleEnd) || input.cycleEnd.slice(0, 10);
  const startedAt = dateOnly(input.startedAt);
  let lastWorkedAt = dateOnly(input.lastWorkedAt);
  if (lastWorkedAt && startedAt && lastWorkedAt < startedAt) lastWorkedAt = null;
  const endedAt = dateOnly(input.endedAt);
  const inactiveAt = dateOnly(input.inactiveAt);
  let lastDay = lastWorkedAt || endedAt || cycleEnd;
  if (inactiveAt && inactiveAt < lastDay) lastDay = inactiveAt;
  return lastDay;
}

export function computeLinkActiveDays(input: {
  cycleStart: string;
  cycleEnd: string;
  startedAt?: string | null;
  lastWorkedAt?: string | null;
  endedAt?: string | null;
  inactiveAt?: string | null;
}): { activeDays: number; lastDay: string; startedAt: string | null } {
  const cycleStart = dateOnly(input.cycleStart) || input.cycleStart.slice(0, 10);
  const cycleEnd = dateOnly(input.cycleEnd) || input.cycleEnd.slice(0, 10);
  const startedAt = dateOnly(input.startedAt);
  const lastDay = resolveOperationalLastDay({
    cycleEnd,
    startedAt,
    lastWorkedAt: input.lastWorkedAt,
    endedAt: input.endedAt,
    inactiveAt: input.inactiveAt,
  });
  return {
    activeDays: overlapDays(cycleStart, cycleEnd, startedAt, lastDay),
    lastDay,
    startedAt,
  };
}

export function prorateCents(amount: number, activeDays: number, totalDays: number): number {
  if (amount <= 0 || totalDays <= 0 || activeDays >= totalDays) return amount;
  if (activeDays <= 0) return 0;
  return Math.round((amount * activeDays) / totalDays);
}

export type MgRange = {
  driverId: string;
  startedAt: string | null;
  lastDay: string;
  activeDays: number;
};

/** Soma dos dias de MG dos fixos — lacuna (soma < ciclo) é regra, não erro. */
export function sumMgActiveDays(ranges: Pick<MgRange, 'activeDays'>[]): number {
  return ranges.reduce((sum, row) => sum + row.activeDays, 0);
}

export function rangesOverlapInclusive(
  aStart: string | null,
  aEnd: string,
  bStart: string | null,
  bEnd: string,
  cycleStart: string
): boolean {
  const startA = aStart && aStart > cycleStart ? aStart : cycleStart;
  const startB = bStart && bStart > cycleStart ? bStart : cycleStart;
  return startA <= bEnd && startB <= aEnd;
}

/** Risco de 2× MG no mesmo dia: dois fixos com vigência sobreposta. */
export function findSameDayMgOverlaps(
  ranges: MgRange[],
  cycleStart: string
): Array<{ driverIdA: string; driverIdB: string }> {
  const hits: Array<{ driverIdA: string; driverIdB: string }> = [];
  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      const a = ranges[i]!;
      const b = ranges[j]!;
      if (rangesOverlapInclusive(a.startedAt, a.lastDay, b.startedAt, b.lastDay, cycleStart)) {
        hits.push({ driverIdA: a.driverId, driverIdB: b.driverId });
      }
    }
  }
  return hits;
}

export function pickLatestLastWorkedAt(
  candidates: Array<{ lastWorkedAt: string | null | undefined; createdAt?: string | null; preferred?: boolean }>
): string | null {
  const dated = candidates
    .map((row) => ({
      lastWorkedAt: dateOnly(row.lastWorkedAt),
      createdAt: row.createdAt || '',
      preferred: Boolean(row.preferred),
    }))
    .filter((row) => Boolean(row.lastWorkedAt));
  if (!dated.length) return null;
  dated.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
  return dated[0]!.lastWorkedAt;
}

export const TERMINATION_TASK_TYPES = [
  'driver_termination_request',
  'driver_termination_prep',
  'driver_termination_financial_review',
] as const;
