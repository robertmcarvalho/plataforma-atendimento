import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import {
  assertSettlementReopenClear,
  recalculateCycleSettlements,
  reopenPharmacyCycleSettlements,
  reverseSettlementArtifacts,
} from '../../lib/billingSettlementEngine';
import { addPharmacyManualDiscount } from '../../lib/billingSettlementManualDiscount';
import {
  addSettlementExclusion,
  loadSettlementExclusions,
} from '../../lib/billingSettlementExclusions';
import { loadDayBaseDayOverlays, upsertDayBaseDay } from '../../lib/billingSettlementDayBase';
import { loadMgOverlays, parseMgMultiplier, upsertMgOverlay } from '../../lib/billingSettlementMgOverlay';
import {
  approvePharmacyCycleSettlements,
  runSettlementApprovalSideEffects,
} from '../../lib/billingSettlementApproval';

const statusSchema = z.enum(['open', 'in_review', 'approved', 'paid']);

const transitionSchema = z.object({
  action: z.enum(['submit_review', 'approve', 'mark_paid', 'reopen']),
});

const pharmacyManualDiscountSchema = z.object({
  amount_cents: z.number().int().positive(),
  justification: z.string().trim().min(3).max(500),
});

const pharmacyExclusionSchema = z.object({
  driver_id: z.string().uuid(),
  scope: z.enum(['driver', 'line']),
  justification: z.string().trim().min(3).max(500),
  line_kind: z.enum(['deliveries', 'minimum_guarantee', 'daily']).optional(),
  line_fingerprint: z.string().max(120).optional(),
  line_id: z.string().uuid().optional(),
  settlement_id: z.string().uuid().optional(),
  pharmacy_amount_cents_before: z.number().int().optional(),
  driver_amount_cents_before: z.number().int().optional(),
});

