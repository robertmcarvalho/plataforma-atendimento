import {
  dailyDriverPayoutOutsideWeeklySettlementCents,
  dailyDriverPayoutInWeeklySettlementCents,
  dailyDriverReferenceOnFinancialTrackCents,
  dailyLineHasStaleWeeklyPayout,
} from '@plataforma/billing-engine';
import type { BillingSettlement } from './billingApi';
import { pharmacyDisplayName } from './billingDisplay';
import { isDriverLinkedToPharmacy } from './isDriverLinkedToPharmacy';

export type AggregatedAcertoRow = {
  cycleId: string;
  pharmacyId: string;
  cycleLabel: string;
  apuracaoStart: string;
  apuracaoEnd: string;
  pharmacyName: string;
  costCenterId: string | null;
  costCenterName: string | null;
  driverIds: string[];
  driverCount: number;
  totalRepasse: number;
  totalRepasseOperacional: number;
  totalDeducaoCapital: number;
  totalFaturado: number;
  /** Diárias da trilha Diárias (PIX terça), fora de `totalRepasse`. */
  totalDiariasTerca: number;
  /** Diária-base de escala, já dentro de `totalRepasse`. */
  totalDiariasQuinta: number;
  status: BillingSettlement['status'];
  settlementIds: string[];
};

export type AcertoDriverLine = {
  settlementId: string;
  driverId: string;
  driverName: string;
  deliveryCount: number;
  linkedToPharmacy: boolean;
  baseRepasse: number;
  /** Diárias da trilha Diárias (PIX terça) — fora do PIX de quinta. */
  diariasTerca: number;
  /** Diárias pagas no acerto de quinta (diária-base de escala) — dentro do PIX de quinta. */
  diariasQuinta: number;
  adicionais: number;
  descontos: number;
  faltas: number;
  capitalCoop: number;
  adiantamentos: number;
  repasseOperacional: number;
  deducaoCapital: number;
  rateio: number;
  valorEntregador: number;
  valorFaturadoFarmacia: number;
  minimoAplicado: boolean;
  status: BillingSettlement['status'];
};

const STATUS_RANK: Record<BillingSettlement['status'], number> = {
  open: 0,
  in_review: 1,
  approved: 2,
  paid: 3,
};

function sumLines(settlement: BillingSettlement, kinds: string[], field: 'driver_amount_cents' | 'pharmacy_amount_cents') {
  return (settlement.billing_settlement_lines || [])
    .filter((l) => kinds.includes(l.kind))
    .reduce((sum, l) => sum + (Number(l[field]) || 0), 0);
}

/** Diárias da trilha Diárias (PIX terça): valor informativo, fora do PIX do acerto. */
function sumDailyTuesdayTrack(settlement: BillingSettlement) {
  return dailyDriverReferenceOnFinancialTrackCents(settlement.billing_settlement_lines || []);
}

/** Diárias pagas junto do acerto de quinta (diária-base de escala). */
function sumDailyThursdayTrack(settlement: BillingSettlement) {
  return dailyDriverPayoutInWeeklySettlementCents(settlement.billing_settlement_lines || []);
}

/**
 * True se alguma linha de diária da trilha de terça ainda carrega repasse no neto
 * (acerto legado, precisa recalcular). Diária-base de escala não conta: ela é paga na
 * quinta justamente com repasse > 0.
 */
export function settlementHasStaleDailyDriverPayout(settlement: BillingSettlement): boolean {
  return (settlement.billing_settlement_lines || []).some(dailyLineHasStaleWeeklyPayout);
}

export function settlementsHaveStaleDailyDriverPayout(settlements: BillingSettlement[]): boolean {
  return settlements.some(settlementHasStaleDailyDriverPayout);
}

function aggregateStatus(statuses: BillingSettlement['status'][]): BillingSettlement['status'] {
  if (!statuses.length) return 'open';
  return statuses.reduce((min, s) => (STATUS_RANK[s] < STATUS_RANK[min] ? s : min), statuses[0]);
}

/** Repasse de diária da trilha de terça ainda embutido no neto (legado). */
function settlementDailyStillInNet(s: BillingSettlement): number {
  return dailyDriverPayoutOutsideWeeklySettlementCents(s.billing_settlement_lines || []);
}

/** PIX quinta efetivo: exclui só as diárias de outra trilha ainda embutidas no neto. */
function settlementWeeklyPixCents(s: BillingSettlement): number {
  return Math.max(0, Number(s.net_driver_payout_cents || 0) - settlementDailyStillInNet(s));
}

function settlementOperationalNet(s: BillingSettlement): number {
  const raw =
    Number(s.operational_net_driver_payout_cents) ||
    Number(s.net_driver_payout_cents || 0) + Number(s.financial_deduction_cents || 0);
  return Math.max(0, raw - settlementDailyStillInNet(s));
}

