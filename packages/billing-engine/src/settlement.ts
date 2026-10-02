import type {
  AbsenceMgDiscountInput,
  DeliverySettlementInput,
  DeliverySettlementResult,
  MgPoolSplitRule,
  SharedPoolDriverAllocation,
  SharedPoolSettlementInput,
  SharedPoolSettlementResult,
  SplitPercentages,
  SplitResolveInput,
} from './types';

const DEFAULT_ABSENCE_DIVISOR = 6;

/** Limiar de entregas para aplicar MG (override explícito ou derivado do repasse). */
export function computeMinimumDeliveryThreshold(input: {
  minimumDeliveriesCount?: number | null;
  minimumGuaranteedDriverPayoutCents: number;
  deliveryFeeDriverPayoutCents: number;
}): number {
  if (input.minimumDeliveriesCount != null && input.minimumDeliveriesCount >= 0) {
    return input.minimumDeliveriesCount;
  }
  const fee = input.deliveryFeeDriverPayoutCents;
  if (fee <= 0) return 0;
  return Math.floor(input.minimumGuaranteedDriverPayoutCents / fee);
}

/** Base de cobrança farmácia × repasse entregador (MG vs por entrega). */
export function computeDeliverySettlement(input: DeliverySettlementInput): DeliverySettlementResult {
  const threshold = computeMinimumDeliveryThreshold(input);
  const count = Math.max(0, Math.floor(input.deliveryCount));

  if (input.mgEnabled && count <= threshold) {
    return {
      pharmacyChargeCents: input.minimumGuaranteedCents,
      driverPayoutCents: input.minimumGuaranteedDriverPayoutCents,
      appliedMinimumGuarantee: true,
      minimumDeliveryThreshold: threshold,
    };
  }

  return {
    pharmacyChargeCents: count * input.deliveryFeeCents,
    driverPayoutCents: count * input.deliveryFeeDriverPayoutCents,
    appliedMinimumGuarantee: false,
    minimumDeliveryThreshold: threshold,
  };
}

type PoolDriver = {
  driverId: string;
  deliveryCount: number;
  activeDays: number;
};

/** Rateio por dias vigentes — mesma regra do MG per_driver (prorateCents). */
function prorateByActiveDays(amountCents: number, activeDays: number, totalDays: number): number {
  if (amountCents <= 0 || totalDays <= 0 || activeDays >= totalDays) return amountCents;
  if (activeDays <= 0) return 0;
  return Math.round((amountCents * activeDays) / totalDays);
}

function poolWeights(
  active: PoolDriver[],
  splitRule: MgPoolSplitRule,
  dayWeighted: boolean
): Array<{ driverId: string; weight: number }> {
  if (splitRule === 'by_deliveries') {
    // Entregas já refletem os dias em que o entregador esteve vigente.
    return active.map((d) => ({ driverId: d.driverId, weight: d.deliveryCount }));
  }
  if (dayWeighted) {
    const byDays = active.map((d) => ({ driverId: d.driverId, weight: d.activeDays }));
    if (byDays.some((w) => w.weight > 0)) return byDays;
  }
  return active.map((d) => ({ driverId: d.driverId, weight: 1 }));
}

function allocatePoolCents(
  totalCents: number,
  driverCounts: PoolDriver[],
  splitRule: MgPoolSplitRule,
  dayWeighted: boolean
): SharedPoolDriverAllocation[] {
  const active = driverCounts.filter((d) => d.deliveryCount > 0);
  const weights = poolWeights(active, splitRule, dayWeighted).filter((w) => w.weight > 0);
  if (!weights.length || totalCents <= 0) {
    return driverCounts.map((d) => ({
      driverId: d.driverId,
      deliveryCount: d.deliveryCount,
      pharmacyChargeCents: 0,
      driverPayoutCents: 0,
    }));
  }

  const weightSum = weights.reduce((a, w) => a + w.weight, 0);
  let allocated = 0;
  const payouts = new Map<string, number>();

  weights.forEach((w, index) => {
    const isLast = index === weights.length - 1;
    const share = isLast ? totalCents - allocated : Math.round((totalCents * w.weight) / weightSum);
    allocated += share;
    payouts.set(w.driverId, share);
  });

  return driverCounts.map((d) => ({
    driverId: d.driverId,
    deliveryCount: d.deliveryCount,
    pharmacyChargeCents: payouts.get(d.driverId) ?? 0,
    driverPayoutCents: payouts.get(d.driverId) ?? 0,
  }));
}

/**
 * MG compartilhado: no máximo 1× cobrança farmácia no ciclo; repasse rateado entre entregadores.
 *
 * Com `totalCycleDays` informado, entrada/saída no meio do ciclo entra na conta:
 * - o pool cai para a fração coberta pelos fixos (Σ dias vigentes ÷ dias do ciclo, teto 1×);
 * - no rateio `equal` o peso passa a ser os dias vigentes de cada um (em `by_deliveries`
 *   as entregas já carregam essa proporção).
 * Cobertura completa mantém o comportamento de pool cheio dividido igualmente.
 */
