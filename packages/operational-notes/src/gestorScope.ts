/** Macro setores usados para roteamento de painéis de gestão e execução. */
export const MACRO_SECTOR_NAMES = [
  'Operacional',
  'Atendimento Geral',
  'Financeiro',
  'Suporte Técnico',
] as const;

export type OperacaoMode =
  | 'carteira'
  | 'execucao_geral'
  | 'execucao_financeiro'
  | 'gestor_financeiro'
  | 'gestor_operacional'
  | 'indisponivel';

export type SectorRow = { id: string; name: string };

const OPERACIONAL = MACRO_SECTOR_NAMES[0];
const ATENDIMENTO_GERAL = MACRO_SECTOR_NAMES[1];
const FINANCEIRO = MACRO_SECTOR_NAMES[2];

export function primarySectorName(
  primarySectorId: string | null | undefined,
  sectorIds: string[] | undefined,
  sectors: SectorRow[]
): string | undefined {
  const id = primarySectorId || sectorIds?.[0];
  if (!id) return undefined;
  return sectors.find((s) => s.id === id)?.name;
}

/** Supervisor/gestor com escopo exclusivo no macro setor Financeiro (sem Operacional nem AG). */
export function isFinanceGestorScope(sectorNames: string[]): boolean {
  if (!sectorNames.length) return false;
  const names = new Set(sectorNames);
  if (!names.has(FINANCEIRO)) return false;
  return !names.has(OPERACIONAL) && !names.has(ATENDIMENTO_GERAL);
}

/**
 * Painel do perfil Gestor (`supervisor`): setor primário define financeiro vs operacional.
 * Papel `financial` permanece como alias legado → gestor financeiro.
 */
export function resolveSupervisorGestorMode(input: {
  primarySectorName?: string;
  sectorNames: string[];
}): 'gestor_financeiro' | 'gestor_operacional' {
  const primary = input.primarySectorName;
  const names = new Set(input.sectorNames);

  if (primary === FINANCEIRO && names.has(FINANCEIRO)) return 'gestor_financeiro';
  if (primary === OPERACIONAL && names.has(OPERACIONAL)) return 'gestor_operacional';
  if (primary === ATENDIMENTO_GERAL && names.has(ATENDIMENTO_GERAL)) return 'gestor_operacional';

  if (isFinanceGestorScope(input.sectorNames)) return 'gestor_financeiro';
  if (names.has(OPERACIONAL)) return 'gestor_operacional';
  if (names.has(FINANCEIRO)) return 'gestor_financeiro';

  return 'gestor_operacional';
}

export function resolveOperacaoModesFromRoles(input: {
  roleNames: string[];
  sectorNames: string[];
  hasPortfolioPharmacies?: boolean;
}): OperacaoMode[] {
  const roles = new Set(input.roleNames.map((r) => String(r || '').toLowerCase()).filter(Boolean));
  const modes = new Set<OperacaoMode>();

  if (roles.has('admin')) {
    modes.add('gestor_operacional');
    modes.add('gestor_financeiro');
    return [...modes];
  }

  if (roles.has('financial')) modes.add('gestor_financeiro');
  if (roles.has('supervisor')) modes.add('gestor_operacional');

  const executionRoles = ['attendant', 'attendant_financeiro', 'operational'].filter((r) => roles.has(r));
  for (const role of executionRoles) {
    const mode = resolveOperacaoMode({
      role,
      sectorNames: input.sectorNames,
      hasPortfolioPharmacies: input.hasPortfolioPharmacies,
    });
    if (mode !== 'indisponivel') modes.add(mode);
  }

  if (!modes.size) {
    const fallback = resolveOperacaoModes({
      role: [...roles][0] || 'attendant',
      sectorNames: input.sectorNames,
      hasPortfolioPharmacies: input.hasPortfolioPharmacies,
    });
    for (const m of fallback) modes.add(m);
  }

  return [...modes];
}

