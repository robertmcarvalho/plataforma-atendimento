import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { supabase } from '../lib/supabase';
import { requireWorkspace } from '../lib/workspaceContext';

type UiAgentStatus = 'online' | 'idle' | 'offline' | 'busy';

function csvEscape(value: unknown) {
  const raw = value === null || value === undefined ? '' : String(value);
  const needs = /[",\n]/.test(raw);
  const escaped = raw.replace(/"/g, '""');
  return needs ? `"${escaped}"` : escaped;
}

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfYesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function hash01(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return (h % 1000) / 1000;
}

function initialsFromName(input: string) {
  const parts = (input || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return '??';
  return parts.map((p) => p[0]?.toUpperCase()).join('');
}

function pctDelta(current: number | null, previous: number | null) {
  const c = Number(current ?? 0);
  const p = Number(previous ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return 0;
  return Math.round(((c - p) / p) * 1000) / 10;
}

function ppDelta(current: number | null, previous: number | null) {
  const c = Number(current ?? 0);
  const p = Number(previous ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return 0;
  return Math.round((c - p) * 10) / 10;
}

async function avgFirstResponseSecondsBetween(workspaceId: string, sinceIso: string, untilIso: string) {
  const { data: convSample } = await supabase
    .from('conversations')
    .select('id, opened_at, messages(direction, created_at)')
    .eq('workspace_id', workspaceId)
    .gte('created_at', sinceIso)
    .lt('created_at', untilIso)
    .order('created_at', { ascending: false })
    .limit(200);

  let firstResponseTotalMs = 0;
  let firstResponseN = 0;
  for (const c of (convSample || []) as Array<{ opened_at?: string; messages?: Array<{ direction?: string; created_at?: string }> }>) {
    const openedAt = c.opened_at ? new Date(c.opened_at).getTime() : null;
    if (!openedAt || !c.messages?.length) continue;
    const outbound = c.messages
      .filter((m) => m.direction === 'outbound' && m.created_at)
      .map((m) => new Date(String(m.created_at)).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)[0];
    if (!outbound) continue;
    const diff = outbound - openedAt;
    if (diff >= 0) {
      firstResponseTotalMs += diff;
      firstResponseN += 1;
    }
  }

  return firstResponseN ? Math.round(firstResponseTotalMs / firstResponseN / 1000) : null;
}

export async function dashboardRoutes(app: FastifyInstance) {
  // GET /api/dashboard/overview — métricas para o Dashboard (acessível a qualquer usuário autenticado)
  app.get('/overview', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { period = '1' } = request.query as { period?: string };
    const days = Math.max(1, Math.min(30, Number(period) || 1));
    const now = Date.now();
    const since = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
    const prevSince = new Date(now - 2 * days * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: totalConversations },
      { count: totalConversationsPrev },
      { count: openConversations },
      { count: resolvedConversations },
      { data: users },
    ] = await Promise.all([
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('created_at', since),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .gte('created_at', prevSince)
        .lt('created_at', since),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'open'),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).in('status', ['resolved', 'closed']).gte('resolved_at', since),
      supabase.from('users').select('id, name, role, is_active').order('name'),
    ]);

    const online = (users || []).filter((u) => u.is_active).length;
    const totalUsers = (users || []).length;

    // Conversas "hoje"
    const todaySince = startOfTodayIso();
    const yesterdaySince = startOfYesterdayIso();
    const [{ count: conversationsToday }, { count: conversationsYesterday }] = await Promise.all([
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('created_at', todaySince),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .gte('created_at', yesterdaySince)
        .lt('created_at', todaySince),
    ]);

    // Resolução (aproximação): resolvidas no período / total no período
    const resolutionRate =
      totalConversations && totalConversations > 0
        ? Math.round((Number(resolvedConversations || 0) / Number(totalConversations)) * 1000) / 10
        : 0;

    // Taxa de resolução do período anterior
    const [{ count: resolvedPrev }] = await Promise.all([
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .in('status', ['resolved', 'closed'])
        .eq('workspace_id', workspaceId)
        .gte('resolved_at', prevSince)
        .lt('resolved_at', since),
    ]);
    const resolutionRatePrev =
      totalConversationsPrev && totalConversationsPrev > 0
        ? Math.round((Number(resolvedPrev || 0) / Number(totalConversationsPrev)) * 1000) / 10
        : 0;

    // Tempo médio de primeira resposta (amostra leve)
    const [avgFirstResponseSeconds, avgFirstResponseSecondsPrev] = await Promise.all([
      avgFirstResponseSecondsBetween(workspaceId, since, new Date(now).toISOString()),
      avgFirstResponseSecondsBetween(workspaceId, prevSince, since),
    ]);

    // SLA (best-effort) — se não houver amostra, retorna 0
    const [
      { count: slaFirstOk },
      { count: slaFirstTotal },
      { count: slaResolvedOk },
      { count: slaResolvedTotal },
      { count: atRiskCount },
      { count: breachedCount },
    ] = await Promise.all([
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .gte('created_at', since)
        .eq('sla_first_response_ok', true),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .gte('created_at', since)
        .not('sla_first_response_ok', 'is', null),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .gte('created_at', since)
        .eq('sla_resolved_ok', true),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .gte('created_at', since)
        .not('sla_resolved_ok', 'is', null),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .in('status', ['open', 'pending'])
        .not('sla_resolution_deadline', 'is', null)
        .lt('sla_resolution_deadline', new Date(now + 30 * 60 * 1000).toISOString())
        .gte('sla_resolution_deadline', new Date(now).toISOString()),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .in('status', ['open', 'pending'])
        .not('sla_resolution_deadline', 'is', null)
        .lt('sla_resolution_deadline', new Date(now).toISOString())
        .eq('sla_resolved_ok', false),
    ]);

    const firstResponsePercent =
      slaFirstTotal && slaFirstTotal > 0 ? Math.round((Number(slaFirstOk || 0) / Number(slaFirstTotal)) * 1000) / 10 : 0;
    const resolutionPercent =
      slaResolvedTotal && slaResolvedTotal > 0
        ? Math.round((Number(slaResolvedOk || 0) / Number(slaResolvedTotal)) * 1000) / 10
        : 0;

    // Top agentes (no período selecionado) — agrupa conversas por atendente
    const { data: byAttendant } = await supabase
      .from('conversations')
      .select('id, attendant:users!attendant_id(id, name, is_active)')
      .eq('workspace_id', workspaceId)
      .gte('created_at', since)
      .not('attendant_id', 'is', null)
      .limit(5000);

    const grouped = new Map<string, { id: string; name: string; is_active: boolean; chats: number }>();
    for (const row of (byAttendant || []) as Array<any>) {
      const attendant = Array.isArray(row.attendant) ? row.attendant[0] : row.attendant;
      if (!attendant?.id || !attendant?.name) continue;
      const current = grouped.get(attendant.id) || { id: attendant.id, name: attendant.name, is_active: Boolean(attendant.is_active), chats: 0 };
      current.chats += 1;
      current.is_active = Boolean(attendant.is_active);
      grouped.set(attendant.id, current);
    }

    const top_agents = Array.from(grouped.values())
      .sort((a, b) => b.chats - a.chats)
      .slice(0, 5)
      .map((a) => {
        const v = hash01(a.id);
        const status: UiAgentStatus = a.is_active ? (v < 0.15 ? 'busy' : v < 0.3 ? 'idle' : 'online') : 'offline';
        return { id: a.id, name: a.name, initials: initialsFromName(a.name), chats: a.chats, csat: null, status };
      });

    const convTodayDelta = pctDelta(conversationsToday || 0, conversationsYesterday || 0);
    const firstRespDelta = (() => {
      const prev = avgFirstResponseSecondsPrev;
      const cur = avgFirstResponseSeconds;
      if (!prev || prev <= 0 || !cur || cur <= 0) return 0;
      // Quanto menor melhor: delta positivo = melhoria
      return Math.round(((prev - cur) / prev) * 1000) / 10;
    })();

    return reply.send({
      period_days: days,
      kpis: {
        conversations_today: conversationsToday || 0,
        avg_first_response_seconds: avgFirstResponseSeconds,
        resolution_rate_percent: resolutionRate,
        agents_online: { online, total: totalUsers },
      },
      deltas: {
        conversations_today: { value: convTodayDelta, up: convTodayDelta >= 0 },
        avg_first_response_seconds: { value: firstRespDelta, up: firstRespDelta >= 0 },
        resolution_rate_percent: { value: ppDelta(resolutionRate, resolutionRatePrev), up: resolutionRate >= resolutionRatePrev },
        agents_online: { value: 0, up: true },
      },
      sla: {
        overall_percent: resolutionPercent,
        first_response_percent: firstResponsePercent,
        resolution_percent: resolutionPercent,
        at_risk_count: atRiskCount || 0,
        breached_count: breachedCount || 0,
      },
      conversations: { total: totalConversations || 0, open: openConversations || 0, resolved: resolvedConversations || 0 },
      channels: [{ ch: 'whatsapp', pct: 100, count: totalConversations || 0 }],
      top_agents,
    });
  });

  // GET /api/dashboard/export — CSV simples para o botão "Exportar" do Dashboard
  app.get('/export', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { period = '1' } = request.query as { period?: string };
    const days = Math.max(1, Math.min(30, Number(period) || 1));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('conversations')
      .select(
        `
        id, status, priority, created_at, opened_at, resolved_at, last_message_at,
        contacts:contacts!contact_id(display_name, wa_phone, profile_type),
        sectors:sectors!sector_id(name),
        attendant:users!attendant_id(name)
      `
      )
      .eq('workspace_id', workspaceId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) return reply.status(500).send({ error: error.message });

    const rows = (data || []) as Array<any>;
    const header = [
      'id',
      'status',
      'priority',
      'created_at',
      'opened_at',
      'last_message_at',
      'resolved_at',
      'contact_name',
      'contact_phone',
      'profile_type',
      'sector',
      'attendant',
    ];

    const lines = [header.join(',')];
    for (const r of rows) {
      const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
      const sector = Array.isArray(r.sectors) ? r.sectors[0] : r.sectors;
      const attendant = Array.isArray(r.attendant) ? r.attendant[0] : r.attendant;
      const line = [
        r.id,
        r.status,
        r.priority,
        r.created_at,
        r.opened_at,
        r.last_message_at,
        r.resolved_at,
        contact?.display_name || '',
        contact?.wa_phone || '',
        contact?.profile_type || '',
        sector?.name || '',
        attendant?.name || '',
      ].map(csvEscape);
      lines.push(line.join(','));
    }

    const csv = lines.join('\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="dashboard-export-${days}d.csv"`);
    return reply.send(csv);
  });
}

