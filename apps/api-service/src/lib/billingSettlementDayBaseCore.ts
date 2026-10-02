import {
  DAILY_PAY_TRACK_WEEKLY_SETTLEMENT,
  DAY_BASE_ALLOCATION_RULE as SHARED_DAY_BASE_ALLOCATION_RULE,
} from '@plataforma/billing-engine';
import { settlementLineMetadata, DRE_SCOPE_OPERATIONAL } from './billingCapitalSeparation';

export const DAY_BASE_ALLOCATION_RULE = SHARED_DAY_BASE_ALLOCATION_RULE;
/** A diária-base de escala é a única diária paga junto do acerto de quinta. */
export const DAY_BASE_PAY_TRACK = DAILY_PAY_TRACK_WEEKLY_SETTLEMENT;

export type DayBaseDayOverlay = {
  id: string;
  driverId: string;
  pharmacyId: string;
  eventDate: string;
  amountCents: number;
};

export type SettlementLineLike = {
  kind: string;
  description: string;
  pharmacy_amount_cents: number;
  driver_amount_cents: number;
  metadata?: Record<string, unknown>;
};

/**
 * Gera linhas de diária-base no acerto.
 * - Cobrança da farmácia: sempre o valor do cadastro (`driver_day_base_cents`).
 * - Repasse ao entregador: `amount_cents` do overlay (ajustável no acerto; default = cadastro na UI).
 */
export function dayBaseLinesForPair(
  overlays: DayBaseDayOverlay[],
  driverId: string,
  pharmacyId: string,
  pharmacyChargeCents: number
): SettlementLineLike[] {
  const pharmacyAmount = Math.max(0, Math.round(Number(pharmacyChargeCents || 0)));
  return overlays
    .filter((row) => row.driverId === driverId && row.pharmacyId === pharmacyId && row.amountCents > 0)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .map((row) => ({
      kind: 'daily',
      description: `Diária-base escala · ${row.eventDate.slice(8, 10)}/${row.eventDate.slice(5, 7)}`,
      pharmacy_amount_cents: pharmacyAmount,
      driver_amount_cents: row.amountCents,
      metadata: settlementLineMetadata(DRE_SCOPE_OPERATIONAL, {
        allocation_rule: DAY_BASE_ALLOCATION_RULE,
        pay_track: DAY_BASE_PAY_TRACK,
        event_date: row.eventDate,
        day_base_overlay_id: row.id,
        pharmacy_day_base_cents: pharmacyAmount,
        driver_day_base_cents: row.amountCents,
      }),
    }));
}
