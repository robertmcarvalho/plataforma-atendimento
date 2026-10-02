import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import {
  requireFinancialApprove,
  requireFinancialManage,
  requireFinancialCancelAdvance,
} from '../../lib/financialAuth';
import { supabase } from '../../lib/supabase';
import { requireWorkspace } from '../../lib/workspaceContext';
import { OccurrenceKind } from '@plataforma/operational-notes';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { generateInstallments } from '../../lib/financialInstallments';
import {
  buildDefaultRuleForType,
  mergeDiscountRulesFromJson,
  previousClosedCycleMonSun,
} from '../../lib/financialDiscountRules';
import { insertFinancialEntryWithInstallments, computeFinancialEntryFields } from '../../lib/financialEntryFactory';
import { recalculateFinancialEntries } from '../../lib/financialEntryRecalculate';
import {
  isValidSlug,
  loadEntryTypes,
  saveEntryTypes,
} from '../../lib/financialEntryTypes';
import { buildMonthlyDriverSummary, buildWeeklyDriverSummary } from '../../lib/financialSummaries';
import { writeAuditLog } from '../../lib/auditLog';
import { cancelFinancialAdvanceEntry } from '../../lib/financialAdvanceCancel';
import {
  entrySchema,
  recalculateSchema,
  entryPatchSchema,
  discountRulesPutSchema,
  entryTypeCreateSchema,
  entryTypePatchSchema,
  exportFilterSchema,
  financialSummaryQuerySchema,
  financialWeeklySummaryQuerySchema,
  FINANCIAL_ENTRY_COVERAGE_SELECT,
  loadMergedDiscountRules,
  persistDiscountRules,
} from './shared';

