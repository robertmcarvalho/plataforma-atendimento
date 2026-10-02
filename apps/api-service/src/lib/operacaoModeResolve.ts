import type { SupabaseClient } from '@supabase/supabase-js';
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
import { sectorIdsFromJwt } from './jwtSectorIds';
import { isAttendantLikeRole } from './roleAliases';
import { getAttendantPortfolioPharmacyIds } from './attendantPortfolio';
import { filterActivePharmacyIds } from './opsAnalyticsAggregate';

export type { OperacaoMode, SectorRow };
export { isFinanceGestorScope, primarySectorName, resolveOperacaoMode, resolveOperacaoModes, resolveOperacaoModesFromRoles, resolveOperacaoModeFromRoles };

export async function resolveOperacaoModeFromAuth(
  db: SupabaseClient,
  workspaceId: string,
  user: {
    sub: string;
    role?: string;
    workspace_role?: string;
    workspace_roles?: string[];
    sector_id?: string | null;
    sector_ids?: string[];
  }
): Promise<{
  mode: OperacaoMode;
  modes: OperacaoMode[];
  role: string;
  roles: string[];
  sectorNames: string[];
  sectorIds: string[];
  portfolioPharmacyCount: number;
}> {
  const role = String(user.workspace_role || user.role || '').toLowerCase();
  const roleNames = Array.from(
    new Set(
      (user.workspace_roles?.length ? user.workspace_roles : [role])
        .map((r) => String(r || '').toLowerCase())
        .filter(Boolean)
    )
  );
  const sectorIds = sectorIdsFromJwt(user);

  const { data: sectorRows, error: sectorErr } = await db
    .from('sectors')
    .select('id, name')
    .eq('workspace_id', workspaceId);
  if (sectorErr) throw new Error(sectorErr.message);

  const sectors = (sectorRows || []).map((s) => ({ id: String(s.id), name: String(s.name || '') }));
  const sectorNames = sectorIds
    .map((id) => sectors.find((s) => s.id === id)?.name)
    .filter((n): n is string => Boolean(n));

  let portfolioPharmacyCount = 0;
  if (isAttendantLikeRole(role) || role === 'operational') {
    const rawIds = await getAttendantPortfolioPharmacyIds(db, workspaceId, user.sub);
    portfolioPharmacyCount = (await filterActivePharmacyIds(db, workspaceId, rawIds)).length;
  }

  const mode = resolveOperacaoModeFromRoles({
    roleNames,
    primaryRoleName: role,
    sectorIds,
    primarySectorId: user.sector_id,
    sectorNames,
    sectors,
    hasPortfolioPharmacies: portfolioPharmacyCount > 0,
  });

  const modes = resolveOperacaoModesFromRoles({
    roleNames,
    sectorNames,
    hasPortfolioPharmacies: portfolioPharmacyCount > 0,
  });

  return { mode, modes, role, roles: roleNames, sectorNames, sectorIds, portfolioPharmacyCount };
}

export async function assertOperacaoModeAccess(
  db: SupabaseClient,
  workspaceId: string,
  user: {
    sub: string;
    role?: string;
    workspace_role?: string;
    sector_id?: string | null;
    sector_ids?: string[];
  },
  allowedModes: OperacaoMode[],
  options?: { allowAdmin?: boolean }
): Promise<
  | { ok: true; resolved: Awaited<ReturnType<typeof resolveOperacaoModeFromAuth>> }
  | { ok: false; status: 403; error: string }
> {
  const resolved = await resolveOperacaoModeFromAuth(db, workspaceId, user);
  const allowAdmin = options?.allowAdmin !== false;
  if (allowAdmin && resolved.role === 'admin') return { ok: true, resolved };
  if (allowedModes.includes(resolved.mode)) return { ok: true, resolved };
  return { ok: false, status: 403, error: 'Acesso negado' };
}
