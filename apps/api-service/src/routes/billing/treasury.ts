import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import {
  requireFinancialManage,
  requireFinancialReconcile,
  requireFinancialView,
} from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { generateDriverPayablesFromCycle } from '../../lib/billingPayablesEngine';
import {
  autoReconcileImportedMovements,
  getTreasurySummary,
  importBankMovements,
  parseBankStatement,
  reconcileBankMovement,
  resolveBankStatementFormat,
  summarizeBankMovementRows,
  takeMovementsForAutoReconcile,
} from '../../lib/billingTreasuryEngine';

const bankAccountSchema = z.object({
  legal_entity_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  bank_code: z.string().max(8).optional().nullable(),
  bank_name: z.string().max(120).optional().nullable(),
  branch_number: z.string().max(16).optional().nullable(),
  account_number: z.string().max(24).optional().nullable(),
  account_digit: z.string().max(4).optional().nullable(),
  account_type: z.enum(['checking', 'savings']).optional().nullable(),
  pix_key: z.string().max(120).optional().nullable(),
  pix_key_type: z.string().max(32).optional().nullable(),
  is_default: z.boolean().default(false),
  active: z.boolean().default(true),
  pix_export_template: z
    .enum(['generic', 'itau', 'bradesco', 'santander', 'bb', 'inter', 'nubank', 'c6'])
    .default('generic'),
  notes: z.string().max(500).optional().nullable(),
});

const manualSettlementSchema = z.object({
  target_type: z.enum(['invoice', 'payable']),
  target_id: z.string().uuid(),
  notes: z.string().max(500).optional().nullable(),
});

