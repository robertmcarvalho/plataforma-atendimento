import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { addQuotaLedgerEntry, ensureQuotaAccount } from '../../lib/billingQuotaLedger';

function addPeriod(date: Date, frequency: 'weekly' | 'biweekly' | 'monthly', index: number) {
  const d = new Date(date);
  if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7 * index);
  else if (frequency === 'biweekly') d.setUTCDate(d.getUTCDate() + 14 * index);
  else d.setUTCMonth(d.getUTCMonth() + index);
  return d.toISOString().slice(0, 10);
}

function splitCents(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

async function ensureProviderAccount(workspaceId: string, providerId: string) {
  const { data: existing, error: loadErr } = await supabase
    .from('billing_provider_accounts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('provider_id', providerId)
    .maybeSingle();
  if (loadErr) throw new Error(loadErr.message);
  if (existing?.id) return String(existing.id);
  const { data, error } = await supabase
    .from('billing_provider_accounts')
    .insert({ workspace_id: workspaceId, provider_id: providerId })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

async function recalcProviderAccount(workspaceId: string, accountId: string) {
  const { data: rows, error } = await supabase
    .from('billing_provider_account_entries')
    .select('entry_type, amount_cents')
    .eq('workspace_id', workspaceId)
    .eq('account_id', accountId);
  if (error) throw new Error(error.message);
  let advance = 0;
  let service = 0;
  let compensated = 0;
  let paid = 0;
  for (const row of rows || []) {
    const amount = Number(row.amount_cents || 0);
    if (row.entry_type === 'advance') advance += Math.abs(amount);
    else if (row.entry_type === 'service_credit' || row.entry_type === 'reimbursement') service += Math.abs(amount);
    else if (row.entry_type === 'compensation') compensated += Math.abs(amount);
    else if (row.entry_type === 'payment') paid += Math.abs(amount);
  }
  const balance = service - paid - advance + compensated;
  const { error: updErr } = await supabase
    .from('billing_provider_accounts')
    .update({
      advance_open_cents: Math.max(0, advance - compensated),
      service_credit_cents: service,
      compensated_cents: compensated,
      paid_cents: paid,
      balance_cents: balance,
      last_movement_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', accountId);
  if (updErr) throw new Error(updErr.message);
}

export async function registerBillingLedgerRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/quota-accounts', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { driver_id } = request.query as { driver_id?: string };
    let q = supabase
      .from('billing_quota_accounts')
      .select('*, drivers(id, name, cpf, status)')
      .eq('workspace_id', workspaceId)
      .order('balance_cents', { ascending: false });
    if (driver_id) q = q.eq('driver_id', driver_id);
    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ accounts: data || [] });
  });

  app.get('/quota-accounts/:driverId/entries', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { driverId } = request.params as { driverId: string };
    const { data, error } = await supabase
      .from('billing_quota_account_entries')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('driver_id', driverId)
      .order('created_at', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ entries: data || [] });
  });

  app.post('/quota-accounts/:driverId/adjustments', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { driverId } = request.params as { driverId: string };
    const actorId = (request.user as { sub: string }).sub;
    const parsed = z
      .object({
        entry_type: z.enum(['adjustment', 'reversal']),
        amount_cents: z.number().int(),
        description: z.string().max(500).optional().nullable(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    await ensureQuotaAccount(supabase, workspaceId, driverId);
    const result = await addQuotaLedgerEntry(supabase, {
      workspaceId,
      driverId,
      entryType: parsed.data.entry_type,
      amountCents: parsed.data.amount_cents,
      description: parsed.data.description || null,
      actorId,
    });
    return reply.status(201).send(result);
  });

  app.get('/provider-accounts', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { provider_id } = request.query as { provider_id?: string };
    let q = supabase
      .from('billing_provider_accounts')
      .select('*, billing_internal_providers(id, legal_name, default_entity, default_cost_center_id)')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (provider_id) q = q.eq('provider_id', provider_id);
    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ accounts: data || [] });
  });

  app.get('/provider-accounts/:providerId/entries', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { providerId } = request.params as { providerId: string };
    const { data, error } = await supabase
      .from('billing_provider_account_entries')
      .select('*, billing_cost_centers(id, name)')
      .eq('workspace_id', workspaceId)
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ entries: data || [] });
  });

  app.post('/provider-advances', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const actorId = (request.user as { sub: string }).sub;
    const parsed = z
      .object({
        provider_id: z.string().uuid(),
        description: z.string().max(500).optional().nullable(),
        total_cents: z.number().int().positive(),
        installment_count: z.number().int().positive(),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        frequency: z.enum(['weekly', 'biweekly', 'monthly']).default('monthly'),
        cost_center_id: z.string().uuid().optional().nullable(),
        legal_entity_type: z.enum(['coop', 'flux']).default('coop'),
        notes: z.string().max(500).optional().nullable(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const accountId = await ensureProviderAccount(workspaceId, parsed.data.provider_id);
    const { data: schedule, error } = await supabase
      .from('billing_provider_advance_schedules')
      .insert({
        workspace_id: workspaceId,
        account_id: accountId,
        provider_id: parsed.data.provider_id,
        description: parsed.data.description || 'Adiantamento',
        total_cents: parsed.data.total_cents,
        installment_count: parsed.data.installment_count,
        start_date: parsed.data.start_date,
        frequency: parsed.data.frequency,
        cost_center_id: parsed.data.cost_center_id || null,
        legal_entity_type: parsed.data.legal_entity_type,
        notes: parsed.data.notes || null,
        created_by: actorId,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    const amounts = splitCents(parsed.data.total_cents, parsed.data.installment_count);
    const baseDate = new Date(`${parsed.data.start_date}T12:00:00.000Z`);
    const installments = amounts.map((amount, index) => ({
      workspace_id: workspaceId,
      schedule_id: schedule.id,
      provider_id: parsed.data.provider_id,
      installment_number: index + 1,
      amount_cents: amount,
      due_date: addPeriod(baseDate, parsed.data.frequency, index),
    }));
    const { error: instErr } = await supabase.from('billing_provider_advance_installments').insert(installments);
    if (instErr) return reply.status(500).send({ error: instErr.message });

    await supabase.from('billing_provider_account_entries').insert({
      workspace_id: workspaceId,
      account_id: accountId,
      provider_id: parsed.data.provider_id,
      entry_type: 'advance',
      amount_cents: -Math.abs(parsed.data.total_cents),
      cost_center_id: parsed.data.cost_center_id || null,
      legal_entity_type: parsed.data.legal_entity_type,
      description: parsed.data.description || 'Adiantamento',
      metadata: { schedule_id: schedule.id, installment_count: parsed.data.installment_count },
      created_by: actorId,
    });
    await recalcProviderAccount(workspaceId, accountId);
    return reply.status(201).send({ schedule, installments });
  });
}
