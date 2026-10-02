import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { writeAuditLog } from '../../lib/auditLog';
import {
  BillingCoraConfigError,
  getCoraConfigForEntity,
  loadCoraWorkspaceConfig,
  resolveEffectiveCoraClientId,
  updateCoraConfig,
} from '../../lib/billingCoraConfig';
import { BillingCoraClient, BillingCoraClientError } from '../../lib/billingCoraClient';
import {
  BillingCoraEmitError,
  cancelCoraBankSlip,
  downloadBankSlipPdfFile,
  emitCoraBankSlipForInvoice,
  handleCoraInvoicePaidWebhookStub,
} from '../../lib/billingCoraEmitEngine';
import { billingArtifactContentDisposition } from '../../lib/billingArtifactFilename';
import { listInvoiceDocumentArtifacts } from '../../lib/billingInvoiceArtifacts';
import {
  assertSafeSecretRef,
  defaultMtlsSecretRefForEntity,
  loadCoraMtlsMaterial,
  writeCoraMtlsMaterial,
  BillingCoraSecretsError,
} from '../../lib/billingCoraSecrets';
import type { BillingCoraEntityType } from '../../lib/billingCoraTypes';
import { requireSchedulerToken } from '../../middleware/requireSchedulerToken';
import {
  BillingCoraStatementSyncError,
  getCoraStatementSyncStatus,
  runCoraStatementSync,
  runCoraStatementSyncJob,
} from '../../lib/billingCoraStatementSyncEngine';
import { supabase } from '../../lib/supabase';

const entityTypeSchema = z.enum(['coop', 'flux']);

const configBodySchema = z.object({
  environment: z.enum(['stage', 'production']).optional(),
  client_id: z.string().max(200).optional().nullable(),
  mtls_secret_ref: z.string().max(120).optional().nullable(),
  enabled: z.boolean().optional(),
  /** Conta destino do sync de extrato Cora (MVP Flux). */
  bank_account_id: z.string().uuid().optional().nullable(),
  fine_mode: z.enum(['none', 'rate', 'amount']).optional(),
  fine_rate: z.number().min(0).max(100).optional().nullable(),
  fine_amount_cents: z.number().int().min(0).optional().nullable(),
  /** % a.m. (produto); Cora: payment_terms.interest.rate 0–100. */
  interest_rate: z.number().min(0).max(100).optional().nullable(),
  pix_qr_enabled: z.boolean().optional(),
  service_name_template: z.string().min(1).max(200).optional(),
  service_description_template: z.string().min(1).max(200).optional(),
});

const syncBodySchema = z.object({
  dry_run: z.boolean().optional(),
  force: z.boolean().optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  auto_reconcile: z.boolean().optional(),
  entity_type: z.enum(['flux', 'coop']).optional(),
});

const mtlsUploadBodySchema = z.object({
  certificate_pem: z.string().min(40).max(100_000),
  private_key_pem: z.string().min(40).max(100_000),
  mtls_secret_ref: z.string().max(120).optional().nullable(),
});

function sendCoraError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, err: unknown) {
  if (err instanceof BillingCoraConfigError || err instanceof BillingCoraSecretsError) {
    return reply.status(err.status).send({ error: err.message, operator_message: err.message });
  }
  if (err instanceof BillingCoraEmitError) {
    return reply.status(err.status).send({
      error: err.message,
      operator_message: err.message,
      code: err.code,
      ...(err.gaps ? { gaps: err.gaps } : {}),
    });
  }
  if (err instanceof BillingCoraClientError) {
    return reply.status(502).send({
      error: err.message,
      operator_message: err.message,
      code: 'cora_api_error',
      cora_status: err.status ?? null,
    });
  }
  if (err instanceof BillingCoraStatementSyncError) {
    return reply.status(err.status).send({
      error: err.message,
      operator_message: err.message,
      code: err.code,
    });
  }
  const message = err instanceof Error ? err.message : 'Erro ao processar Cora';
  return reply.status(500).send({ error: message });
}

