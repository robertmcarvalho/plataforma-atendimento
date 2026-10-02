import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { buildPixBatchPreview } from '../../lib/billingPayablesEngine';
import { buildGeneralPixBatchPreview, exportGeneralPixBatch, exportPixBatchForCycle } from '../../lib/billingPixBatchExport';
import {
  backfillFinancialDailyPayableCostCenters,
  buildDailyPixPreview,
  exportDailyPixBatch,
  syncDailyPayablesFromFinancial,
  syncFinancialInstallmentPaidFromPayable,
} from '../../lib/billingDailyPixExport';
import { ensureCorporateCostCenterId } from '../../lib/billingCostCenters';

const supplierSchema = z.object({
  name: z.string().min(1).max(200),
  cpf_cnpj: z.string().max(18).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(32).optional().nullable(),
  pix_key: z.string().max(120).optional().nullable(),
  pix_key_type: z.string().max(32).optional().nullable(),
  bank_code: z.string().max(8).optional().nullable(),
  bank_name: z.string().max(120).optional().nullable(),
  category: z.string().max(64).optional().nullable(),
  active: z.boolean().default(true),
});

const payableBodySchema = z.object({
  beneficiary_type: z.enum(['driver', 'supplier', 'operational', 'internal_provider', 'shareholder', 'commercial_partner', 'leader']),
  beneficiary_id: z.string().uuid().optional().nullable(),
  legal_entity_type: z.enum(['coop', 'flux']).optional().nullable(),
  cost_center_id: z.string().uuid().optional().nullable(),
  billing_cycle_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1).max(500),
  amount_cents: z.number().int().positive(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  scheduled_payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  payment_method: z.enum(['pix', 'transfer', 'cash', 'other']).optional(),
  payment_bank_account_id: z.string().uuid().optional().nullable(),
  pix_key: z.string().max(160).optional().nullable(),
  pix_key_type: z.string().max(32).optional().nullable(),
  batch_eligible: z.boolean().optional(),
  category: z.string().max(64).optional().nullable(),
  competence_month: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
});

const expenseBodySchema = z.object({
  expense_type_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1).max(500),
  amount_cents: z.number().int().positive(),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cost_center_id: z.string().uuid().optional().nullable(),
  legal_entity_type: z.enum(['coop', 'flux', 'both']).default('both'),
  allocation: z.record(z.number()).optional(),
  recurrence: z.string().max(64).optional().nullable(),
  status: z.enum(['draft', 'approved', 'paid']).optional(),
  scheduled_payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  payment_method: z.enum(['pix', 'transfer', 'cash', 'other']).optional(),
  payment_bank_account_id: z.string().uuid().optional().nullable(),
  pix_key: z.string().max(160).optional().nullable(),
  pix_key_type: z.string().max(32).optional().nullable(),
  batch_eligible: z.boolean().optional(),
  management_group: z.enum(['operational', 'administrative', 'financial', 'tax', 'commercial', 'patrimonial', 'outside_dre']).optional().nullable(),
  dre_group: z.enum(['revenue', 'operational_cost', 'administrative_expense', 'financial_expense', 'tax', 'commercial_expense', 'outside_dre']).optional().nullable(),
  allocation_policy: z.enum(['direct_cost_center', 'revenue_share', 'driver_share', 'delivery_share', 'manual', 'none']).optional().nullable(),
});

type BillingExpenseRow = {
  id: string;
  workspace_id: string;
  expense_type_id: string | null;
  description: string;
  amount_cents: number;
  expense_date: string;
  cost_center_id: string | null;
  legal_entity_type: 'coop' | 'flux' | 'both';
  allocation: Record<string, number> | null;
  recurrence: string | null;
  status: 'draft' | 'approved' | 'paid';
  scheduled_payment_date?: string | null;
  payment_method?: 'pix' | 'transfer' | 'cash' | 'other' | null;
  payment_bank_account_id?: string | null;
  pix_key?: string | null;
  pix_key_type?: string | null;
  batch_eligible?: boolean | null;
  management_group?: string | null;
  dre_group?: string | null;
  allocation_policy?: string | null;
};

const paymentBodySchema = z.object({
  amount_cents: z.number().int().positive(),
  payment_method: z.enum(['pix', 'transfer', 'cash', 'other', 'credit_card']).default('pix'),
  legal_entity_id: z.string().uuid().optional().nullable(),
  bank_account_id: z.string().uuid().optional().nullable(),
  card_last_four: z.string().regex(/^\d{4}$/).optional().nullable(),
  card_brand: z.string().max(32).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  paid_at: z.string().datetime().optional(),
});

const releaseBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

async function syncOperationalPayableFromExpense(workspaceId: string, expense: BillingExpenseRow) {
  const now = new Date().toISOString();
  const legalEntityType =
    expense.legal_entity_type === 'coop' || expense.legal_entity_type === 'flux' ? expense.legal_entity_type : null;

  const { data: expenseType } = expense.expense_type_id
    ? await supabase
        .from('billing_expense_types')
        .select('name, management_group, dre_group, allocation_policy')
        .eq('workspace_id', workspaceId)
        .eq('id', expense.expense_type_id)
        .maybeSingle()
    : { data: null };

  const payablePatch = {
    beneficiary_type: 'operational' as const,
    beneficiary_id: null,
    legal_entity_type: legalEntityType,
    cost_center_id: expense.cost_center_id || null,
    billing_cycle_id: null,
    description: `Despesa — ${expense.description}`,
    amount_cents: expense.amount_cents,
    due_date: String(expense.expense_date).slice(0, 10),
    original_due_date: String(expense.expense_date).slice(0, 10),
    effective_due_date: String(expense.expense_date).slice(0, 10),
    scheduled_payment_date: String(expense.scheduled_payment_date || expense.expense_date).slice(0, 10),
    payment_method: expense.payment_method || 'pix',
    payment_bank_account_id: expense.payment_bank_account_id || null,
    pix_key: expense.pix_key || null,
    pix_key_type: expense.pix_key_type || null,
    batch_eligible: expense.batch_eligible !== false,
    payment_batch_status: 'pending',
    category: expenseType?.name || null,
    management_group: expense.management_group || expenseType?.management_group || null,
    dre_group: expense.dre_group || expenseType?.dre_group || null,
    allocation_policy: expense.allocation_policy || expenseType?.allocation_policy || null,
    competence_month: String(expense.expense_date).slice(0, 7),
    metadata: {
      source: 'billing_expense',
      expense_id: expense.id,
      expense_type_id: expense.expense_type_id,
      recurrence: expense.recurrence,
      allocation: expense.allocation || {},
    },
    updated_at: now,
  };

  const { data: existing, error: existingErr } = await supabase
    .from('billing_payables')
    .select('id, status, amount_paid_cents')
    .eq('workspace_id', workspaceId)
    .eq('beneficiary_type', 'operational')
    .eq('metadata->>expense_id', expense.id)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);

  if (existing) {
    if (String(existing.status) === 'paid' || Number(existing.amount_paid_cents || 0) > 0) {
      return;
    }
    const { error } = await supabase
      .from('billing_payables')
      .update(payablePatch)
      .eq('workspace_id', workspaceId)
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from('billing_payables').insert({
    workspace_id: workspaceId,
    ...payablePatch,
    amount_paid_cents: 0,
    status: 'draft',
  });
  if (error) throw new Error(error.message);
}

