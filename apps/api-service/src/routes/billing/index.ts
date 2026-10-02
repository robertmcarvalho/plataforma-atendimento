import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { writeAuditLog } from '../../lib/auditLog';
import { isBillingModuleEnabled } from '../../lib/billingModule';
import { DEFAULT_BILLING_EXPENSE_TYPES } from '../../lib/billingExpenseCatalog';

const costCenterBodySchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(32).optional().nullable(),
  cnpj: z.string().max(18).optional().nullable(),
  pharmacy_id: z.string().uuid().optional().nullable(),
  billing_pharmacy_id: z.string().uuid().optional().nullable(),
  split_coop_pct: z.number().min(0).max(100).default(50),
  split_flux_pct: z.number().min(0).max(100).default(50),
  active: z.boolean().default(true),
  cycle_closes_weekday: z.number().int().min(1).max(7).default(7),
  cycle_review_weekday: z.number().int().min(1).max(7).default(1),
  invoice_issue_weekday: z.number().int().min(1).max(7).default(1),
  invoice_due_weekday: z.number().int().min(1).max(7).default(3),
  invoice_due_week_offset: z.number().int().min(0).max(8).default(0),
  driver_payment_weekday: z.number().int().min(1).max(7).default(4),
  driver_payment_week_offset: z.number().int().min(0).max(8).default(0),
  driver_payment_release_condition: z
    .enum(['invoice_paid', 'manager_release', 'invoice_paid_or_manager_release', 'none'])
    .default('invoice_paid_or_manager_release'),
  allow_partial_driver_payment: z.boolean().default(false),
  block_c6_without_invoice_payment: z.boolean().default(true),
  invoice_holiday_policy: z
    .enum(['previous_business_day', 'next_business_day', 'keep_requires_approval'])
    .default('next_business_day'),
  driver_payment_holiday_policy: z
    .enum(['previous_business_day', 'next_business_day', 'keep_requires_approval'])
    .default('previous_business_day'),
  require_manager_release_reason: z.boolean().default(true),
  default_coverage_daily_billing_treatment: z
    .enum(['charge_pharmacy', 'absorb_operation', 'pending_audit'])
    .default('pending_audit'),
});

const dailyShareGroupBodySchema = z.object({
  name: z.string().min(1).max(120),
  billing_cost_center_id: z.string().uuid().optional().nullable(),
  billing_pharmacy_id: z.string().uuid().optional().nullable(),
  daily_pharmacy_amount_cents: z.number().int().min(0).default(0),
  daily_driver_payout_cents: z.number().int().min(0).optional().nullable(),
  allocation_rule: z.enum(['equal']).default('equal'),
  active: z.boolean().default(true),
  pharmacy_ids: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma farmácia no grupo.'),
});

const COST_CENTER_POLICY_KEYS = [
  'cycle_closes_weekday',
  'cycle_review_weekday',
  'invoice_issue_weekday',
  'invoice_due_weekday',
  'invoice_due_week_offset',
  'driver_payment_weekday',
  'driver_payment_week_offset',
  'driver_payment_release_condition',
  'allow_partial_driver_payment',
  'block_c6_without_invoice_payment',
  'invoice_holiday_policy',
  'driver_payment_holiday_policy',
  'require_manager_release_reason',
  'default_coverage_daily_billing_treatment',
] as const;

function validateSplitSum(coop: number, flux: number): string | null {
  if (Math.abs(coop + flux - 100) > 0.001) {
    return 'Split Coop + Flux deve somar 100%.';
  }
  return null;
}

function costCenterWriteErrorMessage(error: { code?: string; message?: string; details?: string | null }): string {
  const message = error.message || '';
  if (error.code === '23505' || message.toLowerCase().includes('duplicate')) {
    return 'Já existe um centro de custo com este nome neste workspace.';
  }
  if (error.code === '23514' || message.toLowerCase().includes('split')) {
    return 'Split Coop + Flux deve somar 100%.';
  }
  if (message.includes('Could not find') && message.includes('schema cache')) {
    return 'O schema local do banco ainda não recarregou. Aguarde alguns segundos e tente novamente.';
  }
  return message || 'Erro ao salvar centro de custo.';
}