export function computeSharedPoolDeliverySettlement(
  input: SharedPoolSettlementInput
): SharedPoolSettlementResult {
  const driverCounts: PoolDriver[] = input.driverCounts.map((d) => ({
    driverId: d.driverId,
    deliveryCount: Math.max(0, Math.floor(d.deliveryCount)),
    activeDays: Math.max(0, Math.floor(d.activeDays ?? 0)),
  }));
  const totalCount = driverCounts.reduce((a, d) => a + d.deliveryCount, 0);
  const splitRule = input.splitRule ?? 'by_deliveries';
  const poolTotalCycleDays = Math.max(0, Math.floor(input.totalCycleDays ?? 0));
  const poolActiveDays = driverCounts.reduce((a, d) => a + d.activeDays, 0);
  const dayWeighted = poolTotalCycleDays > 0 && poolActiveDays > 0;

  const poolBase = computeDeliverySettlement({ ...input, deliveryCount: totalCount });

  if (!poolBase.appliedMinimumGuarantee) {
    const perDriver = driverCounts.map((d) => ({
      driverId: d.driverId,
      deliveryCount: d.deliveryCount,
      pharmacyChargeCents: d.deliveryCount * input.deliveryFeeCents,
      driverPayoutCents: d.deliveryCount * input.deliveryFeeDriverPayoutCents,
    }));
    return {
      ...poolBase,
      pharmacyChargeCents: poolBase.pharmacyChargeCents,
      totalDriverPayoutCents: perDriver.reduce((a, d) => a + d.driverPayoutCents, 0),
      perDriver,
      poolActiveDays,
      poolTotalCycleDays,
      poolProrated: false,
    };
  }

  const poolPharmacyChargeCents = dayWeighted
    ? prorateByActiveDays(poolBase.pharmacyChargeCents, poolActiveDays, poolTotalCycleDays)
    : poolBase.pharmacyChargeCents;
  const poolDriverPayoutCents = dayWeighted
    ? prorateByActiveDays(poolBase.driverPayoutCents, poolActiveDays, poolTotalCycleDays)
    : poolBase.driverPayoutCents;

  const pharmacyAlloc = allocatePoolCents(poolPharmacyChargeCents, driverCounts, splitRule, dayWeighted);
  const driverAlloc = allocatePoolCents(poolDriverPayoutCents, driverCounts, splitRule, dayWeighted);

  const perDriver = driverCounts.map((d) => {
    const ph = pharmacyAlloc.find((x) => x.driverId === d.driverId);
    const dr = driverAlloc.find((x) => x.driverId === d.driverId);
    return {
      driverId: d.driverId,
      deliveryCount: d.deliveryCount,
      pharmacyChargeCents: ph?.pharmacyChargeCents ?? 0,
      driverPayoutCents: dr?.driverPayoutCents ?? 0,
    };
  });

  return {
    ...poolBase,
    pharmacyChargeCents: poolPharmacyChargeCents,
    driverPayoutCents: poolDriverPayoutCents,
    totalDriverPayoutCents: poolDriverPayoutCents,
    perDriver,
    poolActiveDays,
    poolTotalCycleDays,
    poolProrated: dayWeighted && poolActiveDays < poolTotalCycleDays,
  };
}

/** Desconto MG÷6 por falta sem diarista (lado farmácia e entregador). */
export function computeAbsenceMgDiscount(input: AbsenceMgDiscountInput): {
  pharmacyDiscountCents: number;
  driverDiscountCents: number;
} {
  const divisor = input.divisor ?? DEFAULT_ABSENCE_DIVISOR;
  if (divisor <= 0) {
    return { pharmacyDiscountCents: 0, driverDiscountCents: 0 };
  }
  return {
    pharmacyDiscountCents: Math.round(input.minimumGuaranteedCents / divisor),
    driverDiscountCents: Math.round(input.minimumGuaranteedDriverPayoutCents / divisor),
  };
}

/** Split Coop × Flux conforme escopo de contrato e percentuais efetivos. */
export function resolveSplitPercentages(input: SplitResolveInput): SplitPercentages {
  if (input.contractScope === 'coop_only') {
    return { coopPct: 100, fluxPct: 0 };
  }
  if (input.contractScope === 'flux_only') {
    return { coopPct: 0, fluxPct: 100 };
  }

  const fromPharmacy =
    input.pharmacySplitCoopPct != null && input.pharmacySplitFluxPct != null
      ? { coopPct: input.pharmacySplitCoopPct, fluxPct: input.pharmacySplitFluxPct }
      : null;
  const fromCc =
    input.costCenterSplitCoopPct != null && input.costCenterSplitFluxPct != null
      ? { coopPct: input.costCenterSplitCoopPct, fluxPct: input.costCenterSplitFluxPct }
      : null;

  const chosen = fromPharmacy ?? fromCc ?? { coopPct: 50, fluxPct: 50 };
  return {
    coopPct: chosen.coopPct,
    fluxPct: chosen.fluxPct,
  };
}

export function splitAmountCents(
  amountCents: number,
  percentages: SplitPercentages
): { coopCents: number; fluxCents: number } {
  const total = Math.max(0, Math.round(amountCents));
  const coopCents = Math.round((total * percentages.coopPct) / 100);
  return {
    coopCents,
    fluxCents: total - coopCents,
  };
}
