import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { previousClosedCycleMonSun } from '@plataforma/financial-cycle';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import {
  assignDeliveriesToCycle,
  formatCycleLabel,
  recalculateCycleSettlements,
} from '../../lib/billingSettlementEngine';

const cycleBodySchema = z.object({
  apuracao_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  apuracao_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  label: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const cycleRecalculateSchema = z.object({
  pharmacy_id: z.string().uuid().optional(),
});

function validateMondaySundayCycle(apuracaoStart: string, apuracaoEnd: string): string | null {
  const start = new Date(`${apuracaoStart}T12:00:00.000Z`);
  const end = new Date(`${apuracaoEnd}T12:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Período de apuração inválido.';
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (start.getUTCDay() !== 1) return 'O ciclo deve iniciar em uma segunda-feira.';
  if (end.getUTCDay() !== 0) return 'O ciclo deve finalizar em um domingo.';
  if (diffDays !== 6) return 'O ciclo deve ter exatamente 7 dias, de segunda a domingo.';
  return null;
}

export async function registerBillingCycleRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/cycles', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const { data, error } = await supabase
      .from('billing_cycles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('apuracao_start', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ cycles: data || [] });
  });

  app.get('/cycles/suggested', { preHandler: [...preView] }, async (request, reply) => {
    const ref = String((request.query as { reference_date?: string }).reference_date || '').slice(0, 10);
    const paymentDate = ref || new Date().toISOString().slice(0, 10);
    const bounds = previousClosedCycleMonSun(paymentDate);
    return reply.send({
      apuracao_start: bounds.startDate,
      apuracao_end: bounds.endDate,
      payment_date: paymentDate,
      label: formatCycleLabel(bounds.startDate, bounds.endDate),
    });
  });

  app.post('/cycles', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = cycleBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    if (parsed.data.apuracao_end < parsed.data.apuracao_start) {
      return reply.status(400).send({ error: 'apuracao_end deve ser >= apuracao_start' });
    }
    const cycleError = validateMondaySundayCycle(parsed.data.apuracao_start, parsed.data.apuracao_end);
    if (cycleError) return reply.status(400).send({ error: cycleError });

    const label = parsed.data.label?.trim() || formatCycleLabel(parsed.data.apuracao_start, parsed.data.apuracao_end);
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('billing_cycles')
      .insert({
        workspace_id: workspaceId,
        label,
        apuracao_start: parsed.data.apuracao_start,
        apuracao_end: parsed.data.apuracao_end,
        payment_date: parsed.data.payment_date || null,
        notes: parsed.data.notes?.trim() || null,
        status: 'open',
        updated_at: now,
      })
      .select()
      .single();
    if (error) {
      if (String(error.message).includes('billing_cycles_workspace_range_unique')) {
        return reply.status(409).send({ error: 'Já existe ciclo com este intervalo de apuração.' });
      }
      return reply.status(500).send({ error: error.message });
    }

    const assigned = await assignDeliveriesToCycle(
      workspaceId,
      data.id,
      parsed.data.apuracao_start,
      parsed.data.apuracao_end
    );

    return reply.status(201).send({ cycle: data, deliveries_assigned: assigned });
  });

  app.post('/cycles/:id/close', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;
    const now = new Date().toISOString();

    const { data: existing, error: loadErr } = await supabase
      .from('billing_cycles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (loadErr) return reply.status(500).send({ error: loadErr.message });
    if (!existing) return reply.status(404).send({ error: 'Ciclo não encontrado' });
    if (existing.status === 'closed') return reply.status(409).send({ error: 'Ciclo já fechado' });

    let result: { settlements: number };
    try {
      await assignDeliveriesToCycle(
        workspaceId,
        id,
        String(existing.apuracao_start).slice(0, 10),
        String(existing.apuracao_end).slice(0, 10)
      );
      result = await recalculateCycleSettlements(workspaceId, id);
    } catch (err) {
      return reply.status(409).send({
        error: err instanceof Error ? err.message : 'Não foi possível recalcular o ciclo com segurança.',
      });
    }

    const { data, error } = await supabase
      .from('billing_cycles')
      .update({ status: 'closed', closed_at: now, closed_by: actorId, updated_at: now })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ cycle: data, settlements_generated: result.settlements });
  });

  /** Re-link null-cycle deliveries in the cycle apuracao window (e.g. after Flux import). */
  app.post('/cycles/:id/assign-deliveries', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { data: existing, error: loadErr } = await supabase
      .from('billing_cycles')
      .select('id, apuracao_start, apuracao_end, status')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (loadErr) return reply.status(500).send({ error: loadErr.message });
    if (!existing) return reply.status(404).send({ error: 'Ciclo não encontrado' });

    try {
      const assigned = await assignDeliveriesToCycle(
        workspaceId,
        id,
        String(existing.apuracao_start).slice(0, 10),
        String(existing.apuracao_end).slice(0, 10)
      );
      return reply.send({ ok: true, deliveries_assigned: assigned, cycle_status: existing.status });
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Falha ao vincular entregas ao ciclo.',
      });
    }
  });

  app.post('/cycles/:id/recalculate', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = cycleRecalculateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Parâmetros de recálculo inválidos' });

    const { data: existing } = await supabase
      .from('billing_cycles')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (!existing) return reply.status(404).send({ error: 'Ciclo não encontrado' });

    let result: { settlements: number };
    try {
      result = await recalculateCycleSettlements(workspaceId, id, {
        pharmacyId: parsed.data.pharmacy_id,
      });
    } catch (err) {
      return reply.status(409).send({
        error: err instanceof Error ? err.message : 'Não foi possível recalcular o ciclo com segurança.',
      });
    }
    return reply.send({ ok: true, settlements: result.settlements, pharmacy_id: parsed.data.pharmacy_id || null });
  });
}