function settlementCapitalDeduction(s: BillingSettlement): number {
  if (Number(s.financial_deduction_cents || 0) > 0) return Number(s.financial_deduction_cents);
  return Math.abs(
    sumLines(s, ['quota', 'advance', 'uniform', 'bag', 'other_discount'], 'driver_amount_cents')
  );
}

export function aggregateSettlementsByPharmacy(settlements: BillingSettlement[]): AggregatedAcertoRow[] {
  const map = new Map<string, AggregatedAcertoRow & { statuses: BillingSettlement['status'][] }>();

  for (const s of settlements) {
    const key = `${s.billing_cycle_id}:${s.pharmacy_id}`;
    const cycle = s.billing_cycles;
    const existing = map.get(key);
    const pharmacyName = pharmacyDisplayName(s.pharmacies);
    const ccId = s.pharmacies?.billing_cost_center_id || null;
    const ccName = s.pharmacies?.billing_cost_centers?.name || null;

    if (!existing) {
      map.set(key, {
        cycleId: s.billing_cycle_id,
        pharmacyId: s.pharmacy_id,
        cycleLabel: cycle?.label || `${cycle?.apuracao_start || ''} → ${cycle?.apuracao_end || ''}`,
        apuracaoStart: String(cycle?.apuracao_start || '').slice(0, 10),
        apuracaoEnd: String(cycle?.apuracao_end || '').slice(0, 10),
        pharmacyName,
        costCenterId: ccId,
        costCenterName: ccName,
        driverIds: [s.driver_id],
        driverCount: 1,
        totalRepasse: settlementWeeklyPixCents(s),
        totalRepasseOperacional: settlementOperationalNet(s),
        totalDeducaoCapital: settlementCapitalDeduction(s),
        totalFaturado: s.pharmacy_charge_cents,
        totalDiariasTerca: sumDailyTuesdayTrack(s),
        totalDiariasQuinta: sumDailyThursdayTrack(s),
        status: s.status,
        settlementIds: [s.id],
        statuses: [s.status],
      });
      continue;
    }

    existing.driverCount += 1;
    if (!existing.driverIds.includes(s.driver_id)) existing.driverIds.push(s.driver_id);
    existing.totalRepasse += settlementWeeklyPixCents(s);
    existing.totalRepasseOperacional += settlementOperationalNet(s);
    existing.totalDeducaoCapital += settlementCapitalDeduction(s);
    existing.totalFaturado += s.pharmacy_charge_cents;
    existing.totalDiariasTerca += sumDailyTuesdayTrack(s);
    existing.totalDiariasQuinta += sumDailyThursdayTrack(s);
    existing.settlementIds.push(s.id);
    existing.statuses.push(s.status);
    existing.status = aggregateStatus(existing.statuses);
  }

  return [...map.values()]
    .map(({ statuses: _s, ...row }) => row)
    .sort((a, b) => b.apuracaoEnd.localeCompare(a.apuracaoEnd) || a.pharmacyName.localeCompare(b.pharmacyName));
}

function isSettlementDriverLinkedToPharmacy(settlement: BillingSettlement): boolean {
  if (!settlement.drivers) return true;
  return isDriverLinkedToPharmacy(settlement.drivers, settlement.pharmacy_id);
}

export function buildDriverLines(settlements: BillingSettlement[]): AcertoDriverLine[] {
  return settlements
    .map((s) => {
      const faltas = sumLines(s, ['absence'], 'driver_amount_cents');
      const capitalCoop = sumLines(s, ['quota', 'advance', 'uniform', 'bag', 'other_discount'], 'driver_amount_cents');
      const deducaoCapital = settlementCapitalDeduction(s);
      return {
        settlementId: s.id,
        driverId: s.driver_id,
        driverName: s.drivers?.name || '—',
        deliveryCount: s.delivery_count,
        linkedToPharmacy: isSettlementDriverLinkedToPharmacy(s),
        baseRepasse: sumLines(s, ['deliveries', 'minimum_guarantee'], 'driver_amount_cents'),
        diariasTerca: sumDailyTuesdayTrack(s),
        diariasQuinta: sumDailyThursdayTrack(s),
        adicionais: 0,
        descontos: faltas,
        faltas,
        capitalCoop,
        adiantamentos: sumLines(s, ['advance'], 'driver_amount_cents'),
        repasseOperacional: settlementOperationalNet(s),
        deducaoCapital,
        rateio: sumLines(s, ['adjustment'], 'driver_amount_cents'),
        valorEntregador: settlementWeeklyPixCents(s),
        valorFaturadoFarmacia: s.pharmacy_charge_cents,
        minimoAplicado: Boolean(s.applied_mg) || (s.billing_settlement_lines || []).some((l) => l.kind === 'minimum_guarantee'),
        status: s.status,
      };
    })
    .sort((a, b) => a.driverName.localeCompare(b.driverName));
}
