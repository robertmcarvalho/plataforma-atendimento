import type { SupabaseClient } from '@supabase/supabase-js';
import { formatTaskTitle, isTaskTypeCreatableForWorkspace, loadOpsTaskCatalog, catalogEntryByType } from './opsTaskCatalog';
import { shouldSkipDriverRegistrationTask } from './driverRegistrationGuards';
import { evaluateInternalNoteAutomation } from './opsTaskAutomation';
import { supabase } from './supabase';
import { isInAppEnabled } from './notificationPreferences';

const MENTION_RE = /@([^\n@]+?)(?=\s@|\s*$|[\n.,;:!?])/g;

const DRIVER_REGISTRATION_NOTE_RE =
  /\b(finalizar\s+cadastro|pr[eé][\s-]?cadastro|cadastro\s+do\s+entregador|completar\s+cadastro|cadastro\s+pendente)\b/i;

export type MentionResolution =
  | { ok: true; userId: string; name: string }
  | { ok: false; reason: 'ambiguous' | 'not_found'; query: string; candidates?: Array<{ id: string; name: string }> };

export function extractMentionQueries(content: string): string[] {
  const out: string[] = [];
  const text = String(content || '');
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    const q = m[1].trim();
    if (q.length >= 2) out.push(q);
  }
  return [...new Set(out)];
}

export async function resolveMentionByName(
  workspaceId: string,
  query: string,
  db: SupabaseClient = supabase
): Promise<MentionResolution> {
  const q = query.trim();
  if (!q) return { ok: false, reason: 'not_found', query: q };

  const { data: memberships } = await db
    .from('workspace_memberships')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);
  const userIds = (memberships || []).map((r) => r.user_id).filter(Boolean) as string[];
  if (!userIds.length) return { ok: false, reason: 'not_found', query: q };

  const { data: users } = await db.from('users').select('id, name').in('id', userIds).eq('is_active', true);
  const rows = (users || []) as Array<{ id: string; name: string }>;
  const lower = q.toLowerCase();
  const exact = rows.filter((u) => String(u.name || '').trim().toLowerCase() === lower);
  if (exact.length === 1) return { ok: true, userId: exact[0].id, name: exact[0].name };
  const partial = rows.filter((u) => String(u.name || '').toLowerCase().includes(lower));
  if (partial.length === 1) return { ok: true, userId: partial[0].id, name: partial[0].name };
  if (partial.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      query: q,
      candidates: partial.slice(0, 8).map((u) => ({ id: u.id, name: u.name })),
    };
  }
  return { ok: false, reason: 'not_found', query: q };
}

async function resolveSupervisorFallback(db: SupabaseClient, workspaceId: string): Promise<string | null> {
  const { data: memberships } = await db
    .from('workspace_memberships')
    .select('user_id, roles(name)')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);
  for (const row of memberships || []) {
    const role = (row as { roles?: { name?: string } | null }).roles?.name;
    if (role === 'supervisor') return String((row as { user_id: string }).user_id);
  }
  const { data } = await db.from('users').select('id').eq('role', 'supervisor').eq('is_active', true).limit(1).maybeSingle();
  return data?.id ? String(data.id) : null;
}

export type InternalNoteSideEffectsResult = {
  mentions: Array<{ user_id: string; name: string; task_id?: string }>;
  tasks_created: Array<{ id: string; task_type: string; title: string }>;
  errors: Array<{ type: string; message: string }>;
};

