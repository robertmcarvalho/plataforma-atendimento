import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { writeAuditLog } from '../../lib/auditLog';
import {
  buildShareholderProLaboreInssReport,
  generateMonthlyCompanyPayroll,
} from '../../lib/billingCompanyPayrollEngine';
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
  termination_reason: z.string().max(500).optional().nullable(),
  active: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable(),
};

const internalProviderSchema = z.object({
  ...personFields,
  contract_type: z.string().max(32).default('pj'),
  role_title: z.string().max(120).optional().nullable(),
  phone_secondary: z.string().max(32).optional().nullable(),
  default_entity: z.enum(['coop', 'flux']).default('coop'),
  default_cost_center_id: z.string().uuid().optional().nullable(),
  default_monthly_cents: z.number().int().min(0).optional().nullable(),
});

const shareholderSchema = z.object({
  ...personFields,
  entity_type: z.enum(['coop', 'flux']),
  ownership_pct: z.number().min(0).max(100).optional().nullable(),
  pro_labore_default_cents: z.number().int().min(0).default(0),
  is_administrator: z.boolean().default(false),
});

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

export async function registerBillingCompanyPayrollRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/internal-providers', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const activeOnly = (request.query as { active?: string }).active === '1';
    let q = supabase
      .from('billing_internal_providers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('legal_name');
    if (activeOnly) q = q.eq('active', true);
    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ internal_providers: data || [] });
  });

  app.get('/internal-providers/:id', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('billing_internal_providers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Prestador não encontrado' });
    return reply.send({ internal_provider: data });
  });

  app.post('/internal-providers', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = internalProviderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const { data, error } = await supabase
      .from('billing_internal_providers')
      .insert({ workspace_id: workspaceId, ...parsed.data, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send({ internal_provider: data });
  });

  app.patch('/internal-providers/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = internalProviderSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const { data, error } = await supabase
      .from('billing_internal_providers')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Prestador não encontrado' });
    return reply.send({ internal_provider: data });
  });

  app.get('/shareholders', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as { active?: string; entity_type?: string };
    let query = supabase
      .from('billing_shareholders')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('legal_name');
    if (q.active === '1') query = query.eq('active', true);
    if (q.entity_type === 'coop' || q.entity_type === 'flux') query = query.eq('entity_type', q.entity_type);
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ shareholders: data || [] });
  });

  app.get('/shareholders/:id', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('billing_shareholders')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Sócio não encontrado' });
    return reply.send({ shareholder: data });
  });

  app.post('/shareholders', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = shareholderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const { data, error } = await supabase
      .from('billing_shareholders')
      .insert({ workspace_id: workspaceId, ...parsed.data, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send({ shareholder: data });
  });

  app.patch('/shareholders/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = shareholderSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const { data, error } = await supabase
      .from('billing_shareholders')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Sócio não encontrado' });
    return reply.send({ shareholder: data });
  });

  app.post('/company-payroll/generate', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z
      .object({
        month: monthSchema,
        include_shareholders: z.boolean().default(true),
        include_providers: z.boolean().default(true),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'month obrigatório (YYYY-MM)' });

    try {
      const result = await generateMonthlyCompanyPayroll(workspaceId, body.data.month, {
        include_shareholders: body.data.include_shareholders,
        include_providers: body.data.include_providers,
      });
      await writeAuditLog({
        actor_id: (request.user as { sub: string }).sub,
        action: 'billing.company_payroll.generate',
        entity_type: 'workspace',
        entity_id: workspaceId,
        metadata: { month: body.data.month, ...result },
      });
      return reply.send({ ok: true, ...result });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/shareholder-pro-labore-inss', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const month = String((request.query as { month?: string }).month || '');
    if (!monthSchema.safeParse(month).success) return reply.status(400).send({ error: 'month obrigatório' });

    try {
      const report = await buildShareholderProLaboreInssReport(workspaceId, month);
      return reply.send({ ...report, month });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/shareholder-pro-labore-inss/csv', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const month = String((request.query as { month?: string }).month || '');
    if (!monthSchema.safeParse(month).success) return reply.status(400).send({ error: 'month obrigatório' });

    const report = await buildShareholderProLaboreInssReport(workspaceId, month);
    const csv = reportRowsToCsv(
      ['nome', 'cpf_cnpj', 'entidade', 'pro_labore'],
      report.rows.map((r) => ({
        nome: r.legal_name,
        cpf_cnpj: r.cpf_cnpj,
        entidade: r.entity_type,
        pro_labore: (r.pro_labore_cents / 100).toFixed(2),
      }))
    );
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    return reply.send(csv);
  });
}
