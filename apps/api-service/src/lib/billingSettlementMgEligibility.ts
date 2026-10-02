import { computeDeliverySettlement, type DeliverySettlementInput } from '@plataforma/billing-engine';
import { dateOnly } from './billingSettlementOverlap';

export type FixedMgEligibilityInput = {
  driverType: string | null | undefined;
  driverStatus: string | null | undefined;
  inactiveAt: string | null | undefined;
  linkIsActive: boolean | null | undefined;
  pharmacyStatus: string | null | undefined;
  pharmacyMgEnabled: boolean | null | undefined;
  activeDays?: number | null;
  cycleEnd?: string | null;
};

function isFixedDriver(driverType: string | null | undefined): boolean {
  return driverType === 'fixed';
}

function pharmacyIsActive(pharmacyStatus: string | null | undefined): boolean {
  return pharmacyStatus === 'active';
}

/** inactive_at no ciclo (ou antes) impede anfitrião de diária; depois do ciclo ainda pode anfitriar. */
export function inactiveAtBlocksDailyHost(
  inactiveAt: string | null | undefined,
  cycleEnd?: string | null
): boolean {
  const inactive = dateOnly(inactiveAt);
  if (!inactive) return false;
  const end = dateOnly(cycleEnd);
  if (!end) return true;
  return inactive <= end;
}

/**
 * MG pelo overlap no ciclo, não pelo snapshot de hoje.
 * Diarista nunca gera MG. is_active/status/inactive_at não apagam dias já vigentes.
 */
export function isFixedMgEligible(input: FixedMgEligibilityInput): boolean {
  if (!isFixedDriver(input.driverType)) return false;
  if (!pharmacyIsActive(input.pharmacyStatus)) return false;
  if (input.pharmacyMgEnabled === false) return false;
  if (typeof input.activeDays === 'number' && input.activeDays <= 0) return false;
  return true;
}

/**
 * Anfitrião de diária contratada: fixo ativo no cadastro, com overlap no ciclo.
 * Blocked/inativo não anfitria. Independente de MG ligado.
 */
export function isContractedDailyEligible(input: FixedMgEligibilityInput): boolean {
  if (!isFixedDriver(input.driverType)) return false;
  if (input.driverStatus !== 'active') return false;
  if (inactiveAtBlocksDailyHost(input.inactiveAt, input.cycleEnd)) return false;
  if (!pharmacyIsActive(input.pharmacyStatus)) return false;
  if (typeof input.activeDays === 'number' && input.activeDays <= 0) return false;
  return true;
}

/** Snapshot atual (badge / cadastro). Não decide MG do ciclo. */
export function isActiveFixedPharmacyLink(input: Omit<FixedMgEligibilityInput, 'pharmacyMgEnabled'>): boolean {
  if (!isFixedDriver(input.driverType)) return false;
  if (input.driverStatus !== 'active') return false;
  if (dateOnly(input.inactiveAt)) return false;
  if (input.linkIsActive !== true) return false;
  if (!pharmacyIsActive(input.pharmacyStatus)) return false;
  return true;
}

export function mgEnabledForPair(pharmacyMgEnabled: boolean, pairEligible: boolean): boolean {
  return pharmacyMgEnabled !== false && pairEligible;
}

export function computePairDeliverySettlement(
  input: DeliverySettlementInput & { pairEligible: boolean }
) {
  return computeDeliverySettlement({
    ...input,
    mgEnabled: mgEnabledForPair(input.mgEnabled, input.pairEligible),
  });
}
