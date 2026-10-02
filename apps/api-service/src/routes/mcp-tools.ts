import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { getToolCatalog, isValidToolAction } from '../lib/mcpCatalog';
import { assertTaskTypeCreatableForWorkspace } from '../lib/opsTaskCatalog';
import { computeAdvanceDueAtIso, loadSlaAdvanceRequestConfig } from '../lib/slaAdvanceRequest';
import { requireWorkspace } from '../lib/workspaceContext';
import { enrichPharmacyApiRow } from '../lib/pharmacyCommercial';
import { hasCanonicalBusinessHours, isOpen, normalizeBusinessHours } from '../lib/businessHours';

const executeSchema = z.object({
  tool: z.string().min(1),
  action: z.string().min(1),
  input: z.record(z.unknown()).default({}),
  context: z
    .object({
      conversation_id: z.string().uuid().optional(),
      ticket_id: z.string().uuid().optional(),
      tenant_id: z.string().uuid().optional(),
    })
    .optional(),
});

type GovernanceConfig = {
  enabled: boolean;
  timeout_ms: number;
  retry: number;
  roles: string[];
};

const DEFAULT_GOVERNANCE: GovernanceConfig = {
  enabled: true,
  timeout_ms: 8000,
  retry: 1,
  roles: ['admin', 'supervisor'],
};

async function getToolGovernance(workspaceId: string, tool: string): Promise<GovernanceConfig> {
  const { data } = await supabase.from('app_settings').select('value').eq('workspace_id', workspaceId).eq('key', 'mcp_tools_governance').maybeSingle();
  const value = (data?.value || {}) as Record<string, Partial<GovernanceConfig>>;
  const cfg = value[tool] || {};
  return {
    enabled: cfg.enabled ?? DEFAULT_GOVERNANCE.enabled,
    timeout_ms: Number(cfg.timeout_ms || DEFAULT_GOVERNANCE.timeout_ms),
    retry: Math.min(Math.max(Number(cfg.retry ?? DEFAULT_GOVERNANCE.retry), 0), 5),
    roles: Array.isArray(cfg.roles) && cfg.roles.length > 0 ? cfg.roles.map((r) => String(r)) : DEFAULT_GOVERNANCE.roles,
  };
}

type RolloutConfig = {
  enabled: boolean;
  pilot_tenants: string[];
};

async function getRolloutConfig(workspaceId: string): Promise<RolloutConfig> {
  const { data } = await supabase.from('app_settings').select('value').eq('workspace_id', workspaceId).eq('key', 'mcp_rollout_config').maybeSingle();
  const value = (data?.value || {}) as Partial<RolloutConfig>;
  return {
    enabled: Boolean(value.enabled),
    pilot_tenants: Array.isArray(value.pilot_tenants) ? value.pilot_tenants.map((x) => String(x)) : [],
  };
}

