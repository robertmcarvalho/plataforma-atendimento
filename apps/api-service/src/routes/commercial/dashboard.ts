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

export async function registerCommercialDashboardRoutes(app: FastifyInstance) {
  // GET /dashboard
  app.get('/dashboard', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    await ensureCommercialDefaults(workspaceId);
    const q = request.query as Record<string, string>;
    const ownerFilter = q.owner_id || null;
    const sourceFilter = q.source || null;

    let leadsQuery = supabase
      .from('commercial_leads')
      .select('id, stage_id, deal_value_cents, updated_at, created_at, converted_pharmacy_id, loss_reason_id, owner_id, source, stage:commercial_pipeline_stages!stage_id(probability_pct, is_won, is_lost)')
      .eq('workspace_id', workspaceId);
    if (ownerFilter) leadsQuery = leadsQuery.eq('owner_id', ownerFilter);
    if (sourceFilter) leadsQuery = leadsQuery.eq('source', sourceFilter);

    const { data: leads, error } = await leadsQuery;
    if (error) return reply.status(500).send({ error: error.message });

    const rows = leads || [];
    const byStage: Record<string, number> = {};
    let weightedPipeline = 0;
    let wonCount = 0;
    let lostCount = 0;
    let stagnant = 0;
    const now = Date.now();

    for (const l of rows) {
      const sid = String(l.stage_id);
      byStage[sid] = (byStage[sid] || 0) + 1;
      const stage = l.stage as { probability_pct?: number; is_won?: boolean; is_lost?: boolean } | null;
      if (stage?.is_won || l.converted_pharmacy_id) wonCount += 1;
      if (stage?.is_lost || l.loss_reason_id) lostCount += 1;
      if (!stage?.is_won && !stage?.is_lost) {
        const cents = Number(l.deal_value_cents || 0);
        const prob = Number(stage?.probability_pct || 0) / 100;
        weightedPipeline += cents * prob;
        const updated = l.updated_at ? new Date(l.updated_at as string).getTime() : 0;
        if (updated && now - updated > 14 * 86400000) stagnant += 1;
      }
    }

    const { data: stages } = await supabase
      .from('commercial_pipeline_stages')
      .select('id, name, sort_order')
      .eq('workspace_id', workspaceId)
      .order('sort_order');

    return reply.send({
      total_leads: rows.length,
      by_stage: (stages || []).map((s) => ({
        stage_id: s.id,
        stage_name: s.name,
        count: byStage[String(s.id)] || 0,
      })),
      won_count: wonCount,
      lost_count: lostCount,
      weighted_pipeline_cents: Math.round(weightedPipeline),
      stagnant_count: stagnant,
    });
  });

  // POST /viability/check
  app.post('/viability/check', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = viabilityCheckSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    const { city, state, volume } = parsed.data;
    const cityNorm = normalizeNameLike(city) || city;
    const uf = state.toUpperCase();
    const motor = await resolveCommercialMotorConfig(workspaceId);
    const result = await computeViability(workspaceId, cityNorm, uf, volume, motor);
    return reply.send(result);
  });

  // GET /motor-config
  app.get('/motor-config', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const config = await resolveCommercialMotorConfig(workspaceId);
    const is_default = !(await hasCustomMotorConfig(workspaceId));
    return reply.send({ config, is_default });
  });

  // PUT /motor-config
  app.put('/motor-config', { preHandler: [...commercialPre, requireCommercialSettings()] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const parsed = motorConfigPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Configuração inválida', details: parsed.error.flatten() });
    }
    try {
      const config = await saveCommercialMotorConfig(workspaceId, parsed.data);
      await writeAuditLog({
        workspace_id: workspaceId,
        actor_id: user.sub,
        action: 'commercial_motor_config_update',
        entity_type: 'app_setting',
        entity_id: 'commercial_motor_config',
        metadata: { config_version: config.version },
      });
      return reply.send({ config });
    } catch (e) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : 'Erro ao salvar configuração' });
    }
  });

  // POST /motor-config/simulate
  app.post('/motor-config/simulate', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = motorSimulateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    try {
      const result = await simulateMotorDimensioning({
        workspaceId,
        city: body.city,
        state: body.state,
        entregas_media_dia: body.entregas_media_dia,
        entregas_media_mes: body.entregas_media_mes,
        perfil_cidade: body.perfil_cidade,
        valor_entrega_informado: body.valor_entrega_informado,
        motorPatch: body.motor_config,
      });
      return reply.send(result);
    } catch (e) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : 'Erro na simulação' });
    }
  });
}
