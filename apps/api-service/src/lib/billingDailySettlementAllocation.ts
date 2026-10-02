export type DailySettlementAllocationLine = {
  kind: string;
  description: string | null;
  pharmacy_amount_cents: number;
  driver_amount_cents: number;
  metadata?: Record<string, unknown>;
};

/** Rateio por grupo de diárias: discriminação DRE/relatório, sem acerto semanal. */
export const DRE_ONLY_DAILY_ALLOCATION_RULE = 'equal_daily_share_group' as const;

export function isDreOnlyDailyAllocationRule(rule: string | null | undefined): boolean {
  return rule === DRE_ONLY_DAILY_ALLOCATION_RULE;
}

function pairKey(driverId: string, pharmacyId: string): string {
  return `${driverId}:${pharmacyId}`;
}

export function registerDailySettlementAllocation(input: {
  driverId: string;
  pharmacyId: string;
  line: DailySettlementAllocationLine;
  dailyAllocationsByPair: Map<string, DailySettlementAllocationLine[]>;
  pairCounts: Map<string, number>;
  dreOnlyDailyAllocationsByPair?: Map<string, DailySettlementAllocationLine[]>;
}): void {
  const { driverId, pharmacyId, line, dailyAllocationsByPair, pairCounts, dreOnlyDailyAllocationsByPair } = input;
  const key = pairKey(driverId, pharmacyId);

  if (isDreOnlyDailyAllocationRule(String(line.metadata?.allocation_rule || ''))) {
    if (dreOnlyDailyAllocationsByPair) {
      const existing = dreOnlyDailyAllocationsByPair.get(key) || [];
      dreOnlyDailyAllocationsByPair.set(key, [...existing, line]);
    }
    return;
  }

  const lines = dailyAllocationsByPair.get(key) || [];
  lines.push(line);
  dailyAllocationsByPair.set(key, lines);
  if (!pairCounts.has(key)) pairCounts.set(key, 0);
}
