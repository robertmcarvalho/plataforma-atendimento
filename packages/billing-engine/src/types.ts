export type BillingContractScope = 'flux_only' | 'coop_only' | 'both';

export type DeliverySettlementInput = {
  deliveryCount: number;
  mgEnabled: boolean;
  minimumDeliveriesCount?: number | null;
  minimumGuaranteedCents: number;
  minimumGuaranteedDriverPayoutCents: number;
  deliveryFeeCents: number;
  deliveryFeeDriverPayoutCents: number;
};

export type DeliverySettlementResult = {
  pharmacyChargeCents: number;
  driverPayoutCents: number;
  appliedMinimumGuarantee: boolean;
  minimumDeliveryThreshold: number;
};

export type AbsenceMgDiscountInput = {
  minimumGuaranteedCents: number;
  minimumGuaranteedDriverPayoutCents: number;
  divisor?: number;
};

export type SplitResolveInput = {
  contractScope: BillingContractScope;
  pharmacySplitCoopPct?: number | null;
  pharmacySplitFluxPct?: number | null;
  costCenterSplitCoopPct?: number | null;
  costCenterSplitFluxPct?: number | null;
};

export type SplitPercentages = {
  coopPct: number;
  fluxPct: number;
};

export type MgPoolSplitRule = 'equal' | 'by_deliveries';

export type SharedPoolDriverCount = {
  driverId: string;
  deliveryCount: number;
  /** Dias vigentes do vínculo no ciclo; habilita rateio proporcional do pool. */
  activeDays?: number | null;
};

export type SharedPoolSettlementInput = DeliverySettlementInput & {
  driverCounts: SharedPoolDriverCount[];
  splitRule?: MgPoolSplitRule;
  /** Dias do ciclo de apuração; sem ele o pool não é proporcionalizado. */
  totalCycleDays?: number | null;
};

export type SharedPoolDriverAllocation = {
  driverId: string;
  deliveryCount: number;
  pharmacyChargeCents: number;
  driverPayoutCents: number;
};

export type SharedPoolSettlementResult = DeliverySettlementResult & {
  pharmacyChargeCents: number;
  totalDriverPayoutCents: number;
  perDriver: SharedPoolDriverAllocation[];
  /** Soma dos dias vigentes dos participantes do pool no ciclo. */
  poolActiveDays: number;
  /** Dias do ciclo usados na proporcionalização (0 = sem proporcional). */
  poolTotalCycleDays: number;
  /** Pool reduzido porque a cobertura dos fixos não cobriu o ciclo inteiro. */
  poolProrated: boolean;
};
