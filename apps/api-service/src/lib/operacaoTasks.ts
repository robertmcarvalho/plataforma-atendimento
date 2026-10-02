import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LEGACY_TASK_KIND_TO_TYPE } from '@plataforma/ops-task-catalog';
import { buildSignatureMetadataForTask } from '@plataforma/operational-notes';
import {
  getAttendantPortfolioPharmacyIds,
  intersectPortfolioWithLeader,
} from './attendantPortfolio';
import {
  buildCadastroSearchOrFilter,
  DRIVER_SEARCH_CONFIG,
  nameMatchesSearchTokens,
} from './cadastroSearch';
import { filterActivePharmacyIds } from './opsAnalyticsAggregate';
import { loadOperationalDriverScope } from './operationalDriverScope';
import { writeAuditLog } from './auditLog';
import {
  assertTaskTypeCreatableForWorkspace,
  formatTaskTitle,
  loadOpsTaskCatalog,
} from './opsTaskCatalog';
import {
  computeTaskDueAtIso,
  loadOpsTaskPlaybooks,
  loadOpsTaskSlaConfig,
  resolveTaskPlaybook,
} from './opsTaskConfig';

/** @deprecated Use task_type string — mantido para alias na API. */
export type CreateTaskKind =
  | 'finalizar_cadastro'
  | 'preparar_matricula'
  | 'preparar_desligamento';

export function resolveManualTaskType(input: { task_type?: string; task_kind?: CreateTaskKind }): string {
  if (input.task_type?.trim()) return input.task_type.trim();
  if (input.task_kind && LEGACY_TASK_KIND_TO_TYPE[input.task_kind]) {
    return LEGACY_TASK_KIND_TO_TYPE[input.task_kind];
  }
  throw new Error('task_type ou task_kind é obrigatório.');
}

async function resolveSectorIdsByName(
  db: SupabaseClient,
  workspaceId: string,
  names: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const { data } = await db
      .from('sectors')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .ilike('name', name)
      .limit(1)
      .maybeSingle();
    if (data?.id) out[name] = String(data.id);
  }
  return out;
}

export async function assertDriverInAttendantPortfolio(
  db: SupabaseClient,
  workspaceId: string,
  attendantUserId: string,
  driverId: string
): Promise<void> {
  const rawIds = await getAttendantPortfolioPharmacyIds(db, workspaceId, attendantUserId);
  const pharmacyIds = await filterActivePharmacyIds(db, workspaceId, rawIds);
  if (!pharmacyIds.length) throw new Error('Carteira vazia.');
  const scope = await loadOperationalDriverScope(db, workspaceId, pharmacyIds);
  if (!scope.driverIds.has(driverId)) throw new Error('Entregador fora da sua carteira.');
}

function playbookChecklist(
  taskType: string,
  playbooksConfig: Awaited<ReturnType<typeof loadOpsTaskPlaybooks>>,
  metadata?: Record<string, unknown>
) {
  const pb = resolveTaskPlaybook(taskType, playbooksConfig, metadata);
  const progress = metadata?.playbook_progress;
  if (Array.isArray(progress)) return progress;
  return pb.steps.map((s) => ({ id: s.id, label: s.label, done: Boolean(s.done) }));
}

