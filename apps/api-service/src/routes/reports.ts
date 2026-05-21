import { FastifyInstance } from 'fastify';
import { isAiAnalysisEnabled } from '@plataforma/ai-core';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';
import {
  aggregateConversations,
  bucketTimeSeries,
  deltaPct,
  parseReportRange,
  unwrapRelation,
  type ConvReportRow,
} from '../lib/reportsAggregate';

type ReportFilters = {
  attendant_id?: string;
  attendant_ids?: string[];
  sector_id?: string;
  sector_ids?: string[];
  supervisor_id?: string;
  supervisor_ids?: string[];
  status?: string;
  statuses?: string[];
  channels?: string[];
  tag?: string;
  tags?: string[];
  search?: string;
};

function parseCsvIds(raw?: string): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length ? ids : undefined;
}

function filtersFromQuery(q: Record<string, string | undefined>): ReportFilters {
  const attendant_ids = parseCsvIds(q.attendant_ids) ?? (q.attendant_id ? [q.attendant_id] : undefined);
  const sector_ids = parseCsvIds(q.sector_ids) ?? (q.sector_id ? [q.sector_id] : undefined);
  const supervisor_ids = parseCsvIds(q.supervisor_ids) ?? (q.supervisor_id ? [q.supervisor_id] : undefined);
  const statuses = parseCsvIds(q.statuses) ?? (q.status ? [q.status] : undefined);
  const channels = parseCsvIds(q.channels);
  const tags = parseCsvIds(q.tags) ?? (q.tag ? [q.tag] : undefined);
  return {
    attendant_id: attendant_ids?.[0],
    attendant_ids,
    sector_id: sector_ids?.[0],
    sector_ids,
    supervisor_id: supervisor_ids?.[0],
    supervisor_ids,
    status: statuses?.[0],
    statuses,
    channels,
    tag: tags?.[0],
    tags,
    search: q.search,
  };
}

function buildHeatmap(rows: ConvReportRow[]): { grid: number[][]; day_labels: string[]; hour_labels: number[] } {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const row of rows) {
    if (!row.opened_at) continue;
    const d = new Date(row.opened_at);
    grid[d.getDay()][d.getHours()] += 1;
  }
  return {
    grid,
    day_labels: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
    hour_labels: Array.from({ length: 24 }, (_, i) => i),
  };
}

function applyConversationFilters<
  T extends {
    eq: (col: string, val: string) => T;
    gte: (col: string, val: string) => T;
    lte: (col: string, val: string) => T;
    in: (col: string, val: string[]) => T;
    contains: (col: string, val: string[]) => T;
  },
>(
  query: T,
  workspaceId: string,
  since: string,
  until: string,
  filters: ReportFilters
): T {
  let q = query.eq('workspace_id', workspaceId).gte('opened_at', since).lte('opened_at', until);
  if (filters.attendant_ids?.length) q = q.in('attendant_id', filters.attendant_ids);
  else if (filters.attendant_id) q = q.eq('attendant_id', filters.attendant_id);
  if (filters.sector_ids?.length) q = q.in('sector_id', filters.sector_ids);
  else if (filters.sector_id) q = q.eq('sector_id', filters.sector_id);
  if (filters.statuses?.length === 1) q = q.eq('status', filters.statuses[0]);
  else if (filters.status) q = q.eq('status', filters.status);
  if (filters.tag) q = q.contains('tags', [filters.tag]);
  return q;
}

