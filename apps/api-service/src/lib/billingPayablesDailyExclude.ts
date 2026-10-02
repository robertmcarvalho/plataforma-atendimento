import {
  dailyDriverPayoutOutsideWeeklySettlementCents,
  type DailyPayTrackLine,
} from '@plataforma/billing-engine';

/**
 * Soma o repasse de diárias que **não** pertence ao acerto de quinta e por isso precisa
 * sair do neto ao gerar o A pagar semanal.
 *
 * Conta apenas linhas da trilha `financial_daily` (PIX terça) que ainda carregam repasse
 * no neto — resíduo de acerto legado. A diária-base de escala
 * (`pay_track: 'thursday_settlement'`) é paga **no** acerto de quinta e nunca é subtraída.
 */
export function settlementDailyDriverAmountOutsideWeeklyPix(
  lines: DailyPayTrackLine[] | null | undefined
): number {
  return dailyDriverPayoutOutsideWeeklySettlementCents(lines);
}
