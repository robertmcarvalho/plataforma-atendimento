import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { sectorIdsFromJwt } from '../lib/jwtSectorIds';
import { writeAuditLog } from '../lib/auditLog';
import { sendOutboundWhatsAppText } from '../lib/outboundWhatsAppText';
import { offboardDriver } from '../lib/driverOffboarding';
import { requireWorkspace } from '../lib/workspaceContext';
import { buildAttendantPendingTasksOr, buildSupervisorPendingTasksOr } from '../lib/pendingTaskScope';

const patchTaskSchema = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']),
});

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(1).optional(),
});

function taskRole(user: { role?: string }): string {
  return String(user.role || '')
    .trim()
    .toLowerCase();
}

async function resolveSystemNoteAuthorId(): Promise<string | null> {
  const { data } = await supabase.from('users').select('id').eq('is_active', true).limit(1).maybeSingle();
  return (data?.id as string | undefined) || null;
}

async function appendInternalNote(workspaceId: string, conversationId: string, content: string): Promise<void> {
  const systemAuthor = await resolveSystemNoteAuthorId();
  if (!systemAuthor) return;
  await supabase.from('internal_notes').insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    author_id: systemAuthor,
    content,
  });
}

export async function taskRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string; role?: string; sector_id?: string | null; sector_ids?: string[] };
    const role = taskRole(user);
    const q = request.query as Record<string, string>;
    const { status = 'open', limit = '50', assignee_id } = q;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

    let query = supabase
      .from('pending_tasks')
      .select(
        `
        *,
        conversation:conversations(id, status, priority, sector_id),
        contact:contacts(id, wa_phone, display_name),
        driver:drivers(id, name, phone)
      `
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (status !== 'all') query = query.eq('status', status);

    const assignee = String(assignee_id || '').trim();
    if (assignee && /^[0-9a-f-]{36}$/i.test(assignee)) query = query.eq('assignee_id', assignee);

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

    const { data: updatedTask, error: updErr } = await supabase
      .from('pending_tasks')
      .update({
        status: 'done',
        completed_at: nowIso,
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

    if (conversationId) {
      const textApproved =
        'Sua solicitacao de adiantamento foi aprovada e esta em processamento. Em caso de duvida, responda esta mensagem.';
      const textRejected =
        `Sua solicitacao de adiantamento nao foi aprovada no momento. Motivo: ${reason}. Se precisar, podemos orientar os proximos passos.`;
      try {
        await sendOutboundWhatsAppText(conversationId, decision === 'approved' ? textApproved : textRejected);
        messageSent = true;
      } catch {
        messageSent = false;
      }

      const closeReason = decision === 'approved' ? 'adiantamento_aprovado' : 'adiantamento_reprovado';
      const { error: convErr } = await supabase
        .from('conversations')
        .update({
          status: 'resolved',
          close_reason: closeReason,
          resolved_at: nowIso,
          updated_at: nowIso,
        })
        .eq('workspace_id', workspaceId)
        .eq('id', conversationId);
      conversationResolved = !convErr;

      await appendInternalNote(
        workspaceId,
        conversationId,
        decision === 'approved'
          ? '[ADIANTAMENTO] Solicitação aprovada pelo supervisor financeiro. Conversa encerrada automaticamente.'
          : `[ADIANTAMENTO] Solicitação reprovada pelo supervisor financeiro. Motivo: ${reason}. Conversa encerrada automaticamente.`
      );
    }

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
        decision === 'approved' && driverId
          ? {
              type: 'open_financial_entry',
              url: `/financial?fromTask=${id}&driver_id=${driverId}&type=advance&decision=approved&approved_at=${encodeURIComponent(nowIso)}`,
              approved_at: nowIso,
            }
          : { type: 'none' },
      message_sent: messageSent,
      conversation_resolved: conversationResolved,
    });
  });
}