export async function registerBillingPayableRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/payables', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as { cycle_id?: string; beneficiary_type?: string; status?: string; cost_center_id?: string };

    let query = supabase
      .from('billing_payables')
      .select('*, billing_cost_centers!cost_center_id(id, name, corporate_entity_type), billing_cycles(id, label, apuracao_start, apuracao_end)')
      .eq('workspace_id', workspaceId)
      .order('due_date', { ascending: true });
    if (q.cycle_id) query = query.eq('billing_cycle_id', q.cycle_id);
    if (q.beneficiary_type) query = query.eq('beneficiary_type', q.beneficiary_type);
    if (q.status) query = query.eq('status', q.status);
    if (q.cost_center_id) query = query.eq('cost_center_id', q.cost_center_id);

    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });

    const driverIds = (data || []).filter((p) => p.beneficiary_type === 'driver' && p.beneficiary_id).map((p) => p.beneficiary_id);
    const supplierIds = (data || []).filter((p) => p.beneficiary_type === 'supplier' && p.beneficiary_id).map((p) => p.beneficiary_id);
    const providerIds = (data || []).filter((p) => p.beneficiary_type === 'internal_provider' && p.beneficiary_id).map((p) => p.beneficiary_id);
    const shareholderIds = (data || []).filter((p) => p.beneficiary_type === 'shareholder' && p.beneficiary_id).map((p) => p.beneficiary_id);
    const partnerIds = (data || []).filter((p) => p.beneficiary_type === 'commercial_partner' && p.beneficiary_id).map((p) => p.beneficiary_id);
    const leaderIds = (data || []).filter((p) => p.beneficiary_type === 'leader' && p.beneficiary_id).map((p) => p.beneficiary_id);

    const driversById = new Map<string, { name: string }>();
    const suppliersById = new Map<string, { name: string }>();
    const providersById = new Map<string, { name: string }>();
    const shareholdersById = new Map<string, { name: string }>();
    const partnersById = new Map<string, { name: string }>();
    const leadersById = new Map<string, { name: string }>();

    if (driverIds.length) {
      const { data: drivers } = await supabase.from('drivers').select('id, name').in('id', driverIds);
      for (const d of drivers || []) driversById.set(String(d.id), { name: String(d.name) });
    }
    if (supplierIds.length) {
      const { data: suppliers } = await supabase.from('billing_suppliers').select('id, name').in('id', supplierIds);
      for (const s of suppliers || []) suppliersById.set(String(s.id), { name: String(s.name) });
    }
    if (providerIds.length) {
      const { data: providers } = await supabase.from('billing_internal_providers').select('id, legal_name').in('id', providerIds);
      for (const p of providers || []) providersById.set(String(p.id), { name: String(p.legal_name) });
    }
    if (shareholderIds.length) {
      const { data: shareholders } = await supabase.from('billing_shareholders').select('id, legal_name').in('id', shareholderIds);
      for (const s of shareholders || []) shareholdersById.set(String(s.id), { name: String(s.legal_name) });
    }
    if (partnerIds.length) {
      const { data: partners } = await supabase.from('billing_commercial_partners').select('id, legal_name').in('id', partnerIds);
      for (const p of partners || []) partnersById.set(String(p.id), { name: String(p.legal_name) });
    }
    if (leaderIds.length) {
      const { data: leaders } = await supabase.from('leaders').select('id, name').in('id', leaderIds);
      for (const l of leaders || []) leadersById.set(String(l.id), { name: String(l.name) });
    }

    const payableIds = (data || []).map((p) => String(p.id));
    const pendingByPayable = new Map<string, number>();
    if (payableIds.length) {
      const { data: pendingPayments, error: pendingErr } = await supabase
        .from('billing_payments')
        .select('payable_id, amount_cents')
        .eq('workspace_id', workspaceId)
        .eq('reconciled', false)
        .in('payable_id', payableIds);
      if (pendingErr) return reply.status(500).send({ error: pendingErr.message });
      for (const payment of pendingPayments || []) {
        if (!payment.payable_id) continue;
        const payableId = String(payment.payable_id);
        pendingByPayable.set(payableId, (pendingByPayable.get(payableId) || 0) + Number(payment.amount_cents || 0));
      }
    }

    const payables = (data || []).map((p) => ({
      ...p,
      pending_payment_cents: pendingByPayable.get(String(p.id)) || 0,
      beneficiary_name:
        p.beneficiary_type === 'driver'
          ? driversById.get(String(p.beneficiary_id))?.name
          : p.beneficiary_type === 'supplier'
            ? suppliersById.get(String(p.beneficiary_id))?.name
            : p.beneficiary_type === 'internal_provider'
              ? providersById.get(String(p.beneficiary_id))?.name
              : p.beneficiary_type === 'shareholder'
                ? shareholdersById.get(String(p.beneficiary_id))?.name
                : p.beneficiary_type === 'commercial_partner'
                  ? partnersById.get(String(p.beneficiary_id))?.name
                  : p.beneficiary_type === 'leader'
                    ? leadersById.get(String(p.beneficiary_id))?.name
                    : p.description,
    }));

    return reply.send({ payables });
  });

  app.post('/payables', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = payableBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const costCenterId =
      parsed.data.cost_center_id ||
      (parsed.data.legal_entity_type && parsed.data.beneficiary_type !== 'driver'
        ? await ensureCorporateCostCenterId(workspaceId, parsed.data.legal_entity_type)
        : null);

    const { data, error } = await supabase
      .from('billing_payables')
      .insert({
        workspace_id: workspaceId,
        ...parsed.data,
        cost_center_id: costCenterId,
        scheduled_payment_date: parsed.data.scheduled_payment_date || parsed.data.due_date || null,
        payment_method: parsed.data.payment_method || 'pix',
        payment_batch_status: 'pending',
        batch_eligible: parsed.data.batch_eligible !== false,
        status: 'draft',
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send({ payable: data });
  });

  app.post('/payables/:id/approve', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('billing_payables')
      .update({ status: 'approved', approved_at: now, approved_by: actorId, updated_at: now })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .eq('status', 'draft')
      .select()
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Título não encontrado' });
    return reply.send({ payable: data });
  });

  app.post('/payables/:id/release', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;
    const parsed = releaseBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Informe uma justificativa para a liberação do pagamento.' });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('billing_payables')
      .update({
        payment_blocked: false,
        block_reason: null,
        manager_released_at: now,
        manager_released_by: actorId,
        manager_release_reason: parsed.data.reason,
        updated_at: now,
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .eq('payment_blocked', true)
      .select()
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Título bloqueado não encontrado' });
    return reply.send({ payable: data });
  });

  app.post('/payables/:id/payment', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;
    const parsed = paymentBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const { data: payableBefore } = await supabase
      .from('billing_payables')
      .select('id, origin_type, origin_id, metadata')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();

    const { data: result, error: rpcErr } = await supabase.rpc('billing_register_payable_payment', {
      p_workspace_id: workspaceId,
      p_payable_id: id,
      p_amount_cents: parsed.data.amount_cents,
      p_payment_method: parsed.data.payment_method,
      p_legal_entity_id: parsed.data.legal_entity_id || null,
      p_bank_account_id: parsed.data.bank_account_id || null,
      p_card_last_four: parsed.data.card_last_four || null,
      p_card_brand: parsed.data.card_brand || null,
      p_notes: parsed.data.notes || null,
      p_paid_at: parsed.data.paid_at || new Date().toISOString(),
      p_created_by: actorId,
    });
    if (rpcErr) return reply.status(500).send({ error: rpcErr.message });

    const payload = result as { payable?: Record<string, unknown>; payment?: Record<string, unknown> };
    try {
      await syncFinancialInstallmentPaidFromPayable(workspaceId, {
        origin_type: payableBefore?.origin_type || null,
        origin_id: payableBefore?.origin_id || null,
        metadata: (payableBefore?.metadata as Record<string, unknown> | null) || null,
      });
    } catch {
      /* baixa do AP não deve falhar se sync financeiro falhar */
    }
    return reply.send({ payable: payload.payable, payment: payload.payment });
  });

  app.get('/suppliers', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('billing_suppliers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ suppliers: data || [] });
  });

  app.post('/suppliers', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = supplierSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const { data, error } = await supabase
      .from('billing_suppliers')
      .insert({ workspace_id: workspaceId, ...parsed.data, name: parsed.data.name.trim(), updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send({ supplier: data });
  });

  app.patch('/suppliers/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = supplierSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) patch[k] = k === 'name' ? String(v).trim() : v;
    }

    const { data, error } = await supabase
      .from('billing_suppliers')
      .update(patch)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Fornecedor não encontrado' });
    return reply.send({ supplier: data });
  });

  app.get('/expenses', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('billing_expenses')
      .select('*, billing_expense_types(id, name, kind), billing_cost_centers!cost_center_id(id, name, corporate_entity_type)')
      .eq('workspace_id', workspaceId)
      .order('expense_date', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ expenses: data || [] });
  });

  app.post('/expenses', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = expenseBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const { data, error } = await supabase
      .from('billing_expenses')
      .insert({
        workspace_id: workspaceId,
        ...parsed.data,
        allocation: parsed.data.allocation || {},
        status: parsed.data.status || 'draft',
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    try {
      await syncOperationalPayableFromExpense(workspaceId, data as BillingExpenseRow);
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Despesa salva, mas não foi possível gerar o contas a pagar.',
      });
    }
    return reply.status(201).send({ expense: data });
  });

  app.patch('/expenses/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = expenseBodySchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) patch[k] = v;
    }

    const { data, error } = await supabase
      .from('billing_expenses')
      .update(patch)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Despesa não encontrada' });
    try {
      await syncOperationalPayableFromExpense(workspaceId, data as BillingExpenseRow);
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Despesa atualizada, mas não foi possível sincronizar o contas a pagar.',
      });
    }
    return reply.send({ expense: data });
  });

  app.get('/reports/pix-batch/preview', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const cycleId = String((request.query as { cycle_id?: string }).cycle_id || '');
    if (!cycleId) return reply.status(400).send({ error: 'cycle_id obrigatório' });

    try {
      const preview = await buildPixBatchPreview(workspaceId, cycleId);
      return reply.send(preview);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/payables-batch/preview', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as {
      payment_date?: string;
      legal_entity_type?: 'coop' | 'flux';
      bank_account_id?: string;
      beneficiary_type?: string;
      cost_center_id?: string;
      payable_ids?: string;
      include_financial_daily?: string;
    };
    try {
      const preview = await buildGeneralPixBatchPreview(workspaceId, {
        paymentDate: q.payment_date || null,
        legalEntityType: q.legal_entity_type || null,
        bankAccountId: q.bank_account_id || null,
        beneficiaryType: q.beneficiary_type || null,
        costCenterId: q.cost_center_id || null,
        payableIds: q.payable_ids ? q.payable_ids.split(',').filter(Boolean) : undefined,
        includeFinancialDaily: q.include_financial_daily === '1' || q.include_financial_daily === 'true',
      });
      return reply.send(preview);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.post('/reports/pix-batch/export', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const actorId = (request.user as { sub: string }).sub;
    const body = z
      .object({
        cycle_id: z.string().uuid(),
        bank_account_id: z.string().uuid().optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'cycle_id obrigatório' });

    try {
      const exported = await exportPixBatchForCycle(workspaceId, body.data.cycle_id, actorId, {
        bankAccountId: body.data.bank_account_id,
      });
      if (!exported) {
        return reply.status(404).send({ error: 'Sem AP aprovado para exportar neste ciclo' });
      }
      return reply.send({
        template: exported.template,
        file_format: exported.file_format,
        filename: exported.filename,
        csv: exported.csv,
        xlsx_base64: exported.xlsx_base64,
        row_count: exported.row_count,
        total_cents: exported.total_cents,
        skipped_no_pix: exported.skipped_no_pix,
        payment_date: exported.payment_date,
        batches: exported.batches,
      });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.post('/reports/payables-batch/export', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const actorId = (request.user as { sub: string }).sub;
    const body = z
      .object({
        payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        legal_entity_type: z.enum(['coop', 'flux']).optional().nullable(),
        bank_account_id: z.string().uuid().optional().nullable(),
        beneficiary_type: z.string().optional().nullable(),
        cost_center_id: z.string().uuid().optional().nullable(),
        payable_ids: z.array(z.string().uuid()).optional(),
        include_financial_daily: z.boolean().optional(),
      })
      .safeParse(request.body || {});
    if (!body.success) return reply.status(400).send({ error: 'Filtros inválidos', details: body.error.flatten() });

    try {
      const exported = await exportGeneralPixBatch(workspaceId, actorId, {
        paymentDate: body.data.payment_date || null,
        legalEntityType: body.data.legal_entity_type || null,
        bankAccountId: body.data.bank_account_id || null,
        beneficiaryType: body.data.beneficiary_type || null,
        costCenterId: body.data.cost_center_id || null,
        payableIds: body.data.payable_ids,
        includeFinancialDaily: body.data.include_financial_daily === true,
      });
      if (!exported) return reply.status(404).send({ error: 'Sem AP PIX aprovado para exportar com estes filtros' });
      return reply.send(exported);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/pix-dailies/preview', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const paymentDate = String((request.query as { payment_date?: string }).payment_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      return reply.status(400).send({ error: 'payment_date obrigatório (YYYY-MM-DD)' });
    }
    try {
      const preview = await buildDailyPixPreview(workspaceId, paymentDate);
      return reply.send(preview);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.post('/reports/pix-dailies/export', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z
      .object({
        payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        bank_account_id: z.string().uuid().optional().nullable(),
        sync_payables: z.boolean().optional().default(true),
      })
      .safeParse(request.body || {});
    if (!body.success) return reply.status(400).send({ error: 'payment_date obrigatório (YYYY-MM-DD)' });

    try {
      if (body.data.sync_payables !== false) {
        await syncDailyPayablesFromFinancial(workspaceId, body.data.payment_date);
      }
      const exported = await exportDailyPixBatch(workspaceId, body.data.payment_date, {
        bankAccountId: body.data.bank_account_id || undefined,
      });
      if (!exported) {
        return reply.status(404).send({
          error: 'Nenhuma diária aprovada com parcela pendente nesta data (ou todas sem chave PIX).',
        });
      }
      return reply.send(exported);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.post('/reports/pix-dailies/sync-payables', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z
      .object({
        payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        /** Preenche cost_center_id em payables financial_daily da data que ainda estão sem CC. */
        backfill_cost_centers: z.boolean().optional().default(true),
      })
      .safeParse(request.body || {});
    if (!body.success) return reply.status(400).send({ error: 'payment_date obrigatório' });
    try {
      const result = await syncDailyPayablesFromFinancial(workspaceId, body.data.payment_date);
      let backfill: Awaited<ReturnType<typeof backfillFinancialDailyPayableCostCenters>> | null = null;
      if (body.data.backfill_cost_centers !== false) {
        backfill = await backfillFinancialDailyPayableCostCenters(workspaceId, {
          dueDate: body.data.payment_date,
        });
      }
      return reply.send({ ...result, backfill });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });
}
