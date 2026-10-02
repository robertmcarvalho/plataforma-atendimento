import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import {
  accrueLeaderFluxCommissionsForMonth,
  buildLeaderCommissionReport,
  generateLeaderCommissionPayables,
} from '../../lib/billingLeaderCommissionEngine';
import { reportRowsToCsv } from '../../lib/billingReportsEngine';

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

const ruleSchema = z.object({
  percent_of_flux_margin: z.number().min(0).max(100),
  active: z.boolean().default(true),
  notes: z.string().max(500).optional().nullable(),
});

export async function registerBillingLeaderCommissionRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/leader-commission/rules', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const { data: leaders, error: lErr } = await supabase
      .from('leaders')
      .select('id, name, status, city, state')
      .eq('workspace_id', workspaceId)
      .order('name');
    if (lErr) return reply.status(500).send({ error: lErr.message });

    const { data: rules, error: rErr } = await supabase
      .from('billing_leader_commission_rules')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (rErr) return reply.status(500).send({ error: rErr.message });

    const rulesByLeader = new Map((rules || []).map((r) => [String(r.leader_id), r]));
    const items = (leaders || []).map((l) => ({
      leader: l,
      rule: rulesByLeader.get(String(l.id)) || null,
    }));

    return reply.send({ items });
  });

  app.put('/leader-commission/rules/:leaderId', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { leaderId } = request.params as { leaderId: string };
    const parsed = ruleSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const now = new Date().toISOString();
    const row = {
      workspace_id: workspaceId,
      leader_id: leaderId,
      ...parsed.data,
      updated_at: now,
    };
    const { data, error } = await supabase
      .from('billing_leader_commission_rules')
      .upsert(row, { onConflict: 'workspace_id,leader_id' })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ rule: data });
  });

  app.post('/leader-commissions/accrue', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z.object({ month: monthSchema }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'month inválido (YYYY-MM)' });
    try {
      const result = await accrueLeaderFluxCommissionsForMonth(workspaceId, body.data.month);
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.post('/leader-commissions/generate-payables', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z.object({ month: monthSchema }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'month inválido (YYYY-MM)' });
    try {
      const result = await generateLeaderCommissionPayables(workspaceId, body.data.month);
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/leader-commissions', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const month = String((request.query as { month?: string }).month || '');
    if (!monthSchema.safeParse(month).success) return reply.status(400).send({ error: 'month obrigatório (YYYY-MM)' });
    try {
      const report = await buildLeaderCommissionReport(workspaceId, month);
      return reply.send({ ...report, month });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/leader-commissions/csv', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const month = String((request.query as { month?: string }).month || '');
    if (!monthSchema.safeParse(month).success) return reply.status(400).send({ error: 'month obrigatório' });
    const report = await buildLeaderCommissionReport(workspaceId, month);
    const csv = reportRowsToCsv(
      ['lider', 'farmacia', 'faturamento_flux', 'margem_flux', 'pct_margem', 'pct_comissao', 'comissao', 'status'],
      report.rows.map((r) => ({
        lider: r.leader_name,
        farmacia: r.pharmacy_name,
        faturamento_flux: (r.flux_billing_cents / 100).toFixed(2),
        margem_flux: (r.flux_margin_cents / 100).toFixed(2),
        pct_margem: String(r.margin_pct_applied),
        pct_comissao: String(r.commission_pct_applied),
        comissao: (r.amount_cents / 100).toFixed(2),
        status: r.payable_id ? 'AP gerado' : r.status,
      }))
    );
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    return reply.send(csv);
  });
}
