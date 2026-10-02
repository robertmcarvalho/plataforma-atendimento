import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { supabase } from '../../lib/supabase';
import { requireWorkspace } from '../../lib/workspaceContext';
import { generateInstallments } from '../../lib/financialInstallments';
import { generateInstallmentDueDates, getRuleForType } from '@plataforma/financial-cycle';
import { isOpenInstallmentStatus } from '../../lib/financialEntryStatus';
import { syncQuotaInstallmentPayment } from '../../lib/billingQuotaLedger';
import { loadMergedDiscountRules } from './shared';

export async function registerFinancialInstallmentRoutes(app: FastifyInstance) {
  app.get('/installments/preview', { preHandler: [authenticate, requireFinancialView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { type, start_date, count, amount, frequency } = request.query as Record<string, string>;
    const entryType = String(type || 'advance').trim();
    const cycleBase = String(start_date || '').slice(0, 10);
    const installmentsCount = Math.max(1, parseInt(String(count || '1'), 10) || 1);
    const totalAmount = Number(amount || 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cycleBase)) {
      return reply.status(400).send({ error: 'start_date inválida (YYYY-MM-DD)' });
    }
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return reply.status(400).send({ error: 'amount deve ser positivo' });
    }

    const rules = await loadMergedDiscountRules(workspaceId);
    const rule = getRuleForType(entryType, rules);
    const dueDates = generateInstallmentDueDates(
      rule,
      cycleBase,
      installmentsCount,
      frequency || 'weekly'
    );
    const installmentAmount = Number((totalAmount / installmentsCount).toFixed(2));
    return reply.send({
      cycle_base_date: cycleBase,
      first_discount_date: dueDates[0] || null,
      installment_amount: installmentAmount,
      installments: dueDates.map((due_date, index) => ({
        number: index + 1,
        due_date,
        amount: installmentAmount,
      })),
    });
  });

  app.get('/installments', { preHandler: [authenticate, requireFinancialView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { status, due_start, due_end, driver_id } = request.query as Record<string, string>;
    let query = supabase
      .from('financial_installments')
      .select(`
        *,
        financial_entries(
          id, type, description, driver_id, pharmacy_id,
          drivers(id, name, cpf, phone),
          pharmacies(id, trade_name)
        ),
        paid_by_user:users!paid_by(id, name)
      `)
      .eq('workspace_id', workspaceId)
      .order('due_date');
    if (status) query = query.eq('status', status);
    if (due_start) query = query.gte('due_date', due_start);
    if (due_end) query = query.lte('due_date', due_end);
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });

    // Filtro em memória por driver_id (via join aninhado)
    const filtered = driver_id
      ? data?.filter((i: { financial_entries: { driver_id: string } }) => i.financial_entries?.driver_id === driver_id)
      : data;
    return reply.send(filtered);
  });

  // PATCH /api/financial/installments/:id/pay — dar baixa em parcela
  app.patch('/installments/:id/pay', { preHandler: [authenticate, requireFinancialManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { notes } = request.body as { notes?: string };
    const user = request.user as { sub: string };

    const { data: before } = await supabase.from('financial_installments').select('*').eq('workspace_id', workspaceId).eq('id', id).single();
    if (!before) return reply.status(404).send({ error: 'Parcela não encontrada' });
    if (!isOpenInstallmentStatus(before.status)) {
      return reply.status(400).send({ error: 'Parcela já quitada ou cancelada' });
    }
    const { data, error } = await supabase
      .from('financial_installments')
      .update({ status: 'paid', paid_at: new Date().toISOString(), paid_by: user.sub, notes: notes || null })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .in('status', ['pending', 'overdue'])
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    await supabase.from('audit_logs').insert({
      workspace_id: workspaceId,
      user_id: user.sub, entity_type: 'financial_installment', entity_id: id,
      action: 'paid', old_data: before, new_data: data,
    });

    // Verifica se todas as parcelas estão pagas e atualiza entry para 'settled'
    const { data: entry } = await supabase.from('financial_installments')
      .select('status').eq('workspace_id', workspaceId).eq('entry_id', data.entry_id);
    const allPaid = entry?.every((i: { status: string }) => i.status === 'paid');
    if (allPaid) {
      await supabase.from('financial_entries').update({ status: 'settled', updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', data.entry_id);
    }

    try {
      await syncQuotaInstallmentPayment(supabase, { workspaceId, installmentId: id, actorId: user.sub });
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Parcela baixada, mas falhou a sincronização da conta de cotas.',
      });
    }

    return reply.send(data);
  });


}