async function fetchConversationsForReport(
  workspaceId: string,
  since: string,
  until: string,
  filters: ReportFilters
) {
  let query = supabase
    .from('conversations')
    .select(
      `
      id, status, opened_at, resolved_at, tags, attendant_id, sector_id, demand_key,
      sla_first_response_at, sla_first_response_ok, sla_resolved_ok, ai_nps_predicted,
      contacts(display_name, profile_type),
      sectors:sectors!sector_id(name),
      attendant:users!attendant_id(id, name)
    `
    );
  query = applyConversationFilters(query, workspaceId, since, until, filters);
  const { data, error } = await query.order('opened_at', { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);

  let rows = (data || []) as Array<
    ConvReportRow & { contacts?: { display_name?: string; profile_type?: string } | Array<{ display_name?: string; profile_type?: string }> | null }
  >;

  const supervisorFilter = filters.supervisor_ids?.length ? filters.supervisor_ids[0] : filters.supervisor_id;
  if (supervisorFilter) {
    const { data: sectorLinks } = await supabase
      .from('user_sectors')
      .select('sector_id')
      .eq('user_id', supervisorFilter);
    const sectorIds = (sectorLinks || []).map((r) => r.sector_id).filter(Boolean);
    if (sectorIds.length) {
      rows = rows.filter((r) => r.sector_id && sectorIds.includes(r.sector_id));
    } else {
      rows = [];
    }
  }

  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter((r) => {
      const c = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
      return r.id.toLowerCase().includes(q) || String(c?.display_name || '').toLowerCase().includes(q);
    }) as typeof rows;
  }

  if (filters.statuses && filters.statuses.length > 1) {
    const set = new Set(filters.statuses);
    rows = rows.filter((r) => set.has(String(r.status || '')));
  }

  if (filters.channels?.length) {
    const set = new Set(filters.channels.map((c) => c.toLowerCase()));
    rows = rows.filter((r) => {
      const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
      const ch = String((contact as { profile_type?: string })?.profile_type || 'whatsapp').toLowerCase();
      return set.has(ch);
    }) as typeof rows;
  }

  if (filters.tags?.length) {
    const set = new Set(filters.tags);
    rows = rows.filter((r) => (r.tags || []).some((t) => set.has(t)));
  }

  return rows;
}

async function attachMessageCounts(workspaceId: string, since: string, until: string, kpis: { messages_inbound: number; messages_outbound: number }) {
  const [{ count: inbound }, { count: outbound }] = await Promise.all([
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('direction', 'inbound')
      .gte('created_at', since)
      .lte('created_at', until),
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('direction', 'outbound')
      .gte('created_at', since)
      .lte('created_at', until),
  ]);
  kpis.messages_inbound = inbound || 0;
  kpis.messages_outbound = outbound || 0;
}

