import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import {
  markConversationFirstResponseIfNeeded,
  markConversationResolvedSla,
  refreshConversationSla,
  syncConversationSlaMilestonesFromMessages,
} from '../lib/conversationSla';
import { ensureGuidedDemandTaskForConversation, closeGuidedDemandTasksOnResolve } from '../lib/guidedDemandTasks';
import { ATTENDANCE_PENDING_TASK_TYPES, syncPendingTaskFromConversation } from '../lib/pendingTaskScope';
import { sectorIdsFromJwt } from '../lib/jwtSectorIds';
import { resolveSectorIdsFromQueueAssignments } from '../lib/userSectorsDb';
import { isAttendantLikeRole } from '../lib/roleAliases';
import { requireWorkspace } from '../lib/workspaceContext';
import { enrichPharmacyApiRow } from '../lib/pharmacyCommercial';
import { canonicalBrazilWaPhone } from '@plataforma/channel-runtime';

const PHARMACY_CONTEXT_EMBED = `
  id, trade_name, city, state,
  delivery_fee_cents, delivery_fee_driver_payout_cents,
  minimum_guaranteed_cents, minimum_guaranteed_driver_payout_cents,
  delivery_schedule
`;

const CONVERSATION_DETAIL_SELECT = `
  *,
  contacts(id, wa_phone, display_name, profile_type, driver_id, pharmacy_id, leader_id),
  sectors:sectors!sector_id(id, name),
  attendant:users!attendant_id(id, name),
  context_pharmacy:pharmacies!context_pharmacy_id(${PHARMACY_CONTEXT_EMBED}),
  context_driver:drivers!context_driver_id(id, name, cpf, phone),
  context_leader:leaders!context_leader_id(id, name, phone),
  topic:ai_topics!ai_topic_id(id, name),
  messages(id, direction, type, content, media_url, status, sent_at, created_at,
    ai_sentiment, ai_sentiment_score, ai_urgency, ai_urgency_score, ai_analyzed_at),
  internal_notes(id, content, created_at, author:users!author_id(id, name)),
  sla_events(
    id, event_type, severity, notified_attendant, notified_supervisor, created_at
  ),
  conversation_assignments(
    id, reason, created_at,
    assigned_by:users!assigned_by(id, name),
    from_attendant:users!from_attendant_id(id, name),
    to_attendant:users!to_attendant_id(id, name),
    from_sector:sectors!from_sector_id(id, name),
    to_sector:sectors!to_sector_id(id, name)
  )
`;

function enrichConversationPharmacyContext(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return row;
  const cp = row.context_pharmacy;
  if (!cp || typeof cp !== 'object') return row;
  return { ...row, context_pharmacy: enrichPharmacyApiRow(cp as Record<string, unknown>) };
}
import { scheduleInboundAiAnalysis, scheduleNpsPredictionOnResolved } from '@plataforma/ai-core';
import { resolveTemplateBody, resolveSystemNoteAuthorId } from '@plataforma/operational-notes';
import { normalizeEmptyTemplatePlaceholders, resolveTemplateVariableKeys } from '../lib/metaTemplateSync';
import { upsertContactByWaPhone, ensureLeaderContactByWaPhone } from '../lib/contactByPhone';
import {
  mergeDuplicateOpenConversations,
  resolveOrReuseConversation,
  updatePrimaryConversationIfActive,
} from '../lib/conversationResolve';
import { requireConversationsTransfer } from '../lib/permissions';
import { scheduleCsatOnConversationResolved } from '../lib/conversationCsatOnResolve';
import { scheduleCloseOpenTicketsForConversation } from '../lib/closeTicketsOnConversationResolve';
import { resolveWhatsAppSendConfig, sendWhatsAppCloudMessage } from '../lib/channelResolver';

function metaApiErrorMessage(detail: unknown, fallback: string): string {
  const message = (detail as { error?: { message?: string } } | null)?.error?.message;
  return message?.trim() || fallback;
}

function normalizeWaPhone(input: string): string {
  const canonical = canonicalBrazilWaPhone(input);
  if (canonical) return canonical;
  const d = String(input || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length >= 10 && d.length <= 11) return `55${d}`;
  return d;
}

async function lastInboundWithin24h(workspaceId: string, conversationId: string): Promise<boolean> {
  const { data } = await supabase
    .from('messages')
    .select('created_at')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.created_at) return false;
  return Date.now() - new Date(data.created_at).getTime() < 24 * 3600000;
}

async function getDefaultWhatsAppChannelId(workspaceId: string): Promise<string | null> {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID?.trim() || process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim();
  let query = supabase
    .from('workspace_channels')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'whatsapp')
    .eq('is_active', true);
  if (phoneNumberId) query = query.eq('external_id', phoneNumberId);
  const { data } = await query.order('is_default', { ascending: false }).limit(1).maybeSingle();
  return data?.id ? String(data.id) : null;
}

