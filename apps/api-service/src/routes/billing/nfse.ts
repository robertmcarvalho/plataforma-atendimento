import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { writeAuditLog } from '../../lib/auditLog';
import {
  BillingNfseConfigError,
  defaultSecretRefForEntity,
  loadNfseWorkspaceConfig,
  updateNfseIssuerConfig,
  updateNfseServiceProfile,
  upsertNfseCertificateMetadata,
} from '../../lib/billingNfseConfig';
import {
  downloadNfseDocumentFile,
  reemitNfseDocument,
  cancelNfseDocument,
} from '../../lib/billingNfseEmitEngine';
import { billingArtifactContentDisposition } from '../../lib/billingArtifactFilename';
import { BillingNfseApproveError, type BillingNfseEntityType } from '../../lib/billingNfseTypes';

const entityTypeSchema = z.enum(['coop', 'flux']);

const issuerBodySchema = z.object({
  environment: z.enum(['producao_restrita', 'producao']).optional(),
  auto_emit_on_approve: z.boolean().optional(),
  municipal_registration: z.string().max(64).optional().nullable(),
  ibge_city_code: z.string().max(16).optional(),
  tax_regime: z.string().max(64).optional().nullable(),
  simples_nacional: z.boolean().optional(),
  dps_series: z.string().max(32).optional().nullable(),
  dps_next_number: z.number().int().min(1).optional().nullable(),
  active: z.boolean().optional(),
});

const profileBodySchema = z.object({
  ctn: z.string().min(1).max(32).optional(),
  nbs: z.string().min(1).max(32).optional(),
  iss_rate_pct: z.number().min(0).max(100).optional().nullable(),
  description_template: z.string().min(1).max(2000).optional(),
  active: z.boolean().optional(),
});

const certificateBodySchema = z.object({
  secret_ref: z.string().max(120).optional().nullable(),
  thumbprint: z.string().max(128).optional().nullable(),
  subject_cn: z.string().max(200).optional().nullable(),
  valid_from: z.string().max(40).optional().nullable(),
  valid_until: z.string().max(40).optional().nullable(),
  active: z.boolean().optional(),
});

const cancelBodySchema = z.object({
  justificativa: z.string().trim().min(15).max(255),
  codigo_motivo: z.union([z.literal(1), z.literal(2), z.literal(3), z.enum(['1', '2', '3'])]).optional(),
  n_ped_reg: z.number().int().min(1).max(999).optional(),
});

function sendConfigError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, err: unknown) {
  if (err instanceof BillingNfseConfigError) {
    return reply.status(err.status).send({ error: err.message, operator_message: err.message });
  }
  if (err instanceof BillingNfseApproveError) {
    return reply.status(err.status).send({
      error: err.message,
      operator_message: err.message,
      code: err.code,
      ...(err.gaps ? { gaps: err.gaps } : {}),
    });
  }
  const message = err instanceof Error ? err.message : 'Erro ao processar config NFS-e';
  return reply.status(500).send({ error: message });
}

