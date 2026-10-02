import { FastifyInstance } from 'fastify';
import { OccurrenceKind } from '@plataforma/operational-notes';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';
import { supabase } from '../lib/supabase';
import { writeAuditLog } from '../lib/auditLog';
import { assertLifecycleScopeForAttendant, assertOccurrenceScopeForAttendant } from '../lib/attendantPortfolio';
import {
  createPreCadastroBundle,
  createTerminationRequestBundle,
} from '../lib/driverLifecycleBundles';
import { sectorIdsFromJwt } from '../lib/jwtSectorIds';
import { resolveSectorIdsFromQueueAssignments } from '../lib/userSectorsDb';
import {
  buildCoordinationSummary,
  buildExecutionBoard,
  buildFinancialOperationsHub,
  buildPortfolioLaunchContext,
  buildPortfolioOperationsHub,
  buildPortfolioSummary,
} from '../lib/opsAnalyticsAggregate';
import {
  buildAgTaskLaunchContext,
  createOperacaoManualTask,
  loadManualTaskTypesForLaunch,
  resolveManualTaskType,
  searchOpsLaunchDrivers,
} from '../lib/operacaoTasks';

const OPS_PORTFOLIO_ROLES = ['attendant', 'operational'] as const;
import { buildGestorOperacionalHub, listOperacionalAttendants } from '../lib/gestorOperacionalHub';
import { assertOperacaoModeAccess, resolveOperacaoModeFromAuth } from '../lib/operacaoModeResolve';
import { insertOccurrence, occurrencePrimaryEntryId } from '../lib/leaderOccurrences';
import { runSignatureSyncForWorkspace } from '../lib/signatureStatusSync';
import { listAllAutentiqueDocuments, canCallAutentiqueApi } from '@plataforma/operational-notes';
import { parseAutentiqueDocumentName } from '@plataforma/operational-notes';

const periodQuerySchema = z.object({
  period: z.coerce.number().int().min(1).max(90).optional(),
  reference_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pharmacy_id: z.string().uuid().optional(),
});

function parseHubQuery(query: unknown) {
  const parsed = periodQuerySchema.safeParse(query);
  if (!parsed.success) {
    return { period: 30, referenceDate: undefined as string | undefined, pharmacyId: undefined as string | undefined };
  }
  return {
    period: parsed.data.period ?? 30,
    referenceDate: parsed.data.reference_date,
    pharmacyId: parsed.data.pharmacy_id,
  };
}

function scopePharmacyIds(pharmacyIds: string[], pharmacyId?: string): string[] {
  if (!pharmacyId) return pharmacyIds;
  return pharmacyIds.includes(pharmacyId) ? [pharmacyId] : [];
}

async function resolveOperationalSectorFlags(
  workspaceId: string,
  user: { sub: string; sector_ids?: string[]; sector_id?: string | null }
) {
  let sids = sectorIdsFromJwt(user);
  if (!sids.length) {
    sids = await resolveSectorIdsFromQueueAssignments(supabase, workspaceId, user.sub);
  }
  const { data: sectors } = await supabase
    .from('sectors')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .in('name', ['Operacional', 'Atendimento Geral']);
  const sectorNames = new Set(
    (sectors || []).filter((s) => sids.includes(String(s.id))).map((s) => String(s.name))
  );
  return {
    sectorIds: sids,
    isAnalyst: sectorNames.has('Operacional'),
    isAg: sectorNames.has('Atendimento Geral'),
  };
}

const AG_TASK_TYPES = [
  'driver_pre_registration',
  'driver_registration_completion',
  'driver_enrollment_prep',
  'driver_termination_prep',
  'driver_termination_request',
  'driver_doc_expiry_warning',
  'driver_doc_expired',
  'guided_demand',
] as const;

const FIN_TASK_TYPES = ['financial_advance_request', 'driver_termination_financial_review'] as const;