function isUuid(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveFinancialTaskRouting(): Promise<{ sectorId: string | null; supervisorId: string | null }> {
  const { data: sector } = await supabase
    .from('sectors')
    .select('id, name')
    .ilike('name', '%finance%')
    .limit(1)
    .maybeSingle();
  const sectorId = (sector?.id as string | undefined) || null;
  if (!sectorId) return { sectorId: null, supervisorId: null };

  const { data: supervisor } = await supabase
    .from('users')
    .select('id, role, is_active, sector_id')
    .eq('role', 'supervisor')
    .eq('is_active', true)
    .eq('sector_id', sectorId)
    .limit(1)
    .maybeSingle();

  return {
    sectorId,
    supervisorId: (supervisor?.id as string | undefined) || null,
  };
}

function isAdvanceRequest(input: Record<string, unknown>): boolean {
  const title = String(input.title || '').toLowerCase();
  const description = String(input.description || '').toLowerCase();
  return /adiant|antecip/.test(title) || /adiant|antecip/.test(description);
}

async function executeTaskingAction(args: {
  action: string;
  input: Record<string, unknown>;
  context?: { conversation_id?: string; ticket_id?: string; tenant_id?: string };
  userId?: string | null;
}): Promise<Record<string, unknown>> {
  const { action, input, context, userId } = args;
  const workspaceId = isUuid(context?.tenant_id) ? context?.tenant_id : null;

  if (action === 'create_pending_task') {
    if (!workspaceId) return { ok: false, tool: 'mcp-tasking', action, error: 'tenant_id_required' };
    const title = String(input.title || '').trim();
    if (!title) {
      return {
        ok: false,
        tool: 'mcp-tasking',
        action,
        error: 'title_required',
      };
    }

    const taskType =
      String(input.task_type || '').trim() ||
      (isAdvanceRequest(input) ? 'financial_advance_request' : 'guided_demand');
    const conversationId = isUuid(context?.conversation_id) ? context?.conversation_id : null;
    const contactId = isUuid(input.contact_id) ? (input.contact_id as string) : null;
    const driverId = isUuid(input.driver_id) ? (input.driver_id as string) : null;
    let sectorId = isUuid(input.sector_id) ? (input.sector_id as string) : null;
    let assigneeId = isUuid(input.assignee_id) ? (input.assignee_id as string) : null;

    if (taskType === 'financial_advance_request' && (!sectorId || !assigneeId)) {
      const route = await resolveFinancialTaskRouting();
      if (!sectorId) sectorId = route.sectorId;
      if (!assigneeId) assigneeId = route.supervisorId;
    }

    if (conversationId) {
      const { data: existing } = await supabase
        .from('pending_tasks')
        .select('id, status')
        .eq('workspace_id', workspaceId)
        .eq('task_type', taskType)
        .eq('conversation_id', conversationId)
        .in('status', ['open', 'in_progress'])
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        return {
          ok: true,
          tool: 'mcp-tasking',
          action,
          deduped: true,
          task_id: existing.id,
          status: existing.status,
        };
      }
    }

    const description = String(input.description || '').trim() || null;
    const priorityRaw = String(input.priority || 'high').toLowerCase();
    const priority = ['low', 'normal', 'high', 'urgent'].includes(priorityRaw) ? priorityRaw : 'high';
    const baseMeta =
      typeof input.metadata === 'object' && input.metadata != null && !Array.isArray(input.metadata)
        ? { ...(input.metadata as Record<string, unknown>) }
        : {};

    let dueAt: string;
    let metadata: Record<string, unknown> = baseMeta;

    if (taskType === 'financial_advance_request') {
      const slaCfg = await loadSlaAdvanceRequestConfig();
      dueAt = computeAdvanceDueAtIso(new Date(), slaCfg);
      metadata = {
        ...baseMeta,
        sla_policy: 'advance_request_v1',
        sla_minutes: slaCfg.sla_minutes,
        notified_80: false,
        notified_overdue: false,
        escalated: false,
        ...(conversationId ? { conversation_id: conversationId } : {}),
        ...(driverId ? { driver_id: driverId } : {}),
      };
    } else {
      const dueAtRaw = String(input.due_at || '').trim();
      dueAt = dueAtRaw ? dueAtRaw : new Date(Date.now() + 6 * 3600 * 1000).toISOString();
      metadata = baseMeta;
    }

    try {
      await assertTaskTypeCreatableForWorkspace(supabase, workspaceId, taskType, 'mcp');
    } catch (e) {
      return {
        ok: false,
        tool: 'mcp-tasking',
        action,
        error: e instanceof Error ? e.message : 'task_type_not_allowed',
      };
    }

    const { data, error } = await supabase
      .from('pending_tasks')
      .insert({
        workspace_id: workspaceId,
        task_type: taskType,
        title,
        description,
        status: 'open',
        priority,
        conversation_id: conversationId,
        contact_id: contactId,
        driver_id: driverId,
        assignee_id: assigneeId,
        sector_id: sectorId,
        source: 'bot',
        metadata,
        due_at: dueAt,
      })
      .select('*')
      .single();
    if (error) throw error;
    return {
      ok: true,
      tool: 'mcp-tasking',
      action,
      task: data,
      routed_to_financial: taskType === 'financial_advance_request',
    };
  }

  if (action === 'list_pending_tasks') {
    if (!workspaceId) return { ok: false, tool: 'mcp-tasking', action, error: 'tenant_id_required' };
    const status = String(input.status || 'open').trim();
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
    let query = supabase.from('pending_tasks').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(limit);
    if (status !== 'all') query = query.eq('status', status);
    if (isUuid(input.assignee_id)) query = query.eq('assignee_id', String(input.assignee_id));
    if (isUuid(input.sector_id)) query = query.eq('sector_id', String(input.sector_id));
    if (isUuid(context?.conversation_id)) query = query.eq('conversation_id', context?.conversation_id as string);
    const { data, error } = await query;
    if (error) throw error;
    return { ok: true, tool: 'mcp-tasking', action, items: data || [] };
  }

  if (action === 'assign_task') {
    if (!workspaceId) return { ok: false, tool: 'mcp-tasking', action, error: 'tenant_id_required' };
    const taskId = String(input.task_id || '').trim();
    const assigneeId = String(input.assignee_id || '').trim();
    if (!isUuid(taskId) || !isUuid(assigneeId)) {
      return { ok: false, tool: 'mcp-tasking', action, error: 'task_id_and_assignee_id_must_be_uuid' };
    }
    const { data, error } = await supabase
      .from('pending_tasks')
      .update({ assignee_id: assigneeId, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', taskId)
      .select('*')
      .single();
    if (error) throw error;
    return { ok: true, tool: 'mcp-tasking', action, task: data };
  }

  if (action === 'close_task') {
    if (!workspaceId) return { ok: false, tool: 'mcp-tasking', action, error: 'tenant_id_required' };
    const taskId = String(input.task_id || '').trim();
    if (!isUuid(taskId)) {
      return { ok: false, tool: 'mcp-tasking', action, error: 'task_id_must_be_uuid' };
    }
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('pending_tasks')
      .update({ status: 'done', completed_at: now, updated_at: now, metadata: { closed_by: userId || null } })
      .eq('workspace_id', workspaceId)
      .eq('id', taskId)
      .select('*')
      .single();
    if (error) throw error;
    return { ok: true, tool: 'mcp-tasking', action, task: data };
  }

  return {
    ok: false,
    tool: 'mcp-tasking',
    action,
    error: 'unsupported_tasking_action',
  };
}

async function resolvePharmacyIdFromContext(
  workspaceId: string,
  input: Record<string, unknown>,
  context?: { conversation_id?: string },
): Promise<string | null> {
  if (isUuid(input.pharmacy_id)) return input.pharmacy_id;
  if (!context?.conversation_id) return null;
  const { data } = await supabase
    .from('conversations')
    .select('context_pharmacy_id')
    .eq('workspace_id', workspaceId)
    .eq('id', context.conversation_id)
    .maybeSingle();
  const pid = data?.context_pharmacy_id;
  return isUuid(pid) ? pid : null;
}

async function executeOperacaoAction(args: {
  action: string;
  input: Record<string, unknown>;
  context?: { conversation_id?: string; ticket_id?: string; tenant_id?: string };
}): Promise<Record<string, unknown>> {
  const { action, input, context } = args;
  const workspaceId = isUuid(context?.tenant_id) ? context!.tenant_id! : null;
  if (!workspaceId) {
    return { ok: false, tool: 'mcp-operacao', action, error: 'tenant_id_required' };
  }

  if (action === 'get_pharmacy_context') {
    const pharmacyId = await resolvePharmacyIdFromContext(workspaceId, input, context);
    if (!pharmacyId) {
      return { ok: false, tool: 'mcp-operacao', action, error: 'pharmacy_id_required' };
    }
    const { data, error } = await supabase
      .from('pharmacies')
      .select(
        `
        *,
        primary_attendant:users!primary_attendant_id(id, name, email),
        secondary_attendant:users!secondary_attendant_id(id, name, email),
        leader:leaders(id, name, phone)
      `,
      )
      .eq('workspace_id', workspaceId)
      .eq('id', pharmacyId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, tool: 'mcp-operacao', action, error: 'pharmacy_not_found' };
    return { ok: true, tool: 'mcp-operacao', action, pharmacy: enrichPharmacyApiRow(data as Record<string, unknown>) };
  }

  if (action === 'get_driver_context') {
    let driverId = isUuid(input.driver_id) ? input.driver_id : null;
    if (!driverId && context?.conversation_id) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('context_driver_id')
        .eq('workspace_id', workspaceId)
        .eq('id', context.conversation_id)
        .maybeSingle();
      if (isUuid(conv?.context_driver_id)) driverId = conv!.context_driver_id!;
    }
    if (!driverId) return { ok: false, tool: 'mcp-operacao', action, error: 'driver_id_required' };
    const { data, error } = await supabase
      .from('drivers')
      .select('id, name, phone, email, cpf, city, state, status, primary_pharmacy_id, work_schedule')
      .eq('workspace_id', workspaceId)
      .eq('id', driverId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, tool: 'mcp-operacao', action, error: 'driver_not_found' };
    let work_open_now: boolean | null = null;
    if (hasCanonicalBusinessHours(data.work_schedule)) {
      work_open_now = isOpen(normalizeBusinessHours(data.work_schedule), new Date());
    }
    return { ok: true, tool: 'mcp-operacao', action, driver: { ...data, work_open_now } };
  }

  if (action === 'get_leader_context') {
    let leaderId = isUuid(input.leader_id) ? input.leader_id : null;
    if (!leaderId && context?.conversation_id) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('context_leader_id')
        .eq('workspace_id', workspaceId)
        .eq('id', context.conversation_id)
        .maybeSingle();
      if (isUuid(conv?.context_leader_id)) leaderId = conv!.context_leader_id!;
    }
    if (!leaderId) return { ok: false, tool: 'mcp-operacao', action, error: 'leader_id_required' };
    const { data, error } = await supabase
      .from('leaders')
      .select('id, name, phone, email, status')
      .eq('workspace_id', workspaceId)
      .eq('id', leaderId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, tool: 'mcp-operacao', action, error: 'leader_not_found' };
    return { ok: true, tool: 'mcp-operacao', action, leader: data };
  }

  return { ok: false, tool: 'mcp-operacao', action, error: 'unsupported_operacao_action' };
}

