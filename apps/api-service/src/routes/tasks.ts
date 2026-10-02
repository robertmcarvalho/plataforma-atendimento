import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { sectorIdsFromJwt } from '../lib/jwtSectorIds';
import { writeAuditLog } from '../lib/auditLog';
import { resolveAdvanceContactAndDriverNames } from '../lib/advanceDecisionFollowup';
import { offboardDriver } from '../lib/driverOffboarding';
import { isActiveWorkspaceMember, requireWorkspace } from '../lib/workspaceContext';
import { buildAttendantPendingTasksOr, buildSupervisorPendingTasksOr } from '../lib/pendingTaskScope';
import { insertSystemInternalNote } from '@plataforma/operational-notes';

const patchTaskSchema = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']),
});

const taskCommentSchema = z.object({
  id: z.string().min(1),
  author_id: z.string().uuid().optional(),
  author_name: z.string().min(1),
  author_initials: z.string().optional(),
  text: z.string().min(1),
  mentions: z.array(z.string()).optional(),
  created_at: z.string().optional(),
});

const taskMetadataSchema = z.object({
  notes: z.string().optional(),
  task_comments: z.array(taskCommentSchema).optional(),
});

const DRIVER_REGISTRATION_COMPLETION_TYPES = new Set([
  'driver_pre_registration',
  'driver_registration_completion',
  'driver_enrollment_prep',
  'driver_enrollment',
]);

const assignTaskSchema = z.object({
  assignee_id: z.string().uuid(),
});

async function buildAdvanceEntryPrefill(
  workspaceId: string,
  driverId: string,
  conversationId: string | null,
  suggestedAmount?: number
) {
  const { data: driver } = await supabase
    .from('drivers')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .eq('id', driverId)
    .maybeSingle();

  const pharmaciesMap = new Map<string, { id: string; trade_name: string }>();

  if (conversationId) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('context_pharmacy_id, context_pharmacy:pharmacies!context_pharmacy_id(id, trade_name)')
      .eq('workspace_id', workspaceId)
      .eq('id', conversationId)
      .maybeSingle();
    const ctxPharmacy = conv?.context_pharmacy as { id?: string; trade_name?: string } | { id?: string; trade_name?: string }[] | null;
    const row = Array.isArray(ctxPharmacy) ? ctxPharmacy[0] : ctxPharmacy;
    if (row?.id) {
      pharmaciesMap.set(String(row.id), {
        id: String(row.id),
        trade_name: String(row.trade_name || 'Farmácia'),
      });
    }
  }

  const { data: links } = await supabase
    .from('driver_pharmacy_links')
    .select('pharmacy_id, pharmacies(id, trade_name)')
    .eq('driver_id', driverId)
    .eq('is_active', true);
  for (const link of links || []) {
    const p = link.pharmacies as { id?: string; trade_name?: string } | { id?: string; trade_name?: string }[] | null;
    const row = Array.isArray(p) ? p[0] : p;
    if (row?.id) {
      pharmaciesMap.set(String(row.id), {
        id: String(row.id),
        trade_name: String(row.trade_name || 'Farmácia'),
      });
    }
  }

  const pharmacies = [...pharmaciesMap.values()].sort((a, b) => a.trade_name.localeCompare(b.trade_name, 'pt-BR'));
  const defaultPharmacyId = pharmacies[0]?.id || '';

  return {
    driver_id: driverId,
    driver_name: String(driver?.name || ''),
    pharmacies,
    default_pharmacy_id: defaultPharmacyId,
    start_date: new Date().toISOString().slice(0, 10),
    type: 'advance' as const,
    frequency: 'weekly' as const,
    suggested_amount: suggestedAmount && suggestedAmount > 0 ? suggestedAmount : undefined,
  };
}

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(1).optional(),
});

function taskRole(user: { role?: string }): string {
  return String(user.role || '')
    .trim()
    .toLowerCase();
}

