import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { generateCycleInvoices } from '../../lib/billingInvoiceEngine';
import { generateDriverPayablesFromCycle } from '../../lib/billingPayablesEngine';
import {
  approveBillingInvoiceWithNfse,
  loadLatestNfseDocumentsForInvoices,
} from '../../lib/billingNfseEmitEngine';
import { BillingNfseApproveError } from '../../lib/billingNfseTypes';
import { isBillingNfseEnabled } from '../../lib/billingNfseConfig';
import { isBillingCoraEnabled } from '../../lib/billingCoraConfig';
import { loadLatestBankSlipsForInvoices } from '../../lib/billingCoraEmitEngine';
import { validateInterestReason } from '../../lib/billingInvoiceInterest';
import { listInvoiceDocumentArtifacts } from '../../lib/billingInvoiceArtifacts';
import {
  BillingInvoiceEmailError,
  sendInvoiceDocumentPackageEmail,
} from '../../lib/billingInvoicePackageEmail';

export async function registerBillingInvoiceRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/invoices', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as { cycle_id?: string; status?: string };

    let query = supabase
      .from('billing_invoices')
      .select('*, pharmacies(id, trade_name, legal_name), billing_cycles(id, label, apuracao_start, apuracao_end)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (q.cycle_id) query = query.eq('billing_cycle_id', q.cycle_id);
    if (q.status) query = query.eq('status', q.status);

    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });

    const invoices = data || [];
    const ids = invoices.map((inv) => String(inv.id));
    let nfseMap: Awaited<ReturnType<typeof loadLatestNfseDocumentsForInvoices>> | null = null;
    let slipMap: Awaited<ReturnType<typeof loadLatestBankSlipsForInvoices>> | null = null;

    if (isBillingNfseEnabled() && ids.length) {
      try {
        nfseMap = await loadLatestNfseDocumentsForInvoices(workspaceId, ids);
      } catch {
        /* listagem não deve falhar se NFS-e estiver indisponível */
      }
    }
    if (isBillingCoraEnabled() && ids.length) {
      try {
        slipMap = await loadLatestBankSlipsForInvoices(workspaceId, ids);
      } catch {
        /* listagem não deve falhar se Cora estiver indisponível */
      }
    }

    if (nfseMap || slipMap) {
      return reply.send({
        invoices: invoices.map((inv) => {
          const nfse = nfseMap?.get(String(inv.id));
          const bankSlip = slipMap?.get(String(inv.id));
          return {
            ...inv,
            nfse: nfse
              ? {
                  id: nfse.id,
                  status: nfse.status,
                  last_error: nfse.last_error,
                  access_key: nfse.access_key,
                  dps_number: nfse.dps_number,
                  entity_type: nfse.entity_type,
                  attempt_number: nfse.attempt_number,
                  has_xml: Boolean(nfse.xml_storage_path),
                  has_pdf: Boolean(nfse.pdf_storage_path),
                }
              : null,
            bank_slip: bankSlip
              ? {
                  id: bankSlip.id,
                  status: bankSlip.status,
                  external_id: bankSlip.external_id,
                  digitable_line: bankSlip.digitable_line,
                  pdf_url: bankSlip.pdf_url,
                  has_pdf_storage: Boolean(bankSlip.pdf_storage_path),
                  last_error: bankSlip.last_error,
                  provider: bankSlip.provider,
                }
              : null,
          };
        }),
      });
    }

    return reply.send({ invoices });
  });

  app.get('/invoices/:id', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
      .from('billing_invoices')
      .select('*, pharmacies(id, trade_name, legal_name, billing_email, email), billing_cycles(*), billing_invoice_lines(*)')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Fatura não encontrada' });
    return reply.send({ invoice: data });
  });

  /**
   * GET /invoices/:id/artifacts — pacote de documentos ready (base para e-mail futuro).
   * Inclui boleto_pdf, nfse_xml, nfse_danfse, invoice_html_url (sem PDF de relatório).
   */
  app.get('/invoices/:id/artifacts', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      const pack = await listInvoiceDocumentArtifacts({ workspaceId, invoiceId: id });
      return reply.send(pack);
    } catch (err) {
      const status = (err as { status?: number })?.status === 404 ? 404 : 500;
      const message = err instanceof Error ? err.message : 'Erro ao listar artefatos';
      return reply.status(status).send({ error: message });
    }
  });

  /**
   * POST /invoices/:id/send-email — envia pacote (boleto + DANFSe + XML + link HTML).
   * Body opcional: { dry_run?: boolean, to?: string } — to override (teste); dry_run não chama SMTP.
   */
  app.post('/invoices/:id/send-email', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = z
      .object({
        dry_run: z.boolean().optional(),
        to: z.string().email().optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: 'Body inválido (dry_run?: boolean, to?: email)' });
    }
    try {
      const result = await sendInvoiceDocumentPackageEmail({
        workspaceId,
        invoiceId: id,
        dryRun: body.data.dry_run === true,
        toOverride: body.data.to || null,
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof BillingInvoiceEmailError) {
        return reply.status(err.status).send({
          error: err.message,
          code: err.code,
          missing: err.missing || undefined,
        });
      }
      const message = err instanceof Error ? err.message : 'Erro ao enviar e-mail da fatura';
      return reply.status(500).send({ error: message });
    }
  });

  app.post('/invoices/generate', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z.object({ cycle_id: z.string().uuid() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'cycle_id obrigatório' });

    const result = await generateCycleInvoices(workspaceId, body.data.cycle_id);
    return reply.send({ ok: true, invoices: result.invoices });
  });

  app.post('/invoices/:id/approve', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;

    try {
      const result = await approveBillingInvoiceWithNfse({
        workspaceId,
        invoiceId: id,
        actorId,
      });
      return reply.send({
        invoice: result.invoice,
        nfse_enabled: result.nfse_enabled,
        nfse: result.nfse
          ? {
              document: {
                id: result.nfse.document.id,
                status: result.nfse.document.status,
                last_error: result.nfse.document.last_error,
                access_key: result.nfse.document.access_key,
                dps_number: result.nfse.document.dps_number,
                entity_type: result.nfse.document.entity_type,
              },
              authorized: result.nfse.emit?.authorized ?? false,
              emitted: result.nfse.emit?.emitted ?? false,
              error: result.nfse.emit?.error ?? result.nfse.document.last_error,
            }
          : null,
      });
    } catch (err) {
      if (err instanceof BillingNfseApproveError) {
        return reply.status(err.status).send({
          error: err.message,
          code: err.code,
          gaps: err.gaps || undefined,
        });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  app.post('/invoices/:id/interest', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;
    const body = z
      .object({
        amount_cents: z.number().int().positive(),
        reason: z.string().min(3).max(500),
        source_movement_id: z.string().uuid().optional().nullable(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'amount_cents e reason são obrigatórios' });

    const reasonErr = validateInterestReason(body.data.reason);
    if (reasonErr) return reply.status(400).send({ error: reasonErr });

    const { data: result, error: rpcErr } = await supabase.rpc('billing_add_invoice_interest', {
      p_workspace_id: workspaceId,
      p_invoice_id: id,
      p_amount_cents: body.data.amount_cents,
      p_reason: body.data.reason.trim(),
      p_created_by: actorId,
      p_source_movement_id: body.data.source_movement_id || null,
    });
    if (rpcErr) return reply.status(500).send({ error: rpcErr.message });

    const payload = result as { invoice?: Record<string, unknown>; line?: Record<string, unknown> };
    return reply.send({ invoice: payload.invoice, line: payload.line });
  });

  app.post('/invoices/:id/payment', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;
    const body = z
      .object({
        amount_cents: z.number().int().positive(),
        paid_at: z.string().optional(),
        payment_method: z.enum(['pix', 'transfer', 'cash', 'other', 'credit_card']).default('transfer'),
        bank_account_id: z.string().uuid().optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'amount_cents inválido' });

    const { data: result, error: rpcErr } = await supabase.rpc('billing_register_invoice_payment', {
      p_workspace_id: workspaceId,
      p_invoice_id: id,
      p_amount_cents: body.data.amount_cents,
      p_payment_method: body.data.payment_method,
      p_bank_account_id: body.data.bank_account_id || null,
      p_notes: body.data.notes || null,
      p_paid_at: body.data.paid_at || new Date().toISOString(),
      p_created_by: actorId,
    });
    if (rpcErr) return reply.status(500).send({ error: rpcErr.message });

    const payload = result as { invoice?: Record<string, unknown>; payment?: Record<string, unknown> };
    let payablesGenerated = 0;
    if (payload.invoice?.status === 'paid' && payload.invoice.billing_cycle_id && payload.payment?.reconciled) {
      try {
        const generated = await generateDriverPayablesFromCycle(workspaceId, String(payload.invoice.billing_cycle_id));
        payablesGenerated = generated.payables;
      } catch (err) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : 'Fatura baixada, mas não foi possível gerar APs.',
          operator_message:
            err instanceof Error
              ? `Fatura baixada, mas os pagamentos dos entregadores não foram gerados: ${err.message}`
              : 'Fatura baixada, mas os pagamentos dos entregadores não foram gerados.',
        });
      }
    }

    return reply.send({ invoice: payload.invoice, payment: payload.payment, payables_generated: payablesGenerated });
  });
}