export async function registerBillingNfseRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  /** GET /nfse/config — issuers + profiles + certificate metadata (sem PEM). */
  app.get('/nfse/config', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    try {
      const config = await loadNfseWorkspaceConfig(workspaceId);
      return reply.send(config);
    } catch (err) {
      return sendConfigError(reply, err);
    }
  });

  /** PUT /nfse/issuers/:entityType — upsert parcial do emitente Coop/Flux. */
  app.put('/nfse/issuers/:entityType', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const entityParsed = entityTypeSchema.safeParse((request.params as { entityType?: string }).entityType);
    if (!entityParsed.success) {
      return reply.status(400).send({ error: 'entityType deve ser coop ou flux' });
    }
    const parsed = issuerBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      const issuer = await updateNfseIssuerConfig(
        workspaceId,
        entityParsed.data as BillingNfseEntityType,
        parsed.data
      );
      await writeAuditLog({
        actor_id: (request.user as { sub: string }).sub,
        action: 'billing.nfse.issuer.update',
        entity_type: 'billing_nfse_issuer_config',
        entity_id: issuer.id,
        metadata: { entity_type: issuer.entity_type, environment: issuer.environment },
      });
      return reply.send({ issuer });
    } catch (err) {
      return sendConfigError(reply, err);
    }
  });

  /** PATCH alias for issuer (same body as PUT). */
  app.patch('/nfse/issuers/:entityType', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const entityParsed = entityTypeSchema.safeParse((request.params as { entityType?: string }).entityType);
    if (!entityParsed.success) {
      return reply.status(400).send({ error: 'entityType deve ser coop ou flux' });
    }
    const parsed = issuerBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      const issuer = await updateNfseIssuerConfig(
        workspaceId,
        entityParsed.data as BillingNfseEntityType,
        parsed.data
      );
      await writeAuditLog({
        actor_id: (request.user as { sub: string }).sub,
        action: 'billing.nfse.issuer.update',
        entity_type: 'billing_nfse_issuer_config',
        entity_id: issuer.id,
        metadata: { entity_type: issuer.entity_type },
      });
      return reply.send({ issuer });
    } catch (err) {
      return sendConfigError(reply, err);
    }
  });

  /** PATCH /nfse/profiles/:id — CTN/NBS/alíquota/template/active (SaaS active gated). */
  app.patch('/nfse/profiles/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = profileBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      const profile = await updateNfseServiceProfile(workspaceId, id, parsed.data);
      await writeAuditLog({
        actor_id: (request.user as { sub: string }).sub,
        action: 'billing.nfse.profile.update',
        entity_type: 'billing_nfse_service_profile',
        entity_id: profile.id,
        metadata: { revenue_line: profile.revenue_line, active: profile.active },
      });
      return reply.send({ profile });
    } catch (err) {
      return sendConfigError(reply, err);
    }
  });

  /**
   * PUT /nfse/issuers/:entityType/certificate — metadados A1 + secret_ref.
   * Não aceita PEM/PFX no body; material fica em .secrets / Secret Manager.
   */
  app.put('/nfse/issuers/:entityType/certificate', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const entityParsed = entityTypeSchema.safeParse((request.params as { entityType?: string }).entityType);
    if (!entityParsed.success) {
      return reply.status(400).send({ error: 'entityType deve ser coop ou flux' });
    }
    const parsed = certificateBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }

    try {
      const config = await loadNfseWorkspaceConfig(workspaceId);
      const issuer = config.issuers.find((i) => i.entity_type === entityParsed.data);
      if (!issuer) return reply.status(404).send({ error: 'Emitente não encontrado' });

      const body = { ...parsed.data };
      if (body.secret_ref === undefined || body.secret_ref === null || !String(body.secret_ref).trim()) {
        body.secret_ref = defaultSecretRefForEntity(entityParsed.data);
      }

      const certificate = await upsertNfseCertificateMetadata(workspaceId, issuer.id, body);
      await writeAuditLog({
        actor_id: (request.user as { sub: string }).sub,
        action: 'billing.nfse.certificate.upsert',
        entity_type: 'billing_nfse_certificate',
        entity_id: certificate.id,
        metadata: {
          entity_type: entityParsed.data,
          has_secret_ref: certificate.has_secret_ref,
          subject_cn: certificate.subject_cn,
        },
      });
      return reply.send({
        certificate,
        hint:
          `Coloque o PFX local em .secrets/${body.secret_ref} (gitignore) ou no Secret Manager com o mesmo nome. ` +
          'A API nunca devolve o conteúdo do certificado.',
      });
    } catch (err) {
      return sendConfigError(reply, err);
    }
  });

  /** GET /nfse/documents/:id/xml — NFS-e XML (financeiro view); backfill Sefin se necessário. */
  app.get('/nfse/documents/:id/xml', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      const file = await downloadNfseDocumentFile({
        workspaceId,
        documentId: id,
        kind: 'xml',
      });
      return reply
        .header('Content-Type', file.contentType)
        .header('Content-Disposition', billingArtifactContentDisposition(file.filename))
        .send(file.buffer);
    } catch (err) {
      return sendConfigError(reply, err);
    }
  });

  /** GET /nfse/documents/:id/pdf — DANFSe PDF quando disponível. */
  app.get('/nfse/documents/:id/pdf', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      const file = await downloadNfseDocumentFile({
        workspaceId,
        documentId: id,
        kind: 'pdf',
      });
      return reply
        .header('Content-Type', file.contentType)
        .header('Content-Disposition', billingArtifactContentDisposition(file.filename))
        .send(file.buffer);
    } catch (err) {
      return sendConfigError(reply, err);
    }
  });

  /**
   * POST /nfse/documents/:id/reemit — nova tentativa a partir de documento rejected (manage).
   * Cria novo billing_nfse_documents + chama emit engine.
   */
  app.post('/nfse/documents/:id/reemit', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;
    try {
      const result = await reemitNfseDocument({
        workspaceId,
        documentId: id,
        actorId,
      });
      await writeAuditLog({
        actor_id: actorId,
        action: 'billing.nfse.reemit',
        entity_type: 'billing_nfse_document',
        entity_id: result.document.id,
        metadata: {
          previous_document_id: result.previous.id,
          invoice_id: result.document.invoice_id,
          status: result.document.status,
          authorized: result.emit.authorized,
        },
      });
      return reply.send({
        previous_document_id: result.previous.id,
        document: {
          id: result.document.id,
          status: result.document.status,
          last_error: result.document.last_error,
          access_key: result.document.access_key,
          dps_number: result.document.dps_number,
          entity_type: result.document.entity_type,
          attempt_number: result.document.attempt_number,
          has_xml: Boolean(result.document.xml_storage_path),
          has_pdf: Boolean(result.document.pdf_storage_path),
        },
        authorized: result.emit.authorized,
        emitted: result.emit.emitted,
        error: result.emit.error ?? result.document.last_error,
      });
    } catch (err) {
      return sendConfigError(reply, err);
    }
  });

  /**
   * POST /nfse/documents/:id/cancel — evento Sefin e101101 (manage).
   * Só documento authorized. Homolog = producao_restrita (sem ALLOW_PRODUCAO).
   * Produção exige BILLING_NFSE_ENABLED + BILLING_NFSE_ALLOW_PRODUCAO.
   */
  app.post('/nfse/documents/:id/cancel', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;
    const parsed = cancelBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Informe justificativa (15 a 255 caracteres).',
        details: parsed.error.flatten(),
        operator_message: 'Informe justificativa (15 a 255 caracteres). codigo_motivo opcional: 1=erro na emissão, 2=serviço não prestado, 3=outros.',
      });
    }
    try {
      const result = await cancelNfseDocument({
        workspaceId,
        documentId: id,
        actorId,
        justificativa: parsed.data.justificativa,
        codigoMotivo: parsed.data.codigo_motivo,
        nPedReg: parsed.data.n_ped_reg,
      });
      await writeAuditLog({
        actor_id: actorId,
        action: 'billing.nfse.cancel',
        entity_type: 'billing_nfse_document',
        entity_id: result.document.id,
        metadata: {
          invoice_id: result.document.invoice_id,
          status: result.document.status,
          canceled: result.canceled,
          protocol: result.protocol,
        },
      });
      return reply.send({
        document: {
          id: result.document.id,
          status: result.document.status,
          last_error: result.document.last_error,
          access_key: result.document.access_key,
          protocol: result.document.protocol,
          dps_number: result.document.dps_number,
          entity_type: result.document.entity_type,
          attempt_number: result.document.attempt_number,
          has_xml: Boolean(result.document.xml_storage_path),
          has_pdf: Boolean(result.document.pdf_storage_path),
        },
        canceled: result.canceled,
        protocol: result.protocol,
        error: result.error ?? result.document.last_error,
      });
    } catch (err) {
      return sendConfigError(reply, err);
    }
  });
}