function normalizeExpenseTypeName(name: string): string {
  const repaired = name
    .replace(/alimenta\?+o/gi, 'alimentacao')
    .replace(/refei\?+o/gi, 'refeicao')
    .replace(/aux\?lio/gi, 'auxilio')
    .replace(/combust\?vel/gi, 'combustivel')
    .replace(/b\?nus/gi, 'bonus')
    .replace(/comiss\?es/gi, 'comissoes')
    .replace(/indica\?+es/gi, 'indicacoes')
    .replace(/jur\?dico/gi, 'juridico')
    .replace(/banc\?rias/gi, 'bancarias')
    .replace(/funcion\?rios/gi, 'funcionarios')
    .replace(/condom\?nio/gi, 'condominio')
    .replace(/\?gua/gi, 'agua');
  const normalized = repaired
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\?/g, '')
    .replace(/[().]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (normalized === 'aluguel sede') return 'aluguel';
  if (normalized === 'pagamento de funcionarios / folha administrativa') return 'pagamento de funcionarios';
  if (normalized === 'publicidade / propaganda') return 'publicidade e propaganda';
  if (normalized === 'software / sistemas / licencas') return 'software / licencas saas';
  if (normalized === 'uniforme / bag / equipamentos') return 'uniforme / bag entregador';
  if (normalized === 'tarifas bancarias / iof / juros') return 'iof / juros / desp financeira';
  return normalized;
}

async function seedDefaultExpenseTypesForWorkspace(workspaceId: string): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  const { data: existingTypes, error: existingErr } = await supabase
    .from('billing_expense_types')
    .select('id, name')
    .eq('workspace_id', workspaceId);
  if (existingErr) throw new Error(existingErr.message);
  const existingByName = new Map((existingTypes || []).map((type) => [normalizeExpenseTypeName(String(type.name || '')), String(type.id)]));
  for (const seed of DEFAULT_BILLING_EXPENSE_TYPES) {
    const normalizedSeed = normalizeExpenseTypeName(seed.name);
    const existingId = existingByName.get(normalizedSeed);
    if (existingId) {
      const { error } = await supabase
        .from('billing_expense_types')
        .update({
          management_group: seed.management_group || 'administrative',
          dre_group: seed.dre_group || 'administrative_expense',
          allocation_policy: seed.allocation_policy || 'revenue_share',
          requires_cost_center: seed.requires_cost_center || false,
          affects_dre: seed.affects_dre !== false,
          updated_at: now,
        })
        .eq('workspace_id', workspaceId)
        .eq('id', existingId);
      if (error) throw new Error(error.message);
      skipped += 1;
      continue;
    }
    const { error } = await supabase.from('billing_expense_types').insert({
      workspace_id: workspaceId,
      name: seed.name,
      kind: seed.kind,
      default_entity: seed.default_entity,
      allocation_mode: seed.allocation_mode || 'none',
      recurrence: seed.recurrence || null,
      affects_dre: seed.affects_dre !== false,
      management_group: seed.management_group || 'administrative',
      dre_group: seed.dre_group || 'administrative_expense',
      allocation_policy: seed.allocation_policy || 'revenue_share',
      requires_cost_center: seed.requires_cost_center || false,
      active: true,
      updated_at: now,
    });
    if (error) throw new Error(error.message);
    existingByName.set(normalizedSeed, seed.name);
    created += 1;
  }
  return { created, skipped };
}