export async function registerFinancialWorkflowRoutes(app: FastifyInstance) {
  // POST /api/financial/entries/recalculate — recálculo em massa (regras atuais)
  app.post('/entries/recalculate', { preHandler: [authenticate, requireFinancialManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = recalculateSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    try {
      const result = await recalculateFinancialEntries(supabase, {
        workspace_id: workspaceId,
        dry_run: body.data.dry_run,
        types: body.data.types,
        since: body.data.since,
        limit: body.data.limit,
      });
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha no recálculo' });
    }
  });

  // PATCH /api/financial/entries/:id — edição pelo financeiro
  app.patch('/entries/:id', { preHandler: [authenticate, requireFinancialManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = entryPatchSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const { data: existing, error: loadErr } = await supabase
      .from('financial_entries')
      .select('*, financial_installments(id, status)')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (loadErr || !existing) return reply.status(404).send({ error: 'Lançamento não encontrado' });

    const insts = (existing.financial_installments || []) as Array<{ status: string }>;
    const hasPaid = insts.some((i) => i.status === 'paid');
    const user = request.user as { sub: string };

    if (hasPaid) {
      if (body.data.notes === undefined) {
        return reply.status(400).send({ error: 'Com parcelas baixadas, só é possível editar o motivo/observações.' });
      }
      const { data, error } = await supabase
        .from('financial_entries')
        .update({ notes: body.data.notes, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('id', id)
        .select()
        .single();
      if (error) return reply.status(500).send({ error: error.message });
      return reply.send(data);
    }

    const rules = await loadMergedDiscountRules(workspaceId);
    const createdAt = new Date(String(existing.created_at));
    const nextDriverId = body.data.driver_id ?? String(existing.driver_id);
    const nextPharmacyId = body.data.pharmacy_id ?? String(existing.pharmacy_id || '');
    const nextTotal = body.data.total_amount ?? Number(existing.total_amount);
    const nextCount = body.data.installments_count ?? (Number(existing.installments_count) || 1);
    const nextNotes = body.data.notes !== undefined ? body.data.notes : existing.notes;
    const nextEventDate = body.data.event_date ?? (existing.event_date ? String(existing.event_date).slice(0, 10) : undefined);

    if (body.data.pharmacy_id && body.data.driver_id) {
      const { data: link } = await supabase
        .from('driver_pharmacy_links')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('driver_id', body.data.driver_id)
        .eq('pharmacy_id', body.data.pharmacy_id)
        .eq('is_active', true)
        .maybeSingle();
      const { data: driver } = await supabase
        .from('drivers')
        .select('primary_pharmacy_id')
        .eq('workspace_id', workspaceId)
        .eq('id', body.data.driver_id)
        .maybeSingle();
      const primaryOk = driver?.primary_pharmacy_id === body.data.pharmacy_id;
      if (!link && !primaryOk) {
        return reply.status(400).send({ error: 'Entregador não vinculado à farmácia selecionada.' });
      }
    }

    const computed = computeFinancialEntryFields(
      {
        workspace_id: workspaceId,
        created_by: user.sub,
        driver_id: nextDriverId,
        pharmacy_id: nextPharmacyId,
        type: String(existing.type),
        total_amount: nextTotal,
        installments_count: nextCount,
        frequency: String(existing.frequency || 'weekly'),
        event_date: nextEventDate,
        start_date: existing.start_date ? String(existing.start_date).slice(0, 10) : undefined,
        notes: nextNotes ? String(nextNotes) : null,
        status: String(existing.status),
        created_at_iso: createdAt.toISOString(),
      },
      rules,
      createdAt
    );

    const patch = {
      driver_id: nextDriverId,
      pharmacy_id: nextPharmacyId || existing.pharmacy_id,
      total_amount: nextTotal,
      installments_count: nextCount,
      notes: computed.notes,
      description: computed.description,
      start_date: computed.start_date,
      installment_amount: computed.installment_amount,
      event_date: computed.event_date,
      apuracao_start: computed.apuracao_start,
      apuracao_end: computed.apuracao_end,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: upErr } = await supabase
      .from('financial_entries')
      .update(patch)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (upErr) return reply.status(500).send({ error: upErr.message });

    await supabase.from('financial_installments').delete().eq('entry_id', id).eq('workspace_id', workspaceId);
    const instRows = generateInstallments(
      id,
      computed.start_date,
      nextCount,
      computed.installment_amount,
      String(existing.frequency || 'weekly'),
      String(existing.type || 'other'),
      rules
    ).map(
      (inst) => ({ ...inst, workspace_id: workspaceId })
    );
    if (instRows.length) {
      const { error: instErr } = await supabase.from('financial_installments').insert(instRows);
      if (instErr) return reply.status(500).send({ error: instErr.message });
    }

    await supabase.from('audit_logs').insert({
      workspace_id: workspaceId,
      user_id: user.sub,
      entity_type: 'financial_entry',
      entity_id: id,
      action: 'updated',
      new_data: patch,
    });

    return reply.send(updated);
  });

  // PATCH /api/financial/entries/:id/disposition — abonar ou descontar falta (unexcused)
  app.patch('/entries/:id/disposition', { preHandler: [authenticate, requireFinancialManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const schema = z.object({
      action: z.enum(['excused', 'discounted']),
      discount_amount: z.number().nonnegative().optional(),
      notes: z.string().optional(),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const user = request.user as { sub: string };

    try {
      const { applyAbsenceDisposition } = await import('../../lib/absenceDisposition.js');
      const updated = await applyAbsenceDisposition(supabase, {
        workspace_id: workspaceId,
        entry_id: id,
        actor_id: user.sub,
        action: body.data.action,
        discount_amount: body.data.discount_amount,
        notes: body.data.notes,
      });

      await writeAuditLog({
        actor_id: user.sub,
        action: 'financial.absence.disposition',
        entity_type: 'financial_entry',
        entity_id: id,
        workspace_id: workspaceId,
        metadata: {
          disposition: body.data.action,
          discount_amount: body.data.discount_amount ?? null,
        },
      });

      return reply.send(updated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao registrar decisão';
      const status = msg.includes('não') || msg.includes('Informe') || msg.includes('Folga') ? 400 : 500;
      return reply.status(status).send({ error: msg });
    }
  });

  app.patch('/entries/:id/daily-billing', { preHandler: [authenticate, requireFinancialManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const user = request.user as { sub: string };
    const schema = z.object({
      treatment: z.enum(['charge_pharmacy', 'absorb_operation', 'pending_audit']),
      pharmacy_charge_amount: z.number().nonnegative().optional().nullable(),
      notes: z.string().max(1000).optional().nullable(),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const { data: existing, error: loadErr } = await supabase
      .from('financial_entries')
      .select('id, type, total_amount')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (loadErr) return reply.status(500).send({ error: loadErr.message });
    if (!existing) return reply.status(404).send({ error: 'Lançamento não encontrado' });
    if (existing.type !== 'daily') {
      return reply.status(400).send({ error: 'Decisão de faturamento disponível apenas para diárias.' });
    }

    const shouldCharge = body.data.treatment === 'charge_pharmacy';
    const chargeAmount = shouldCharge
      ? Number(body.data.pharmacy_charge_amount ?? existing.total_amount ?? 0)
      : null;
    if (shouldCharge && !((chargeAmount ?? 0) > 0)) {
      return reply.status(400).send({ error: 'Informe o valor a cobrar da farmácia.' });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('financial_entries')
      .update({
        daily_billing_treatment: body.data.treatment,
        daily_pharmacy_charge_amount: chargeAmount,
        daily_billing_decided_by: user.sub,
        daily_billing_decided_at: now,
        daily_billing_notes: body.data.notes?.trim() || null,
        updated_at: now,
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    await writeAuditLog({
      actor_id: user.sub,
      action: 'financial.daily_billing.decide',
      entity_type: 'financial_entry',
      entity_id: id,
      workspace_id: workspaceId,
      metadata: {
        treatment: body.data.treatment,
        pharmacy_charge_amount: chargeAmount,
      },
    });

    return reply.send(data);
  });

  // PATCH /api/financial/entries/:id/submit — enviar para aprovação
  app.patch('/entries/:id/submit', { preHandler: [authenticate, requireFinancialManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('financial_entries').update({ status: 'pending_approval', updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).eq('status', 'draft').select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // PATCH /api/financial/entries/:id/approve — aprovar
  app.patch('/entries/:id/approve', { preHandler: [authenticate, requireFinancialApprove] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const user = request.user as { sub: string };
    const { data, error } = await supabase
      .from('financial_entries')
      .update({ status: 'active', approved_by: user.sub, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).eq('status', 'pending_approval').select().single();
    if (error) return reply.status(500).send({ error: error.message });
    await supabase.from('audit_logs').insert({
      workspace_id: workspaceId,
      user_id: user.sub, entity_type: 'financial_entry', entity_id: id,
      action: 'approved', new_data: { status: 'active' },
    });
    return reply.send(data);
  });

  // PATCH /api/financial/entries/:id/reject — rejeitar
  app.patch('/entries/:id/reject', { preHandler: [authenticate, requireFinancialApprove] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { rejection_reason } = request.body as { rejection_reason: string };
    const user = request.user as { sub: string };
    const { data, error } = await supabase
      .from('financial_entries')
      .update({
        status: 'rejected',
        rejection_reason,
        approved_by: null,
        approved_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .eq('status', 'pending_approval')
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    await supabase.from('audit_logs').insert({
      workspace_id: workspaceId,
      user_id: user.sub, entity_type: 'financial_entry', entity_id: id,
      action: 'rejected', new_data: { status: 'rejected', rejection_reason },
    });
    return reply.send(data);
  });

  // POST /api/financial/entries/:id/cancel — cancelar parcelas pendentes de adiantamento
  app.post('/entries/:id/cancel', { preHandler: [authenticate, requireFinancialCancelAdvance] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason?: string };
    const user = request.user as { sub: string };
    try {
      const result = await cancelFinancialAdvanceEntry(supabase, {
        workspaceId,
        entryId: id,
        reason: String(reason || ''),
        actorId: user.sub,
      });
      const { data: entry, error } = await supabase
        .from('financial_entries')
        .select(`
          *,
          drivers(id, name, cpf, phone),
          created_by_user:users!created_by(id, name),
          cancelled_by_user:users!cancelled_by(id, name),
          financial_installments(id, installment_number, amount, due_date, status, paid_at)
        `)
        .eq('workspace_id', workspaceId)
        .eq('id', id)
        .single();
      if (error) return reply.status(500).send({ error: error.message });
      return reply.send({ ...result, entry });
    } catch (e) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : 'Falha ao cancelar lançamento' });
    }
  });

  // GET /api/financial/installments — parcelas com filtros

}