const dayBaseDaySchema = z.object({
  driver_id: z.string().uuid(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_cents: z.number().int().min(0),
  active: z.boolean().optional(),
});

const mgOverlaySchema = z.object({
  driver_id: z.string().uuid(),
  multiplier: z.union([z.literal(0.5), z.literal(1), z.literal(2)]),
  justification: z.string().trim().min(3).max(500),
});

const recalculateSchema = z.object({
  cycle_id: z.string().uuid(),
  pharmacy_id: z.string().uuid().optional(),
});

const SETTLEMENT_TRANSITIONS: Record<string, { from: string[]; to: string; fields: Record<string, unknown> }> = {
  submit_review: { from: ['open'], to: 'in_review', fields: {} },
  approve: { from: ['in_review'], to: 'approved', fields: {} },
  mark_paid: { from: ['approved'], to: 'paid', fields: {} },
  reopen: { from: ['in_review', 'approved'], to: 'open', fields: {} },
};

export async function registerBillingSettlementRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/settlements', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const q = request.query as { cycle_id?: string; status?: string };
    let query = supabase
      .from('billing_settlements')
      .select(
        '*, drivers(id, name, primary_pharmacy_id, driver_pharmacy_links(is_active, pharmacy_id)), pharmacies(id, trade_name, legal_name, billing_cost_center_id, billing_cost_centers!billing_cost_center_id(name)), billing_cycles(id, label, apuracao_start, apuracao_end, status), billing_settlement_lines(*)'
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (q.cycle_id) query = query.eq('billing_cycle_id', q.cycle_id);
    if (q.status) {
      const parsed = statusSchema.safeParse(q.status);
      if (parsed.success) query = query.eq('status', parsed.data);
    }

    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ settlements: data || [] });
  });

  app.get('/settlements/:id', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
      .from('billing_settlements')
      .select(
        '*, drivers(id, name, primary_pharmacy_id, driver_pharmacy_links(is_active, pharmacy_id)), pharmacies(id, trade_name, legal_name, billing_cost_center_id, billing_cost_centers!billing_cost_center_id(name)), billing_cycles(id, label, apuracao_start, apuracao_end, status), billing_settlement_lines(*)'
      )
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Acerto não encontrado' });
    return reply.send({ settlement: data });
  });

  app.post(
    '/cycles/:cycleId/pharmacies/:pharmacyId/manual-discounts',
    { preHandler: [...preManage] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { cycleId, pharmacyId } = request.params as { cycleId: string; pharmacyId: string };
      const parsed = pharmacyManualDiscountSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Dados de desconto inválidos' });

      const actorId = (request.user as { sub: string }).sub;
      try {
        const result = await addPharmacyManualDiscount({
          workspaceId,
          cycleId,
          pharmacyId,
          actorId,
          amountCents: parsed.data.amount_cents,
          justification: parsed.data.justification,
        });
        const { data: settlements, error } = await supabase
          .from('billing_settlements')
          .select(
            '*, drivers(id, name, primary_pharmacy_id, driver_pharmacy_links(is_active, pharmacy_id)), pharmacies(id, trade_name, legal_name, billing_cost_center_id, billing_cost_centers!billing_cost_center_id(name)), billing_cycles(id, label, apuracao_start, apuracao_end, status), billing_settlement_lines(*)'
          )
          .eq('workspace_id', workspaceId)
          .eq('billing_cycle_id', cycleId)
          .eq('pharmacy_id', pharmacyId);
        if (error) return reply.status(500).send({ error: error.message });
        return reply.status(201).send({
          line_id: result.line_id,
          settlement_id: result.settlement_id,
          settlements: settlements || [],
        });
      } catch (err) {
        return reply.status(409).send({
          error: err instanceof Error ? err.message : 'Não foi possível aplicar o desconto manual.',
        });
      }
    }
  );

  app.get(
    '/cycles/:cycleId/pharmacies/:pharmacyId/settlement-exclusions',
    { preHandler: [...preView] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { cycleId, pharmacyId } = request.params as { cycleId: string; pharmacyId: string };
      try {
        const exclusions = await loadSettlementExclusions(workspaceId, cycleId, pharmacyId);
        return reply.send({ exclusions });
      } catch (err) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : 'Não foi possível carregar as exclusões.',
        });
      }
    }
  );

  app.post(
    '/cycles/:cycleId/pharmacies/:pharmacyId/settlement-exclusions',
    { preHandler: [...preManage] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { cycleId, pharmacyId } = request.params as { cycleId: string; pharmacyId: string };
      const parsed = pharmacyExclusionSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Dados de exclusão inválidos' });

      const actorId = (request.user as { sub: string }).sub;
      try {
        const result = await addSettlementExclusion({
          workspaceId,
          cycleId,
          pharmacyId,
          driverId: parsed.data.driver_id,
          actorId,
          scope: parsed.data.scope,
          justification: parsed.data.justification,
          lineKind: parsed.data.line_kind || null,
          lineFingerprint: parsed.data.line_fingerprint || null,
          pharmacyAmountCentsBefore: parsed.data.pharmacy_amount_cents_before || 0,
          driverAmountCentsBefore: parsed.data.driver_amount_cents_before || 0,
          settlementId: parsed.data.settlement_id || null,
          lineId: parsed.data.line_id || null,
        });
        const recalc = await recalculateCycleSettlements(workspaceId, cycleId, { pharmacyId });
        return reply.status(201).send({
          id: result.id,
          settlements_recalculated: recalc.settlements,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Não foi possível excluir do acerto.';
        const status = message.includes('Justificativa')
          ? 400
          : message.includes('já existe') || message.includes('aprovado')
            ? 409
            : 500;
        return reply.status(status).send({ error: message });
      }
    }
  );

  app.get(
    '/cycles/:cycleId/pharmacies/:pharmacyId/day-base-days',
    { preHandler: [...preView] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { cycleId, pharmacyId } = request.params as { cycleId: string; pharmacyId: string };
      try {
        const days = await loadDayBaseDayOverlays(workspaceId, cycleId, pharmacyId);
        return reply.send({ days });
      } catch (err) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : 'Não foi possível carregar a diária-base.',
        });
      }
    }
  );

  app.post(
    '/cycles/:cycleId/pharmacies/:pharmacyId/day-base-days',
    { preHandler: [...preManage] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { cycleId, pharmacyId } = request.params as { cycleId: string; pharmacyId: string };
      const parsed = dayBaseDaySchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Dados de diária-base inválidos' });
      const actorId = (request.user as { sub: string }).sub;
      try {
        const result = await upsertDayBaseDay({
          workspaceId,
          cycleId,
          pharmacyId,
          driverId: parsed.data.driver_id,
          eventDate: parsed.data.event_date,
          amountCents: parsed.data.amount_cents,
          actorId,
          active: parsed.data.active,
        });
        const recalc = await recalculateCycleSettlements(workspaceId, cycleId, { pharmacyId });
        return reply.status(201).send({ id: result.id, settlements_recalculated: recalc.settlements });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Não foi possível salvar a diária-base.';
        const status = message.includes('aprovado') || message.includes('não encontrado') ? 409 : 500;
        return reply.status(status).send({ error: message });
      }
    }
  );

  app.get(
    '/cycles/:cycleId/pharmacies/:pharmacyId/mg-overlays',
    { preHandler: [...preView] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { cycleId, pharmacyId } = request.params as { cycleId: string; pharmacyId: string };
      try {
        const overlays = await loadMgOverlays(workspaceId, cycleId, pharmacyId);
        return reply.send({ overlays });
      } catch (err) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : 'Não foi possível carregar os overlays de MG.',
        });
      }
    }
  );

  app.post(
    '/cycles/:cycleId/pharmacies/:pharmacyId/mg-overlays',
    { preHandler: [...preManage] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { cycleId, pharmacyId } = request.params as { cycleId: string; pharmacyId: string };
      const parsed = mgOverlaySchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Dados de multiplicador MG inválidos' });
      const multiplier = parseMgMultiplier(parsed.data.multiplier);
      if (!multiplier) return reply.status(400).send({ error: 'Multiplicador inválido' });
      const actorId = (request.user as { sub: string }).sub;
      try {
        const result = await upsertMgOverlay({
          workspaceId,
          cycleId,
          pharmacyId,
          driverId: parsed.data.driver_id,
          multiplier,
          justification: parsed.data.justification,
          actorId,
        });
        const recalc = await recalculateCycleSettlements(workspaceId, cycleId, { pharmacyId });
        return reply.status(201).send({ id: result.id, settlements_recalculated: recalc.settlements });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Não foi possível salvar o multiplicador de MG.';
        const status = message.includes('Justificativa')
          ? 400
          : message.includes('aprovado') || message.includes('não encontrado')
            ? 409
            : 500;
        return reply.status(status).send({ error: message });
      }
    }
  );

  app.post('/settlements/:id/transition', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = transitionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Ação inválida' });

    const actorId = (request.user as { sub: string }).sub;
    const now = new Date().toISOString();
    const rule = SETTLEMENT_TRANSITIONS[parsed.data.action];
    if (!rule) return reply.status(400).send({ error: 'Transição desconhecida' });

    const { data: existing, error: loadErr } = await supabase
      .from('billing_settlements')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (loadErr) return reply.status(500).send({ error: loadErr.message });
    if (!existing) return reply.status(404).send({ error: 'Acerto não encontrado' });
    if (!rule.from.includes(String(existing.status))) {
      return reply.status(409).send({ error: `Não é possível ${parsed.data.action} a partir de ${existing.status}` });
    }

    if (parsed.data.action === 'reopen') {
      try {
        await assertSettlementReopenClear(workspaceId, {
          id: String(existing.id),
          billing_cycle_id: String(existing.billing_cycle_id),
          pharmacy_id: String(existing.pharmacy_id),
          driver_id: String(existing.driver_id),
        });
      } catch (err) {
        return reply.status(409).send({
          error: err instanceof Error ? err.message : 'Não é possível estornar os efeitos financeiros do acerto.',
        });
      }
    }

    const patch: Record<string, unknown> = { status: rule.to, updated_at: now, ...rule.fields };
    if (parsed.data.action === 'submit_review') {
      patch.submitted_at = now;
      patch.submitted_by = actorId;
    }
    if (parsed.data.action === 'approve') {
      patch.approved_at = now;
      patch.approved_by = actorId;
    }
    if (parsed.data.action === 'mark_paid') {
      patch.paid_at = now;
    }
    if (parsed.data.action === 'reopen') {
      patch.submitted_at = null;
      patch.submitted_by = null;
      patch.approved_at = null;
      patch.approved_by = null;
    }

    const { data, error } = await supabase
      .from('billing_settlements')
      .update(patch)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    let invoicesRemoved = 0;
    let payablesResynced = 0;
    let ledgerEntriesRemoved = 0;
    if (parsed.data.action === 'reopen') {
      try {
        const reversal = await reverseSettlementArtifacts(workspaceId, {
          id: String(existing.id),
          billing_cycle_id: String(existing.billing_cycle_id),
          pharmacy_id: String(existing.pharmacy_id),
          driver_id: String(existing.driver_id),
        });
        invoicesRemoved = reversal.invoices_removed;
        payablesResynced = reversal.payables_resynced;
        ledgerEntriesRemoved = reversal.ledger_entries_removed;
      } catch (err) {
        return reply.status(409).send({
          error: err instanceof Error ? err.message : 'Não foi possível estornar os efeitos financeiros do acerto.',
        });
      }
    }

    return reply.send({
      settlement: data,
      invoices_removed: invoicesRemoved || undefined,
      payables_resynced: payablesResynced || undefined,
      ledger_entries_removed: ledgerEntriesRemoved || undefined,
    });
  });

  app.post('/cycles/:cycleId/settlements/submit-all', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { cycleId } = request.params as { cycleId: string };
    const actorId = (request.user as { sub: string }).sub;
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('billing_settlements')
      .update({ status: 'in_review', submitted_at: now, submitted_by: actorId, updated_at: now })
      .eq('workspace_id', workspaceId)
      .eq('billing_cycle_id', cycleId)
      .eq('status', 'open')
      .select('id');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ updated: (data || []).length });
  });

  app.post(
    '/cycles/:cycleId/pharmacies/:pharmacyId/settlements/approve',
    { preHandler: [...preManage] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { cycleId, pharmacyId } = request.params as { cycleId: string; pharmacyId: string };
      const actorId = (request.user as { sub: string }).sub;

      try {
        const result = await approvePharmacyCycleSettlements({
          workspaceId,
          cycleId,
          pharmacyId,
          actorId,
        });
        return reply.send(result);
      } catch (err) {
        return reply.status(409).send({
          error: err instanceof Error ? err.message : 'Não foi possível aprovar os acertos da farmácia.',
        });
      }
    }
  );

  app.post(
    '/cycles/:cycleId/pharmacies/:pharmacyId/settlements/reopen',
    { preHandler: [...preManage] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { cycleId, pharmacyId } = request.params as { cycleId: string; pharmacyId: string };

      try {
        const result = await reopenPharmacyCycleSettlements({
          workspaceId,
          cycleId,
          pharmacyId,
        });
        return reply.send(result);
      } catch (err) {
        return reply.status(409).send({
          error: err instanceof Error ? err.message : 'Não foi possível estornar os acertos da farmácia.',
        });
      }
    }
  );

  app.post('/cycles/:cycleId/settlements/approve-all', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { cycleId } = request.params as { cycleId: string };
    const actorId = (request.user as { sub: string }).sub;
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('billing_settlements')
      .update({ status: 'approved', approved_at: now, approved_by: actorId, updated_at: now })
      .eq('workspace_id', workspaceId)
      .eq('billing_cycle_id', cycleId)
      .eq('status', 'in_review')
      .select('id');
    if (error) return reply.status(500).send({ error: error.message });

    const sideEffects = await runSettlementApprovalSideEffects({
      workspaceId,
      cycleId,
      actorId,
    });

    return reply.send({
      updated: (data || []).length,
      ...sideEffects,
    });
  });

  app.post('/settlements/recalculate', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = recalculateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'cycle_id obrigatório' });

    let result: { settlements: number };
    try {
      result = await recalculateCycleSettlements(workspaceId, parsed.data.cycle_id, {
        pharmacyId: parsed.data.pharmacy_id,
      });
    } catch (err) {
      return reply.status(409).send({
        error: err instanceof Error ? err.message : 'Não foi possível recalcular os acertos com segurança.',
      });
    }
    return reply.send({ ok: true, settlements: result.settlements, pharmacy_id: parsed.data.pharmacy_id || null });
  });
}