export function resolveOperacaoModeFromRoles(input: {
  roleNames: string[];
  primaryRoleName?: string;
  sectorNames: string[];
  sectorIds?: string[];
  primarySectorId?: string | null;
  sectors?: SectorRow[];
  hasPortfolioPharmacies?: boolean;
}): OperacaoMode {
  const primary = String(input.primaryRoleName || input.roleNames[0] || '').toLowerCase();
  const modes = resolveOperacaoModesFromRoles({
    roleNames: input.roleNames,
    sectorNames: input.sectorNames,
    hasPortfolioPharmacies: input.hasPortfolioPharmacies,
  });
  const primaryMode = resolveOperacaoMode({
    role: primary,
    sectorIds: input.sectorIds,
    primarySectorId: input.primarySectorId,
    sectorNames: input.sectorNames,
    sectors: input.sectors,
    hasPortfolioPharmacies: input.hasPortfolioPharmacies,
  });
  if (modes.includes(primaryMode)) return primaryMode;
  return modes[0] || 'indisponivel';
}

export function resolveOperacaoModes(input: {
  role: string;
  sectorNames: string[];
  hasPortfolioPharmacies?: boolean;
}): OperacaoMode[] {
  const role = String(input.role || '').toLowerCase();
  const names = new Set(input.sectorNames);
  const hasPortfolio = Boolean(input.hasPortfolioPharmacies);
  const modes = new Set<OperacaoMode>();

  if (role === 'financial') {
    modes.add('gestor_financeiro');
    return [...modes];
  }
  if (role === 'admin') {
    modes.add('gestor_operacional');
    modes.add('gestor_financeiro');
    return [...modes];
  }
  if (role === 'supervisor') {
    if (names.has(FINANCEIRO)) modes.add('gestor_financeiro');
    if (names.has(OPERACIONAL) || names.has(ATENDIMENTO_GERAL)) modes.add('gestor_operacional');
    if (!modes.size) modes.add('gestor_operacional');
    return [...modes];
  }
  if (role !== 'attendant' && role !== 'attendant_financeiro' && role !== 'operational') {
    return [];
  }

  if (names.has(FINANCEIRO)) modes.add('execucao_financeiro');
  if (names.has(ATENDIMENTO_GERAL)) modes.add('execucao_geral');
  if (names.has(OPERACIONAL) || hasPortfolio) modes.add('carteira');
  if (!modes.size) modes.add(hasPortfolio ? 'carteira' : 'execucao_geral');
  return [...modes];
}

export function resolveOperacaoMode(input: {
  role: string;
  sectorIds?: string[];
  primarySectorId?: string | null;
  sectorNames: string[];
  sectors?: SectorRow[];
  hasPortfolioPharmacies?: boolean;
}): OperacaoMode {
  const role = String(input.role || '').toLowerCase();

  if (role === 'financial') return 'gestor_financeiro';
  if (role === 'supervisor') {
    const primaryName =
      primarySectorName(input.primarySectorId, input.sectorIds, input.sectors || []) || undefined;
    return resolveSupervisorGestorMode({ primarySectorName: primaryName, sectorNames: input.sectorNames });
  }
  if (role === 'admin') return 'gestor_operacional';
  if (role !== 'attendant' && role !== 'attendant_financeiro' && role !== 'operational') return 'indisponivel';

  const names = new Set(input.sectorNames);
  const hasPortfolio = Boolean(input.hasPortfolioPharmacies);
  const primaryName =
    primarySectorName(input.primarySectorId, input.sectorIds, input.sectors || []) || undefined;

  const pick =
    primaryName && names.has(primaryName)
      ? primaryName
      : names.has(OPERACIONAL)
        ? OPERACIONAL
        : names.has(ATENDIMENTO_GERAL)
          ? ATENDIMENTO_GERAL
          : names.has(FINANCEIRO)
            ? FINANCEIRO
            : [...names][0];

  if (pick === FINANCEIRO) return 'execucao_financeiro';
  if (pick === ATENDIMENTO_GERAL) return 'execucao_geral';
  if (pick === OPERACIONAL) return 'carteira';

  if (names.has(ATENDIMENTO_GERAL)) return 'execucao_geral';
  if (names.has(OPERACIONAL) || hasPortfolio) return 'carteira';
  if (names.has(FINANCEIRO)) return 'execucao_financeiro';

  return hasPortfolio ? 'carteira' : 'execucao_geral';
}