async function linkPharmacyToCostCenter(workspaceId: string, pharmacyId: string | null | undefined, costCenterId: string) {
  if (!pharmacyId) return;
  const { data, error } = await supabase
    .from('pharmacies')
    .update({ billing_cost_center_id: costCenterId, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', pharmacyId)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Farmácia selecionada não foi encontrada neste workspace.');
}

async function replaceDailyShareGroupMembers(workspaceId: string, groupId: string, pharmacyIds: string[]) {
  const uniqueIds = [...new Set(pharmacyIds)];
  const { data: pharmacies, error: pharmacyErr } = await supabase
    .from('pharmacies')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('id', uniqueIds);
  if (pharmacyErr) throw new Error(pharmacyErr.message);
  if ((pharmacies || []).length !== uniqueIds.length) {
    throw new Error('Uma ou mais farmácias do grupo não foram encontradas neste workspace.');
  }

  const { error: deleteErr } = await supabase
    .from('billing_daily_share_group_pharmacies')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('group_id', groupId);
  if (deleteErr) throw new Error(deleteErr.message);

  const { error: insertErr } = await supabase.from('billing_daily_share_group_pharmacies').insert(
    uniqueIds.map((pharmacyId) => ({
      workspace_id: workspaceId,
      group_id: groupId,
      pharmacy_id: pharmacyId,
      active: true,
      updated_at: new Date().toISOString(),
    }))
  );
  if (insertErr) throw new Error(insertErr.message);
}

export async function registerBillingStatusRoutes(app: FastifyInstance) {
  app.get('/status', { preHandler: [authenticate] }, async (_request, reply) => {
    return reply.send({ enabled: isBillingModuleEnabled() });
  });
}

export async function registerBillingCostCenterRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/cost-centers', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const activeOnly = String((request.query as { active?: string }).active || '') === '1';
    let q = supabase
      .from('billing_cost_centers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name');
    if (activeOnly) q = q.eq('active', true);

    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ cost_centers: data || [] });
  });

  app.post('/cost-centers', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = costCenterBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    const splitErr = validateSplitSum(parsed.data.split_coop_pct, parsed.data.split_flux_pct);
    if (splitErr) return reply.status(400).send({ error: splitErr });

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('billing_cost_centers')
      .insert({
        workspace_id: workspaceId,
        name: parsed.data.name.trim(),
        code: parsed.data.code?.trim() || null,
        cnpj: parsed.data.cnpj?.trim() || null,
        billing_pharmacy_id: parsed.data.billing_pharmacy_id || parsed.data.pharmacy_id || null,
        split_coop_pct: parsed.data.split_coop_pct,
        split_flux_pct: parsed.data.split_flux_pct,
        active: parsed.data.active,
        ...Object.fromEntries(COST_CENTER_POLICY_KEYS.map((key) => [key, parsed.data[key]])),
        updated_at: now,
      })
      .select()
      .single();
    if (error) {
      const message = costCenterWriteErrorMessage(error);
      const status = error.code === '23505' ? 409 : error.code === '23514' ? 400 : 500;
      return reply.status(status).send({ error: message, operator_message: message });
    }

    try {
      await linkPharmacyToCostCenter(workspaceId, parsed.data.pharmacy_id, data.id);
    } catch (err) {
      await supabase.from('billing_cost_centers').delete().eq('workspace_id', workspaceId).eq('id', data.id);
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Erro ao vincular farmácia',
        operator_message:
          err instanceof Error
            ? err.message
            : 'Centro de custo não foi salvo porque não foi possível vincular a farmácia selecionada.',
      });
    }

    await writeAuditLog({
      actor_id: (request.user as { sub: string }).sub,
      action: 'billing.cost_center.create',
      entity_type: 'billing_cost_center',
      entity_id: data.id,
      metadata: { name: data.name },
    });

    return reply.status(201).send({ cost_center: data });
  });

  app.patch('/cost-centers/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = costCenterBodySchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const { data: existing, error: loadErr } = await supabase
      .from('billing_cost_centers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (loadErr) return reply.status(500).send({ error: loadErr.message });
    if (!existing) return reply.status(404).send({ error: 'Centro de custo não encontrado' });

    const coop = parsed.data.split_coop_pct ?? Number(existing.split_coop_pct);
    const flux = parsed.data.split_flux_pct ?? Number(existing.split_flux_pct);
    const splitErr = validateSplitSum(coop, flux);
    if (splitErr) return reply.status(400).send({ error: splitErr });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
    if (parsed.data.code !== undefined) patch.code = parsed.data.code?.trim() || null;
    if (parsed.data.cnpj !== undefined) patch.cnpj = parsed.data.cnpj?.trim() || null;
    if (parsed.data.billing_pharmacy_id !== undefined) patch.billing_pharmacy_id = parsed.data.billing_pharmacy_id || null;
    if (parsed.data.split_coop_pct !== undefined) patch.split_coop_pct = parsed.data.split_coop_pct;
    if (parsed.data.split_flux_pct !== undefined) patch.split_flux_pct = parsed.data.split_flux_pct;
    if (parsed.data.active !== undefined) patch.active = parsed.data.active;
    for (const key of COST_CENTER_POLICY_KEYS) {
      if (parsed.data[key] !== undefined) patch[key] = parsed.data[key];
    }

    const { data, error } = await supabase
      .from('billing_cost_centers')
      .update(patch)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      const message = costCenterWriteErrorMessage(error);
      const status = error.code === '23505' ? 409 : error.code === '23514' ? 400 : 500;
      return reply.status(status).send({ error: message, operator_message: message });
    }
    try {
      await linkPharmacyToCostCenter(workspaceId, parsed.data.pharmacy_id, data.id);
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Erro ao vincular farmácia',
      });
    }
    return reply.send({ cost_center: data });
  });

  app.delete('/cost-centers/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { count, error: useErr } = await supabase
      .from('pharmacies')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('billing_cost_center_id', id);
    if (useErr) return reply.status(500).send({ error: useErr.message });
    if ((count || 0) > 0) {
      return reply.status(409).send({ error: 'Centro de custo vinculado a farmácias. Remova o vínculo antes.' });
    }

    const { error } = await supabase.from('billing_cost_centers').delete().eq('workspace_id', workspaceId).eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true });
  });

  app.get('/daily-share-groups', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const activeOnly = String((request.query as { active?: string }).active || '') === '1';

    let query = supabase
      .from('billing_daily_share_groups')
      .select(
        `
        *,
        billing_cost_centers!billing_cost_center_id(id, name),
        billing_pharmacy:pharmacies!billing_pharmacy_id(id, trade_name, legal_name, cnpj),
        billing_daily_share_group_pharmacies(
          id, group_id, pharmacy_id, active, started_at, ended_at,
          pharmacies(id, trade_name, legal_name, cnpj)
        )
      `
      )
      .eq('workspace_id', workspaceId)
      .order('name');
    if (activeOnly) query = query.eq('active', true);

    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ groups: data || [] });
  });

  app.post('/daily-share-groups', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = dailyShareGroupBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const now = new Date().toISOString();
    const { pharmacy_ids: pharmacyIds, ...row } = parsed.data;
    const { data, error } = await supabase
      .from('billing_daily_share_groups')
      .insert({
        workspace_id: workspaceId,
        name: row.name.trim(),
        billing_cost_center_id: row.billing_cost_center_id || null,
        billing_pharmacy_id: row.billing_pharmacy_id || null,
        daily_pharmacy_amount_cents: row.daily_pharmacy_amount_cents,
        daily_driver_payout_cents: row.daily_driver_payout_cents ?? null,
        allocation_rule: row.allocation_rule,
        active: row.active,
        updated_at: now,
      })
      .select()
      .single();
    if (error) return reply.status(error.code === '23505' ? 409 : 500).send({ error: error.message });

    try {
      await replaceDailyShareGroupMembers(workspaceId, data.id, pharmacyIds);
    } catch (err) {
      await supabase.from('billing_daily_share_groups').delete().eq('workspace_id', workspaceId).eq('id', data.id);
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro ao salvar farmácias do grupo' });
    }

    await writeAuditLog({
      actor_id: (request.user as { sub: string }).sub,
      action: 'billing.daily_share_group.create',
      entity_type: 'billing_daily_share_group',
      entity_id: data.id,
      metadata: { name: data.name, pharmacy_ids: pharmacyIds },
    });

    return reply.status(201).send({ group: data });
  });

  app.patch('/daily-share-groups/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = dailyShareGroupBodySchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const { pharmacy_ids: pharmacyIds, ...body } = parsed.data;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.billing_cost_center_id !== undefined) patch.billing_cost_center_id = body.billing_cost_center_id || null;
    if (body.billing_pharmacy_id !== undefined) patch.billing_pharmacy_id = body.billing_pharmacy_id || null;
    if (body.daily_pharmacy_amount_cents !== undefined) patch.daily_pharmacy_amount_cents = body.daily_pharmacy_amount_cents;
    if (body.daily_driver_payout_cents !== undefined) patch.daily_driver_payout_cents = body.daily_driver_payout_cents ?? null;
    if (body.allocation_rule !== undefined) patch.allocation_rule = body.allocation_rule;
    if (body.active !== undefined) patch.active = body.active;

    const { data, error } = await supabase
      .from('billing_daily_share_groups')
      .update(patch)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) return reply.status(error.code === '23505' ? 409 : 500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Grupo de rateio não encontrado' });

    if (pharmacyIds !== undefined) {
      try {
        await replaceDailyShareGroupMembers(workspaceId, id, pharmacyIds);
      } catch (err) {
        return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro ao salvar farmácias do grupo' });
      }
    }

    return reply.send({ group: data });
  });

  app.delete('/daily-share-groups/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { error } = await supabase
      .from('billing_daily_share_groups')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true });
  });

  app.get('/holidays', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { start, end } = request.query as { start?: string; end?: string };
    let q = supabase
      .from('billing_holidays')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('active', true)
      .order('holiday_date', { ascending: true });
    if (start) q = q.gte('holiday_date', start);
    if (end) q = q.lte('holiday_date', end);
    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ holidays: data || [] });
  });

  app.post('/holidays', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = z
      .object({
        holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        name: z.string().min(1).max(120),
        scope: z.enum(['national', 'state', 'city', 'workspace']).default('workspace'),
        state: z.string().max(2).optional().nullable(),
        city: z.string().max(120).optional().nullable(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    const { data, error } = await supabase
      .from('billing_holidays')
      .insert({
        workspace_id: workspaceId,
        holiday_date: parsed.data.holiday_date,
        name: parsed.data.name.trim(),
        scope: parsed.data.scope,
        state: parsed.data.state?.trim() || null,
        city: parsed.data.city?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send({ holiday: data });
  });

  app.delete('/holidays/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { error } = await supabase
      .from('billing_holidays')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true });
  });

  app.get('/audit-notifications', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { cycle_id, status } = request.query as { cycle_id?: string; status?: string };
    let q = supabase
      .from('billing_audit_notifications')
      .select('*, drivers(id, name), pharmacies(id, trade_name, legal_name), billing_cycles(id, label)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (cycle_id) q = q.eq('billing_cycle_id', cycle_id);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ notifications: data || [] });
  });

  app.patch('/audit-notifications/:id/resolve', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('billing_audit_notifications')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: (request.user as { sub: string }).sub,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ notification: data });
  });
}

export async function registerBillingExpenseTypeRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  const bodySchema = z.object({
    name: z.string().min(1).max(120),
    kind: z.enum(['fixed', 'variable']),
    default_cost_center_id: z.string().uuid().optional().nullable(),
    default_entity: z.enum(['coop', 'flux', 'both']).default('both'),
    allocation_mode: z.enum(['none', 'per_pharmacy', 'per_driver', 'per_delivery', 'per_provider']).default('none'),
    recurrence: z.string().max(64).optional().nullable(),
    active: z.boolean().default(true),
    affects_dre: z.boolean().default(true),
    management_group: z.enum(['operational', 'administrative', 'financial', 'tax', 'commercial', 'patrimonial', 'outside_dre']).default('administrative'),
    dre_group: z.enum(['revenue', 'operational_cost', 'administrative_expense', 'financial_expense', 'tax', 'commercial_expense', 'outside_dre']).default('administrative_expense'),
    allocation_policy: z.enum(['direct_cost_center', 'revenue_share', 'driver_share', 'delivery_share', 'manual', 'none']).default('revenue_share'),
    requires_cost_center: z.boolean().default(false),
  });

  app.get('/expense-types', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    try {
      await seedDefaultExpenseTypesForWorkspace(workspaceId);
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Não foi possível sincronizar categorias padrão.',
      });
    }
    const { data, error } = await supabase
      .from('billing_expense_types')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name');
    if (error) return reply.status(500).send({ error: error.message });
    const byName = new Map<string, Record<string, unknown>>();
    for (const row of data || []) {
      const key = normalizeExpenseTypeName(String(row.name || ''));
      const current = byName.get(key);
      if (!current || String(current.name || '').includes('?')) byName.set(key, row);
    }
    return reply.send({ expense_types: [...byName.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR')) });
  });

  app.post('/expense-types', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const { data, error } = await supabase
      .from('billing_expense_types')
      .insert({
        workspace_id: workspaceId,
        ...parsed.data,
        name: parsed.data.name.trim(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send({ expense_type: data });
  });

  app.post('/expense-types/seed-defaults', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    try {
      const result = await seedDefaultExpenseTypesForWorkspace(workspaceId);
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Não foi possível sincronizar categorias padrão.',
      });
    }
  });

  app.patch('/expense-types/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = bodySchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
    for (const k of [
      'kind',
      'default_cost_center_id',
      'default_entity',
      'allocation_mode',
      'recurrence',
      'active',
      'affects_dre',
      'management_group',
      'dre_group',
      'allocation_policy',
      'requires_cost_center',
    ] as const) {
      if (parsed.data[k] !== undefined) patch[k] = parsed.data[k];
    }

    const { data, error } = await supabase
      .from('billing_expense_types')
      .update(patch)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Tipo não encontrado' });
    return reply.send({ expense_type: data });
  });
}

