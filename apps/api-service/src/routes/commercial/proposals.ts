import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requireWorkspace } from '../../lib/workspaceContext';
import { supabase } from '../../lib/supabase';
import { buildCadastroSearchOrFilter, COMMERCIAL_LEAD_SEARCH_CONFIG } from '../../lib/cadastroSearch';
import { writeAuditLog } from '../../lib/auditLog';
import { normalizeBrazilPhone } from '../../lib/brCadastroNormalize';
import { normalizeNameLike } from '../../lib/textNormalization';
import {
  requireCommercialModule,
  requireCommercialProposals,
  requireCommercialRole,
  requireCommercialSettings,
} from '../../lib/commercial/commercialAuth';
import { resolveCommercialWhatsAppChannel } from '../../lib/commercial/commercialChannel';
import { appendLeadActivity } from '../../lib/commercial/activities';
import {
  ensureCommercialDefaults,
  getEntryStageId,
  getStageById,
  getTerminalStageId,
} from '../../lib/commercial/pipelineStages';
import {
  fieldDefinitionInputSchema,
  leadCreateSchema,
  leadLoseSchema,
  leadPatchSchema,
  lossReasonInputSchema,
  erpOptionInputSchema,
  pipelineStageInputSchema,
  proposalCreateSchema,
  proposalNotesSchema,
  propostaComercialSchema,
  dimensioningSelectSchema,
  viabilityCheckSchema,
} from '../../lib/commercial/leadSchemas';
import {
  mapActivityRow,
  mapFieldDefinitionRow,
  mapLeadRow,
  mapProposalRow,
  mapStageRow,
} from '../../lib/commercial/serialize';
import {
  buildCommercialLeadImportTemplate,
  IMPORT_MAX_BYTES as LEAD_IMPORT_MAX_BYTES,
  parseCommercialLeadImportWorkbook,
} from '../../lib/commercial/excelCommercialLeadImport';
import {
  commercialDataRequestTtlDays,
  defaultRequiredFields,
  generateDataRequestToken,
} from '../../lib/commercial/dataRequest';
import { resolveCommercialDataRequestPublicUrl } from '../../lib/webAppUrl';
import { computeEnhancedViability } from '../../lib/commercial/enhancedViability';
import { computeViability } from '../../lib/commercial/viability';
import {
  assertLeadOperationalReadiness,
  LeadOperationalNotReadyError,
} from '../../lib/commercial/leadOperationalReadiness';
import {
  assertLeadStageAllowsViability,
  LeadStageViabilityForbiddenError,
} from '../../lib/commercial/commercialViabilityGuard';
import { DimensionamentoValidationError } from '../../lib/commercial/operationalDimensioning';
import { rehydrateOperationalSnapshot } from '../../lib/commercial/commercialSnapshotFinance';
import { hasCustomMotorConfig, resolveCommercialMotorConfig, saveCommercialMotorConfig } from '../../lib/commercial/commercialMotorConfig';
import { motorConfigPatchSchema, motorSimulateSchema } from '../../lib/commercial/commercialMotorConfigCore';
import {
  attachConfigToSnapshot,
  runLeadDimensioningWithConfig,
  simulateMotorDimensioning,
} from '../../lib/commercial/commercialMotorRuntime';
import {
  confirmLeadDimensioning,
  createProposalFromConfirmedSnapshot,
  DimensionamentoMissingError,
  DimensionamentoNotConfirmedError,
  DimensionamentoScenarioInvalidError,
  DimensionamentoScenarioRequiredError,
  ProposalPdfGenerationError,
  loadProposalDocx,
  loadProposalPdf,
  regenerateProposalPdf,
  saveLeadDimensioningSnapshot,
  saveLeadPropostaComercial,
  saveProposalNotes,
  selectLeadDimensioningScenario,
} from '../../lib/commercial/proposalService';
import { commercialPre, proposalPre } from './shared';