const createTaskBodySchema = z
  .object({
    task_type: z.string().min(3).max(64).optional(),
    task_kind: z.enum(['finalizar_cadastro', 'preparar_matricula', 'preparar_desligamento']).optional(),
    driver_id: z.string().uuid(),
    pharmacy_id: z.string().uuid().optional(),
    leader_id: z.string().uuid().nullable().optional(),
    assignee_id: z.string().uuid().optional(),
    notes: z.string().max(2000).optional(),
    last_worked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    operation_started_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    reason: z.enum(['driver_request', 'performance', 'absence', 'route_ended', 'other']).optional(),
    conversation_id: z.string().uuid().optional(),
    /** `ag` = Atendimento Geral (sem validação de carteira); `portfolio` = analista operacional. */
    scope: z.enum(['ag', 'portfolio']).optional(),
  })
  .refine((b) => Boolean(b.task_type?.trim() || b.task_kind), {
    message: 'Informe task_type ou task_kind',
    path: ['task_type'],
  });

const preRegistrationBodySchema = z.object({
  on_behalf_of_leader_id: z.string().uuid(),
  name: z.string().min(2),
  cpf: z.string().optional().nullable(),
  phone: z.string().min(10),
  email: z.string().email().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  driver_type: z.enum(['fixed', 'daily']).default('fixed'),
  work_schedule: z.record(z.unknown()).optional(),
  pharmacy_ids: z.array(z.string().uuid()).min(1),
  primary_pharmacy_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const terminationRequestBodySchema = z.object({
  on_behalf_of_leader_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  last_worked_at: z.string().min(8),
  reason: z.enum(['driver_request', 'performance', 'absence', 'route_ended', 'other']),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const occurrenceBodySchema = z.object({
  on_behalf_of_leader_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  pharmacy_ids: z.array(z.string().uuid()).min(1),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift: z.enum(['full', 'morning', 'afternoon', 'night']).optional(),
  occurrence_kind: z.enum([
    OccurrenceKind.UNEXCUSED,
    OccurrenceKind.DAY_OFF,
    OccurrenceKind.CONTRACTED_DAILY,
  ]),
  has_coverage: z.boolean(),
  coverage: z
    .object({
      covering_driver_id: z.string().uuid(),
      amount: z.number().positive(),
      notes: z.string().optional(),
    })
    .optional(),
  contracted_daily: z
    .object({
      amount: z.number().positive(),
      notes: z.string().optional(),
    })
    .optional(),
  reason: z.string().optional(),
});

export async function opsAnalyticsRoutes(app: FastifyInstance) {
  app.get('/operacao-mode', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as {
      sub: string;
      role?: string;
      workspace_role?: string;
      sector_id?: string | null;
      sector_ids?: string[];
    };
    try {
      const resolved = await resolveOperacaoModeFromAuth(supabase, workspaceId, user);
      return reply.send({
        mode: resolved.mode,
        modes: resolved.modes,
        roles: resolved.roles,
        role: resolved.role,
        sector_names: resolved.sectorNames,
        sector_ids: resolved.sectorIds,
        portfolio_pharmacy_count: resolved.portfolioPharmacyCount,
      });
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao resolver painel de operação' });
    }
  });

  app.get(
    '/portfolio',
    { preHandler: [authenticate, requireRole(...OPS_PORTFOLIO_ROLES)] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const parsed = periodQuerySchema.safeParse(request.query);
      const period = parsed.success ? parsed.data.period ?? 30 : 30;
      const user = request.user as { sub: string };
      try {
        const summary = await buildPortfolioSummary(supabase, workspaceId, user.sub, period);
        return reply.send(summary);
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao montar carteira' });
      }
    }
  );

  app.get(
    '/portfolio/hub',
    { preHandler: [authenticate, requireRole(...OPS_PORTFOLIO_ROLES)] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { period, referenceDate, pharmacyId } = parseHubQuery(request.query);
      const user = request.user as { sub: string };
      try {
        const hub = await buildPortfolioOperationsHub(supabase, workspaceId, user.sub, period, {
          referenceDate,
          pharmacyId,
        });
        return reply.send(hub);
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao montar hub da carteira' });
      }
    }
  );

  app.get('/financial-hub', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as {
      sub: string;
      role?: string;
      workspace_role?: string;
      sector_id?: string | null;
      sector_ids?: string[];
    };
    try {
      const access = await assertOperacaoModeAccess(supabase, workspaceId, user, ['gestor_financeiro']);
      if (!access.ok) return reply.status(access.status).send({ error: access.error });
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao validar acesso financeiro' });
    }
    const { period, referenceDate, pharmacyId } = parseHubQuery(request.query);
    try {
      const hub = await buildFinancialOperationsHub(supabase, workspaceId, period, {
        referenceDate,
        pharmacyId,
      });
      return reply.send(hub);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao montar hub financeiro' });
    }
  });

  app.get(
    '/portfolio/launch-context',
    { preHandler: [authenticate, requireRole(...OPS_PORTFOLIO_ROLES)] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const q = request.query as { leader_id?: string };
      const user = request.user as { sub: string };
      try {
        const ctx = await buildPortfolioLaunchContext(
          supabase,
          workspaceId,
          user.sub,
          q.leader_id?.trim() || undefined
        );
        return reply.send(ctx);
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao carregar contexto' });
      }
    }
  );

  app.post(
    '/occurrences',
    { preHandler: [authenticate, requireRole(...OPS_PORTFOLIO_ROLES)] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const parsed = occurrenceBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
      }
      const user = request.user as { sub: string; name?: string };
      const payload = parsed.data;

      try {
        await assertOccurrenceScopeForAttendant(supabase, {
          workspaceId,
          attendantUserId: user.sub,
          onBehalfOfLeaderId: payload.on_behalf_of_leader_id,
          pharmacyIds: payload.pharmacy_ids,
          driverId: payload.driver_id,
          coveringDriverId:
            payload.has_coverage && payload.coverage ? payload.coverage.covering_driver_id : undefined,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Escopo inválido';
        const status = msg.includes('fora') ? 403 : 400;
        return reply.status(status).send({ error: msg });
      }

      const { data: leaderRow } = await supabase
        .from('leaders')
        .select('name')
        .eq('id', payload.on_behalf_of_leader_id)
        .maybeSingle();
      const { data: attendantRow } = await supabase.from('users').select('name').eq('id', user.sub).maybeSingle();
      const leaderName = String(leaderRow?.name || 'líder');
      const attendantName = String(attendantRow?.name || user.name || 'analista');
      const defaultReason = `Registrado pelo analista ${attendantName} em substituição ao líder ${leaderName}.`;
      const reason = payload.reason?.trim()
        ? `${defaultReason} ${payload.reason.trim()}`
        : defaultReason;

      try {
        const result = await insertOccurrence(supabase, {
          workspace_id: workspaceId,
          created_by: user.sub,
          driver_id: payload.driver_id,
          pharmacy_ids: payload.pharmacy_ids,
          event_date: payload.event_date,
          shift: payload.shift,
          occurrence_kind: payload.occurrence_kind,
          has_coverage: payload.has_coverage,
          coverage: payload.coverage,
          contracted_daily: payload.contracted_daily,
          reason,
          source: 'attendant',
        });

        await writeAuditLog({
          actor_id: user.sub,
          action: 'ops.occurrence.create_on_behalf',
          entity_type: 'financial_entry',
          entity_id: occurrencePrimaryEntryId(result),
          workspace_id: workspaceId,
          metadata: {
            on_behalf_of_leader_id: payload.on_behalf_of_leader_id,
            attendant_id: user.sub,
            driver_id: payload.driver_id,
            pharmacy_ids: payload.pharmacy_ids,
            occurrence_kind: payload.occurrence_kind,
          },
        });

        return reply.status(201).send({
          absence_entries: result.absence_entries,
          coverage_daily_entries: result.coverage_daily_entries,
          installments_created: result.installments_created,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha ao registrar ocorrência';
        const status =
          msg.includes('Ciclo') ||
          msg.includes('futuro') ||
          msg.includes('cobridor') ||
          msg.includes('Valor') ||
          msg.includes('Diária contratada')
            ? 400
            : 500;
        return reply.status(status).send({ error: msg });
      }
    }
  );

  app.get(
    '/execution-board',
    { preHandler: [authenticate, requireRole(...OPS_PORTFOLIO_ROLES)] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { period, referenceDate, pharmacyId } = parseHubQuery(request.query);
      const q = request.query as {
        board?: string;
        task_type?: string;
        status?: string;
        assignee_id?: string;
        date_from?: string;
        date_to?: string;
      };
      const user = request.user as { sub: string; role?: string; sector_id?: string | null; sector_ids?: string[] };
      const sids = sectorIdsFromJwt(user);
      const board = String(q.board || 'geral').toLowerCase();
      const taskTypes =
        board === 'financeiro' ? [...FIN_TASK_TYPES] : [...AG_TASK_TYPES];
      try {
        const data = await buildExecutionBoard(supabase, workspaceId, user.sub, sids, taskTypes, period, {
          referenceDate,
          pharmacyId,
          taskType: q.task_type?.trim() || undefined,
          status: q.status?.trim() || undefined,
          assigneeId: q.assignee_id?.trim() || undefined,
          dateFrom: q.date_from?.trim() || undefined,
          dateTo: q.date_to?.trim() || undefined,
        });
        return reply.send(data);
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao montar quadro de execução' });
      }
    }
  );

  app.get(
    '/drivers/search',
    { preHandler: [authenticate, requireRole('attendant', 'supervisor', 'operational')] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const user = request.user as { sub: string; role?: string; sector_ids?: string[]; sector_id?: string | null };
      const q = request.query as { q?: string; scope?: string; leader_id?: string };
      const searchQ = String(q.q || '').trim();
      if (searchQ.length < 2) {
        return reply.send({ drivers: [] });
      }
      try {
        const role = String(user.role || '').trim().toLowerCase();
        const isElevated = role === 'supervisor' || role === 'admin';
        const { isAnalyst, isAg } = await resolveOperationalSectorFlags(workspaceId, user);
        const requestedPortfolio = String(q.scope || 'ag').toLowerCase() === 'portfolio';
        const scope = requestedPortfolio && isAnalyst && !isAg && !isElevated ? 'portfolio' : 'ag';
        const drivers = await searchOpsLaunchDrivers(supabase, workspaceId, {
          q: searchQ,
          scope,
          attendantUserId: user.sub,
          leaderId: q.leader_id?.trim() || undefined,
        });
        return reply.send({ drivers });
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao buscar entregadores' });
      }
    }
  );

  app.get(
    '/tasks/launch-context',
    { preHandler: [authenticate, requireRole('attendant', 'supervisor')] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const user = request.user as { sub: string; role?: string; sector_ids?: string[]; sector_id?: string | null };
      const q = request.query as { scope?: string };
      try {
        const role = String(user.role || '').trim().toLowerCase();
        const isElevated = role === 'supervisor' || role === 'admin';
        const { isAnalyst, isAg } = await resolveOperationalSectorFlags(workspaceId, user);
        const requestedPortfolio = String(q.scope || 'ag').toLowerCase() === 'portfolio';
        const scope = requestedPortfolio && isAnalyst && !isAg && !isElevated ? 'portfolio' : 'ag';
        if (scope === 'portfolio') {
          const [ctx, manual_task_types] = await Promise.all([
            buildPortfolioLaunchContext(supabase, workspaceId, user.sub),
            loadManualTaskTypesForLaunch(supabase, workspaceId),
          ]);
          return reply.send({
            ...ctx,
            manual_task_types,
          });
        }
        const ctx = await buildAgTaskLaunchContext(supabase, workspaceId);
        return reply.send(ctx);
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao carregar contexto de tarefas' });
      }
    }
  );

  app.post(
    '/pre-registrations',
    { preHandler: [authenticate, requireRole(...OPS_PORTFOLIO_ROLES)] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const parsed = preRegistrationBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
      }
      const user = request.user as { sub: string };
      const payload = parsed.data;
      try {
        await assertLifecycleScopeForAttendant(supabase, {
          workspaceId,
          attendantUserId: user.sub,
          onBehalfOfLeaderId: payload.on_behalf_of_leader_id,
          pharmacyIds: payload.pharmacy_ids,
        });
        const result = await createPreCadastroBundle(supabase, {
          workspaceId,
          leaderId: payload.on_behalf_of_leader_id,
          initiatedBy: user.sub,
          source: 'operacao_analyst',
          name: payload.name,
          cpf: payload.cpf || null,
          phone: payload.phone,
          email: payload.email || null,
          city: payload.city || null,
          state: payload.state || null,
          driver_type: payload.driver_type,
          work_schedule: payload.work_schedule,
          pharmacy_ids: payload.pharmacy_ids,
          primary_pharmacy_id: payload.primary_pharmacy_id,
          notes: payload.notes || null,
        });
        await writeAuditLog({
          actor_id: user.sub,
          action: 'ops.pre_registration.create',
          entity_type: 'driver',
          entity_id: String((result.driver as { id?: string }).id || ''),
          workspace_id: workspaceId,
          metadata: { leader_id: payload.on_behalf_of_leader_id, request_id: result.request_id },
        });
        return reply.status(201).send(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha no pré-cadastro';
        const status = msg.includes('fora') ? 403 : msg.includes('Já existe') ? 409 : 500;
        return reply.status(status).send({ error: msg });
      }
    }
  );

  app.post(
    '/termination-requests',
    { preHandler: [authenticate, requireRole(...OPS_PORTFOLIO_ROLES)] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const parsed = terminationRequestBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
      }
      const user = request.user as { sub: string };
      const payload = parsed.data;
      try {
        const { data: links } = await supabase
          .from('driver_pharmacy_links')
          .select('pharmacy_id')
          .eq('driver_id', payload.driver_id)
          .eq('is_active', true);
        const pharmacyIds = Array.from(
          new Set((links || []).map((l: { pharmacy_id: string }) => String(l.pharmacy_id)).filter(Boolean))
        );
        await assertLifecycleScopeForAttendant(supabase, {
          workspaceId,
          attendantUserId: user.sub,
          onBehalfOfLeaderId: payload.on_behalf_of_leader_id,
          pharmacyIds,
          driverId: payload.driver_id,
        });
        const result = await createTerminationRequestBundle(supabase, {
          workspaceId,
          driverId: payload.driver_id,
          leaderId: payload.on_behalf_of_leader_id,
          initiatedBy: user.sub,
          source: 'operacao_analyst',
          last_worked_at: payload.last_worked_at,
          reason: payload.reason,
          notes: payload.notes || null,
        });
        await writeAuditLog({
          actor_id: user.sub,
          action: 'ops.termination.request',
          entity_type: 'driver',
          entity_id: payload.driver_id,
          workspace_id: workspaceId,
          metadata: { leader_id: payload.on_behalf_of_leader_id, request_id: result.request_id },
        });
        return reply.status(201).send(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha ao solicitar desligamento';
        const status =
          msg.includes('fora') ? 403 : msg.includes('Já existe') || msg.includes('inativo') ? 409 : 500;
        return reply.status(status).send({ error: msg });
      }
    }
  );

  app.post(
    '/tasks',
    { preHandler: [authenticate, requireRole('attendant', 'supervisor')] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const parsed = createTaskBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
      }
      const user = request.user as { sub: string; role?: string; sector_ids?: string[]; sector_id?: string | null };
      const payload = parsed.data;
      const role = String(user.role || '').trim().toLowerCase();
      const isElevated = role === 'supervisor' || role === 'admin';
      const { isAnalyst, isAg } = await resolveOperationalSectorFlags(workspaceId, user);

      if (!isAnalyst && !isAg && !isElevated) {
        return reply.status(403).send({ error: 'Sem permissão para criar tarefas neste setor.' });
      }

      const scopeParam = String(payload.scope || '').toLowerCase();
      let portfolioScope: boolean;
      if (scopeParam === 'ag') {
        portfolioScope = false;
      } else if (scopeParam === 'portfolio') {
        if (!isAnalyst && !isElevated) {
          return reply.status(403).send({ error: 'Sem permissão para tarefas de carteira.' });
        }
        portfolioScope = isAnalyst && !isAg && !isElevated;
      } else {
        // Compat: só exige carteira quando o atendente é exclusivamente do setor Operacional.
        portfolioScope = isElevated ? false : isAnalyst && !isAg;
      }

      try {
        const taskType = resolveManualTaskType({
          task_type: payload.task_type,
          task_kind: payload.task_kind,
        });
        const result = await createOperacaoManualTask(supabase, {
          workspaceId,
          actorId: user.sub,
          taskType,
          taskKind: payload.task_kind,
          driverId: payload.driver_id,
          pharmacyId: payload.pharmacy_id,
          leaderId: payload.leader_id,
          assigneeId: payload.assignee_id,
          notes: payload.notes,
          lastWorkedAt: payload.last_worked_at,
          operationStartedAt: payload.operation_started_at,
          reason: payload.reason,
          conversationId: payload.conversation_id,
          portfolioScope,
        });
        return reply.status(201).send(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha ao criar tarefa';
        const status = msg.includes('Já existe')
          ? 409
          : msg.includes('carteira') || msg.includes('fora')
            ? 403
            : msg.includes('desabilitado')
              ? 403
              : 400;
        return reply.status(status).send({ error: msg });
      }
    }
  );

  app.get(
    '/gestor-operacional/attendants',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const user = request.user as {
        sub: string;
        role?: string;
        workspace_role?: string;
        sector_id?: string | null;
        sector_ids?: string[];
      };
      try {
        const access = await assertOperacaoModeAccess(supabase, workspaceId, user, ['gestor_operacional']);
        if (!access.ok) return reply.status(access.status).send({ error: access.error });
        const attendants = await listOperacionalAttendants(supabase, workspaceId);
        return reply.send({ attendants });
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao listar analistas' });
      }
    }
  );

  app.get(
    '/gestor-operacional/hub',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const user = request.user as {
        sub: string;
        role?: string;
        workspace_role?: string;
        sector_id?: string | null;
        sector_ids?: string[];
      };
      try {
        const access = await assertOperacaoModeAccess(supabase, workspaceId, user, ['gestor_operacional']);
        if (!access.ok) return reply.status(access.status).send({ error: access.error });
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao validar acesso operacional' });
      }
      const { period, referenceDate, pharmacyId } = parseHubQuery(request.query);
      const q = request.query as { attendant_id?: string };
      const attendantId = q.attendant_id?.trim() || undefined;
      try {
        const hub = await buildGestorOperacionalHub(supabase, workspaceId, period, attendantId, {
          referenceDate,
          pharmacyId,
        });
        return reply.send(hub);
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao montar hub do gestor' });
      }
    }
  );

  app.post(
    '/signatures/reconcile',
    { preHandler: [authenticate, requireRole('admin', 'supervisor')] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      if (!canCallAutentiqueApi()) {
        return reply.status(503).send({
          error: 'Integração Autentique pausada. Reative com AUTENTIQUE_SYNC_ENABLED=true quando decidir retomar.',
          paused: true,
        });
      }
      try {
        const syncResult = await runSignatureSyncForWorkspace(supabase, workspaceId);
        let docs: Awaited<ReturnType<typeof listAllAutentiqueDocuments>> = [];
        try {
          docs = await listAllAutentiqueDocuments(3);
        } catch {
          return reply.send({
            synced: syncResult.synced ?? 0,
            autentique_fetch_failed: true,
            aethera_docs: [],
            unmatched_aethera: [],
          });
        }
        const aetheraDocs = docs.filter((d) => d.name.startsWith('AETHERA_'));
        const parsed = aetheraDocs.map((d) => ({
          id: d.id,
          name: d.name,
          parsed: parseAutentiqueDocumentName(d.name),
        }));
        const unmatched = parsed.filter((p) => !p.parsed);
        return reply.send({
          synced: syncResult.synced ?? 0,
          aethera_docs: parsed.length,
          unmatched_aethera: unmatched,
          sample: parsed.slice(0, 20),
        });
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha na reconciliação' });
      }
    }
  );

  app.get(
    '/coordination',
    { preHandler: [authenticate, requireRole('admin', 'supervisor')] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const parsed = periodQuerySchema.safeParse(request.query);
      const period = parsed.success ? parsed.data.period ?? 30 : 30;
      try {
        const summary = await buildCoordinationSummary(supabase, workspaceId, period);
        return reply.send(summary);
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao montar coordenação' });
      }
    }
  );
}