export async function applyInternalNoteSideEffects(input: {
  workspaceId: string;
  conversationId: string;
  noteId: string;
  authorId: string;
  content: string;
  authorNotificationPrefs?: Record<string, unknown> | null;
  db?: SupabaseClient;
}): Promise<InternalNoteSideEffectsResult> {
  const db = input.db ?? supabase;
  const result: InternalNoteSideEffectsResult = { mentions: [], tasks_created: [], errors: [] };

  const mentionQueries = extractMentionQueries(input.content);
  const resolvedMentions: Array<{ userId: string; name: string }> = [];

  for (const query of mentionQueries) {
    const res = await resolveMentionByName(input.workspaceId, query, db);
    if (!res.ok) {
      if (res.reason === 'ambiguous') {
        result.errors.push({
          type: 'mention_ambiguous',
          message: `Menção "@${query}" ambígua. Use o nome completo. Opções: ${(res.candidates || []).map((c) => c.name).join(', ')}`,
        });
      } else {
        result.errors.push({ type: 'mention_not_found', message: `Usuário não encontrado para "@${query}".` });
      }
      continue;
    }
    if (resolvedMentions.some((m) => m.userId === res.userId)) continue;
    resolvedMentions.push({ userId: res.userId, name: res.name });
  }

  const { data: conv } = await db
    .from('conversations')
    .select(
      'id, attendant_id, sector_id, context_driver_id, contact:contacts(id, driver_id, display_name)'
    )
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.conversationId)
    .maybeSingle();

  if (!conv) {
    result.errors.push({ type: 'conversation_not_found', message: 'Conversa não encontrada.' });
    return result;
  }

  const contact = (conv as { contact?: { driver_id?: string | null; display_name?: string } | null }).contact;
  const driverId =
    (conv as { context_driver_id?: string | null }).context_driver_id || contact?.driver_id || null;

  for (const mention of resolvedMentions) {
    if (mention.userId === input.authorId) continue;
    const authorPrefs = input.authorNotificationPrefs;
    const targetPrefsRow = await db.from('users').select('notification_preferences').eq('id', mention.userId).maybeSingle();
    const targetEnabled = isInAppEnabled(
      targetPrefsRow.data?.notification_preferences as Record<string, unknown> | null,
      'mention_internal_note'
    );
    if (!targetEnabled) continue;

    const { data: existing } = await db
      .from('pending_tasks')
      .select('id')
      .eq('workspace_id', input.workspaceId)
      .eq('task_type', 'internal_note_mention')
      .eq('assignee_id', mention.userId)
      .eq('conversation_id', input.conversationId)
      .in('status', ['open', 'in_progress'])
      .contains('metadata', { note_id: input.noteId } as Record<string, unknown>)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      result.mentions.push({ user_id: mention.userId, name: mention.name, task_id: String(existing.id) });
      continue;
    }

    const { data: task, error: taskErr } = await db
      .from('pending_tasks')
      .insert({
        workspace_id: input.workspaceId,
        task_type: 'internal_note_mention',
        title: `Menção em nota interna`,
        description: `Você foi mencionado em uma nota nesta conversa.`,
        status: 'open',
        priority: 'normal',
        conversation_id: input.conversationId,
        assignee_id: mention.userId,
        sector_id: (conv as { sector_id?: string | null }).sector_id || null,
        source: 'manual',
        metadata: { note_id: input.noteId, author_id: input.authorId, mention_name: mention.name },
      })
      .select('id, task_type, title')
      .single();

    if (taskErr) {
      result.errors.push({ type: 'mention_task_failed', message: taskErr.message });
    } else if (task) {
      result.mentions.push({ user_id: mention.userId, name: mention.name, task_id: String(task.id) });
      result.tasks_created.push({ id: String(task.id), task_type: String(task.task_type), title: String(task.title) });
    }
  }

  const assigneeId =
    (conv as { attendant_id?: string | null }).attendant_id ||
    (await resolveSupervisorFallback(db, input.workspaceId));

  if (DRIVER_REGISTRATION_NOTE_RE.test(input.content) && driverId) {
    if (await shouldSkipDriverRegistrationTask(db, input.workspaceId, driverId)) {
      return result;
    }

    const { data: driver } = await db.from('drivers').select('id, name').eq('id', driverId).maybeSingle();
    const driverName = driver?.name || contact?.display_name || 'Entregador';

    const { data: openDup } = await db
      .from('pending_tasks')
      .select('id, title')
      .eq('workspace_id', input.workspaceId)
      .eq('task_type', 'driver_registration_completion')
      .eq('driver_id', driverId)
      .in('status', ['open', 'in_progress'])
      .limit(1)
      .maybeSingle();

    if (openDup?.id) {
      result.tasks_created.push({
        id: String(openDup.id),
        task_type: 'driver_registration_completion',
        title: String(openDup.title),
      });
    } else if (assigneeId) {
      const allowed = await isTaskTypeCreatableForWorkspace(
        db,
        input.workspaceId,
        'driver_registration_completion',
        'internal_note'
      );
      if (allowed) {
        const catalog = await loadOpsTaskCatalog(db, input.workspaceId);
        const entry = catalogEntryByType(catalog, 'driver_registration_completion');
        const { data: regTask, error: regErr } = await db
          .from('pending_tasks')
          .insert({
            workspace_id: input.workspaceId,
            task_type: 'driver_registration_completion',
            title: formatTaskTitle(entry?.title_template || 'Finalizar cadastro: {driver_name}', {
              driver_name: driverName,
            }),
            description: 'Solicitação registrada em nota interna. Validar documentos e concluir cadastro do entregador.',
            status: 'open',
            priority: 'normal',
            conversation_id: input.conversationId,
            driver_id: driverId,
            assignee_id: assigneeId,
            sector_id: (conv as { sector_id?: string | null }).sector_id || null,
            source: 'manual',
            metadata: { note_id: input.noteId, author_id: input.authorId },
          })
          .select('id, task_type, title')
          .single();

        if (regErr) {
          result.errors.push({ type: 'registration_task_failed', message: regErr.message });
        } else if (regTask) {
          result.tasks_created.push({
            id: String(regTask.id),
            task_type: String(regTask.task_type),
            title: String(regTask.title),
          });
        }
      }
    }
  }

  if (driverId && assigneeId) {
    const driverName =
      (await db.from('drivers').select('name').eq('id', driverId).maybeSingle()).data?.name ||
      contact?.display_name ||
      'Entregador';
    const autoTasks = await evaluateInternalNoteAutomation({
      db,
      workspaceId: input.workspaceId,
      content: input.content,
      driverId,
      driverName: String(driverName),
      assigneeId,
      conversationId: input.conversationId,
      sectorId: (conv as { sector_id?: string | null }).sector_id || null,
      noteId: input.noteId,
      authorId: input.authorId,
    });
    for (const task of autoTasks) {
      if (!result.tasks_created.some((t) => t.id === task.id)) {
        result.tasks_created.push(task);
      }
    }
  }

  return result;
}