export async function registerCommercialProposalRoutes(app: FastifyInstance) {
  // POST /proposals
  app.post('/proposals', { preHandler: proposalPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const parsed = proposalCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    try {
      const { proposal, dimensionamento, pdfWarning } = await createProposalFromConfirmedSnapshot({
        workspaceId,
        leadId: parsed.data.lead_id,
        packageName: parsed.data.package_name,
        setupCents: parsed.data.setup_cents,
        setupPagamento: parsed.data.setup_pagamento,
        setupParcelas: parsed.data.setup_parcelas,
        monthlyCents: parsed.data.monthly_cents,
        notes: parsed.data.notes,
      });

      const version = Number(proposal.version ?? 1);
      await appendLeadActivity({
        workspaceId,
        leadId: parsed.data.lead_id,
        activityType: 'proposal',
        title: `Proposta v${version} criada`,
        detail: `Valor lead anual (30% margem): R$ ${(dimensionamento.valor_lead_anual_cents / 100).toFixed(2)}`,
        metadata: { proposal_id: proposal.id, deal_value_cents: dimensionamento.valor_lead_anual_cents },
        createdBy: user.sub,
      });

      return reply.status(201).send({
        ...mapProposalRow(proposal as Record<string, unknown>),
        operational_snapshot: dimensionamento,
        deal_value_cents: dimensionamento.valor_lead_anual_cents,
        pdf_warning: pdfWarning ?? null,
      });
    } catch (e) {
      if (e instanceof DimensionamentoMissingError || e instanceof DimensionamentoNotConfirmedError) {
        return reply.status(400).send({ error: e.message });
      }
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao gerar proposta' });
    }
  });

  // GET /proposals/:id
  app.get('/proposals/:id', { preHandler: proposalPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('commercial_proposals')
      .select(
        'id, lead_id, version, status, package_name, setup_cents, monthly_cents, mdr_pct, notes, created_at, sent_at, operational_snapshot, document_source, document_saved_at, template_version, pdf_generated_at, pdf_storage_path, docx_storage_path, document_html',
      )
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Proposta não encontrada' });
    return reply.send(mapProposalRow(data as Record<string, unknown>));
  });

  // PUT /proposals/:id/document — legado (HTML)
  app.put('/proposals/:id/document', { preHandler: proposalPre }, async (_request, reply) => {
    return reply.status(410).send({
      error:
        'Edição HTML descontinuada. Use Regenerar proposta após alterar a viabilidade ou PUT /notes para observações.',
    });
  });

  // PUT /proposals/:id/notes
  app.put('/proposals/:id/notes', { preHandler: proposalPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = proposalNotesSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'notes inválido' });
    try {
      const row = await saveProposalNotes({
        workspaceId,
        proposalId: id,
        notes: parsed.data.notes,
      });
      return reply.send(mapProposalRow(row));
    } catch (e) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : 'Erro ao salvar observações' });
    }
  });

  // POST /proposals/:id/regenerate — DOCX + PDF do snapshot
  app.post('/proposals/:id/regenerate', { preHandler: proposalPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      const row = await regenerateProposalPdf({ workspaceId, proposalId: id });
      return reply.send(mapProposalRow(row));
    } catch (e) {
      if (e instanceof ProposalPdfGenerationError) {
        return reply.status(503).send({ error: e.message });
      }
      return reply.status(400).send({ error: e instanceof Error ? e.message : 'Erro ao regenerar proposta' });
    }
  });

  // POST /proposals/:id/regenerate-document — alias legado
  app.post('/proposals/:id/regenerate-document', { preHandler: proposalPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      const row = await regenerateProposalPdf({ workspaceId, proposalId: id });
      return reply.send(mapProposalRow(row));
    } catch (e) {
      if (e instanceof ProposalPdfGenerationError) {
        return reply.status(503).send({ error: e.message });
      }
      return reply.status(400).send({ error: e instanceof Error ? e.message : 'Erro ao regenerar proposta' });
    }
  });

  // GET /proposals/:id/docx
  app.get('/proposals/:id/docx', { preHandler: proposalPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      const docx = await loadProposalDocx({ workspaceId, proposalId: id });
      if (!docx) return reply.status(404).send({ error: 'Proposta não encontrada' });
      return reply
        .header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )
        .header('Content-Disposition', `attachment; filename="${docx.filename}"`)
        .send(docx.buffer);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao baixar DOCX' });
    }
  });

  // GET /proposals/:id/pdf
  app.get('/proposals/:id/pdf', { preHandler: proposalPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      const pdf = await loadProposalPdf({ workspaceId, proposalId: id });
      if (!pdf) return reply.status(404).send({ error: 'Proposta não encontrada' });
      const query = request.query as { disposition?: string };
      const inline = query.disposition === 'inline';
      return reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `${inline ? 'inline' : 'attachment'}; filename="${pdf.filename}"`,
        )
        .send(pdf.buffer);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao gerar PDF' });
    }
  });

  // POST /proposals/:id/send
  app.post('/proposals/:id/send', { preHandler: proposalPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('commercial_proposals')
      .update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error || !data) return reply.status(404).send({ error: 'Proposta não encontrada' });

    await appendLeadActivity({
      workspaceId,
      leadId: data.lead_id as string,
      activityType: 'proposal',
      title: `Proposta v${data.version} enviada`,
      metadata: { proposal_id: id },
      createdBy: user.sub,
    });

    return reply.send(mapProposalRow(data as Record<string, unknown>));
  });
}
