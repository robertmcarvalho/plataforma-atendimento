/**
 * Client-side mirror of api-service billingDebitPayableSuggestions.
 * Keep scoring thresholds and logic in sync with the API module.
 */

export const DEBIT_PAYABLE_SUGGESTION_MIN_SCORE = 80;
export const DEBIT_PAYABLE_HIGH_CONFIDENCE_SCORE = 90;

export type DebitSuggestionMovement = {
  id: string;
  movement_date: string;
  amount_cents: number;
  description: string | null;
  direction: 'credit' | 'debit' | string;
  reconciled?: boolean;
};

export type DebitSuggestionPayable = {
  id: string;
  description: string | null;
  beneficiary_name: string | null;
  due_date: string | null;
  amount_cents: number;
  amount_paid_cents: number;
  status: string;
  payment_blocked?: boolean | null;
};

export type DebitPayableSuggestion = {
  movement_id: string;
  payable_id: string;
  score: number;
  high_confidence: boolean;
  amount_cents: number;
  movement_date: string;
  movement_description: string | null;
  payable_description: string | null;
  payable_beneficiary_name: string | null;
  payable_due_date: string | null;
  payable_available_cents: number;
};

function normalizeText(raw: string | null | undefined): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function textScore(statementText: string | null | undefined, candidateText: string | null | undefined): number {
  const source = normalizeText(statementText);
  const candidate = normalizeText(candidateText);
  if (!source || !candidate) return 0;
  if (source.includes(candidate) || candidate.includes(source)) return 30;
  const sourceTokens = new Set(source.split(' ').filter((t) => t.length > 2));
  const candidateTokens = candidate.split(' ').filter((t) => t.length > 2);
  if (!candidateTokens.length) return 0;
  const hits = candidateTokens.filter((t) => sourceTokens.has(t)).length;
  return Math.round((hits / candidateTokens.length) * 30);
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(`${a.slice(0, 10)}T12:00:00.000Z`).getTime();
  const db = new Date(`${b.slice(0, 10)}T12:00:00.000Z`).getTime();
  return Math.abs(Math.round((da - db) / 86_400_000));
}

export function availablePayableCents(
  payable: Pick<DebitSuggestionPayable, 'amount_cents' | 'amount_paid_cents'>,
  pendingUnreconciledCents = 0
): number {
  return Math.max(0, payable.amount_cents - payable.amount_paid_cents - pendingUnreconciledCents);
}

export function isPayableEligibleForDebitSuggestion(
  payable: DebitSuggestionPayable,
  movementAmountCents: number,
  pendingUnreconciledCents = 0
): boolean {
  if (payable.status !== 'approved') return false;
  if (payable.payment_blocked) return false;
  const available = availablePayableCents(payable, pendingUnreconciledCents);
  return available === movementAmountCents && available > 0;
}

export function scoreDebitPayableSuggestion(
  movement: Pick<DebitSuggestionMovement, 'movement_date' | 'description'>,
  payable: Pick<DebitSuggestionPayable, 'description' | 'beneficiary_name' | 'due_date'>
): number {
  const dateScore = payable.due_date
    ? Math.max(0, 20 - daysBetween(movement.movement_date, String(payable.due_date).slice(0, 10)) * 5)
    : 0;
  const nameScore = Math.max(
    textScore(movement.description, payable.beneficiary_name),
    textScore(movement.description, payable.description),
    textScore(movement.description, `${payable.beneficiary_name || ''} ${payable.description || ''}`)
  );
  return 60 + dateScore + nameScore;
}

export function buildDebitPayableSuggestions(input: {
  movements: DebitSuggestionMovement[];
  payables: DebitSuggestionPayable[];
  pendingByPayableId?: Map<string, number> | Record<string, number>;
  movementIdsWithPendingPayment?: Set<string> | string[];
  ignoredMovementIds?: Set<string> | string[];
  minScore?: number;
  highConfidenceScore?: number;
}): DebitPayableSuggestion[] {
  const minScore = input.minScore ?? DEBIT_PAYABLE_SUGGESTION_MIN_SCORE;
  const highConfidenceScore = input.highConfidenceScore ?? DEBIT_PAYABLE_HIGH_CONFIDENCE_SCORE;
  const pendingMap =
    input.pendingByPayableId instanceof Map
      ? input.pendingByPayableId
      : new Map(Object.entries(input.pendingByPayableId || {}).map(([k, v]) => [k, Number(v) || 0]));
  const skipMovements = new Set(
    [
      ...(input.movementIdsWithPendingPayment instanceof Set
        ? [...input.movementIdsWithPendingPayment]
        : input.movementIdsWithPendingPayment || []),
      ...(input.ignoredMovementIds instanceof Set ? [...input.ignoredMovementIds] : input.ignoredMovementIds || []),
    ].map(String)
  );

  const openDebits = input.movements.filter(
    (m) => m.direction === 'debit' && !m.reconciled && !skipMovements.has(m.id)
  );

  type Pair = {
    movement: DebitSuggestionMovement;
    payable: DebitSuggestionPayable;
    score: number;
    available: number;
  };

  const pairs: Pair[] = [];
  for (const movement of openDebits) {
    for (const payable of input.payables) {
      const pending = pendingMap.get(payable.id) || 0;
      if (!isPayableEligibleForDebitSuggestion(payable, movement.amount_cents, pending)) continue;
      const score = scoreDebitPayableSuggestion(movement, payable);
      if (score < minScore) continue;
      pairs.push({
        movement,
        payable,
        score,
        available: availablePayableCents(payable, pending),
      });
    }
  }

  pairs.sort((a, b) => b.score - a.score || a.movement.movement_date.localeCompare(b.movement.movement_date));

  const usedMovements = new Set<string>();
  const usedPayables = new Set<string>();
  const out: DebitPayableSuggestion[] = [];

  for (const pair of pairs) {
    if (usedMovements.has(pair.movement.id) || usedPayables.has(pair.payable.id)) continue;
    usedMovements.add(pair.movement.id);
    usedPayables.add(pair.payable.id);
    out.push({
      movement_id: pair.movement.id,
      payable_id: pair.payable.id,
      score: pair.score,
      high_confidence: pair.score >= highConfidenceScore,
      amount_cents: pair.movement.amount_cents,
      movement_date: pair.movement.movement_date,
      movement_description: pair.movement.description,
      payable_description: pair.payable.description,
      payable_beneficiary_name: pair.payable.beneficiary_name,
      payable_due_date: pair.payable.due_date,
      payable_available_cents: pair.available,
    });
  }

  return out;
}