async function applyDriverRegistrationCompletionSideEffects(
  workspaceId: string,
  task: { task_type?: string | null; driver_id?: string | null }
) {
  const taskType = String(task.task_type || '');
  const driverId = task.driver_id ? String(task.driver_id) : '';
  if (!driverId || !DRIVER_REGISTRATION_COMPLETION_TYPES.has(taskType)) return;

  const { analyzeDriverRegistrationGaps } = await import('../lib/driverRegistrationCatalog.js');
  const { syncDriverDocumentsAfterSave } = await import('../lib/driverDocumentAlerts.js');

  const gaps = await analyzeDriverRegistrationGaps(driverId, workspaceId, supabase);
  if (gaps.error) return;
  const missingRequired = Array.isArray(gaps.missing_required) ? gaps.missing_required : [];

  if (missingRequired.length === 0) {
    const { data: driver } = await supabase
      .from('drivers')
      .select('tags')
      .eq('workspace_id', workspaceId)
      .eq('id', driverId)
      .maybeSingle();

    const tags = Array.isArray(driver?.tags) ? driver.tags.map(String) : [];
    const nextTags = tags.filter((tag) => tag !== 'cadastro-pendente');
    if (nextTags.length !== tags.length) {
      await supabase
        .from('drivers')
        .update({ tags: nextTags, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('id', driverId);
    }
  }

  await syncDriverDocumentsAfterSave(supabase, driverId, workspaceId);
}

async function appendInternalNote(workspaceId: string, conversationId: string, content: string): Promise<void> {
  await insertSystemInternalNote(supabase, { workspaceId, conversationId, content });
}

export async function taskRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string; role?: string; sector_id?: string | null; sector_ids?: string[] };
    const role = taskRole(user);
    const q = request.query as Record<string, string>;
    const {
      status = 'open',
      limit = '50',
      assignee_id,
      task_type,
      date_from,
      date_to,
      pharmacy_id,
    } = q;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

    let query = supabase
      .from('pending_tasks')
      .select(
        `
        *,
        conversation:conversations(id, status, priority, sector_id),
        contact:contacts(id, wa_phone, display_name),
        driver:drivers(id, name, phone, primary_pharmacy_id)
      `
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (status !== 'all') query = query.eq('status', status);

    const assignee = String(assignee_id || '').trim();
    if (assignee && /^[0-9a-f-]{36}$/i.test(assignee)) query = query.eq('assignee_id', assignee);

    const taskType = String(task_type || '').trim();
    if (taskType) query = query.eq('task_type', taskType);

    const dateFrom = String(date_from || '').trim();
    if (dateFrom) query = query.gte('created_at', dateFrom);

    const dateTo = String(date_to || '').trim();
    if (dateTo) {
      const end = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59.999Z`;
      query = query.lte('created_at', end);
    }

    const pharmacyId = String(pharmacy_id || '').trim();
    if (pharmacyId && /^[0-9a-f-]{36}$/i.test(pharmacyId)) {
      query = query.or(
        `metadata->>pharmacy_id.eq.${pharmacyId},driver.primary_pharmacy_id.eq.${pharmacyId}`
      );
    }

    if (role === 'supervisor') {
      const sids = sectorIdsFromJwt(user);
      const scopeOr = await buildSupervisorPendingTasksOr(supabase, workspaceId, sids);
      if (scopeOr) query = query.or(scopeOr);
    } else if (role === 'attendant') {
      const sids = sectorIdsFromJwt(user);
      const scopeOr = await buildAttendantPendingTasksOr(supabase, workspaceId, user, sids);
      query = query.or(scopeOr);
    }

    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  app.get('/summary', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string; role?: string; sector_id?: string | null; sector_ids?: string[] };
    const role = taskRole(user);

    let attendantScopeOr: string | null = null;
    let supervisorScopeOr: string | null = null;
    if (role === 'supervisor') {
      const sids = sectorIdsFromJwt(user);
      supervisorScopeOr = await buildSupervisorPendingTasksOr(supabase, workspaceId, sids);
    } else if (role === 'attendant') {
      const sids = sectorIdsFromJwt(user);
      attendantScopeOr = await buildAttendantPendingTasksOr(supabase, workspaceId, user, sids);
    }

    let open = supabase.from('pending_tasks').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'open');
    let inProgress = supabase.from('pending_tasks').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'in_progress');
    let mineOpen = supabase
      .from('pending_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'open')
      .eq('assignee_id', user.sub);
    let overdue = supabase
      .from('pending_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .in('status', ['open', 'in_progress'])
      .lt('due_at', new Date().toISOString());

    const scopeOr = supervisorScopeOr || attendantScopeOr;
    if (scopeOr) {
      open = open.or(scopeOr);
      inProgress = inProgress.or(scopeOr);
      overdue = overdue.or(scopeOr);
    }

    const [a, b, c, d] = await Promise.all([open, inProgress, mineOpen, overdue]);
    if (a.error || b.error || c.error || d.error) {
      const err = a.error || b.error || c.error || d.error;
      return reply.status(500).send({ error: err?.message || 'Falha ao buscar resumo' });
    }

    return reply.send({
      open: a.count || 0,
      in_progress: b.count || 0,
      mine_open: c.count || 0,
      overdue: d.count || 0,
    });
  });

  app.get('/for-conversation/:conversationId', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { conversationId } = request.params as { conversationId: string };

    const { data: task, error } = await supabase
      .from('pending_tasks')
      .select('id, task_type, status, title, description, driver_id, conversation_id, metadata')
      .eq('workspace_id', workspaceId)
      .eq('conversation_id', conversationId)
      .eq('task_type', 'financial_advance_request')
      .in('status', ['open', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return reply.status(500).send({ error: error.message });
    if (!task) return reply.send({ task: null });

    const meta =
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : {};

    return reply.send({
      task: {
        id: task.id,
        task_type: task.task_type,
        status: task.status,
        title: task.title,
        description: task.description,
        driver_id: task.driver_id,
        phase: String(meta.phase || 'review'),
        metadata: meta,
      },
    });
  });

  app.get('/:id/context', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { data: task, error } = await supabase
      .from('pending_tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (error || !task) return reply.status(404).send({ error: 'Pendência não encontrada' });

    const meta =
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : {};

    const { loadOpsTaskPlaybooks, resolveTaskPlaybook } = await import('../lib/opsTaskConfig.js');
    const playbooksConfig = await loadOpsTaskPlaybooks(supabase, workspaceId);
    const playbook = resolveTaskPlaybook(String(task.task_type || ''), playbooksConfig, meta);

    const entities: Record<string, unknown> = {};
    if (task.driver_id) {
      const { data: driver } = await supabase
        .from('drivers')
        .select('id, name, phone, status')
        .eq('workspace_id', workspaceId)
        .eq('id', task.driver_id)
        .maybeSingle();
      if (driver) entities.driver = driver;
    }
    let convDriverId: string | null = null;
    if (task.conversation_id) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('id, status, priority, contact_id, context_driver_id, demand_key')
        .eq('workspace_id', workspaceId)
        .eq('id', task.conversation_id)
        .maybeSingle();
      if (conv) {
        entities.conversation = conv;
        convDriverId = (conv.context_driver_id as string | null) ?? null;
      }
    }

    let advance_context: unknown = undefined;
    let financial_review_context: unknown = meta.financial_review ?? undefined;
    let registration_context: unknown = undefined;

    const driverIdForFin =
      (task.driver_id as string | null) ||
      convDriverId ||
      (entities.driver && typeof entities.driver === 'object' && 'id' in entities.driver
        ? String((entities.driver as { id: string }).id)
        : null);

    if (task.task_type === 'financial_advance_request' && driverIdForFin) {
      const { buildAdvanceEligibility } = await import('../lib/advanceEligibility.js');
      const reqAmt = Number(meta.requested_amount || meta.amount || 0) || undefined;
      advance_context = await buildAdvanceEligibility(supabase, workspaceId, driverIdForFin, reqAmt);
    }

    if (task.task_type === 'guided_demand' && driverIdForFin) {
      const demandKey = String(meta.demand_key || '');
      const sectorName = String(meta.sector_name || '');
      const { isLeaderFinancialDemand } = await import('../lib/leaderFinancialDemandContext.js');
      if (isLeaderFinancialDemand(demandKey, sectorName)) {
        if (!financial_review_context) {
          const { buildDriverFinancialReviewContext } = await import('../lib/leaderFinancialDemandContext.js');
          financial_review_context = await buildDriverFinancialReviewContext(
            supabase,
            workspaceId,
            driverIdForFin
          );
        }
        const { buildAdvanceEligibility } = await import('../lib/advanceEligibility.js');
        advance_context = await buildAdvanceEligibility(supabase, workspaceId, driverIdForFin);
      }
    }

    if (task.task_type === 'driver_registration_completion' && task.driver_id) {
      const { getDriverRegistrationGapsPublic } = await import('../lib/driverRegistrationGaps.js');
      registration_context = await getDriverRegistrationGapsPublic(String(task.driver_id), workspaceId);
    }

    let document_context: unknown = undefined;
    if (
      (task.task_type === 'driver_doc_expiry_warning' || task.task_type === 'driver_doc_expired') &&
      task.driver_id
    ) {
      const { data: docDriver } = await supabase
        .from('drivers')
        .select('id, name, cnh_expires_at, has_digital_certificate, digital_certificate_expires_at, doc_status')
        .eq('workspace_id', workspaceId)
        .eq('id', task.driver_id)
        .maybeSingle();
      if (docDriver) {
        const { buildDocumentStatusPayload } = await import('../lib/driverDocumentAlerts.js');
        document_context = {
          ...buildDocumentStatusPayload(docDriver),
          driver_link: `/drivers/${task.driver_id}`,
          alert_kind: meta.alert_kind || null,
          document_type: meta.document_type || null,
        };
      }
    }

    let entry_prefill: Awaited<ReturnType<typeof buildAdvanceEntryPrefill>> | undefined;
    if (task.task_type === 'financial_advance_request' && driverIdForFin) {
      const reqAmt = Number(meta.requested_amount || meta.amount || 0) || undefined;
      entry_prefill = await buildAdvanceEntryPrefill(
        workspaceId,
        driverIdForFin,
        (task.conversation_id as string | null) || null,
        reqAmt
      );
    }

    return reply.send({
      task,
      playbook,
      entities,
      related_tasks: [],
      suggested_messages: [],
      advance_context,
      financial_review_context,
      registration_context,
      document_context,
      entry_prefill,
    });
  });

  app.patch('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = patchTaskSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const updates: Record<string, unknown> = {
      status: body.data.status,
      updated_at: new Date().toISOString(),
    };
    if (body.data.status === 'done' || body.data.status === 'cancelled') {
      updates.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('pending_tasks')
      .update(updates)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    if (body.data.status === 'done') {
      try {
        await applyDriverRegistrationCompletionSideEffects(workspaceId, data);
      } catch (e) {
        return reply.status(500).send({
          error: e instanceof Error ? e.message : 'Falha ao atualizar cadastro do entregador',
        });
      }
    }
    return reply.send(data);
  });

  const playbookProgressSchema = z.object({
    step_id: z.string().min(1),
    done: z.boolean(),
  });

  app.patch('/:id/playbook-progress', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = playbookProgressSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const { data: task, error: taskErr } = await supabase
      .from('pending_tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (taskErr || !task) return reply.status(404).send({ error: 'Pendência não encontrada' });

    const prevMeta =
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : {};
    const { loadOpsTaskPlaybooks, resolveTaskPlaybook } = await import('../lib/opsTaskConfig.js');
    const playbooksConfig = await loadOpsTaskPlaybooks(supabase, workspaceId);
    const pb = resolveTaskPlaybook(String(task.task_type || ''), playbooksConfig, prevMeta);
    const progress = Array.isArray(prevMeta.playbook_progress)
      ? [...(prevMeta.playbook_progress as Array<Record<string, unknown>>)]
      : pb.steps.map((s) => ({ id: s.id, label: s.label, done: false }));

    const idx = progress.findIndex((p) => String(p.id) === parsed.data.step_id);
    if (idx < 0) return reply.status(400).send({ error: 'Passo não encontrado no checklist' });

    progress[idx] = { ...progress[idx], done: parsed.data.done };
    const nextMeta = { ...prevMeta, playbook_progress: progress };

    const { data, error } = await supabase
      .from('pending_tasks')
      .update({
        metadata: nextMeta,
        status: task.status === 'open' ? 'in_progress' : task.status,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.patch('/:id/metadata', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = taskMetadataSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const { data: task, error: taskErr } = await supabase
      .from('pending_tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (taskErr || !task) return reply.status(404).send({ error: 'Pendência não encontrada' });

    const prevMeta =
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : {};
    const nextMeta: Record<string, unknown> = { ...prevMeta };
    if (parsed.data.notes !== undefined) nextMeta.notes = parsed.data.notes;
    if (parsed.data.task_comments !== undefined) nextMeta.task_comments = parsed.data.task_comments;

    const { data, error } = await supabase
      .from('pending_tasks')
      .update({ metadata: nextMeta, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.patch('/:id/assign', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = assignTaskSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const assigneeOk = await isActiveWorkspaceMember(workspaceId, parsed.data.assignee_id);
    if (!assigneeOk) {
      return reply.status(400).send({ error: 'Atendente inválido ou inativo' });
    }

    const { data, error } = await supabase
      .from('pending_tasks')
      .update({
        assignee_id: parsed.data.assignee_id,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Pendência não encontrada' });
    return reply.send(data);
  });

  app.patch('/:id/decision', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = decisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const user = request.user as { sub: string; role?: string };
    const role = taskRole(user);
    if (!['admin', 'supervisor', 'financial', 'operational'].includes(role)) {
      return reply.status(403).send({ error: 'Sem permissão para decidir pendências' });
    }

    const { data: task, error: taskErr } = await supabase
      .from('pending_tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (taskErr || !task) return reply.status(404).send({ error: 'Pendência não encontrada' });
    if (!['open', 'in_progress'].includes(String(task.status || ''))) {
      return reply.status(409).send({ error: 'Pendência já finalizada' });
    }

    const decision = parsed.data.decision;
    const reason = (parsed.data.reason || '').trim();
    if (decision === 'rejected' && !reason) {
      return reply.status(400).send({ error: 'Motivo obrigatório para reprovação' });
    }

    const nowIso = new Date().toISOString();
    const prevMeta =
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : {};
    const metadata: Record<string, unknown> = {
      ...prevMeta,
      decision,
      decision_reason: decision === 'rejected' ? reason : null,
      decided_by: user.sub,
      decided_at: nowIso,
    };

    if (task.task_type === 'driver_termination_request') {
      if (!['admin', 'supervisor', 'operational'].includes(role)) {
        return reply.status(403).send({ error: 'Sem permissão para aprovar desligamento de entregador' });
      }

      let offboarding: Awaited<ReturnType<typeof offboardDriver>> | null = null;
      if (decision === 'approved') {
        const driverId = String(task.driver_id || metadata.driver_id || '');
        if (!driverId) return reply.status(400).send({ error: 'Pendência sem entregador vinculado' });
        offboarding = await offboardDriver(supabase, {
          driverId,
          lastWorkedAt: String(metadata.last_worked_at || nowIso),
          actorId: user.sub,
          source: 'task_approval',
          reason: typeof metadata.reason === 'string' ? metadata.reason : null,
          notes: typeof metadata.notes === 'string' ? metadata.notes : null,
          taskId: id,
        });
        metadata.offboarding = offboarding;
      }

      const { data: updatedTask, error: updErr } = await supabase
        .from('pending_tasks')
        .update({
          status: decision === 'approved' ? 'done' : 'cancelled',
          completed_at: nowIso,
          updated_at: nowIso,
          metadata,
        })
        .eq('workspace_id', workspaceId)
        .eq('id', id)
        .select('*')
        .single();
      if (updErr) return reply.status(500).send({ error: updErr.message });

      const requestId = typeof metadata.request_id === 'string' ? metadata.request_id : '';
      if (requestId) {
        await supabase
          .from('pending_tasks')
          .update({
            status: decision === 'approved' ? 'in_progress' : 'cancelled',
            updated_at: nowIso,
            ...(decision === 'rejected' ? { completed_at: nowIso } : {}),
          })
          .eq('workspace_id', workspaceId)
          .eq('task_type', 'driver_termination_financial_review')
          .eq('metadata->>request_id', requestId)
          .in('status', ['open', 'in_progress']);
      }

      await writeAuditLog({
        actor_id: user.sub,
        action: 'tasks.driver_termination.decision',
        entity_type: 'pending_task',
        entity_id: id,
        workspace_id: workspaceId,
        metadata: {
          task_id: id,
          decision,
          reason: decision === 'rejected' ? reason : null,
          decided_by: user.sub,
          offboarding,
        },
      });

      return reply.send({
        task: updatedTask,
        next_action: { type: 'none' },
        offboarding,
      });
    }

    if (task.task_type !== 'financial_advance_request') {
      return reply.status(400).send({ error: 'Esta rota não suporta decisão para este tipo de pendência' });
    }
    if (!['admin', 'supervisor', 'financial'].includes(role)) {
      return reply.status(403).send({ error: 'Sem permissão para decidir pendências de adiantamento' });
    }

    if (decision === 'approved') {
      metadata.phase = 'awaiting_entry';
      metadata.approved_at = nowIso;
    } else {
      metadata.phase = 'rejected';
    }

    const { data: updatedTask, error: updErr } = await supabase
      .from('pending_tasks')
      .update({
        status: decision === 'approved' ? 'in_progress' : 'done',
        completed_at: decision === 'rejected' ? nowIso : null,
        updated_at: nowIso,
        metadata,
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select('*')
      .single();
    if (updErr) return reply.status(500).send({ error: updErr.message });

    const conversationId = (task.conversation_id as string | null | undefined) || null;
    let messageSent = false;
    let conversationResolved = false;

    const driverIdForMsg =
      (updatedTask?.driver_id as string | null) ||
      (task.driver_id as string | null) ||
      (typeof metadata.driver_id === 'string' ? metadata.driver_id : null);

    if (conversationId && decision === 'rejected') {
      const { driverName } = await resolveAdvanceContactAndDriverNames(
        supabase,
        workspaceId,
        conversationId,
        driverIdForMsg
      );

      await supabase
        .from('conversations')
        .update({
          status: 'resolved',
          close_reason: 'adiantamento_reprovado',
          resolved_at: nowIso,
          has_unread: false,
          updated_at: nowIso,
        })
        .eq('workspace_id', workspaceId)
        .eq('id', conversationId);
      conversationResolved = true;

      await appendInternalNote(
        workspaceId,
        conversationId,
        `[ADIANTAMENTO] Reprovado pelo gestor financeiro. Motivo: ${reason}. Entregador: ${driverName || '—'}. Demanda encerrada; o líder acompanha o status no portal do líder.`
      );
    } else if (conversationId && decision === 'approved') {
      const { driverName } = await resolveAdvanceContactAndDriverNames(
        supabase,
        workspaceId,
        conversationId,
        driverIdForMsg
      );

      await supabase
        .from('conversations')
        .update({
          status: 'open',
          close_reason: null,
          resolved_at: null,
          has_unread: false,
          updated_at: nowIso,
        })
        .eq('workspace_id', workspaceId)
        .eq('id', conversationId);

      await appendInternalNote(
        workspaceId,
        conversationId,
        `[ADIANTAMENTO] Aprovado pelo gestor financeiro. Realize o lançamento na Inbox. Entregador: ${driverName || '—'}. Após o lançamento, encerre a conversa; o líder vê a atualização no portal.`
      );
    }

    await supabase
      .from('pending_tasks')
      .update({ metadata, updated_at: nowIso })
      .eq('workspace_id', workspaceId)
      .eq('id', id);

    await writeAuditLog({
      actor_id: user.sub,
      action: 'tasks.decision',
      entity_type: 'pending_task',
      entity_id: id,
        workspace_id: workspaceId,
      metadata: {
        task_id: id,
        decision,
        reason: decision === 'rejected' ? reason : null,
        decided_by: user.sub,
      },
    });

    const driverId =
      typeof updatedTask?.driver_id === 'string'
        ? updatedTask.driver_id
        : typeof metadata.driver_id === 'string'
          ? String(metadata.driver_id)
          : '';

    return reply.send({
      task: updatedTask,
      next_action:
        decision === 'approved'
          ? { type: 'inline_financial_entry', task_id: id, driver_id: driverId, approved_at: nowIso }
          : { type: 'none' },
      message_sent: messageSent,
      conversation_resolved: conversationResolved,
    });
  });
}
