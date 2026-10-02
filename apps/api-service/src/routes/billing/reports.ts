import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { generateRecurringExpenses } from '../../lib/billingExpenseRecurrence';
import {
  buildInssAccountingReport,
  buildInsuranceActiveReport,
  buildInsuranceTerminatedReport,
  recordReportRun,
  reportRowsToCsv,
} from '../../lib/billingReportsEngine';

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

function cpfDigits(value: string | null) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? digits.padStart(11, '0') : null;
}

function insuranceRowsToCooperativaTemplate(rows: Awaited<ReturnType<typeof buildInsuranceActiveReport>>['rows']) {
  return reportRowsToCsv(
    ['Nome', 'Data de nascimento', 'CPF', 'Sexo ', 'Matricula'],
    rows.map((r) => ({
      Nome: r.name,
      'Data de nascimento': r.birth_date,
      CPF: cpfDigits(r.cpf),
      'Sexo ': r.gender || 'M',
      Matricula: r.registration || 0,
    }))
  );
}

export async function registerBillingReportRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/reports/cycle-health', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const limit = Math.min(12, Math.max(1, Number((request.query as { limit?: string }).limit || 6)));

    const { data: cycles, error: cycleErr } = await supabase
      .from('billing_cycles')
      .select('id, label, apuracao_start, apuracao_end, status, closed_at')
      .eq('workspace_id', workspaceId)
      .order('apuracao_end', { ascending: false })
      .limit(limit);
    if (cycleErr) return reply.status(500).send({ error: cycleErr.message });

    const rows = [];
    for (const cycle of cycles || []) {
      const cycleId = String(cycle.id);
      const competenceMonth = String(cycle.apuracao_end).slice(0, 7);
      const [
        { count: settlements },
        { count: approvedSettlements },
        { count: invoices },
        { count: paidInvoices },
        { count: payables },
        { count: paidPayables },
        { count: pixBatches },
        { count: closedDre },
      ] = await Promise.all([
        supabase.from('billing_settlements').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('billing_cycle_id', cycleId),
        supabase.from('billing_settlements').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('billing_cycle_id', cycleId).in('status', ['approved', 'paid']),
        supabase.from('billing_invoices').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('billing_cycle_id', cycleId),
        supabase.from('billing_invoices').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('billing_cycle_id', cycleId).eq('status', 'paid'),
        supabase.from('billing_payables').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('billing_cycle_id', cycleId),
        supabase.from('billing_payables').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('billing_cycle_id', cycleId).eq('status', 'paid'),
        supabase.from('billing_payment_batch_exports').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('billing_cycle_id', cycleId),
        supabase.from('billing_dre_periods').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('competence_month', competenceMonth).eq('status', 'closed'),
      ]);

      rows.push({
        cycle_id: cycleId,
        label: cycle.label,
        apuracao_start: cycle.apuracao_start,
        apuracao_end: cycle.apuracao_end,
        status: cycle.status,
        closed_at: cycle.closed_at,
        competence_month: competenceMonth,
        settlements: settlements || 0,
        approved_settlements: approvedSettlements || 0,
        invoices: invoices || 0,
        paid_invoices: paidInvoices || 0,
        payables: payables || 0,
        paid_payables: paidPayables || 0,
        pix_batches: pixBatches || 0,
        dre_closed: Boolean(closedDre),
      });
    }

    return reply.send({ rows });
  });

  app.post('/expenses/generate-recurring', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z.object({ month: monthSchema }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'month inválido (YYYY-MM)' });

    try {
      const result = await generateRecurringExpenses(workspaceId, body.data.month);
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/inss-accounting', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const month = String((request.query as { month?: string }).month || '');
    if (!monthSchema.safeParse(month).success) return reply.status(400).send({ error: 'month obrigatório (YYYY-MM)' });

    try {
      const report = await buildInssAccountingReport(workspaceId, month);
      const { data: run } = await supabase
        .from('billing_monthly_report_runs')
        .select('sent_at, sent_by')
        .eq('workspace_id', workspaceId)
        .eq('report_kind', 'inss_accounting')
        .eq('competence_month', month)
        .maybeSingle();

      return reply.send({ ...report, month, sent_at: run?.sent_at ?? null });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/inss-accounting/csv', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const month = String((request.query as { month?: string }).month || '');
    if (!monthSchema.safeParse(month).success) return reply.status(400).send({ error: 'month obrigatório' });

    const report = await buildInssAccountingReport(workspaceId, month);
    const csv = reportRowsToCsv(
      ['nome', 'cpf', 'valor_faturado'],
      report.rows.map((r) => ({
        nome: r.name,
        cpf: r.cpf,
        valor_faturado: (r.gross_remuneration_cents / 100).toFixed(2),
      }))
    );
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    return reply.send(csv);
  });

  app.get('/reports/insurance-active', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as { month?: string; cutoff_date?: string };
    const month = q.month || new Date().toISOString().slice(0, 7);
    if (!monthSchema.safeParse(month).success) return reply.status(400).send({ error: 'month inválido' });

    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cutoff = q.cutoff_date || `${month}-${String(lastDay).padStart(2, '0')}`;

    try {
      const report = await buildInsuranceActiveReport(workspaceId, cutoff);
      return reply.send({ ...report, month });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/insurance-active/csv', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as { month?: string; cutoff_date?: string };
    const month = q.month || new Date().toISOString().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cutoff = q.cutoff_date || `${month}-${String(lastDay).padStart(2, '0')}`;

    const report = await buildInsuranceActiveReport(workspaceId, cutoff);
    const csv = insuranceRowsToCooperativaTemplate(report.rows);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    return reply.send(csv);
  });

  app.get('/reports/insurance-terminated', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const month = String((request.query as { month?: string }).month || '');
    if (!monthSchema.safeParse(month).success) return reply.status(400).send({ error: 'month obrigatório' });

    try {
      const report = await buildInsuranceTerminatedReport(workspaceId, month);
      return reply.send({ ...report, month });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/insurance-terminated/csv', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const month = String((request.query as { month?: string }).month || '');
    if (!monthSchema.safeParse(month).success) return reply.status(400).send({ error: 'month obrigatório' });

    const report = await buildInsuranceTerminatedReport(workspaceId, month);
    const csv = insuranceRowsToCooperativaTemplate(report.rows);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    return reply.send(csv);
  });

  app.post('/reports/:kind/mark-sent', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { kind } = request.params as { kind: string };
    const body = z
      .object({
        month: monthSchema,
        row_count: z.number().int().min(0).default(0),
        total_cents: z.number().int().nullable().optional(),
        cutoff_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const kindMap: Record<string, 'inss_accounting' | 'insurance_active' | 'insurance_terminated'> = {
      'inss-accounting': 'inss_accounting',
      'insurance-active': 'insurance_active',
      'insurance-terminated': 'insurance_terminated',
    };
    const reportKind = kindMap[kind];
    if (!reportKind) return reply.status(404).send({ error: 'Relatório não encontrado' });

    try {
      const run = await recordReportRun(
        workspaceId,
        reportKind,
        body.data.month,
        body.data.row_count,
        body.data.total_cents ?? null,
        body.data.cutoff_date ?? null,
        (request.user as { sub: string }).sub,
        true
      );
      return reply.send({ run });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });
}
