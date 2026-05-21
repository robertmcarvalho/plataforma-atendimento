import { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../middleware/authenticate';
import { supabase } from '../lib/supabase';
import { requireWorkspace } from '../lib/workspaceContext';

type ExecutionPayload = {
  tool?: string;
  action?: string;
  latency_ms?: number;
  result?: { ok?: boolean };
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export async function mcpMetricsRoutes(app: FastifyInstance) {
  app.get('/summary', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { period = '7' } = request.query as { period?: string };
    const periodDays = Math.min(Math.max(Number(period) || 7, 1), 90);
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('ticket_events')
      .select('payload, created_at')
      .eq('workspace_id', workspaceId)
      .eq('event_type', 'log_tool_execution')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) return reply.status(500).send({ error: error.message });

    const rows = (data || []) as Array<{ payload?: ExecutionPayload | null }>;
    const latencies: number[] = [];
    let total = 0;
    let ok = 0;
    let failed = 0;

    const byTool: Record<string, { total: number; ok: number; failed: number; latencies: number[] }> = {};

    for (const row of rows) {
      const payload = (row.payload || {}) as ExecutionPayload;
      const tool = String(payload.tool || 'unknown');
      const latency = Number(payload.latency_ms || 0);
      const success = Boolean(payload.result?.ok);

      total += 1;
      if (success) ok += 1;
      else failed += 1;
      if (latency > 0) latencies.push(latency);

      if (!byTool[tool]) byTool[tool] = { total: 0, ok: 0, failed: 0, latencies: [] };
      byTool[tool].total += 1;
      if (success) byTool[tool].ok += 1;
      else byTool[tool].failed += 1;
      if (latency > 0) byTool[tool].latencies.push(latency);
    }

    const tools = Object.entries(byTool).map(([tool, agg]) => ({
      tool,
      total: agg.total,
      ok: agg.ok,
      failed: agg.failed,
      error_rate: agg.total > 0 ? Number((agg.failed / agg.total).toFixed(4)) : 0,
      p50_ms: percentile(agg.latencies, 50),
      p95_ms: percentile(agg.latencies, 95),
    }));

    return reply.send({
      period_days: periodDays,
      total_executions: total,
      ok,
      failed,
      error_rate: total > 0 ? Number((failed / total).toFixed(4)) : 0,
      p50_ms: percentile(latencies, 50),
      p95_ms: percentile(latencies, 95),
      tools,
    });
  });

  app.get('/alerts', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const nowIso = new Date().toISOString();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ data: mcpRows, error: mcpErr }, { count: overdueCount }, { count: openCount }] = await Promise.all([
      supabase
        .from('ticket_events')
        .select('payload')
        .eq('workspace_id', workspaceId)
        .eq('event_type', 'log_tool_execution')
        .gte('created_at', since)
        .limit(5000),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'overdue'),
      supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .in('status', ['open', 'in_progress'])
        .lt('due_at', nowIso),
    ]);

    if (mcpErr) return reply.status(500).send({ error: mcpErr.message });

    const mcpAgg = ((mcpRows || []) as Array<{ payload?: { result?: { ok?: boolean } } }>).reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.payload?.result?.ok) acc.ok += 1;
        else acc.failed += 1;
        return acc;
      },
      { total: 0, ok: 0, failed: 0 }
    );

    const mcpErrorRate = mcpAgg.total > 0 ? mcpAgg.failed / mcpAgg.total : 0;
    const alerting = {
      mcp_error_rate_high: mcpErrorRate >= 0.1,
      backlog_overdue_high: (overdueCount || 0) >= 20,
      sla_risk_high: (openCount || 0) >= 15,
    };

    return reply.send({
      thresholds: {
        mcp_error_rate_high: 0.1,
        backlog_overdue_high: 20,
        sla_risk_high: 15,
      },
      values: {
        mcp_error_rate: Number(mcpErrorRate.toFixed(4)),
        overdue_tickets: overdueCount || 0,
        open_past_due: openCount || 0,
      },
      alerts: alerting,
      has_critical: Object.values(alerting).some(Boolean),
    });
  });
}
