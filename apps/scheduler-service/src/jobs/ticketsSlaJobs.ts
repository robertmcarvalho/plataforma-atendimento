import type { SupabaseClient } from '@supabase/supabase-js';

type JsonRecord = Record<string, unknown>;

export function registerTicketSlaJobs(db: SupabaseClient, timezone: string) {
  return {
    timezone,
    runAlert80Job: () => runAlert80Job(db),
    runEscalationJob: () => runEscalationJob(db),
    runDailyReportJob: () => runDailyReportJob(db),
  };
}

async function runAlert80Job(db: SupabaseClient) {
  const { data: rows, error } = await db
    .from('tickets')
    .select('id, workspace_id, conversation_id, assignee_user_id, leader_id, created_at, sla_minutes, due_at')
    .in('status', ['open', 'in_progress']);
  if (error || !rows?.length) return;

  for (const ticket of rows) {
    const createdAt = new Date(String(ticket.created_at || ''));
    const now = Date.now();
    if (Number.isNaN(createdAt.getTime())) continue;
    const elapsedMinutes = (now - createdAt.getTime()) / 60000;
    const threshold = Number(ticket.sla_minutes || 0) * 0.8;
    if (elapsedMinutes < threshold) continue;

    const exists = await hasRecentEvent(db, String(ticket.id), 'sla_80_alert');
    if (exists) continue;

    const supervisorId = await resolveSupervisorId(db, ticket.assignee_user_id as string | null | undefined);
    await db.from('ticket_events').insert({
      workspace_id: ticket.workspace_id || null,
      ticket_id: ticket.id,
      event_type: 'sla_80_alert',
      payload: {
        notified_attendant_id: ticket.assignee_user_id || null,
        notified_supervisor_id: supervisorId,
        threshold_minutes: threshold,
      } as JsonRecord,
      created_by: null,
    });

    await notifyUsersForTicket(
      db,
      String(ticket.id),
      (ticket.conversation_id as string | null | undefined) || null,
      (ticket.assignee_user_id as string | null | undefined) || null,
      supervisorId,
      'Alerta de SLA em 80%',
      `Ticket em 80% do prazo de SLA. Revise e trate com prioridade.`,
      {
        type: 'sla_80_alert',
        threshold_minutes: threshold,
      }
    );
  }
}

async function runEscalationJob(db: SupabaseClient) {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await db
    .from('tickets')
    .select('id, workspace_id, conversation_id, assignee_user_id, due_at')
    .in('status', ['open', 'in_progress'])
    .lt('due_at', nowIso);
  if (error || !rows?.length) return;

  for (const ticket of rows) {
    const exists = await hasRecentEvent(db, String(ticket.id), 'sla_escalated');
    if (exists) continue;

    const supervisorId = await resolveSupervisorId(db, ticket.assignee_user_id as string | null | undefined);
    await db
      .from('tickets')
      .update({
        status: 'overdue',
        assignee_user_id: supervisorId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ticket.id);

    await db.from('ticket_events').insert({
      workspace_id: ticket.workspace_id || null,
      ticket_id: ticket.id,
      event_type: 'sla_escalated',
      payload: {
        from_attendant_id: ticket.assignee_user_id || null,
        to_supervisor_id: supervisorId,
      } as JsonRecord,
      created_by: null,
    });

    await notifyUsersForTicket(
      db,
      String(ticket.id),
      (ticket.conversation_id as string | null | undefined) || null,
      (ticket.assignee_user_id as string | null | undefined) || null,
      supervisorId,
      'Escalonamento por SLA vencido',
      `Ticket vencido no SLA e escalonado automaticamente para supervisor.`,
      {
        type: 'sla_escalated',
      }
    );
  }
}

async function runDailyReportJob(db: SupabaseClient) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const { data: rows, error } = await db
    .from('tickets')
    .select('workspace_id, type, status, created_at, resolved_at')
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());
  if (error) return;

  const rowsByWorkspace = new Map<string, NonNullable<typeof rows>>();
  for (const row of rows || []) {
    const workspaceKey = String(row.workspace_id || 'unscoped');
    rowsByWorkspace.set(workspaceKey, [...(rowsByWorkspace.get(workspaceKey) || []), row]);
  }

  for (const [workspaceKey, workspaceRows] of rowsByWorkspace.entries()) {
    const workspaceId = workspaceKey === 'unscoped' ? null : workspaceKey;
    const supervisors = await listSupervisors(db, workspaceId);
    if (!supervisors.length) continue;

    const opened = workspaceRows.length;
    const resolved = workspaceRows.filter((r) => r.status === 'resolved').length;
    const overdue = workspaceRows.filter((r) => r.status === 'overdue').length;
    const avgByType = computeAverageByType(workspaceRows);

    for (const supervisor of supervisors) {
      await db.from('ticket_events').insert({
        workspace_id: workspaceId,
        ticket_id: null,
        event_type: 'sla_daily_report',
        payload: {
          supervisor_id: supervisor.id,
          opened,
          resolved,
          overdue,
          avg_minutes_by_type: avgByType,
        } as JsonRecord,
        created_by: null,
      });

      await createPendingTask(
        db,
        null,
        supervisor.id,
        'ticket_sla_daily_report',
        'Resumo diário de tickets',
        `Fechamento do dia: abertos=${opened}, resolvidos=${resolved}, vencidos=${overdue}.`,
        {
          workspace_id: workspaceId,
          opened,
          resolved,
          overdue,
          avg_minutes_by_type: avgByType,
        }
      );
    }
  }
}

