import { DAILY_PAY_TRACK_FINANCIAL_DAILY } from '@plataforma/billing-engine';

type ContractedDailyPharmacy = {
  id: string;
  status: 'active' | 'inactive';
  daily_billing_enabled: boolean;
  daily_billing_rule: 'per_driver_delivery_day' | 'fixed_per_driver_cycle';
  daily_billing_quantity: number | null;
  daily_billing_pharmacy_amount_cents: number | null;
  daily_billing_driver_payout_cents: number | null;
};

type ContractedDailyEligibility = {
  driverId: string;
  pharmacyId: string;
  activeDays: number;
  totalCycleDays: number;
};

export type ContractedDailySettlementLine = {
  kind: string;
  description: string | null;
  pharmacy_amount_cents: number;
  driver_amount_cents: number;
  metadata?: Record<string, unknown>;
};

function cents(n: number | null | undefined): number {
  return Math.max(0, Math.round(Number(n) || 0));
}

function pairKey(driverId: string, pharmacyId: string): string {
  return `${driverId}:${pharmacyId}`;
}

/** Anfitrião da diária contratada: mais dias vigentes no ciclo; empate por UUID. Nunca o menor UUID fantasma. */
export function selectContractedDailyHost(
  eligibilities: ContractedDailyEligibility[]
): ContractedDailyEligibility | null {
  if (!eligibilities.length) return null;
  return [...eligibilities].sort((a, b) => {
    if (b.activeDays !== a.activeDays) return b.activeDays - a.activeDays;
    const aFull = a.totalCycleDays > 0 && a.activeDays === a.totalCycleDays ? 1 : 0;
    const bFull = b.totalCycleDays > 0 && b.activeDays === b.totalCycleDays ? 1 : 0;
    if (bFull !== aFull) return bFull - aFull;
    return a.driverId.localeCompare(b.driverId);
  })[0]!;
}

