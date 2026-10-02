import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import {
  accrueCommissionsForMonth,
  buildCommissionReport,
  generateCommissionPayables,
} from '../../lib/billingCommissionEngine';
import { reportRowsToCsv } from '../../lib/billingReportsEngine';

const personFields = {
  legal_name: z.string().min(1).max(200),
  trade_name: z.string().max(200).optional().nullable(),
  cpf_cnpj: z.string().max(18).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(32).optional().nullable(),
  financial_email: z.string().email().optional().nullable(),
  address_cep: z.string().max(12).optional().nullable(),
  address_street: z.string().max(200).optional().nullable(),
  address_number: z.string().max(32).optional().nullable(),
  address_neighborhood: z.string().max(120).optional().nullable(),
  address_city: z.string().max(120).optional().nullable(),
  address_state: z.string().max(2).optional().nullable(),
  pix_key: z.string().max(120).optional().nullable(),
  pix_key_type: z.string().max(32).optional().nullable(),
  bank_code: z.string().max(8).optional().nullable(),
  bank_name: z.string().max(120).optional().nullable(),
  branch_number: z.string().max(16).optional().nullable(),
  account_number: z.string().max(24).optional().nullable(),
  account_digit: z.string().max(4).optional().nullable(),
  account_type: z.enum(['checking', 'savings']).optional().nullable(),
  contract_started_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  inactive_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  active: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable(),
};

const partnerSchema = z.object({
  ...personFields,
  partner_kind: z.enum(['sales_agent', 'referrer', 'both']).default('sales_agent'),
  default_entity: z.enum(['coop', 'flux']).default('coop'),
});

const commissionRuleSchema = z
  .object({
    role_type: z.enum(['sales_agent', 'referrer']),
    calculation_basis: z.enum(['percent_deal_value', 'fixed_per_conversion']),
    percent_value: z.number().min(0).max(100).optional().nullable(),
    fixed_cents: z.number().int().min(0).optional().nullable(),
    active: z.boolean().default(true),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    effective_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.calculation_basis === 'percent_deal_value' && (val.percent_value == null || val.percent_value <= 0)) {
      ctx.addIssue({ code: 'custom', message: 'percent_value obrigatório para base percentual' });
    }
    if (val.calculation_basis === 'fixed_per_conversion' && (val.fixed_cents == null || val.fixed_cents <= 0)) {
      ctx.addIssue({ code: 'custom', message: 'fixed_cents obrigatório para valor fixo' });
    }
  });

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

export async function registerBillingCommercialPartnerRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/commercial-partners', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as { active?: string; partner_kind?: string };
    let query = supabase
      .from('billing_commercial_partners')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('legal_name');
    if (q.active === '1') query = query.eq('active', true);
    if (q.partner_kind === 'sales_agent' || q.partner_kind === 'referrer' || q.partner_kind === 'both') {
      query = query.eq('partner_kind', q.partner_kind);
    }
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ commercial_partners: data || [] });
  });

  app.get('/commercial-partners/:id', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('billing_commercial_partners')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Parceiro não encontrado' });
    return reply.send({ commercial_partner: data });
  });

  app.post('/commercial-partners', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = partnerSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const { data, error } = await supabase
      .from('billing_commercial_partners')
      .insert({ workspace_id: workspaceId, ...parsed.data, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send({ commercial_partner: data });
  });

  app.patch('/commercial-partners/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = partnerSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const { data, error } = await supabase
      .from('billing_commercial_partners')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Parceiro não encontrado' });
    return reply.send({ commercial_partner: data });
  });

  app.get('/commercial-partners/:id/commission-rules', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('billing_commission_rules')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('partner_id', id)
      .order('role_type');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ commission_rules: data || [] });
  });

  app.put('/commercial-partners/:id/commission-rules/:roleType', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id, roleType } = request.params as { id: string; roleType: string };
    if (roleType !== 'sales_agent' && roleType !== 'referrer') {
      return reply.status(400).send({ error: 'roleType inválido' });
    }
    const parsed = commissionRuleSchema.safeParse({ ...(request.body as object), role_type: roleType });
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const now = new Date().toISOString();
    const row = {
      workspace_id: workspaceId,
      partner_id: id,
      ...parsed.data,
      updated_at: now,
    };
    const { data, error } = await supabase
      .from('billing_commission_rules')
      .upsert(row, { onConflict: 'workspace_id,partner_id,role_type' })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ commission_rule: data });
  });

  app.post('/commissions/accrue', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z.object({ month: monthSchema }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'month inválido (YYYY-MM)' });
    try {
      const result = await accrueCommissionsForMonth(workspaceId, body.data.month);
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.post('/commissions/generate-payables', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z.object({ month: monthSchema }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'month inválido (YYYY-MM)' });
    try {
      const result = await generateCommissionPayables(workspaceId, body.data.month);
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/commissions', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const month = String((request.query as { month?: string }).month || '');
    if (!monthSchema.safeParse(month).success) return reply.status(400).send({ error: 'month obrigatório (YYYY-MM)' });
    try {
      const report = await buildCommissionReport(workspaceId, month);
      return reply.send({ ...report, month });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/commissions/csv', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const month = String((request.query as { month?: string }).month || '');
    if (!monthSchema.safeParse(month).success) return reply.status(400).send({ error: 'month obrigatório' });
    const report = await buildCommissionReport(workspaceId, month);
    const csv = reportRowsToCsv(
      ['parceiro', 'papel', 'lead', 'valor_negocio', 'comissao', 'status', 'vencimento_ap'],
      report.rows.map((r) => ({
        parceiro: r.partner_name,
        papel: r.commission_role === 'sales_agent' ? 'Venda' : 'Indicação',
        lead: r.lead_trade_name,
        valor_negocio: r.deal_value_cents != null ? (r.deal_value_cents / 100).toFixed(2) : '',
        comissao: (r.amount_cents / 100).toFixed(2),
        status: r.status,
        vencimento_ap: r.payable_id ? 'vinculado' : 'pendente',
      }))
    );
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    return reply.send(csv);
  });
}