async function executeToolAction(args: {
  tool: string;
  action: string;
  input: Record<string, unknown>;
  context?: { conversation_id?: string; ticket_id?: string; tenant_id?: string };
  userId?: string | null;
}): Promise<Record<string, unknown>> {
  const { tool, action, input, context } = args;
  if (tool === 'mcp-tasking') {
    return executeTaskingAction({ action, input, context, userId: args.userId });
  }
  if (tool === 'mcp-operacao') {
    return executeOperacaoAction({ action, input, context });
  }

  if (tool === 'mcp-finance') {
    if (!context?.tenant_id) {
      return {
        ok: false,
        tool,
        action,
        tenant_id: null,
        error: 'tenant_id_required_for_mcp_finance',
        note: 'Informe context.tenant_id para operacoes financeiras multi-tenant.',
      };
    }

    if (action === 'get_tenant_financial_snapshot') {
      return {
        ok: true,
        tool,
        action,
        tenant_id: context.tenant_id,
        snapshot: {
          pending_installments: 0,
          overdue_installments: 0,
          pending_amount: 0,
          overdue_amount: 0,
        },
        note: 'Snapshot financeiro simulado por tenant (P1).',
      };
    }
    if (action === 'list_tenant_overdue_items') {
      return {
        ok: true,
        tool,
        action,
        tenant_id: context.tenant_id,
        items: [],
        note: 'Lista de itens em atraso simulada por tenant (P1).',
      };
    }
    if (action === 'get_tenant_reconciliation_status') {
      return {
        ok: true,
        tool,
        action,
        tenant_id: context.tenant_id,
        reconciliation: { status: 'not_started', updated_at: new Date().toISOString() },
        note: 'Status de conciliacao simulado por tenant (P1).',
      };
    }
  }

  if (tool === 'mcp-integrations') {
    if (!context?.tenant_id) {
      return {
        ok: false,
        tool,
        action,
        tenant_id: null,
        error: 'tenant_id_required_for_mcp_integrations',
        note: 'Informe context.tenant_id para operações em conectores externos.',
      };
    }

    const connectorId = String(input.connector_id || 'erp-orders-logistics');

    if (action === 'erp_orders_get_status') {
      return {
        ok: true,
        tool,
        action,
        tenant_id: context.tenant_id,
        connector_id: connectorId,
        order: {
          id: String(input.order_id || 'ORDER-DEMO'),
          status: 'in_transit',
          eta_minutes: 35,
        },
        note: 'Primeiro conector (ERP logístico) simulado por tenant.',
      };
    }
    if (action === 'erp_orders_list_recent') {
      return {
        ok: true,
        tool,
        action,
        tenant_id: context.tenant_id,
        connector_id: connectorId,
        items: [
          { order_id: 'ORDER-001', status: 'delivered' },
          { order_id: 'ORDER-002', status: 'in_transit' },
        ],
        note: 'Lista de pedidos recentes simulada por tenant.',
      };
    }
    if (action === 'connector_health_check') {
      return {
        ok: true,
        tool,
        action,
        tenant_id: context.tenant_id,
        connector_id: connectorId,
        health: {
          status: 'healthy',
          last_sync_at: new Date().toISOString(),
          latency_ms: 120,
        },
        note: 'Health-check simulado do conector externo.',
      };
    }
  }

  return {
    ok: true,
    tool,
    action,
    received_input: input,
    note: 'Execucao simulada no P0; integracao real sera implementada por ferramenta.',
  };
}