export async function reportRoutes(app: FastifyInstance) {
  // GET /api/reports/dashboard — painel executivo
  app.get('/dashboard', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { period = '7' } = request.query as { period?: string };
    const since = new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: totalConversations },
      { count: openConversations },
      { count: resolvedConversations },
      { count: pendingInstallments },
      { count: overdueInstallments },
    ] = await Promise.all([
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('created_at', since),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'open'),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'resolved')
        .gte('resolved_at', since),
      supabase.from('financial_installments').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'pending'),
      supabase.from('financial_installments').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'overdue'),
    ]);

    return reply.send({
      period_days: Number(period),
      conversations: { total: totalConversations, open: openConversations, resolved: resolvedConversations },
      financial: { pending_installments: pendingInstallments, overdue_installments: overdueInstallments },
    });
  });

  // GET /api/reports/conversations — relatório de atendimento
  app.get('/conversations', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { start_date, end_date, sector_id, attendant_id } = request.query as Record<string, string>;
    let query = supabase
      .from('conversations')
      .select(`
        id, status, priority, opened_at, resolved_at, last_message_at,
        sla_first_response_ok, sla_resolved_ok,
        sectors:sectors!sector_id(name), attendant:users!attendant_id(name),
        contacts(profile_type), context_pharmacy:pharmacies!context_pharmacy_id(trade_name)
      `)
      .eq('workspace_id', workspaceId);
    if (start_date) query = query.gte('opened_at', start_date);
    if (end_date) query = query.lte('opened_at', end_date);
    if (sector_id) query = query.eq('sector_id', sector_id);
    if (attendant_id) query = query.eq('attendant_id', attendant_id);
    const { data, error } = await query.order('opened_at', { ascending: false }).limit(500);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // GET /api/reports/attendants — produtividade por atendente
  app.get('/attendants', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as Record<string, string>;
    const { start_date, end_date, period } = q;
    let since = start_date;
    let until = end_date;
    if (!since && period) {
      const periodDays = Math.min(Math.max(Number(period) || 7, 1), 90);
      since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    }
    let query = supabase
      .from('conversations')
      .select('attendant_id, status, sla_first_response_ok, sla_resolved_ok, opened_at, resolved_at, attendant:users!attendant_id(id, name)')
      .eq('workspace_id', workspaceId)
      .not('attendant_id', 'is', null);
    if (since) query = query.gte('opened_at', since);
    if (until) query = query.lte('opened_at', until);
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });

    // Agrupa por atendente em memória
    const grouped: Record<string, {
      attendant: { id: string; name: string };
      total: number;
      resolved: number;
      sla_ok: number;
      avg_resolution_ms: number;
      resolution_times: number[];
    }> = {};

    for (const conv of (data || [])) {
      const attendantData = conv.attendant as { id: string; name: string } | Array<{ id: string; name: string }> | null;
      const att = Array.isArray(attendantData) ? attendantData[0] : attendantData;
      if (!att) continue;
      if (!grouped[att.id]) grouped[att.id] = { attendant: att, total: 0, resolved: 0, sla_ok: 0, avg_resolution_ms: 0, resolution_times: [] };
      grouped[att.id].total++;
      if (conv.status === 'resolved' || conv.status === 'closed') grouped[att.id].resolved++;
      if (conv.sla_resolved_ok) grouped[att.id].sla_ok++;
      if (conv.resolved_at && conv.opened_at) {
        grouped[att.id].resolution_times.push(new Date(conv.resolved_at).getTime() - new Date(conv.opened_at).getTime());
      }
    }

    const result = Object.values(grouped).map(g => ({
      ...g,
      avg_resolution_minutes: g.resolution_times.length
        ? Math.round(g.resolution_times.reduce((a, b) => a + b, 0) / g.resolution_times.length / 60000)
        : null,
      sla_compliance_rate: g.total > 0 ? Math.round((g.sla_ok / g.total) * 100) : 0,
      resolution_times: undefined,
    }));

    return reply.send(result);
  });

  // GET /api/reports/financial — indicadores financeiros
  app.get('/financial', { preHandler: [authenticate, requireRole('admin', 'financial', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { start_date, end_date } = request.query as Record<string, string>;
    let query = supabase
      .from('financial_installments')
      .select('status, amount, due_date, financial_entries(type, pharmacy_id, pharmacies(trade_name))')
      .eq('workspace_id', workspaceId);
    if (start_date) query = query.gte('due_date', start_date);
    if (end_date) query = query.lte('due_date', end_date);
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });

    const summary = { pending: 0, paid: 0, overdue: 0, total_amount: 0, paid_amount: 0 };
    for (const inst of (data || [])) {
      summary.total_amount += Number(inst.amount);
      if (inst.status === 'pending') summary.pending++;
      if (inst.status === 'paid') { summary.paid++; summary.paid_amount += Number(inst.amount); }
      if (inst.status === 'overdue') summary.overdue++;
    }

    return reply.send({ summary, detail: data });
  });

  // GET /api/reports/operational-kpis — agregados operacionais v1 (tickets + SLA + MCP)
  app.get('/operational-kpis', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { period = '7' } = request.query as { period?: string };
    const periodDays = Math.min(Math.max(Number(period) || 7, 1), 90);
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: ticketsOpened },
      { count: ticketsResolved },
      { count: ticketsOverdue },
      { data: resolvedRows, error: resolvedErr },
      { data: escalatedRows, error: escalatedErr },
      { data: mcpRows, error: mcpErr },
    ] = await Promise.all([
      supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('created_at', since),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'resolved').gte('resolved_at', since),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'overdue').gte('updated_at', since),
      supabase
        .from('tickets')
        .select('created_at,resolved_at')
        .eq('workspace_id', workspaceId)
        .not('resolved_at', 'is', null)
        .gte('resolved_at', since)
        .limit(5000),
      supabase.from('ticket_events').select('id').eq('workspace_id', workspaceId).eq('event_type', 'sla_escalated').gte('created_at', since).limit(5000),
      supabase.from('ticket_events').select('payload').eq('workspace_id', workspaceId).eq('event_type', 'log_tool_execution').gte('created_at', since).limit(5000),
    ]);

    if (resolvedErr) return reply.status(500).send({ error: resolvedErr.message });
    if (escalatedErr) return reply.status(500).send({ error: escalatedErr.message });
    if (mcpErr) return reply.status(500).send({ error: mcpErr.message });

    const totalOpened = ticketsOpened || 0;
    const totalResolved = ticketsResolved || 0;
    const totalOverdue = ticketsOverdue || 0;
    const totalEscalated = (escalatedRows || []).length;

    const avgHandleMinutes = Math.round(
      ((resolvedRows || []) as Array<{ created_at: string; resolved_at: string }>)
        .map((row) => new Date(row.resolved_at).getTime() - new Date(row.created_at).getTime())
        .filter((delta) => delta > 0)
        .reduce((sum, delta, _, arr) => sum + delta / Math.max(arr.length, 1), 0) / 60000
    );

    const mcpAgg = ((mcpRows || []) as Array<{ payload?: { result?: { ok?: boolean } } }>).reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.payload?.result?.ok) acc.ok += 1;
        else acc.failed += 1;
        return acc;
      },
      { total: 0, ok: 0, failed: 0 }
    );

    const slaOnTimeRate = totalOpened > 0 ? Number((Math.max(0, totalOpened - totalOverdue) / totalOpened).toFixed(4)) : 0;
    const escalationRate = totalOpened > 0 ? Number((totalEscalated / totalOpened).toFixed(4)) : 0;
    const mcpErrorRate = mcpAgg.total > 0 ? Number((mcpAgg.failed / mcpAgg.total).toFixed(4)) : 0;

    return reply.send({
      period_days: periodDays,
      tickets_opened: totalOpened,
      tickets_resolved: totalResolved,
      sla_on_time_rate: slaOnTimeRate,
      escalation_rate: escalationRate,
      avg_handle_minutes: Number.isFinite(avgHandleMinutes) ? avgHandleMinutes : 0,
      mcp: {
        total: mcpAgg.total,
        ok: mcpAgg.ok,
        failed: mcpAgg.failed,
        error_rate: mcpErrorRate,
      },
    });
  });

  // GET /api/reports/ai-summary — agregados de IA (sentimento, urgência, tópicos, NPS) no período
  app.get('/ai-summary', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { period = '7' } = request.query as { period?: string };
    const periodDays = Math.min(Math.max(Number(period) || 7, 1), 90);
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    const generationEnabled = isAiAnalysisEnabled();

    type ConvRow = {
      ai_sentiment_last?: string | null;
      ai_nps_predicted?: number | null;
      ai_topic_id?: string | null;
      topic?: { id: string; name: string } | { id: string; name: string }[] | null;
    };

    const [
      { data: convAgg, error: convErr },
      { data: urgencyRows, error: urgErr },
      { count: messagesAnalyzed, error: msgErr },
    ] = await Promise.all([
      supabase
        .from('conversations')
        .select(
          `
          ai_sentiment_last,
          ai_nps_predicted,
          ai_topic_id,
          topic:ai_topics!ai_topic_id(id, name)
        `
        )
        .eq('workspace_id', workspaceId)
        .gte('updated_at', since)
        .limit(12000),
      supabase
        .from('messages')
        .select('ai_urgency')
        .eq('workspace_id', workspaceId)
        .eq('direction', 'inbound')
        .not('ai_urgency', 'is', null)
        .gte('created_at', since)
        .limit(12000),
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('direction', 'inbound')
        .not('ai_analyzed_at', 'is', null)
        .gte('created_at', since),
    ]);

    if (convErr) return reply.status(500).send({ error: convErr.message });
    if (urgErr) return reply.status(500).send({ error: urgErr.message });
    if (msgErr) return reply.status(500).send({ error: msgErr.message });

    const sentiment: Record<'positivo' | 'neutro' | 'negativo', number> = {
      positivo: 0,
      neutro: 0,
      negativo: 0,
    };
    let withSentiment = 0;
    let npsSum = 0;
    let npsCount = 0;
    const topicMap = new Map<string, { id: string; name: string; count: number }>();

    for (const row of (convAgg || []) as ConvRow[]) {
      const s = row.ai_sentiment_last;
      if (s === 'positivo' || s === 'neutro' || s === 'negativo') {
        sentiment[s]++;
        withSentiment++;
      }
      if (row.ai_nps_predicted != null && Number.isFinite(Number(row.ai_nps_predicted))) {
        npsSum += Number(row.ai_nps_predicted);
        npsCount++;
      }
      const rawTopic = row.topic;
      const t = Array.isArray(rawTopic) ? rawTopic[0] : rawTopic;
      if (t?.id) {
        const prev = topicMap.get(t.id) || { id: t.id, name: t.name || '—', count: 0 };
        prev.count += 1;
        topicMap.set(t.id, prev);
      }
    }

    const urgency: Record<'alta' | 'media' | 'baixa', number> = {
      alta: 0,
      media: 0,
      baixa: 0,
    };
    for (const ur of urgencyRows || []) {
      const u = (ur as { ai_urgency?: string | null }).ai_urgency;
      if (u === 'alta' || u === 'media' || u === 'baixa') urgency[u]++;
    }

    const top_topics = [...topicMap.values()].sort((a, b) => b.count - a.count).slice(0, 8);

    return reply.send({
      period_days: periodDays,
      since,
      generation_enabled: generationEnabled,
      conversations_updated_in_period: (convAgg || []).length,
      conversations_with_sentiment: withSentiment,
      sentiment,
      messages_analyzed: messagesAnalyzed ?? 0,
      urgency_inbound_messages: urgency,
      nps_predicted:
        npsCount > 0
          ? { count: npsCount, avg: Number((npsSum / npsCount).toFixed(2)), min_score: 0, max_score: 10 }
          : { count: 0, avg: null, min_score: 0, max_score: 10 },
      top_topics,
    });
  });

  // GET /api/reports/summary — KPIs agregados + série temporal (conversas)
  app.get('/summary', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as Record<string, string | undefined>;
    const range = parseReportRange(q);
    const compare = q.compare === '1' || q.compare === 'true';
    const granularity = (q.granularity === 'week' || q.granularity === 'month' ? q.granularity : 'day') as 'day' | 'week' | 'month';
    const filters = filtersFromQuery(q);

    try {
      const [currRows, prevRows] = await Promise.all([
        fetchConversationsForReport(workspaceId, range.since, range.until, filters),
        compare
          ? fetchConversationsForReport(workspaceId, range.prevSince, range.prevUntil, filters)
          : Promise.resolve([]),
      ]);

      const kpis = aggregateConversations(currRows);
      const prevKpis = compare ? aggregateConversations(prevRows) : null;
      await attachMessageCounts(workspaceId, range.since, range.until, kpis);
      if (prevKpis && compare) await attachMessageCounts(workspaceId, range.prevSince, range.prevUntil, prevKpis);

      const by_sector: Record<string, number> = {};
      const by_tag: Record<string, number> = {};
      const by_channel: Record<string, number> = {};
      for (const row of currRows) {
        const sectorName = unwrapRelation((row as { sectors?: { name?: string } | { name?: string }[] | null }).sectors)?.name;
        if (sectorName) by_sector[sectorName] = (by_sector[sectorName] || 0) + 1;
        for (const t of row.tags || []) by_tag[t] = (by_tag[t] || 0) + 1;
        const contact = unwrapRelation((row as { contacts?: { display_name?: string; profile_type?: string } | Array<{ display_name?: string; profile_type?: string }> | null }).contacts);
        const ch = String(contact?.profile_type || 'whatsapp').toLowerCase();
        by_channel[ch] = (by_channel[ch] || 0) + 1;
      }

      return reply.send({
        period_days: range.periodDays,
        since: range.since,
        until: range.until,
        kpis,
        previous: prevKpis,
        deltas: prevKpis
          ? {
              tickets: deltaPct(kpis.tickets, prevKpis.tickets),
              tmr_seconds: deltaPct(kpis.tmr_seconds, prevKpis.tmr_seconds),
              tma_seconds: deltaPct(kpis.tma_seconds, prevKpis.tma_seconds),
              tme_seconds: deltaPct(kpis.tme_seconds, prevKpis.tme_seconds),
              sla_pct: deltaPct(kpis.sla_pct, prevKpis.sla_pct),
              csat_avg: kpis.csat_avg != null && prevKpis.csat_avg != null ? deltaPct(kpis.csat_avg, prevKpis.csat_avg) : null,
              fcr_pct: deltaPct(kpis.fcr_pct, prevKpis.fcr_pct),
              reopen_pct: deltaPct(kpis.reopen_pct, prevKpis.reopen_pct),
            }
          : null,
        series: bucketTimeSeries(currRows, granularity),
        by_sector: Object.entries(by_sector).map(([name, count]) => ({ name, count })),
        by_tag: Object.entries(by_tag)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 12),
        by_channel: Object.entries(by_channel).map(([channel, count]) => ({ channel, count })),
        heatmap: buildHeatmap(currRows),
      });
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao agregar relatório' });
    }
  });

  // GET /api/reports/tickets — lista densa para tabela / drill-down
  app.get('/tickets', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as Record<string, string | undefined>;
    const range = parseReportRange(q);
    const filters = filtersFromQuery(q);

    try {
      const rows = await fetchConversationsForReport(workspaceId, range.since, range.until, filters);
      const items = rows.slice(0, 500).map((row) => {
        const r = row as ConvReportRow & {
          contacts?: { display_name?: string; profile_type?: string } | Array<{ display_name?: string; profile_type?: string }> | null;
          sectors?: { name?: string } | { name?: string }[] | null;
          attendant?: { id?: string; name?: string } | { id?: string; name?: string }[] | null;
        };
        const contact = unwrapRelation(r.contacts);
        const sector = unwrapRelation(r.sectors);
        const attendant = unwrapRelation(r.attendant);
        const tmr =
          row.sla_first_response_at && row.opened_at
            ? Math.round((new Date(row.sla_first_response_at).getTime() - new Date(row.opened_at).getTime()) / 1000)
            : null;
        return {
          id: row.id,
          contact_name: contact?.display_name || row.id.slice(0, 8),
          status: row.status,
          channel: String(contact?.profile_type || 'whatsapp').toLowerCase(),
          sector: sector?.name || '—',
          attendant: attendant?.name || '—',
          attendant_id: attendant?.id || row.attendant_id,
          opened_at: row.opened_at,
          resolved_at: row.resolved_at,
          tmr_seconds: tmr,
          sla_ok: Boolean(row.sla_resolved_ok),
          csat: row.ai_nps_predicted,
          tags: row.tags || [],
          demand_key: row.demand_key || null,
        };
      });
      return reply.send({ items, total: rows.length });
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao listar tickets' });
    }
  });

  // GET /api/reports/export — CSV com filtros aplicados
  app.get('/export', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as Record<string, string | undefined>;
    const range = parseReportRange(q);
    const filters = filtersFromQuery(q);

    try {
      const rows = await fetchConversationsForReport(workspaceId, range.since, range.until, filters);
      const kpis = aggregateConversations(rows);
      const lines = [
        ['Relatório de Atendimento'],
        ['Período', range.since, range.until],
        [],
        ['KPI', 'Valor'],
        ['Tickets', String(kpis.tickets)],
        ['Resolvidos', String(kpis.resolved)],
        ['TMR (s)', String(kpis.tmr_seconds)],
        ['TMA (s)', String(kpis.tma_seconds)],
        ['SLA %', String(kpis.sla_pct)],
        ['CSAT', kpis.csat_avg != null ? String(kpis.csat_avg) : ''],
        ['FCR %', String(kpis.fcr_pct)],
        ['Reabertura %', String(kpis.reopen_pct)],
        [],
        ['ID', 'Contato', 'Status', 'Setor', 'Atendente', 'Aberto em', 'TMR (s)', 'SLA OK', 'CSAT'],
        ...rows.map((row) => {
          const r = row as ConvReportRow & {
            contacts?: { display_name?: string; profile_type?: string } | Array<{ display_name?: string; profile_type?: string }> | null;
            sectors?: { name?: string } | { name?: string }[] | null;
            attendant?: { name?: string } | { name?: string }[] | null;
          };
          const contact = unwrapRelation(r.contacts);
          const sector = unwrapRelation(r.sectors);
          const attendant = unwrapRelation(r.attendant);
          const tmr =
            row.sla_first_response_at && row.opened_at
              ? Math.round((new Date(row.sla_first_response_at).getTime() - new Date(row.opened_at).getTime()) / 1000)
              : '';
          return [
            row.id,
            contact?.display_name || '',
            row.status,
            sector?.name || '',
            attendant?.name || '',
            row.opened_at,
            String(tmr),
            row.sla_resolved_ok ? 'sim' : 'não',
            row.ai_nps_predicted != null ? String(row.ai_nps_predicted) : '',
          ];
        }),
      ];
      const csv = lines
        .map((r) => r.map((c) => (/[",\n;]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(','))
        .join('\n');
      const filename = `relatorio-atendimento-${range.since.slice(0, 10)}.csv`;
      return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${filename}"`).send('\ufeff' + csv);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao exportar' });
    }
  });
}