export async function registerBillingCoraRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  /** GET /cora/config — configs por entidade (Flux MVP). */
  app.get('/cora/config', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    try {
      const config = await loadCoraWorkspaceConfig(workspaceId);
      return reply.send(config);
    } catch (err) {
      return sendCoraError(reply, err);
    }
  });

  /** PUT /cora/configs/:entityType — client_id, ambiente, secret_ref, enabled. */
  app.put('/cora/configs/:entityType', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const entityParsed = entityTypeSchema.safeParse((request.params as { entityType?: string }).entityType);
    if (!entityParsed.success) {
      return reply.status(400).send({ error: 'entityType deve ser coop ou flux' });
    }
    const parsed = configBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      const { bank_account_id, ...configPatch } = parsed.data;
      const config = await updateCoraConfig(
        workspaceId,
        entityParsed.data as BillingCoraEntityType,
        configPatch
      );
      if (bank_account_id !== undefined) {
        const { error: bankErr } = await supabase
          .from('billing_cora_configs')
          .update({
            bank_account_id: bank_account_id || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', config.id)
          .eq('workspace_id', workspaceId);
        if (bankErr) {
          return reply.status(500).send({ error: bankErr.message });
        }
        (config as { bank_account_id?: string | null }).bank_account_id = bank_account_id || null;
      }
      await writeAuditLog({
        actor_id: (request.user as { sub: string }).sub,
        action: 'billing.cora.config.update',
        entity_type: 'billing_cora_config',
        entity_id: config.id,
        metadata: {
          entity_type: config.entity_type,
          environment: config.environment,
          enabled: config.enabled,
          has_client_id: config.has_client_id,
          mtls_secret_ref: config.mtls_secret_ref,
          bank_account_id: bank_account_id ?? undefined,
          fine_mode: config.fine_mode,
          fine_rate: config.fine_rate,
          interest_rate: config.interest_rate,
          pix_qr_enabled: config.pix_qr_enabled,
        },
      });
      return reply.send({
        config,
        hint:
          `Material mTLS: coloque certificate.pem e private-key.key em .secrets/${config.mtls_secret_ref}/ ` +
          '(gitignore) ou faça upload pela UI. A API nunca devolve a private key.',
      });
    } catch (err) {
      return sendCoraError(reply, err);
    }
  });

  /**
   * PUT /cora/configs/:entityType/mtls — grava PEM/KEY em .secrets/<ref>/ (local).
   * Body: certificate_pem + private_key_pem. Nunca persiste no Postgres.
   */
  app.put('/cora/configs/:entityType/mtls', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const entityParsed = entityTypeSchema.safeParse((request.params as { entityType?: string }).entityType);
    if (!entityParsed.success) {
      return reply.status(400).send({ error: 'entityType deve ser coop ou flux' });
    }
    if (entityParsed.data !== 'flux') {
      return reply.status(400).send({ error: 'MVP: upload mTLS apenas para Flux nesta rodada.' });
    }
    const parsed = mtlsUploadBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      const ref =
        (parsed.data.mtls_secret_ref && assertSafeSecretRef(parsed.data.mtls_secret_ref)) ||
        defaultMtlsSecretRefForEntity('flux');
      const paths = writeCoraMtlsMaterial(ref, {
        certificatePem: parsed.data.certificate_pem,
        privateKeyPem: parsed.data.private_key_pem,
      });
      void paths;
      const config = await updateCoraConfig(workspaceId, 'flux', { mtls_secret_ref: ref });
      await writeAuditLog({
        actor_id: (request.user as { sub: string }).sub,
        action: 'billing.cora.mtls.upload',
        entity_type: 'billing_cora_config',
        entity_id: config.id,
        metadata: { entity_type: 'flux', mtls_secret_ref: ref, has_files: true },
      });
      return reply.send({
        config,
        hint: `Arquivos gravados em .secrets/${ref}/ (certificate.pem + private-key.key). Não versionar.`,
      });
    } catch (err) {
      return sendCoraError(reply, err);
    }
  });

  /**
   * GET /cora/configs/:entityType/balance — health-check read-only (token mTLS + saldo).
   * Não exige config habilitada: valida credenciais antes de liberar emissão/sync.
   */
  app.get('/cora/configs/:entityType/balance', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const entityParsed = entityTypeSchema.safeParse((request.params as { entityType?: string }).entityType);
    if (!entityParsed.success) {
      return reply.status(400).send({ error: 'entityType deve ser coop ou flux' });
    }
    try {
      const entityType = entityParsed.data as BillingCoraEntityType;
      const config = await getCoraConfigForEntity(workspaceId, entityType);
      if (!config) return reply.status(404).send({ error: 'Config Cora não encontrada' });
      const clientId = resolveEffectiveCoraClientId(config);
      if (!clientId) return reply.status(400).send({ error: 'client_id Cora ausente.' });
      const client = new BillingCoraClient({
        environment: config.environment,
        clientId,
        material: loadCoraMtlsMaterial(config.mtls_secret_ref || defaultMtlsSecretRefForEntity(entityType)),
      });
      const { balance } = await client.getBalance();
      return reply.send({
        ok: true,
        entity_type: entityType,
        environment: config.environment,
        mtls_secret_ref: config.mtls_secret_ref,
        balance_cents: balance,
      });
    } catch (err) {
      return sendCoraError(reply, err);
    }
  });

  /** POST /invoices/:id/cora-bank-slip — emissão manual. */
  app.post('/invoices/:id/cora-bank-slip', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const forceNew = Boolean((request.body as { force_new?: boolean } | null)?.force_new);
    try {
      const result = await emitCoraBankSlipForInvoice({
        workspaceId,
        invoiceId: id,
        actorId: (request.user as { sub: string }).sub,
        forceNew,
      });
      await writeAuditLog({
        actor_id: (request.user as { sub: string }).sub,
        action: 'billing.cora.bank_slip.emit',
        entity_type: 'billing_bank_slip',
        entity_id: result.bank_slip.id,
        metadata: {
          invoice_id: id,
          created: result.created,
          external_id: result.bank_slip.external_id,
          status: result.bank_slip.status,
        },
      });
      return reply.send(result);
    } catch (err) {
      return sendCoraError(reply, err);
    }
  });

  /** POST /cora/bank-slips/:id/cancel — cancela boleto aberto na Cora + status local. */
  app.post('/cora/bank-slips/:id/cancel', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      const result = await cancelCoraBankSlip({
        workspaceId,
        bankSlipId: id,
        actorId: (request.user as { sub: string }).sub,
      });
      await writeAuditLog({
        actor_id: (request.user as { sub: string }).sub,
        action: 'billing.cora.bank_slip.cancel',
        entity_type: 'billing_bank_slip',
        entity_id: result.bank_slip.id,
        metadata: {
          invoice_id: result.bank_slip.invoice_id,
          external_id: result.bank_slip.external_id,
          status: result.bank_slip.status,
          canceled: result.canceled,
        },
      });
      return reply.send(result);
    } catch (err) {
      return sendCoraError(reply, err);
    }
  });

  /** GET /cora/bank-slips/:id/pdf — PDF espelhado no storage Aethera (backfill sob demanda). */
  app.get('/cora/bank-slips/:id/pdf', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      const file = await downloadBankSlipPdfFile({
        workspaceId,
        bankSlipId: id,
      });
      return reply
        .header('Content-Type', file.contentType)
        .header('Content-Disposition', billingArtifactContentDisposition(file.filename))
        .send(file.buffer);
    } catch (err) {
      return sendCoraError(reply, err);
    }
  });

  /**
   * POST /cora/webhooks/invoice-paid — stub (fase 4).
   * Cora envia body vazio; headers trazem resource/event ids.
   */
  app.post('/cora/webhooks/invoice-paid', async (request, reply) => {
    const headers = request.headers;
    const stub = await handleCoraInvoicePaidWebhookStub({
      resourceId: (headers['webhook-resource-id'] as string | undefined) || null,
      eventId: (headers['webhook-event-id'] as string | undefined) || null,
    });
    return reply.status(501).send(stub);
  });

  /** GET /cora/sync/status — última sync extrato (UI mínima / ops). */
  app.get('/cora/sync/status', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    try {
      const status = await getCoraStatementSyncStatus({ workspaceId, entityType: 'flux' });
      return reply.send({ status });
    } catch (err) {
      return sendCoraError(reply, err);
    }
  });

  /**
   * POST /cora/sync/statement — sync manual (JWT manage).
   * Default dry_run=true por segurança; force=true ignora SYNC_ENABLED para smoke.
   * Body: { dry_run?, force?, start?, end?, auto_reconcile? }
   */
  app.post('/cora/sync/statement', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = syncBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      // Default dry_run=true (smoke seguro). dry_run:false exige WRITE flag em prod.
      const wantDryRun = parsed.data.dry_run !== false;
      const result = await runCoraStatementSync({
        workspaceId,
        dryRun: wantDryRun,
        force: parsed.data.force === true || wantDryRun,
        start: parsed.data.start,
        end: parsed.data.end,
        autoReconcile: parsed.data.auto_reconcile,
      });
      await writeAuditLog({
        actor_id: (request.user as { sub: string }).sub,
        action: 'billing.cora.statement.sync',
        entity_type: 'billing_cora_config',
        entity_id: result.entity_type,
        metadata: result as unknown as Record<string, unknown>,
      });
      return reply.send({ result });
    } catch (err) {
      return sendCoraError(reply, err);
    }
  });

  /**
   * POST /cora/sync/statement/job — Cloud Scheduler / scheduler-service (X-Scheduler-Token).
   */
  app.post('/cora/sync/statement/job', { preHandler: [requireSchedulerToken] }, async (_request, reply) => {
    try {
      const job = await runCoraStatementSyncJob();
      return reply.status(job.ok ? 200 : 500).send(job);
    } catch (err) {
      return sendCoraError(reply, err);
    }
  });
}
