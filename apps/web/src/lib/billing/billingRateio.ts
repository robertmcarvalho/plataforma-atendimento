import type { BillingCostCenter } from '@/lib/billing/billingApi';

export type RateioLine = {
  cost_center_id: string;
  percent: number;
  amount_cents: number;
};

export function divideEqual(totalCents: number, ccIds: string[]): RateioLine[] {
  if (!ccIds.length || totalCents <= 0) return [];
  const base = Math.floor(totalCents / ccIds.length);
  let remainder = totalCents - base * ccIds.length;
  return ccIds.map((id) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    const amount_cents = base + extra;
    return {
      cost_center_id: id,
      percent: Math.round((amount_cents / totalCents) * 10000) / 100,
      amount_cents,
    };
  });
}

export function recalcFromPercent(lines: RateioLine[], totalCents: number): RateioLine[] {
  if (!lines.length || totalCents <= 0) return lines;
  const amounts = lines.map((l) => Math.round((totalCents * l.percent) / 100));
  const diff = totalCents - amounts.reduce((s, n) => s + n, 0);
  if (diff !== 0 && amounts.length) amounts[amounts.length - 1] += diff;
  return lines.map((l, i) => ({ ...l, amount_cents: amounts[i] ?? 0 }));
}

export function recalcFromAmount(lines: RateioLine[], totalCents: number): RateioLine[] {
  if (!lines.length || totalCents <= 0) return lines;
  return lines.map((l) => ({
    ...l,
    percent: Math.round((l.amount_cents / totalCents) * 10000) / 100,
  }));
}

export function validateRateio(lines: RateioLine[], totalCents: number): { ok: boolean; error?: string } {
  if (!lines.length) return { ok: true };
  const sum = lines.reduce((s, l) => s + l.amount_cents, 0);
  if (sum !== totalCents) {
    return { ok: false, error: `Soma ${(sum / 100).toFixed(2)} ≠ total ${(totalCents / 100).toFixed(2)}` };
  }
  const ids = new Set<string>();
  for (const l of lines) {
    if (!l.cost_center_id) return { ok: false, error: 'Selecione todos os centros de custo' };
    if (ids.has(l.cost_center_id)) return { ok: false, error: 'CC duplicado no rateio' };
    ids.add(l.cost_center_id);
  }
  return { ok: true };
}

export function rateioToAllocation(lines: RateioLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    if (l.cost_center_id && l.amount_cents > 0) out[l.cost_center_id] = l.amount_cents;
  }
  return out;
}

export function allocationToRateio(
  allocation: Record<string, number>,
  totalCents: number,
  costCenters: BillingCostCenter[]
): RateioLine[] {
  const entries = Object.entries(allocation || {}).filter(([, v]) => v > 0);
  if (!entries.length) return [];
  return entries.map(([cost_center_id, amount_cents]) => ({
    cost_center_id,
    amount_cents,
    percent: totalCents > 0 ? Math.round((amount_cents / totalCents) * 10000) / 100 : 0,
  }));
}