const legalEntityBodySchema = z
  .object({
    legal_name: z.string().max(200).optional(),
    trade_name: z.string().max(200).optional(),
    cnpj: z.string().max(18).optional().nullable(),
    state_registration: z.string().max(64).optional().nullable(),
    municipal_registration: z.string().max(64).optional().nullable(),
    tax_regime: z.string().max(64).optional().nullable(),
    address_cep: z.string().max(12).optional().nullable(),
    address_street: z.string().max(200).optional().nullable(),
    address_number: z.string().max(32).optional().nullable(),
    address_neighborhood: z.string().max(120).optional().nullable(),
    address_city: z.string().max(120).optional().nullable(),
    address_state: z.string().max(2).optional().nullable(),
    financial_email: z.string().email().optional().nullable(),
    commercial_email: z.string().email().optional().nullable(),
    phone: z.string().max(32).optional().nullable(),
    bank_code: z.string().max(8).optional().nullable(),
    bank_name: z.string().max(120).optional().nullable(),
    branch_number: z.string().max(16).optional().nullable(),
    account_number: z.string().max(24).optional().nullable(),
    account_digit: z.string().max(4).optional().nullable(),
    account_type: z.enum(['checking', 'savings']).optional().nullable(),
    pix_key: z.string().max(120).optional().nullable(),
    pix_key_type: z.string().max(32).optional().nullable(),
    default_split_coop_pct: z.number().min(0).max(100).optional().nullable(),
    default_split_flux_pct: z.number().min(0).max(100).optional().nullable(),
    flux_service_margin_pct: z.number().min(0).max(100).optional().nullable(),
    invoice_header_notes: z.string().max(4000).optional().nullable(),
    invoice_footer_notes: z.string().max(4000).optional().nullable(),
    logo_storage_path: z.string().max(500).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.default_split_coop_pct != null && val.default_split_flux_pct != null) {
      const err = validateSplitSum(val.default_split_coop_pct, val.default_split_flux_pct);
      if (err) ctx.addIssue({ code: 'custom', message: err });
    }
  });

export async function registerBillingLegalEntityRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/legal-entities', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('billing_legal_entities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('entity_type');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ legal_entities: data || [] });
  });

  app.put('/legal-entities/:entityType', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { entityType } = request.params as { entityType: string };
    if (entityType !== 'coop' && entityType !== 'flux') {
      return reply.status(400).send({ error: 'entityType deve ser coop ou flux' });
    }
    const parsed = legalEntityBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const now = new Date().toISOString();
    const row = { workspace_id: workspaceId, entity_type: entityType, ...parsed.data, updated_at: now };
    const { data, error } = await supabase
      .from('billing_legal_entities')
      .upsert(row, { onConflict: 'workspace_id,entity_type' })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ legal_entity: data });
  });
}