export async function registerBillingTreasuryRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;
  const preReconcile = [authenticate, requireBillingModule, requireFinancialReconcile] as const;

  app.get('/treasury/summary', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const bankAccountId = (request.query as { bank_account_id?: string }).bank_account_id;
    try {
      const summary = await getTreasurySummary(workspaceId, bankAccountId);
      return reply.send(summary);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/bank-accounts', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as { legal_entity_id?: string; active?: string };
    let query = supabase
      .from('billing_bank_accounts')
      .select('*, legal_entity:billing_legal_entities!legal_entity_id(entity_type, legal_name, trade_name)')
      .eq('workspace_id', workspaceId)
      .order('name');
    if (q.legal_entity_id) query = query.eq('legal_entity_id', q.legal_entity_id);
    if (q.active === '1') query = query.eq('active', true);
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ bank_accounts: data || [] });
  });

  app.post('/bank-accounts', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = bankAccountSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    if (parsed.data.is_default) {
      await supabase
        .from('billing_bank_accounts')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('legal_entity_id', parsed.data.legal_entity_id);
    }

    const { data, error } = await supabase
      .from('billing_bank_accounts')
      .insert({ workspace_id: workspaceId, ...parsed.data, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send({ bank_account: data });
  });

  app.patch('/bank-accounts/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = bankAccountSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos' });

    if (parsed.data.is_default) {
      let legalEntityId = parsed.data.legal_entity_id;
      if (!legalEntityId) {
        const { data: current } = await supabase
          .from('billing_bank_accounts')
          .select('legal_entity_id')
          .eq('workspace_id', workspaceId)
          .eq('id', id)
          .maybeSingle();
        legalEntityId = current?.legal_entity_id || undefined;
      }
      if (legalEntityId) {
        await supabase
          .from('billing_bank_accounts')
          .update({ is_default: false, updated_at: new Date().toISOString() })
          .eq('workspace_id', workspaceId)
          .eq('legal_entity_id', legalEntityId)
          .neq('id', id);
      }
    }

    const { data, error } = await supabase
      .from('billing_bank_accounts')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select('*, legal_entity:billing_legal_entities!legal_entity_id(entity_type, legal_name, trade_name)')
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Conta não encontrada' });
    return reply.send({ bank_account: data });
  });

  app.get('/bank-movements', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as { bank_account_id?: string; reconciled?: string };
    let query = supabase
      .from('billing_bank_movements')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('movement_date', { ascending: false })
      .limit(2000);
    if (q.bank_account_id) query = query.eq('bank_account_id', q.bank_account_id);
    if (q.reconciled === '0') query = query.eq('reconciled', false);
    if (q.reconciled === '1') query = query.eq('reconciled', true);
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ movements: data || [] });
  });

  app.get('/payments', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as { bank_account_id?: string; reconciled?: string };
    let query = supabase
      .from('billing_payments')
      .select(`
        id,
        amount_cents,
        paid_at,
        payment_method,
        payable_id,
        invoice_id,
        legal_entity_id,
        bank_account_id,
        reconciled,
        reconciled_at,
        notes,
        created_by,
        reconciled_by,
        created_by_user:users!created_by(id, name),
        reconciled_by_user:users!reconciled_by(id, name),
        billing_invoices(
          id,
          due_date,
          total_cents,
          pharmacies(id, trade_name, legal_name)
        ),
        billing_payables(
          id,
          description,
          due_date,
          beneficiary_type,
          beneficiary_id,
          legal_entity_type,
          category,
          origin_type
        )
      `)
      .eq('workspace_id', workspaceId)
      .order('paid_at', { ascending: false })
      .limit(200);
    if (q.bank_account_id) query = query.eq('bank_account_id', q.bank_account_id);
    if (q.reconciled === '0') query = query.eq('reconciled', false);
    if (q.reconciled === '1') query = query.eq('reconciled', true);
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ payments: data || [] });
  });

  app.get('/payments/unreconciled', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('billing_payments')
      .select(`
        id,
        amount_cents,
        paid_at,
        payment_method,
        payable_id,
        invoice_id,
        legal_entity_id,
        bank_account_id,
        reconciled,
        reconciled_at,
        notes,
        created_by,
        reconciled_by,
        created_by_user:users!created_by(id, name),
        reconciled_by_user:users!reconciled_by(id, name),
        billing_invoices(
          id,
          due_date,
          total_cents,
          pharmacies(id, trade_name, legal_name)
        ),
        billing_payables(
          id,
          description,
          due_date,
          beneficiary_type,
          beneficiary_id,
          legal_entity_type,
          category,
          origin_type
        )
      `)
      .eq('workspace_id', workspaceId)
      .eq('reconciled', false)
      .order('paid_at', { ascending: false })
      .limit(200);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ payments: data || [] });
  });

  app.post('/bank-movements/import', { preHandler: [...preReconcile] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z
      .object({
        bank_account_id: z.string().uuid(),
        format: z.enum(['csv', 'ofx', 'cora', 'c6']),
        content: z.string().min(1).max(5_000_000),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const formatRequested = body.data.format;
    const format = resolveBankStatementFormat(body.data.content, formatRequested);
    const rows = parseBankStatement(body.data.content, format);
    const parse_stats = summarizeBankMovementRows(rows);
    if (!rows.length) {
      return reply.status(400).send({
        error:
          formatRequested === 'c6' || formatRequested === 'csv'
            ? 'Nenhum movimento reconhecido. Extratos C6 suportados: (1) conta corrente com Data Lançamento / Entrada / Saída, ou (2) extrato de lote com Data Pagamento / Tipo e Beneficiário / Valor. Confirme o arquivo ou use CSV genérico / OFX / Cora.'
            : 'Nenhum movimento reconhecido no arquivo. Formatos aceitos: C6 CSV (conta ou lote), Cora CSV, CSV genérico ou OFX.',
        format_requested: formatRequested,
        format,
        parse_stats,
      });
    }

    try {
      const result = await importBankMovements(workspaceId, body.data.bank_account_id, rows, format);
      const { to_reconcile, pending: auto_reconcile_pending } = takeMovementsForAutoReconcile(result.movement_ids);
      const reconciliation = await autoReconcileImportedMovements(workspaceId, to_reconcile);
      return reply.send({
        ...result,
        ...reconciliation,
        parsed: rows.length,
        format_requested: formatRequested,
        format,
        parse_stats,
        auto_reconcile_pending,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      return reply.status(500).send({
        error: message,
        hint: /Reimporte o mesmo arquivo/i.test(message)
          ? undefined
          : 'Se a importação parou no meio, reimporte o mesmo arquivo: linhas já gravadas serão ignoradas pelo external_id.',
        format_requested: formatRequested,
        format,
        parse_stats,
      });
    }
  });

  app.post('/bank-movements/:id/reconcile', { preHandler: [...preReconcile] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;
    const body = z.object({ payment_id: z.string().uuid() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'payment_id obrigatório' });
    try {
      await reconcileBankMovement(workspaceId, id, body.data.payment_id, actorId);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.post('/bank-movements/:id/settle-with-interest', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;
    const body = z
      .object({
        invoice_id: z.string().uuid(),
        reason: z.string().min(3).max(500).optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'invoice_id obrigatório' });

    const { data: result, error: rpcErr } = await supabase.rpc('billing_settle_invoice_with_interest', {
      p_workspace_id: workspaceId,
      p_movement_id: id,
      p_invoice_id: body.data.invoice_id,
      p_reason: body.data.reason || null,
      p_created_by: actorId,
      p_notes: body.data.notes || null,
    });
    if (rpcErr) return reply.status(500).send({ error: rpcErr.message });

    const payload = result as {
      movement?: Record<string, unknown>;
      invoice?: { id?: string; status?: string; billing_cycle_id?: string | null } | null;
      payment?: { id?: string } | null;
      interest_cents?: number;
      pending_payments_removed?: number;
    };

    let warning: string | null = null;
    if (payload.invoice?.status === 'paid' && payload.invoice.billing_cycle_id) {
      try {
        await generateDriverPayablesFromCycle(workspaceId, String(payload.invoice.billing_cycle_id));
      } catch (err) {
        warning =
          err instanceof Error
            ? `Fatura baixada e conciliada, mas os pagamentos dos entregadores não foram gerados: ${err.message}`
            : 'Fatura baixada e conciliada, mas os pagamentos dos entregadores não foram gerados.';
      }
    }

    return reply.send({ ok: true, result: payload, warning });
  });

  app.post('/bank-movements/:id/manual-settlement', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;
    const body = manualSettlementSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const { data: result, error: rpcErr } = await supabase.rpc('billing_manual_settle_bank_movement', {
      p_workspace_id: workspaceId,
      p_movement_id: id,
      p_target_type: body.data.target_type,
      p_target_id: body.data.target_id,
      p_notes: body.data.notes || null,
      p_created_by: actorId,
    });
    if (rpcErr) return reply.status(500).send({ error: rpcErr.message });

    const payload = result as {
      movement?: Record<string, unknown>;
      invoice?: { id?: string; status?: string; billing_cycle_id?: string | null } | null;
      payable?: Record<string, unknown> | null;
      payment?: { id?: string } | null;
    };

    let warning: string | null = null;
    if (payload.invoice?.status === 'paid' && payload.invoice.billing_cycle_id) {
      try {
        await generateDriverPayablesFromCycle(workspaceId, String(payload.invoice.billing_cycle_id));
      } catch (err) {
        warning =
          err instanceof Error
            ? `Fatura baixada e conciliada, mas os pagamentos dos entregadores não foram gerados: ${err.message}`
            : 'Fatura baixada e conciliada, mas os pagamentos dos entregadores não foram gerados.';
      }
    }

    return reply.send({
      ok: true,
      movement: payload.movement,
      invoice: payload.invoice,
      payable: payload.payable,
      payment_id: payload.payment?.id,
      warning,
    });
  });
}