async function persistOutboundRow(
  workspaceId: string,
  conversationId: string,
  row: {
    meta_message_id?: string | null;
    type: string;
    content?: string | null;
    template_id?: string | null;
  }
) {
  await supabase.from('messages').insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    meta_message_id: row.meta_message_id ?? null,
    direction: 'outbound',
    type: row.type,
    content: row.content ?? null,
    template_id: row.template_id ?? null,
    status: 'sent',
    sent_at: new Date().toISOString(),
  });
  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      status: 'open',
      has_unread: false,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', conversationId);

  await markConversationFirstResponseIfNeeded(conversationId);
}

function isUuid(value: unknown) {
  if (typeof value !== 'string') return false;
  // Only to avoid PostgREST UUID cast errors (ex: eq.null).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const conversationUpdateSchema = z.object({
  sector_id: z.string().uuid().optional(),
  attendant_id: z.string().uuid().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  merge_duplicate_open: z.boolean().optional(),
  context_pharmacy_id: z.string().uuid().optional().nullable(),
  context_commercial_lead_id: z.string().uuid().optional().nullable(),
  intent_sector_id: z.string().uuid().optional().nullable(),
  status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  summary: z.string().max(280).optional().nullable(),
  close_reason: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const transferSchema = z.object({
  to_attendant_id: z.string().uuid().optional(),
  to_sector_id: z.string().uuid().optional(),
  reason: z.string().optional(),
});

const leaderPortalStartSchema = z.object({
  sector_id: z.string().uuid().optional(),
});

const initialMessageSchema = z.union([
  z.object({
    template_id: z.string().uuid(),
    template_variables: z.record(z.string()).optional(),
  }),
  z.object({ content: z.string().min(1) }),
]);

const staffConversationStartSchema = z.object({
  contact_type: z.enum(['driver', 'pharmacy', 'leader', 'phone', 'commercial_lead']),
  driver_id: z.string().uuid().optional(),
  pharmacy_id: z.string().uuid().optional(),
  leader_id: z.string().uuid().optional(),
  commercial_lead_id: z.string().uuid().optional(),
  wa_phone: z.string().optional(),
  display_name: z.string().optional(),
  sector_id: z.string().uuid().optional(),
  workspace_channel_id: z.string().uuid().optional(),
  initial_message: initialMessageSchema,
});

export async function conversationRoutes(app: FastifyInstance) {
  // GET /api/conversations — inbox com filtros
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as Record<string, string>;
    const { status, sector_id, attendant_id, priority, search, workspace_channel_id, page = '1', limit = '30' } = q;
    const attendance_group = String(q.attendance_group || '').trim();
    const sla_stage = String(q.sla_stage || '').trim();
    const sla_bucket = String(q.sla_bucket || '').trim();
    const escalated_supervisor = String(q.escalated_supervisor || '').trim();
    const user = request.user as { sub: string; role: string; sector_id?: string | null; sector_ids?: string[] };

    const offset = (Number(page) - 1) * Number(limit);

    if (sector_id && !isUuid(sector_id)) return reply.status(400).send({ error: 'sector_id invalido' });
    if (attendant_id && !isUuid(attendant_id)) return reply.status(400).send({ error: 'attendant_id invalido' });
    if (attendance_group && !['active', 'waiting', 'finished'].includes(attendance_group)) {
      return reply.status(400).send({ error: 'attendance_group invalido (use active|waiting|finished)' });
    }
    if (sla_stage && !['first_response', 'treatment', 'resolution'].includes(sla_stage)) {
      return reply.status(400).send({ error: 'sla_stage invalido' });
    }
    if (sla_bucket && !['breached', 'at_risk', 'on_track'].includes(sla_bucket)) {
      return reply.status(400).send({ error: 'sla_bucket invalido' });
    }
    if (sla_stage && !sla_bucket) {
      return reply.status(400).send({ error: 'sla_bucket obrigatório quando sla_stage é informado' });
    }

    let escalatedIds: string[] | null = null;
    if (escalated_supervisor === '1') {
      const { data: evRows, error: evErr } = await supabase
        .from('sla_events')
        .select('conversation_id')
        .eq('workspace_id', workspaceId)
        .eq('notified_supervisor', true)
        .limit(1000);
      if (evErr) return reply.status(500).send({ error: evErr.message });
      escalatedIds = [...new Set((evRows || []).map((r: { conversation_id: string }) => r.conversation_id).filter(Boolean))];
      if (!escalatedIds.length) {
        return reply.send({ data: [], total: 0, page: Number(page), limit: Number(limit) });
      }
    }

    let query = supabase
      .from('conversations')
      .select(`
        *,
        contacts(id, wa_phone, display_name, profile_type),
        sectors:sectors!sector_id(id, name),
        attendant:users!attendant_id(id, name),
        context_driver:drivers!context_driver_id(id, name),
        context_pharmacy:pharmacies!context_pharmacy_id(id, trade_name),
        topic:ai_topics!ai_topic_id(id, name),
        messages(content, direction, created_at, status, ai_sentiment, ai_sentiment_score, ai_urgency, ai_urgency_score, ai_analyzed_at)
      `, { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('last_message_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (attendance_group === 'active') query = query.eq('status', 'open');
    else if (attendance_group === 'waiting') query = query.eq('status', 'pending');
    else if (attendance_group === 'finished') query = query.in('status', ['resolved', 'closed']);
    else if (status) query = query.eq('status', status);
    else query = query.not('status', 'in', '(resolved,closed)');

    if (sector_id) query = query.eq('sector_id', sector_id);
    if (attendant_id) query = query.eq('attendant_id', attendant_id);
    if (priority) query = query.eq('priority', priority);
    if (workspace_channel_id && isUuid(workspace_channel_id)) query = query.eq('workspace_channel_id', workspace_channel_id);

    if (escalatedIds?.length) query = query.in('id', escalatedIds);

    const nowIso = new Date().toISOString();
    const riskIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    if (sla_stage === 'first_response') {
      query = query.not('sla_first_response_deadline', 'is', null);
      query = query.in('status', ['open', 'pending']);
      if (sla_bucket === 'breached') {
        query = query.is('sla_first_response_at', null).lt('sla_first_response_deadline', nowIso);
      } else if (sla_bucket === 'at_risk') {
        query = query
          .is('sla_first_response_at', null)
          .gt('sla_first_response_deadline', nowIso)
          .lte('sla_first_response_deadline', riskIso);
      } else if (sla_bucket === 'on_track') {
        query = query.is('sla_first_response_at', null).gt('sla_first_response_deadline', riskIso);
      }
    } else if (sla_stage === 'treatment') {
      query = query.not('sla_first_response_at', 'is', null).not('sla_treatment_deadline', 'is', null);
      query = query.in('status', ['open', 'pending']);
      if (sla_bucket === 'breached') {
        query = query.lt('sla_treatment_deadline', nowIso);
      } else if (sla_bucket === 'at_risk') {
        query = query.gt('sla_treatment_deadline', nowIso).lte('sla_treatment_deadline', riskIso);
      } else if (sla_bucket === 'on_track') {
        query = query.gt('sla_treatment_deadline', riskIso);
      }
    } else if (sla_stage === 'resolution') {
      query = query.not('sla_resolution_deadline', 'is', null);
      query = query.in('status', ['open', 'pending']);
      if (sla_bucket === 'breached') {
        query = query.lt('sla_resolution_deadline', nowIso);
      } else if (sla_bucket === 'at_risk') {
        query = query.gt('sla_resolution_deadline', nowIso).lte('sla_resolution_deadline', riskIso);
      } else if (sla_bucket === 'on_track') {
        query = query.gt('sla_resolution_deadline', riskIso);
      }
    }

    // Atendente/supervisor: setores legados + conversas ainda não roteadas em canais/fila do webhook.
    if ((isAttendantLikeRole(user.role) || user.role === 'supervisor') && !sector_id) {
      let sids = sectorIdsFromJwt(user);
      if (!sids.length) {
        const fromQueues = await resolveSectorIdsFromQueueAssignments(supabase, workspaceId, user.sub);
        if (fromQueues.length) sids = fromQueues;
      }
      const sectorFilters = sids.length ? sids : isUuid(user.sector_id) ? [user.sector_id as string] : [];
      const { data: queueAssignments, error: queueErr } = await supabase
        .from('user_channel_queue_assignments')
        .select('workspace_channel_id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.sub)
        .eq('is_enabled', true);
      if (queueErr && !(queueErr.message || '').includes('user_channel_queue_assignments')) {
        return reply.status(500).send({ error: queueErr.message });
      }
      const channelIds = [
        ...new Set(
          (queueAssignments || [])
            .map((row: { workspace_channel_id?: string | null }) => String(row.workspace_channel_id || '').trim())
            .filter(isUuid)
        ),
      ];

      if (sectorFilters.length && channelIds.length) {
        query = query.in('workspace_channel_id', channelIds);
        const sectorOr = [
          `sector_id.in.(${sectorFilters.join(',')})`,
          `attendant_id.eq.${user.sub}`,
          'sector_id.is.null',
        ].join(',');
        query = query.or(sectorOr);
      } else if (sectorFilters.length) {
        query = query.in('sector_id', sectorFilters);
      } else if (channelIds.length) {
        query = query.in('workspace_channel_id', channelIds);
        query = query.or(`attendant_id.eq.${user.sub},sector_id.is.null`);
      } else {
        return reply.send({ data: [], total: 0, page: Number(page), limit: Number(limit) });
      }
    }

    // Vendas/comercial: todas as conversas do canal WhatsApp comercial (visão compartilhada do time).
    if (user.role === 'sales' || user.role === 'commercial') {
      try {
        const { resolveCommercialWhatsAppChannel } = await import('../lib/commercial/commercialChannel');
        const commercialChannelId = await resolveCommercialWhatsAppChannel(workspaceId);
        query = query.eq('workspace_channel_id', commercialChannelId);
      } catch {
        return reply.send({ data: [], total: 0, page: Number(page), limit: Number(limit) });
      }
    }

    // Líder só vê conversas vinculadas ao seu perfil (via contacts.leader_id).
    // Evita filtro em join/embedded (PostgREST) usando contact_id diretamente.
    if (user.role === 'leader') {
      const { data: leader } = await supabase.from('leaders').select('id').eq('workspace_id', workspaceId).eq('user_id', user.sub).single();
      if (leader?.id) {
        const { data: contactRows, error: cErr } = await supabase.from('contacts').select('id').eq('workspace_id', workspaceId).eq('leader_id', leader.id);
        if (cErr) return reply.status(500).send({ error: cErr.message });
        const contactIds = (contactRows || []).map((c: any) => c.id).filter(Boolean);
        if (!contactIds.length) return reply.send({ data: [], total: 0, page: Number(page), limit: Number(limit) });
        query = query.in('contact_id', contactIds);
      }
    }

    const { data, error, count } = await query;
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ data, total: count, page: Number(page), limit: Number(limit) });
  });

  // GET /api/conversations/:id
  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    await syncConversationSlaMilestonesFromMessages(id).catch(() => undefined);
    await syncPendingTaskFromConversation(supabase, id, [...ATTENDANCE_PENDING_TASK_TYPES]).catch(() => undefined);
    await ensureGuidedDemandTaskForConversation(supabase, workspaceId, id).catch(() => undefined);

    const { data, error } = await supabase
      .from('conversations')
      .select(CONVERSATION_DETAIL_SELECT)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (error) return reply.status(404).send({ error: 'Conversa não encontrada' });

    const payload = enrichConversationPharmacyContext(data as Record<string, unknown>);
    if (payload && Array.isArray((payload as { messages?: unknown[] }).messages)) {
      const messages = (payload as { messages: Array<{ created_at?: string; sent_at?: string }> }).messages;
      messages.sort((a, b) => {
        const ta = new Date(a.sent_at || a.created_at || 0).getTime();
        const tb = new Date(b.sent_at || b.created_at || 0).getTime();
        return ta - tb;
      });
    }
    return reply.send(payload);
  });

  // PATCH /api/conversations/:id — atualizar status, prioridade, etc
  app.patch('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = conversationUpdateSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const jwtUser = request.user as { role?: string };
    const role = jwtUser?.role || '';

    let tagsForUpdate: string[] | undefined;
    if (body.data.tags !== undefined) {
      if (role !== 'admin' && role !== 'supervisor') {
        return reply.status(403).send({ error: 'Apenas administradores e supervisores podem alterar tags.' });
      }
      const unique = Array.from(new Set(body.data.tags.filter(Boolean)));
      if (unique.length === 0) {
        tagsForUpdate = [];
      } else {
        const { data: rows, error: tagErr } = await supabase
          .from('conversation_tag_catalog')
          .select('slug')
          .in('slug', unique);
        if (tagErr) return reply.status(500).send({ error: tagErr.message });
        const ok = new Set((rows || []).map((r: { slug: string }) => r.slug));
        const invalid = unique.filter((s) => !ok.has(s));
        if (invalid.length) {
          return reply.status(400).send({ error: 'Tag inválida ou fora do catálogo.', invalid });
        }
        tagsForUpdate = unique;
      }
    }

    const patchPayload = { ...body.data, ...(tagsForUpdate !== undefined ? { tags: tagsForUpdate } : {}) };
    const { merge_duplicate_open: mergeDuplicates, ...restPatch } = patchPayload;
    const updates: Record<string, unknown> = { ...restPatch, updated_at: new Date().toISOString() };
    const resolvedAtIso =
      body.data.status === 'resolved' || body.data.status === 'closed' ? new Date().toISOString() : null;
    if (resolvedAtIso) {
      updates.resolved_at = resolvedAtIso;
    }

    const { data: before } = await supabase
      .from('conversations')
      .select('attendant_id, sector_id, status, sla_resolution_deadline, resolved_at, contact_id')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();


    const { data, error } = await supabase
      .from('conversations').update(updates).eq('workspace_id', workspaceId).eq('id', id).select().single();
    if (error) return reply.status(500).send({ error: error.message });

    if (mergeDuplicates && body.data.contact_id) {
      await mergeDuplicateOpenConversations(supabase, workspaceId, String(body.data.contact_id), id);
    }

    if (before) {
      const patch = body.data;
      const becameOpen =
        patch.status === 'open' && (before.status === 'resolved' || before.status === 'closed');
      const attendantChanged =
        patch.attendant_id !== undefined && patch.attendant_id !== before.attendant_id;
      const sectorChanged = patch.sector_id !== undefined && patch.sector_id !== before.sector_id;

      if (becameOpen) {
        scheduleInboundAiAnalysis(supabase, { conversationId: id, tenantId: workspaceId, reason: 'reopened' });
      } else if (attendantChanged || sectorChanged) {
        scheduleInboundAiAnalysis(supabase, { conversationId: id, tenantId: workspaceId, reason: 'transferred' });
      }

      const resolvedNow =
        (patch.status === 'resolved' || patch.status === 'closed') &&
        before.status !== 'resolved' &&
        before.status !== 'closed';
      if (resolvedNow) {
        scheduleCsatOnConversationResolved(supabase, id, workspaceId);
        scheduleCloseOpenTicketsForConversation(supabase, workspaceId, id);
        scheduleNpsPredictionOnResolved(supabase, id, workspaceId);
        const at = resolvedAtIso ? new Date(resolvedAtIso) : new Date();
        const slaResolved = await markConversationResolvedSla(id, at);
        await closeGuidedDemandTasksOnResolve(supabase, id).catch(() => undefined);
        if (slaResolved && data) {
          return reply.send({ ...data, sla_resolved_ok: slaResolved.sla_resolved_ok });
        }
      }

      if (attendantChanged || sectorChanged) {
        await syncPendingTaskFromConversation(supabase, id, [...ATTENDANCE_PENDING_TASK_TYPES]).catch(() => undefined);
      }
    }

    return reply.send(data);
  });

  // POST /api/conversations/:id/assign — atribuir atendente
  app.post('/:id/assign', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { attendant_id } = request.body as { attendant_id: string };
    const user = request.user as { sub: string };

    const { data: current } = await supabase.from('conversations').select('attendant_id, sector_id').eq('workspace_id', workspaceId).eq('id', id).single();

    await supabase.from('conversation_assignments').insert({
      workspace_id: workspaceId,
      conversation_id: id,
      from_attendant_id: current?.attendant_id,
      to_attendant_id: attendant_id,
      from_sector_id: current?.sector_id,
      to_sector_id: current?.sector_id,
      assigned_by: user.sub,
    });

    const { data, error } = await supabase
      .from('conversations').update({ attendant_id, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).select().single();
    if (error) return reply.status(500).send({ error: error.message });

    const touchedAttendant = attendant_id !== current?.attendant_id;
    if (touchedAttendant) {
      scheduleInboundAiAnalysis(supabase, { conversationId: id, tenantId: workspaceId, reason: 'transferred' });
      await syncPendingTaskFromConversation(supabase, id, [...ATTENDANCE_PENDING_TASK_TYPES]).catch(() => undefined);
    }

    return reply.send(data);
  });

  // POST /api/conversations/:id/transfer — transferir setor/atendente
  app.post('/:id/transfer', { preHandler: [authenticate, requireConversationsTransfer] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = transferSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const { to_attendant_id, to_sector_id, reason } = body.data;
    const user = request.user as { sub: string };

    const { data: current } = await supabase
      .from('conversations').select('attendant_id, sector_id').eq('workspace_id', workspaceId).eq('id', id).single();

    await supabase.from('conversation_assignments').insert({
      workspace_id: workspaceId,
      conversation_id: id,
      from_attendant_id: current?.attendant_id,
      to_attendant_id,
      from_sector_id: current?.sector_id,
      to_sector_id,
      reason,
      assigned_by: user.sub,
    });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (to_attendant_id) updates.attendant_id = to_attendant_id;
    if (to_sector_id) updates.sector_id = to_sector_id;

    const { data, error } = await supabase
      .from('conversations').update(updates).eq('workspace_id', workspaceId).eq('id', id).select().single();
    if (error) return reply.status(500).send({ error: error.message });

    const attendantMoved =
      to_attendant_id !== undefined && to_attendant_id !== current?.attendant_id;
    const sectorMoved = to_sector_id !== undefined && to_sector_id !== current?.sector_id;
    if (attendantMoved || sectorMoved) {
      scheduleInboundAiAnalysis(supabase, { conversationId: id, tenantId: workspaceId, reason: 'transferred' });
      await syncPendingTaskFromConversation(supabase, id, [...ATTENDANCE_PENDING_TASK_TYPES]).catch(() => undefined);
    }

    return reply.send(data);
  });

  // POST /api/conversations/:id/notes — adicionar nota interna
  app.post('/:id/notes', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { content } = request.body as { content: string };
    const user = request.user as { sub: string };
    const trimmed = String(content || '').trim();
    if (!trimmed) return reply.status(400).send({ error: 'Conteúdo da nota é obrigatório.' });

    const { extractMentionQueries, resolveMentionByName, applyInternalNoteSideEffects } = await import(
      '../lib/internalNoteSideEffects'
    );
    const mentionQueries = extractMentionQueries(trimmed);
    for (const q of mentionQueries) {
      const res = await resolveMentionByName(workspaceId, q);
      if (!res.ok && res.reason === 'ambiguous') {
        return reply.status(400).send({
          error: `Menção "@${q}" ambígua. Use o nome completo.`,
          candidates: res.candidates,
        });
      }
    }

    const { data, error } = await supabase
      .from('internal_notes')
      .insert({ workspace_id: workspaceId, conversation_id: id, author_id: user.sub, content: trimmed })
      .select(`*, author:users!author_id(id, name)`)
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    const { data: authorRow } = await supabase
      .from('users')
      .select('notification_preferences')
      .eq('id', user.sub)
      .maybeSingle();

    const sideEffects = await applyInternalNoteSideEffects({
      workspaceId,
      conversationId: id,
      noteId: String(data.id),
      authorId: user.sub,
      content: trimmed,
      authorNotificationPrefs: (authorRow?.notification_preferences as Record<string, unknown> | null) || null,
    });

    return reply.status(201).send({ note: data, side_effects: sideEffects });
  });

  // POST /api/conversations/:id/chat — chat interno entre atendentes
  app.post('/:id/chat', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { content } = request.body as { content: string };
    const user = request.user as { sub: string };

    const { data, error } = await supabase
      .from('internal_chat_messages')
      .insert({ workspace_id: workspaceId, conversation_id: id, sender_id: user.sub, content })
      .select(`*, sender:users!sender_id(id, name)`)
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(data);
  });

  // PATCH /api/conversations/:id/reopen — reabrir conversa
  app.patch('/:id/reopen', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('conversations')
      .update({ status: 'open', resolved_at: null, close_reason: null, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    scheduleInboundAiAnalysis(supabase, { conversationId: id, tenantId: workspaceId, reason: 'reopened' });
    return reply.send(data);
  });

  // PATCH /api/conversations/:id/read — marcar como lida
  app.patch('/:id/read', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { error } = await supabase
      .from('conversations')
      .update({ has_unread: false, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id);

    if (error) {
      // Allow dev setups where migration 002 wasn't applied yet.
      if ((error.message || '').includes('has_unread') && (error.message || '').includes('does not exist')) {
        return reply.status(204).send();
      }
      return reply.status(500).send({ error: error.message });
    }
    return reply.status(204).send();
  });

  // POST /api/conversations/start — portal líder (legado) ou atendente (nova conversa)
  app.post('/start', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string; role: string; sector_id?: string | null; name?: string };
    const rawBody = request.body as Record<string, unknown>;

    const isLegacyLeaderPortal =
      user.role === 'leader' &&
      rawBody.contact_type === undefined &&
      rawBody.initial_message === undefined;

    if (isLegacyLeaderPortal) {
      const parsed = leaderPortalStartSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
      }
      const { sector_id } = parsed.data;

      const { data: leader } = await supabase.from('leaders').select('*').eq('workspace_id', workspaceId).eq('user_id', user.sub).single();
      if (!leader) return reply.status(403).send({ error: 'Perfil de líder não encontrado' });
      const verifiedAt = leader.whatsapp_verified_at ? new Date(String(leader.whatsapp_verified_at)) : null;
      const revokedAt = leader.whatsapp_session_revoked_at ? new Date(String(leader.whatsapp_session_revoked_at)) : null;
      if (!leader.phone || !verifiedAt || (revokedAt && revokedAt > verifiedAt)) {
        return reply.status(403).send({ error: 'Vincule e verifique seu WhatsApp antes de iniciar uma conversa.' });
      }

      let contact: Record<string, unknown>;
      try {
        const ensured = await ensureLeaderContactByWaPhone(
          supabase,
          workspaceId,
          String(leader.id),
          String(leader.phone || ''),
          leader.name,
        );
        contact = ensured.contact;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Falha ao resolver contato do líder';
        return reply.status(500).send({ error: message });
      }

      let existingQuery = supabase
        .from('conversations')
        .select('id, status')
        .eq('workspace_id', workspaceId)
        .eq('contact_id', contact!.id)
        .in('status', ['open', 'pending'])
        .order('created_at', { ascending: false })
        .limit(1);
      const { data: existing } = await existingQuery.maybeSingle();

      if (existing) return reply.send(existing);

      const { data: sector } = sector_id
        ? await supabase.from('sectors').select('name').eq('workspace_id', workspaceId).eq('id', sector_id).maybeSingle()
        : { data: null as { name?: string } | null };
      const sectorName = String(sector?.name || 'Atendimento').trim();
      const summary = `Atendimento iniciado pelo líder ${leader.name || 'líder'} para o setor ${sectorName}.`;
      const workspaceChannelId = await getDefaultWhatsAppChannelId(workspaceId);

      const { data: conversation, error: convErr } = await supabase
        .from('conversations')
        .insert({
          workspace_id: workspaceId,
          workspace_channel_id: workspaceChannelId,
          contact_id: contact!.id,
          status: 'open',
          priority: 'normal',
          sector_id: sector_id || null,
          context_leader_id: leader.id,
          summary,
          tags: ['portal-lider'],
        })
        .select()
        .single();

      if (convErr) return reply.status(500).send({ error: convErr.message });
      const systemAuthor = await resolveSystemNoteAuthorId(supabase, workspaceId);
      await supabase.from('internal_notes').insert({
        workspace_id: workspaceId,
        conversation_id: conversation.id,
        author_id: systemAuthor || user.sub,
        content: [
          `Portal do Líder · ${leader.name || 'líder'}:`,
          'Contexto de abertura pelo Portal do Líder:',
          `- Líder: ${leader.name || 'não informado'}`,
          `- Setor solicitado: ${sectorName}`,
          '- Origem: portal_lider',
        ].join('\n'),
      });
      if (conversation?.id && sector_id) await refreshConversationSla(conversation.id as string);
      return reply.status(201).send(conversation);
    }

    const staffParsed = staffConversationStartSchema.safeParse(request.body);
    if (!staffParsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: staffParsed.error.flatten() });
    }

    const body = staffParsed.data;
    let waPhone = '';
    let profileType: 'driver' | 'pharmacy' | 'leader' | 'commercial_lead' | 'unknown' = 'unknown';
    let driverId: string | null = null;
    let pharmacyId: string | null = null;
    let leaderId: string | null = null;
    let commercialLeadId: string | null = null;
    let displayName = '';

    if (body.contact_type === 'driver') {
      if (!body.driver_id) return reply.status(400).send({ error: 'driver_id obrigatorio' });
      const { data: d } = await supabase.from('drivers').select('id, name, phone').eq('workspace_id', workspaceId).eq('id', body.driver_id).single();
      if (!d?.phone) return reply.status(400).send({ error: 'Entregador sem telefone cadastrado' });
      waPhone = normalizeWaPhone(d.phone);
      displayName = d.name || waPhone;
      profileType = 'driver';
      driverId = d.id;
    } else if (body.contact_type === 'pharmacy') {
      if (!body.pharmacy_id) return reply.status(400).send({ error: 'pharmacy_id obrigatorio' });
      const { data: p } = await supabase.from('pharmacies').select('id, trade_name, phone').eq('workspace_id', workspaceId).eq('id', body.pharmacy_id).single();
      if (!p?.phone) return reply.status(400).send({ error: 'Farmacia sem telefone cadastrado' });
      waPhone = normalizeWaPhone(p.phone);
      displayName = p.trade_name || waPhone;
      profileType = 'pharmacy';
      pharmacyId = p.id;
    } else if (body.contact_type === 'leader') {
      if (!body.leader_id) return reply.status(400).send({ error: 'leader_id obrigatorio' });
      const { data: l } = await supabase.from('leaders').select('id, name, phone').eq('workspace_id', workspaceId).eq('id', body.leader_id).single();
      if (!l?.phone) return reply.status(400).send({ error: 'Lider sem telefone cadastrado' });
      waPhone = normalizeWaPhone(l.phone);
      displayName = l.name || waPhone;
      profileType = 'leader';
      leaderId = l.id;
    } else if (body.contact_type === 'commercial_lead') {
      if (!body.commercial_lead_id) return reply.status(400).send({ error: 'commercial_lead_id obrigatorio' });
      const { data: cl } = await supabase
        .from('commercial_leads')
        .select('id, trade_name, phone')
        .eq('workspace_id', workspaceId)
        .eq('id', body.commercial_lead_id)
        .single();
      if (!cl?.phone) return reply.status(400).send({ error: 'Lead comercial sem telefone cadastrado' });
      waPhone = normalizeWaPhone(cl.phone);
      displayName = cl.trade_name || waPhone;
      profileType = 'commercial_lead';
      commercialLeadId = cl.id;
    } else {
      waPhone = normalizeWaPhone(body.wa_phone || '');
      if (!waPhone || waPhone.length < 12) {
        return reply.status(400).send({ error: 'wa_phone invalido (use E.164 com DDI 55)' });
      }
      displayName = (body.display_name || '').trim() || waPhone;
      profileType = 'unknown';
    }

    const sectorId = body.sector_id || (isUuid(user.sector_id || '') ? user.sector_id : null);
    let workspaceChannelId = body.workspace_channel_id || null;
    let channelForcedByCommercialTemplate = false;

    // Templates comerciais só existem na WABA comercial. Sem este ajuste, o default
    // (canal operacional) gera Meta #132001 "Template name does not exist in the translation".
    if (profileType !== 'commercial_lead' && !('content' in body.initial_message)) {
      const earlyTplId = body.initial_message.template_id;
      const { data: earlyTpl } = await supabase
        .from('message_templates')
        .select('category, meta_template_name')
        .eq('workspace_id', workspaceId)
        .eq('id', earlyTplId)
        .maybeSingle();
      if (earlyTpl) {
        const { isCommercialMessageTemplate, resolveCommercialWhatsAppChannel } = await import(
          '../lib/commercial/commercialChannel'
        );
        if (isCommercialMessageTemplate(earlyTpl)) {
          try {
            workspaceChannelId = await resolveCommercialWhatsAppChannel(workspaceId);
            channelForcedByCommercialTemplate = true;
          } catch {
            return reply.status(400).send({
              error:
                'Template comercial exige o canal WhatsApp Comercial. Configure purpose=commercial em Canais.',
            });
          }
        }
      }
    }

    if (profileType === 'commercial_lead') {
      try {
        const { resolveCommercialWhatsAppChannel } = await import('../lib/commercial/commercialChannel');
        workspaceChannelId = await resolveCommercialWhatsAppChannel(workspaceId);
      } catch {
        return reply.status(400).send({ error: 'Canal WhatsApp comercial não configurado.' });
      }
    } else if (!workspaceChannelId) {
      workspaceChannelId = await getDefaultWhatsAppChannelId(workspaceId);
    }

    let contact: Record<string, unknown> | null = null;
    try {
      const upserted = await upsertContactByWaPhone(supabase, workspaceId, waPhone, {
        display_name: displayName,
        profile_type: profileType,
        driver_id: profileType === 'driver' ? driverId : null,
        pharmacy_id: profileType === 'pharmacy' ? pharmacyId : null,
        leader_id: profileType === 'leader' ? leaderId : null,
        commercial_lead_id: profileType === 'commercial_lead' ? commercialLeadId : null,
      });
      contact = upserted.contact;
    } catch (e: unknown) {
      const message =
        e instanceof Error && e.message.trim()
          ? e.message
          : e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
            ? String((e as { message: string }).message)
            : 'Falha ao resolver contato';
      return reply.status(500).send({ error: message || 'Falha ao resolver contato' });
    }

    const reopenPatch: Record<string, unknown> = {
      attendant_id: user.sub,
      context_driver_id: driverId,
      context_pharmacy_id: pharmacyId,
      context_leader_id: leaderId,
      context_commercial_lead_id: commercialLeadId,
    };
    if (channelForcedByCommercialTemplate && workspaceChannelId) {
      reopenPatch.workspace_channel_id = workspaceChannelId;
    } else if (body.workspace_channel_id) {
      reopenPatch.workspace_channel_id = body.workspace_channel_id;
    } else if (profileType === 'commercial_lead' && workspaceChannelId) {
      reopenPatch.workspace_channel_id = workspaceChannelId;
    }
    if (sectorId) reopenPatch.sector_id = sectorId;

    let openConv: Record<string, unknown>;
    try {
      openConv = await resolveOrReuseConversation(supabase, {
        workspaceId,
        contactId: String(contact!.id),
        insert: {
          workspace_channel_id: workspaceChannelId,
          priority: 'normal',
          sector_id: sectorId,
          attendant_id: user.sub,
          context_driver_id: driverId,
          context_pharmacy_id: pharmacyId,
          context_leader_id: leaderId,
          context_commercial_lead_id: commercialLeadId,
        },
        reopenPatch,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Falha ao abrir conversa';
      return reply.status(500).send({ error: message });
    }

    const convId = String(openConv.id);

    if (commercialLeadId) {
      await updatePrimaryConversationIfActive(
        supabase,
        workspaceId,
        commercialLeadId,
        convId,
        String(openConv.status || 'open'),
      );
    }

    if (sectorId) await refreshConversationSla(convId);

    const whatsappConfig = await resolveWhatsAppSendConfig(workspaceId, workspaceChannelId);
    const metaEnabled = Boolean(whatsappConfig);
    const im = body.initial_message;

    if ('content' in im) {
      const allowText = await lastInboundWithin24h(workspaceId, convId);
      if (!allowText && metaEnabled) {
        return reply.status(400).send({
          error:
            'Fora da janela de 24h com Meta ativa: envie um template aprovado (initial_message.template_id) em vez de texto livre.',
        });
      }
      const textBody = im.content.trim();
      const signed = user.name ? `${user.name}:\n${textBody}` : textBody;
      try {
        if (metaEnabled && whatsappConfig) {
          const metaResponse = await sendWhatsAppCloudMessage(
            {
              messaging_product: 'whatsapp',
              to: waPhone,
              type: 'text',
              text: { body: signed, preview_url: false },
            },
            whatsappConfig
          );
          await persistOutboundRow(workspaceId, convId, {
            meta_message_id: metaResponse.messages?.[0]?.id || null,
            type: 'text',
            content: signed,
          });
        } else {
          await persistOutboundRow(workspaceId, convId, { meta_message_id: null, type: 'text', content: signed });
        }
      } catch (err: unknown) {
        const payload = err as { status?: number; detail?: unknown; message?: string };
        return reply.status(502).send({
          error: metaApiErrorMessage(payload.detail, payload.message || 'Falha ao enviar mensagem via WhatsApp'),
          detail: payload.detail,
        });
      }
    } else {
      const { data: template } = await supabase.from('message_templates').select('*').eq('workspace_id', workspaceId).eq('id', im.template_id).single();
      if (!template) return reply.status(404).send({ error: 'Template nao encontrado' });
      if (metaEnabled && template.meta_template_status !== 'approved') {
        return reply.status(400).send({ error: 'Template nao aprovado pela Meta' });
      }

      const vars = im.template_variables || {};
      const variableKeys = resolveTemplateVariableKeys(template);
      const resolvedBody = resolveTemplateBody(
        normalizeEmptyTemplatePlaceholders(String(template.body || '')),
        variableKeys,
        vars,
      );
      const components =
        variableKeys.length > 0
          ? [
              {
                type: 'body',
                parameters: variableKeys.map((v: string) => ({
                  type: 'text',
                  text: vars[v] || '',
                })),
              },
            ]
          : [];

      try {
        if (!template.meta_template_name) {
          return reply.status(400).send({ error: 'Template sem meta_template_name configurado' });
        }
        if (metaEnabled && whatsappConfig) {
          const metaResponse = await sendWhatsAppCloudMessage(
            {
              messaging_product: 'whatsapp',
              to: waPhone,
              type: 'template',
              template: {
                name: template.meta_template_name,
                language: { code: template.meta_template_language || 'pt_BR' },
                components,
              },
            },
            whatsappConfig
          );
          await persistOutboundRow(workspaceId, convId, {
            meta_message_id: metaResponse.messages?.[0]?.id || null,
            type: 'template',
            content: resolvedBody,
            template_id: template.id,
          });
        } else {
          await persistOutboundRow(workspaceId, convId, {
            meta_message_id: null,
            type: 'template',
            content: resolvedBody,
            template_id: template.id,
          });
        }
      } catch (err: unknown) {
        const payload = err as { status?: number; detail?: unknown; message?: string };
        return reply.status(502).send({
          error: metaApiErrorMessage(payload.detail, payload.message || 'Falha ao enviar template via WhatsApp'),
          detail: payload.detail,
        });
      }
    }

    return reply.send(openConv);
  });
}