export async function createOperacaoManualTask(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    actorId: string;
    taskType: string;
    driverId: string;
    pharmacyId?: string | null;
    leaderId?: string | null;
    assigneeId?: string | null;
    notes?: string | null;
    lastWorkedAt?: string | null;
    operationStartedAt?: string | null;
    reason?: string | null;
    conversationId?: string | null;
    portfolioScope: boolean;
    /** @deprecated */
    taskKind?: CreateTaskKind;
  }
) {
  const taskType = input.taskType || resolveManualTaskType({ task_kind: input.taskKind });

  const catalogEntry = await assertTaskTypeCreatableForWorkspace(db, input.workspaceId, taskType, 'manual');
  if (!catalogEntry.manual_create) {
    throw new Error(`Tipo de tarefa "${catalogEntry.label}" não permite criação manual.`);
  }

  const { data: driver, error: driverErr } = await db
    .from('drivers')
    .select('id, name, status, primary_pharmacy_id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.driverId)
    .maybeSingle();
  if (driverErr || !driver) throw new Error('Entregador não encontrado.');

  if (input.portfolioScope) {
    await assertDriverInAttendantPortfolio(db, input.workspaceId, input.actorId, input.driverId);
  }

  const { data: dup } = await db
    .from('pending_tasks')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('driver_id', input.driverId)
    .eq('task_type', taskType)
    .in('status', ['open', 'in_progress'])
    .limit(1)
    .maybeSingle();
  if (dup?.id) {
    throw new Error(`Já existe tarefa aberta (${taskType}) para este entregador.`);
  }

  const { data: links } = await db
    .from('driver_pharmacy_links')
    .select('pharmacy_id, is_primary, pharmacies(id, trade_name, city, leader_id)')
    .eq('driver_id', input.driverId)
    .eq('is_active', true);
  const pharmacyIds = Array.from(new Set((links || []).map((l) => String(l.pharmacy_id)).filter(Boolean)));
  const primaryPharmacyId =
    input.pharmacyId || driver.primary_pharmacy_id || pharmacyIds[0] || null;
  const taskPharmacyIds = Array.from(new Set([primaryPharmacyId, ...pharmacyIds].filter(Boolean) as string[]));

  let resolvedLeaderId = input.leaderId || null;
  if (!resolvedLeaderId && primaryPharmacyId) {
    const { data: pharm } = await db
      .from('pharmacies')
      .select('leader_id, leader:leaders(name)')
      .eq('workspace_id', input.workspaceId)
      .eq('id', primaryPharmacyId)
      .maybeSingle();
    if (pharm?.leader_id) resolvedLeaderId = String(pharm.leader_id);
  }

  let leaderName: string | null = null;
  if (resolvedLeaderId) {
    const { data: leader } = await db
      .from('leaders')
      .select('name')
      .eq('workspace_id', input.workspaceId)
      .eq('id', resolvedLeaderId)
      .maybeSingle();
    leaderName = leader?.name ? String(leader.name) : null;
  }

  const sectors = await resolveSectorIdsByName(db, input.workspaceId, [
    'Atendimento Geral',
    'Operacional',
    'Financeiro',
  ]);
  const [playbooksConfig, slaConfig] = await Promise.all([
    loadOpsTaskPlaybooks(db, input.workspaceId),
    loadOpsTaskSlaConfig(db, input.workspaceId),
  ]);

  const requestId = randomUUID();
  const nowIso = new Date().toISOString();
  const driverName = String(driver.name || '');
  const baseMetadata: Record<string, unknown> = {
    source: 'operacao_manual',
    created_by: input.actorId,
    request_id: requestId,
    leader_id: resolvedLeaderId,
    leader_name: leaderName,
    driver_id: input.driverId,
    driver_name: driver.name,
    pharmacy_ids: taskPharmacyIds,
    primary_pharmacy_id: primaryPharmacyId,
    notes: input.notes || null,
    last_worked_at: input.lastWorkedAt || null,
    operation_started_at: input.operationStartedAt || null,
    termination_reason: input.reason || null,
    requested_at: nowIso,
    playbook_progress: playbookChecklist(taskType, playbooksConfig),
    deep_link: '/operacao',
  };

  const assigneeId = input.assigneeId || input.actorId;
  const inserted: Array<Record<string, unknown>> = [];

  const title = formatTaskTitle(catalogEntry.title_template, { driver_name: driverName });
  const sigMeta =
    taskType === 'driver_enrollment_prep' || taskType === 'driver_termination_prep'
      ? buildSignatureMetadataForTask(taskType, input.driverId, driverName)
      : {};
  const { data, error } = await db
    .from('pending_tasks')
    .insert({
      workspace_id: input.workspaceId,
      task_type: taskType,
      title: title || `Tarefa: ${driverName}`,
      description: 'Tarefa criada manualmente no painel Operação.',
      status: 'open',
      priority: 'normal',
      driver_id: input.driverId,
      assignee_id: assigneeId,
      sector_id: sectors['Atendimento Geral'] || null,
      conversation_id: input.conversationId || null,
      source: 'operacao_manual',
      due_at: computeTaskDueAtIso(taskType, slaConfig),
      metadata: {
        ...baseMetadata,
        ...sigMeta,
        playbook_progress: playbookChecklist(taskType, playbooksConfig),
      },
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  if (data) inserted.push(data);

  const mainTask = inserted[0];
  const taskId = mainTask ? String(mainTask.id) : '';

  await writeAuditLog({
    actor_id: input.actorId,
    action: 'ops.task.create_manual',
    entity_type: 'pending_task',
    entity_id: taskId,
    workspace_id: input.workspaceId,
    metadata: { task_type: taskType, driver_id: input.driverId, task_ids: inserted.map((t) => t.id) },
  });

  return {
    tasks: inserted,
    task_id: taskId,
    deep_link: `/operacao?task=${taskId}`,
  };
}

export async function loadManualTaskTypesForLaunch(db: SupabaseClient, workspaceId: string) {
  const catalog = await loadOpsTaskCatalog(db, workspaceId);
  return catalog
    .filter((e) => e.enabled && e.manual_create)
    .map((e) => ({
      task_type: e.task_type,
      label: e.label,
      icon: e.icon,
      tone: e.tone,
    }));
}

export type OpsLaunchDriverRow = {
  id: string;
  name: string;
  phone: string | null;
  primary_pharmacy_id: string | null;
  leader_linked_pharmacy_ids: string[];
};

async function loadActiveDriverPharmacyLinks(
  db: SupabaseClient,
  workspaceId: string,
  driverIds: string[]
): Promise<Map<string, string[]>> {
  const linksByDriver = new Map<string, string[]>();
  if (!driverIds.length) return linksByDriver;

  const { data: links } = await db
    .from('driver_pharmacy_links')
    .select('driver_id, pharmacy_id')
    .eq('workspace_id', workspaceId)
    .in('driver_id', driverIds)
    .eq('is_active', true);

  for (const link of links || []) {
    const did = String(link.driver_id);
    const list = linksByDriver.get(did) || [];
    if (link.pharmacy_id) list.push(String(link.pharmacy_id));
    linksByDriver.set(did, list);
  }
  return linksByDriver;
}

function mapDriverToLaunchRow(
  d: { id: string; name?: string | null; phone?: string | null; primary_pharmacy_id?: string | null },
  linksByDriver: Map<string, string[]>
): OpsLaunchDriverRow {
  const id = String(d.id);
  const linked = linksByDriver.get(id) || [];
  const primary = d.primary_pharmacy_id ? String(d.primary_pharmacy_id) : null;
  return {
    id,
    name: String(d.name || ''),
    phone: d.phone ? String(d.phone) : null,
    primary_pharmacy_id: primary,
    leader_linked_pharmacy_ids: linked.length > 0 ? linked : primary ? [primary] : [],
  };
}

export async function searchOpsLaunchDrivers(
  db: SupabaseClient,
  workspaceId: string,
  opts: {
    q: string;
    scope: 'ag' | 'portfolio';
    attendantUserId?: string;
    leaderId?: string;
    limit?: number;
  }
): Promise<OpsLaunchDriverRow[]> {
  const q = String(opts.q || '').trim();
  if (q.length < 2) return [];

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 50);
  const firstToken = q.split(/\s+/).find((t) => t.length >= 2) || q;
  const orFilter = buildCadastroSearchOrFilter(firstToken, DRIVER_SEARCH_CONFIG);
  if (!orFilter) return [];

  let pharmacyIds: string[] | null = null;
  if (opts.scope === 'portfolio') {
    if (!opts.attendantUserId) return [];
    const rawIds = await getAttendantPortfolioPharmacyIds(db, workspaceId, opts.attendantUserId);
    pharmacyIds = await filterActivePharmacyIds(db, workspaceId, rawIds);
    if (opts.leaderId?.trim()) {
      const intersect = await intersectPortfolioWithLeader(
        db,
        opts.attendantUserId,
        opts.leaderId.trim(),
        workspaceId
      );
      pharmacyIds = intersect;
    }
    if (!pharmacyIds.length) return [];
  }

  let query = db
    .from('drivers')
    .select('id, name, phone, primary_pharmacy_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .or(orFilter)
    .order('name')
    .limit(limit * 3);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  let candidates = (rows || []).filter((d) => nameMatchesSearchTokens(String(d.name || ''), q));

  let scopedLinksByDriver: Map<string, string[]> | null = null;
  if (opts.scope === 'portfolio' && pharmacyIds) {
    const scope = await loadOperationalDriverScope(db, workspaceId, pharmacyIds);
    candidates = candidates.filter((d) => scope.driverIds.has(String(d.id)));
    scopedLinksByDriver = scope.pharmacyIdsByDriver;
  }

  candidates = candidates.slice(0, limit);
  const linksByDriver = await loadActiveDriverPharmacyLinks(
    db,
    workspaceId,
    candidates.map((d) => String(d.id))
  );
  if (scopedLinksByDriver) {
    for (const [driverId, ids] of scopedLinksByDriver) {
      if (!candidates.some((d) => String(d.id) === driverId)) continue;
      const current = linksByDriver.get(driverId) || [];
      linksByDriver.set(driverId, [...new Set([...current, ...ids])]);
    }
  }

  return candidates.map((d) => mapDriverToLaunchRow(d, linksByDriver));
}

export async function buildAgTaskLaunchContext(db: SupabaseClient, workspaceId: string, limit = 200) {
  const manual_task_types = await loadManualTaskTypesForLaunch(db, workspaceId);

  const { data: drivers } = await db
    .from('drivers')
    .select('id, name, phone, primary_pharmacy_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('name')
    .limit(limit);

  const driverIds = (drivers || []).map((d) => String(d.id)).filter(Boolean);
  const linksByDriver = await loadActiveDriverPharmacyLinks(db, workspaceId, driverIds);

  const { data: pharmacies } = await db
    .from('pharmacies')
    .select('id, trade_name, leader_id, leader:leaders(id, name)')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('trade_name')
    .limit(limit);

  return {
    manual_task_types,
    drivers: (drivers || []).map((d) => mapDriverToLaunchRow(d, linksByDriver)),
    pharmacies: (pharmacies || []).map((p) => {
      const leader = Array.isArray(p.leader) ? p.leader[0] : p.leader;
      return {
        id: String(p.id),
        trade_name: String(p.trade_name || ''),
        leader_id: p.leader_id ? String(p.leader_id) : null,
        leader_name: leader?.name ? String(leader.name) : null,
      };
    }),
    leaders: [] as Array<{ id: string; name: string }>,
  };
}
