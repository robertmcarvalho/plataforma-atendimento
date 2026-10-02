import {
  isFinanceGestorScope,
  primarySectorName,
  resolveOperacaoMode,
  resolveOperacaoModeFromRoles,
  resolveOperacaoModes,
  resolveOperacaoModesFromRoles,
  type OperacaoMode,
  type SectorRow,
} from '@plataforma/operational-notes';

export type { OperacaoMode, SectorRow };
export {
  isFinanceGestorScope,
  primarySectorName,
  resolveOperacaoMode,
  resolveOperacaoModes,
  resolveOperacaoModesFromRoles,
  resolveOperacaoModeFromRoles,
};

export function sectorNamesForUser(
  sectorIds: string[] | undefined,
  sectors: SectorRow[]
): string[] {
  if (!sectorIds?.length || !sectors.length) return [];
  const byId = new Map(sectors.map((s) => [s.id, s.name]));
  return sectorIds.map((id) => byId.get(id)).filter((n): n is string => Boolean(n));
}

export const EXECUCAO_TASK_TYPES_GERAL = [
  'driver_pre_registration',
  'driver_registration_completion',
  'driver_enrollment_prep',
  'driver_termination_prep',
  'driver_termination_request',
  'driver_doc_expiry_warning',
  'driver_doc_expired',
  'guided_demand',
] as const;

export const EXECUCAO_TASK_TYPES_FINANCEIRO = [
  'financial_advance_request',
  'driver_termination_financial_review',
] as const;

/** Painéis disponíveis para override (somente admin validando UI) — nomes alinhados ao Revive. */
export const OPERACAO_PAINEL_OPTIONS: Array<{ id: OperacaoMode; label: string }> = [
  { id: 'carteira', label: 'Analista Operacional' },
  { id: 'execucao_geral', label: 'Atendente · Atendimento Geral' },
  { id: 'execucao_financeiro', label: 'Atendente Financeiro' },
  { id: 'gestor_financeiro', label: 'Gestor Financeiro' },
  { id: 'gestor_operacional', label: 'Gestor Operacional' },
];

export function canSwitchOperacaoPainel(modesCount: number): boolean {
  return modesCount > 1;
}

/** @deprecated use canSwitchOperacaoPainel */
export function canOverrideOperacaoPainel(_role: string, modesCount = 0): boolean {
  return canSwitchOperacaoPainel(modesCount);
}

export function parseOperacaoPainelOverride(value: string | null | undefined): OperacaoMode | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const id = raw === 'coordenacao' ? 'gestor_operacional' : raw;
  return OPERACAO_PAINEL_OPTIONS.some((o) => o.id === id) ? (id as OperacaoMode) : null;
}

export function operacaoModeLabel(mode: OperacaoMode): string {
  const opt = OPERACAO_PAINEL_OPTIONS.find((o) => o.id === mode);
  return opt?.label ?? 'Operação';
}
