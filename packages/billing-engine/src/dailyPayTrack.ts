/**
 * Trilha de pagamento das linhas `kind = 'daily'` do acerto.
 *
 * Toda diária cobra a farmácia no acerto, mas o **repasse ao entregador** sai em uma de
 * duas trilhas, e a linha declara qual:
 *
 * | Caminho | `allocation_rule` | Etiqueta | Trilha |
 * |---|---|---|---|
 * | Diária-base de escala | `pharmacy_day_base` | `pay_track: 'thursday_settlement'` | acerto semanal (PIX quinta) |
 * | Diária do Financeiro | `direct_pharmacy_without_group`, `fallback_*`, `operation_absorbed`, `financial_daily_covers_contracted` | `driver_payout_track: 'financial_daily'` | Diárias (PIX terça) |
 * | Diária contratada do cadastro | `pharmacy_contracted_daily` | `pay_track: 'financial_daily'` | Diárias (PIX terça), via lançamento no Financeiro |
 *
 * A decisão de somar ou subtrair a diária do PIX de quinta se baseia **na trilha declarada**,
 * nunca na presença de `driver_amount_cents > 0`.
 */
export const DAILY_PAY_TRACK_WEEKLY_SETTLEMENT = 'thursday_settlement';
export const DAILY_PAY_TRACK_FINANCIAL_DAILY = 'financial_daily';
export const DAY_BASE_ALLOCATION_RULE = 'pharmacy_day_base';

export type DailyPayTrack =
  | typeof DAILY_PAY_TRACK_WEEKLY_SETTLEMENT
  | typeof DAILY_PAY_TRACK_FINANCIAL_DAILY;

export type DailyPayTrackLine = {
  kind?: string | null;
  driver_amount_cents?: number | null;
  metadata?: unknown;
};

function metadataObject(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function cents(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export function isDailySettlementLine(line: DailyPayTrackLine | null | undefined): boolean {
  return String(line?.kind || '') === 'daily';
}

/**
 * Trilha declarada da linha de diária, ou `null` quando a linha não é diária.
 *
 * Linhas legadas — gravadas antes das etiquetas existirem — caem no default
 * `financial_daily`. Antes da diária-base de escala existir, **toda** diária vinha do
 * Financeiro e era paga no PIX de terça; tratar essas linhas como trilha de quinta
 * pagaria de novo algo que já saiu. O único palpite permitido é pela `allocation_rule`
 * da diária-base, que é a própria linha que nasceu junto com a etiqueta.
 */
export function resolveDailyPayTrack(line: DailyPayTrackLine | null | undefined): DailyPayTrack | null {
  if (!isDailySettlementLine(line)) return null;
  const meta = metadataObject(line?.metadata);
  const declared = String(meta.pay_track || meta.driver_payout_track || '');
  if (declared === DAILY_PAY_TRACK_WEEKLY_SETTLEMENT) return DAILY_PAY_TRACK_WEEKLY_SETTLEMENT;
  if (declared === DAILY_PAY_TRACK_FINANCIAL_DAILY) return DAILY_PAY_TRACK_FINANCIAL_DAILY;
  if (String(meta.allocation_rule || '') === DAY_BASE_ALLOCATION_RULE) {
    return DAILY_PAY_TRACK_WEEKLY_SETTLEMENT;
  }
  return DAILY_PAY_TRACK_FINANCIAL_DAILY;
}

/** Esta linha de diária entra no pagamento de quinta (acerto semanal)? */
export function dailyLineIsPaidInWeeklySettlement(line: DailyPayTrackLine | null | undefined): boolean {
  return resolveDailyPayTrack(line) === DAILY_PAY_TRACK_WEEKLY_SETTLEMENT;
}

/** Esta linha de diária é paga na trilha Diárias (PIX terça)? */
export function dailyLineIsPaidOnFinancialTrack(line: DailyPayTrackLine | null | undefined): boolean {
  return resolveDailyPayTrack(line) === DAILY_PAY_TRACK_FINANCIAL_DAILY;
}

/**
 * Repasse de diária embutido em `net_driver_payout_cents` que pertence à trilha de terça
 * e portanto precisa ser **subtraído** do PIX de quinta.
 *
 * Recalculado pelo motor atual, esse valor é 0 para diárias do Financeiro (o repasse é
 * zerado e preservado em `settlement_driver_amount_excluded_cents`). Continua existindo
 * para acertos legados que ainda carregam o repasse na linha.
 */
export function dailyDriverPayoutOutsideWeeklySettlementCents(
  lines: DailyPayTrackLine[] | null | undefined
): number {
  if (!lines?.length) return 0;
  let total = 0;
  for (const line of lines) {
    if (!isDailySettlementLine(line)) continue;
    if (dailyLineIsPaidInWeeklySettlement(line)) continue;
    const amount = cents(line.driver_amount_cents);
    if (amount > 0) total += amount;
  }
  return total;
}

/** Repasse de diária que compõe o PIX de quinta (hoje, só a diária-base de escala). */
export function dailyDriverPayoutInWeeklySettlementCents(
  lines: DailyPayTrackLine[] | null | undefined
): number {
  if (!lines?.length) return 0;
  let total = 0;
  for (const line of lines) {
    if (!dailyLineIsPaidInWeeklySettlement(line)) continue;
    const amount = cents(line.driver_amount_cents);
    if (amount > 0) total += amount;
  }
  return total;
}

/**
 * Valor de repasse da linha de diária, independente da trilha: o motor zera
 * `driver_amount_cents` na trilha de terça e guarda o valor real em
 * `settlement_driver_amount_excluded_cents`.
 */
export function dailyDriverReferenceCents(line: DailyPayTrackLine | null | undefined): number {
  if (!isDailySettlementLine(line)) return 0;
  const meta = metadataObject(line?.metadata);
  return Math.max(
    0,
    cents(line?.driver_amount_cents),
    cents(meta.settlement_driver_amount_excluded_cents)
  );
}

/** Referência de repasse das diárias pagas na trilha Diárias (PIX terça). */
export function dailyDriverReferenceOnFinancialTrackCents(
  lines: DailyPayTrackLine[] | null | undefined
): number {
  if (!lines?.length) return 0;
  let total = 0;
  for (const line of lines) {
    if (!dailyLineIsPaidOnFinancialTrack(line)) continue;
    total += dailyDriverReferenceCents(line);
  }
  return total;
}

/**
 * Linha de diária de acerto legado que ainda carrega repasse da trilha de terça no neto.
 * Só esses acertos precisam de recálculo — a diária-base de escala é paga na quinta
 * justamente com `driver_amount_cents > 0` e não é resíduo.
 */
export function dailyLineHasStaleWeeklyPayout(line: DailyPayTrackLine | null | undefined): boolean {
  if (!isDailySettlementLine(line)) return false;
  if (dailyLineIsPaidInWeeklySettlement(line)) return false;
  return cents(line?.driver_amount_cents) > 0;
}