async function hasRecentEvent(db: SupabaseClient, ticketId: string, eventType: string): Promise<boolean> {
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data } = await db
    .from('ticket_events')
    .select('id')
    .eq('ticket_id', ticketId)
    .eq('event_type', eventType)
    .gte('created_at', tenMinAgo)
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

async function resolveSupervisorId(db: SupabaseClient, fallbackUserId?: string | null): Promise<string | null> {
  const { data } = await db.from('users').select('id').eq('role', 'supervisor').eq('is_active', true).limit(1).maybeSingle();
  return (data?.id as string | undefined) || fallbackUserId || null;
}

async function listSupervisors(db: SupabaseClient, workspaceId?: string | null): Promise<Array<{ id: string }>> {
  let userIds: string[] | null = null;
  if (workspaceId) {
    const { data: memberships } = await db
      .from('workspace_memberships')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);
    userIds = (memberships || []).map((m: { user_id?: string | null }) => m.user_id).filter((id): id is string => Boolean(id));
    if (!userIds.length) return [];
  }

  let query = db.from('users').select('id').eq('role', 'supervisor').eq('is_active', true);
  if (userIds) query = query.in('id', userIds);
  const { data } = await query;
  return (data || []) as Array<{ id: string }>;
}

async function notifyUsersForTicket(
  db: SupabaseClient,
  ticketId: string,
  conversationId: string | null,
  attendantId: string | null,
  supervisorId: string | null,
  title: string,
  description: string,
  metadata: JsonRecord
) {
  const recipients = [attendantId, supervisorId].filter((x): x is string => Boolean(x));
  for (const userId of recipients) {
    await createPendingTask(db, conversationId, userId, 'ticket_sla_notification', title, description, {
      ticket_id: ticketId,
      ...metadata,
    });
  }

  if (conversationId) {
    await appendInternalNote(
      db,
      conversationId,
      `[SLA Tickets] ${title} — ${description} (ticket: ${ticketId})`
    );
  }
}

async function createPendingTask(
  db: SupabaseClient,
  conversationId: string | null,
  assigneeId: string,
  taskType: string,
  title: string,
  description: string,
  metadata: JsonRecord
) {
  const ticketId = String((metadata.ticket_id as string | undefined) || '');
  const { data: existing } = await db
    .from('pending_tasks')
    .select('id, metadata')
    .eq('task_type', taskType)
    .eq('assignee_id', assigneeId)
    .in('status', ['open', 'in_progress'])
    .limit(20);
  const alreadyOpen = (existing || []).some((row: { metadata?: JsonRecord | null }) => {
    const currentTicketId = String((row?.metadata?.ticket_id as string | undefined) || '');
    return ticketId && currentTicketId === ticketId;
  });
  if (alreadyOpen) return;

  const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await db.from('pending_tasks').insert({
    task_type: taskType,
    title,
    description,
    status: 'open',
    priority: 'high',
    conversation_id: conversationId,
    assignee_id: assigneeId,
    source: 'system',
    metadata,
    due_at: dueAt,
  });
}

async function appendInternalNote(db: SupabaseClient, conversationId: string, content: string) {
  const systemAuthor = await resolveSystemNoteAuthorId(db);
  if (!systemAuthor) return;
  await db.from('internal_notes').insert({
    conversation_id: conversationId,
    author_id: systemAuthor,
    content,
  });
}

async function resolveSystemNoteAuthorId(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from('users').select('id').eq('is_active', true).limit(1).maybeSingle();
  return (data?.id as string | undefined) || null;
}

function computeAverageByType(rows: Array<{ type?: string | null; created_at?: string | null; resolved_at?: string | null }>) {
  const sums = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    if (!row.type || !row.created_at || !row.resolved_at) continue;
    const start = new Date(row.created_at).getTime();
    const end = new Date(row.resolved_at).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    const mins = Math.round((end - start) / 60000);
    const curr = sums.get(row.type) || { total: 0, count: 0 };
    curr.total += mins;
    curr.count += 1;
    sums.set(row.type, curr);
  }

  const output: Record<string, number> = {};
  for (const [type, val] of sums.entries()) {
    output[type] = val.count ? Math.round(val.total / val.count) : 0;
  }
  return output;
}