export function financialDailyBelongsToCycle(input: {
  eventDate: string | null | undefined;
  startDate: string | null | undefined;
  apuracaoStart: string;
  apuracaoEnd: string;
}): boolean {
  const event = String(input.eventDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(event)) {
    return event >= input.apuracaoStart && event <= input.apuracaoEnd;
  }
  const start = String(input.startDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return false;
  return start >= input.apuracaoStart && start <= input.apuracaoEnd;
}

function countsTowardContractedQuantity(line: ContractedDailySettlementLine): boolean {
  if (line.kind !== 'daily') return false;
  if (cents(line.pharmacy_amount_cents) <= 0) return false;
  const treatment = line.metadata?.billing_treatment;
  if (treatment === 'pending_audit') return false;
  return true;
}

function financialDailyPayoutCents(line: ContractedDailySettlementLine): number {
  return Math.max(
    cents(line.driver_amount_cents),
    cents(Number(line.metadata?.settlement_driver_amount_excluded_cents))
  );
}

/** Diária financeira com repasse real, ainda sem cobrança contratada da farmácia. */
export function financialDailyCoversContractedQuantity(line: ContractedDailySettlementLine): boolean {
  if (line.kind !== 'daily') return false;
  if (!line.metadata?.financial_entry_id) return false;
  if (countsTowardContractedQuantity(line)) return false;
  return financialDailyPayoutCents(line) > 0;
}

function attachContractedChargeToFinancialDaily(
  line: ContractedDailySettlementLine,
  pharmacy: ContractedDailyPharmacy,
  quantity: number
): void {
  const qty = Math.max(1, Math.round(quantity));
  line.pharmacy_amount_cents = cents(pharmacy.daily_billing_pharmacy_amount_cents) * qty;
  line.metadata = {
    ...(line.metadata || {}),
    allocation_rule: 'financial_daily_covers_contracted',
    billing_treatment: 'charge_pharmacy',
    contracted_rule: pharmacy.daily_billing_rule,
    contracted_quantity: qty,
    contracted_driver_payout_reference_cents: cents(pharmacy.daily_billing_driver_payout_cents) * qty,
  };
}

function dailyLineQuantity(line: ContractedDailySettlementLine): number {
  if (!countsTowardContractedQuantity(line)) return 0;
  const contractedQty = line.metadata?.contracted_quantity;
  if (typeof contractedQty === 'number' && Number.isFinite(contractedQty)) {
    return Math.max(0, Math.round(contractedQty));
  }
  return 1;
}

function countPharmacyDailyAllocations(
  pharmacyId: string,
  dailyAllocationsByPair: Map<string, ContractedDailySettlementLine[]>
): number {
  let total = 0;
  for (const [key, lines] of dailyAllocationsByPair) {
    const [, pairPharmacyId] = key.split(':');
    if (pairPharmacyId !== pharmacyId) continue;
    for (const line of lines) total += dailyLineQuantity(line);
  }
  return total;
}

export function buildContractedDailySettlementLine(input: {
  pharmacy: Pick<
    ContractedDailyPharmacy,
    'daily_billing_pharmacy_amount_cents' | 'daily_billing_driver_payout_cents' | 'daily_billing_rule'
  >;
  quantity: number;
  eligibility?: Pick<ContractedDailyEligibility, 'activeDays' | 'totalCycleDays'>;
}): ContractedDailySettlementLine {
  const qty = Math.max(0, Math.round(input.quantity));
  const pharmacyCents = cents(input.pharmacy.daily_billing_pharmacy_amount_cents) * qty;
  const driverReferenceCents = cents(input.pharmacy.daily_billing_driver_payout_cents) * qty;
  return {
    kind: 'daily',
    description: qty === 1 ? 'Diária contratada (1× no ciclo)' : `Diária contratada (${qty}× no ciclo)`,
    pharmacy_amount_cents: pharmacyCents,
    driver_amount_cents: 0,
    metadata: {
      allocation_rule: 'pharmacy_contracted_daily',
      // Cobrança-espelho da farmácia: o repasse ao entregador vem de um lançamento no
      // Financeiro e sai na trilha Diárias (PIX terça), nunca no acerto de quinta.
      pay_track: DAILY_PAY_TRACK_FINANCIAL_DAILY,
      contracted_rule: input.pharmacy.daily_billing_rule,
      contracted_quantity: qty,
      contracted_driver_payout_reference_cents: driverReferenceCents,
      fixed_link_active_days: input.eligibility?.activeDays ?? null,
      fixed_link_total_days: input.eligibility?.totalCycleDays ?? null,
    },
  };
}

export function applyContractedDailyAllocations(input: {
  pharmacyById: Map<string, ContractedDailyPharmacy>;
  fixedEligibilities: ContractedDailyEligibility[];
  dailyAllocationsByPair: Map<string, ContractedDailySettlementLine[]>;
  pairCounts: Map<string, number>;
}): void {
  const { pharmacyById, fixedEligibilities, dailyAllocationsByPair, pairCounts } = input;

  const eligibilitiesByPharmacy = new Map<string, ContractedDailyEligibility[]>();
  for (const eligibility of fixedEligibilities) {
    const list = eligibilitiesByPharmacy.get(eligibility.pharmacyId) || [];
    list.push(eligibility);
    eligibilitiesByPharmacy.set(eligibility.pharmacyId, list);
  }

  for (const [pharmacyId, eligibilities] of eligibilitiesByPharmacy) {
    const pharmacy = pharmacyById.get(pharmacyId);
    if (!pharmacy || pharmacy.status !== 'active' || !pharmacy.daily_billing_enabled) continue;
    if (pharmacy.daily_billing_rule !== 'fixed_per_driver_cycle') continue;

    const contractedQuantity = Math.max(0, Math.round(Number(pharmacy.daily_billing_quantity ?? 0)));
    if (contractedQuantity <= 0) continue;
    if (cents(pharmacy.daily_billing_pharmacy_amount_cents) <= 0) continue;

    let remaining = Math.max(0, contractedQuantity - countPharmacyDailyAllocations(pharmacyId, dailyAllocationsByPair));
    if (remaining <= 0) continue;

    const coveringKeys = [...dailyAllocationsByPair.keys()]
      .filter((key) => key.endsWith(`:${pharmacyId}`))
      .sort((a, b) => a.localeCompare(b));
    for (const key of coveringKeys) {
      if (remaining <= 0) break;
      const lines = dailyAllocationsByPair.get(key) || [];
      for (const line of lines) {
        if (remaining <= 0) break;
        if (!financialDailyCoversContractedQuantity(line)) continue;
        const qty = Math.min(1, remaining);
        attachContractedChargeToFinancialDaily(line, pharmacy, qty);
        remaining -= qty;
      }
    }
    if (remaining <= 0) continue;

    const eligibility = selectContractedDailyHost(eligibilities);
    if (!eligibility) continue;

    const key = pairKey(eligibility.driverId, pharmacyId);
    const existing = dailyAllocationsByPair.get(key) || [];
    const line = buildContractedDailySettlementLine({
      pharmacy,
      quantity: remaining,
      eligibility,
    });
    dailyAllocationsByPair.set(key, [...existing, line]);
    if (!pairCounts.has(key)) pairCounts.set(key, 0);
  }
}