async function executeWithTimeout<T>(promiseFactory: () => Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promiseFactory(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`mcp_timeout_after_${timeoutMs}ms`)), Math.max(200, timeoutMs))
    ),
  ]);
}

export async function mcpToolRoutes(app: FastifyInstance) {
  app.get('/tools', { preHandler: [authenticate] }, async (_request, reply) => {
    return reply.send(getToolCatalog());
  });

  app.post('/execute', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = executeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados invalidos', details: parsed.error.flatten() });
    }

    const { tool, action, input } = parsed.data;
    const context = { ...(parsed.data.context || {}), tenant_id: parsed.data.context?.tenant_id || workspaceId };
    if (!isValidToolAction(tool, action)) {
      return reply.status(400).send({ error: 'Tool/action invalidos para o catalogo MCP atual' });
    }

    const user = request.user as { sub?: string; role?: string };
    const governance = await getToolGovernance(workspaceId, tool);
    const rollout = await getRolloutConfig(workspaceId);
    if (!governance.enabled) {
      return reply.status(403).send({ error: 'Tool MCP desabilitada por governanca' });
    }
    if (tool === 'mcp-finance' || tool === 'mcp-integrations') {
      if (!context?.tenant_id) {
        return reply.status(400).send({ error: 'tenant_id obrigatorio para tool multi-tenant' });
      }
      if (rollout.enabled && !rollout.pilot_tenants.includes(context.tenant_id)) {
        return reply.status(403).send({
          error: 'tenant_fora_do_rollout_piloto',
          hint: 'Adicione o tenant em mcp_rollout_config.pilot_tenants para liberar acesso.',
        });
      }
    }
    if (user.role && !governance.roles.includes(user.role)) {
      return reply.status(403).send({ error: 'Papel sem permissao para executar esta tool MCP' });
    }

    const started = Date.now();
    let toolResult: Record<string, unknown> = {};
    let attempt = 0;
    let lastError: string | null = null;
    while (attempt <= governance.retry) {
      try {
        toolResult = (await executeWithTimeout(
          async () => executeToolAction({ tool, action, input, context, userId: user.sub || null }),
          governance.timeout_ms
        )) as Record<string, unknown>;
        lastError = null;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'mcp_execution_failed';
        attempt += 1;
      }
    }

    const latencyMs = Date.now() - started;
    const payload = {
      tool,
      action,
      input,
      context: context || null,
      result:
        lastError === null
          ? toolResult
          : {
              ok: false,
              tool,
              action,
              error: lastError,
            },
      latency_ms: latencyMs,
      governance,
      rollout,
      attempts: attempt + (lastError ? 0 : 1),
    };

    const { error: auditErr } = await supabase.from('ticket_events').insert({
      workspace_id: workspaceId,
      ticket_id: context?.ticket_id || null,
      event_type: 'log_tool_execution',
      payload,
      created_by: user.sub || null,
    });

    if (auditErr) {
      return reply.status(500).send({ error: auditErr.message });
    }

    if (lastError) {
      return reply.status(504).send({
        ok: false,
        latency_ms: latencyMs,
        error: lastError,
        governance,
        rollout,
      });
    }

    return reply.send({ ok: true, latency_ms: latencyMs, result: toolResult, governance, rollout });
  });

  app.get('/executions', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { conversation_id, ticket_id, tenant_id, limit = '50' } = request.query as Record<string, string>;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

    let query = supabase
      .from('ticket_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('event_type', 'log_tool_execution')
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (ticket_id) query = query.eq('ticket_id', ticket_id);
    if (conversation_id) query = query.contains('payload', { context: { conversation_id } });
    if (tenant_id) query = query.contains('payload', { context: { tenant_id } });

    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });
}
