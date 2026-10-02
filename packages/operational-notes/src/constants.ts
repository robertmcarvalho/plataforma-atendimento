/** Shared financial entry workflow statuses (api-service + web). */
export const FinancialEntryStatus = {
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ACTIVE: 'active',
  DRAFT: 'draft',
  SETTLED: 'settled',
  CANCELLED: 'cancelled',
  PARTIALLY_CANCELLED: 'partially_cancelled',
  INFORMED: 'informed',
} as const;

export type FinancialEntryStatusValue =
  (typeof FinancialEntryStatus)[keyof typeof FinancialEntryStatus];

/** Leader / financial occurrence kinds. */
export const OccurrenceKind = {
  UNEXCUSED: 'unexcused',
  DAY_OFF: 'day_off',
  /** Diária contratada executada pelo próprio entregador (sem ausência/cobertura). */
  CONTRACTED_DAILY: 'contracted_daily',
} as const;

export type OccurrenceKindValue = (typeof OccurrenceKind)[keyof typeof OccurrenceKind];

export const OCCURRENCE_KIND_VALUES = [
  OccurrenceKind.UNEXCUSED,
  OccurrenceKind.DAY_OFF,
  OccurrenceKind.CONTRACTED_DAILY,
] as const;

/** Guided task / advance approval decisions. */
export const AdvanceTaskDecision = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;

export type AdvanceTaskDecisionValue =
  (typeof AdvanceTaskDecision)[keyof typeof AdvanceTaskDecision];
