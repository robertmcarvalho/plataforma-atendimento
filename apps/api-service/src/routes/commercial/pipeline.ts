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

const COMMERCIAL_OWNER_ROLES = new Set(['commercial', 'sales']);

export async function registerCommercialPipelineRoutes(app: FastifyInstance) {
  // GET /owners — vendedores do CRM (roles commercial/sales), não atendentes operacionais
  app.get('/owners', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const { data: memberships, error } = await supabase
      .from('workspace_memberships')
      .select('user_id, is_active, users!inner(id, name, is_active), roles!inner(name)')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);
    if (error) return reply.status(500).send({ error: error.message });

    const owners = new Map<string, { id: string; name: string }>();
    for (const row of memberships || []) {
      const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
      const user = Array.isArray(row.users) ? row.users[0] : row.users;
      const roleName = String((role as { name?: string })?.name || '').toLowerCase();
      if (!COMMERCIAL_OWNER_ROLES.has(roleName)) continue;
      if (!(user as { is_active?: boolean })?.is_active || !(user as { id?: string })?.id) continue;
      const id = String((user as { id: string }).id);
      owners.set(id, { id, name: String((user as { name: string }).name) });
    }

    const { data: leadRows } = await supabase
      .from('commercial_leads')
      .select('owner_id, owner:users!owner_id(id, name, is_active)')
      .eq('workspace_id', workspaceId);
    for (const row of leadRows || []) {
      const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
      if (!(owner as { is_active?: boolean })?.is_active || !(owner as { id?: string })?.id) continue;
      const id = String((owner as { id: string }).id);
      if (!owners.has(id)) {
        owners.set(id, { id, name: String((owner as { name: string }).name) });
      }
    }

    return reply.send(
      [...owners.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    );
  });

  // GET /pipeline-stages
  app.get('/pipeline-stages', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    await ensureCommercialDefaults(workspaceId);
    const { data, error } = await supabase
      .from('commercial_pipeline_stages')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('sort_order', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send((data || []).map((r) => mapStageRow(r as Record<string, unknown>)));
  });

  // PUT /pipeline-stages
  app.put('/pipeline-stages', { preHandler: [...commercialPre, requireCommercialSettings()] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = z.array(pipelineStageInputSchema).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const saved: Record<string, unknown>[] = [];
    for (const s of parsed.data) {
      const row = {
        workspace_id: workspaceId,
        name: s.name,
        sort_order: s.sort_order,
        color: s.color || '#6366f1',
        probability_pct: s.probability_pct ?? s.probability ?? 0,
        is_won: Boolean(s.is_won),
        is_lost: Boolean(s.is_lost),
        is_entry: Boolean(s.is_entry),
        updated_at: new Date().toISOString(),
      };
      if (s.id) {
        const { data, error } = await supabase
          .from('commercial_pipeline_stages')
          .update(row)
          .eq('workspace_id', workspaceId)
          .eq('id', s.id)
          .select()
          .single();
        if (error) return reply.status(500).send({ error: error.message });
        saved.push(data as Record<string, unknown>);
      } else {
        const { data, error } = await supabase.from('commercial_pipeline_stages').insert(row).select().single();
        if (error) return reply.status(500).send({ error: error.message });
        saved.push(data as Record<string, unknown>);
      }
    }
    const keptIds = new Set(
      saved.map((row) => String((row as { id?: string }).id || '')).filter(Boolean),
    );
    const { data: existingStages, error: listErr } = await supabase
      .from('commercial_pipeline_stages')
      .select('id, is_won, is_lost, is_entry')
      .eq('workspace_id', workspaceId);
    if (listErr) return reply.status(500).send({ error: listErr.message });

    const removable = (existingStages || []).filter((stage) => {
      const id = String(stage.id);
      if (keptIds.has(id)) return false;
      if (stage.is_won || stage.is_lost || stage.is_entry) return false;
      return true;
    });

    for (const stage of removable) {
      const stageId = String(stage.id);
      const { count: leadCount, error: leadCountErr } = await supabase
        .from('commercial_leads')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('stage_id', stageId);
      if (leadCountErr) return reply.status(500).send({ error: leadCountErr.message });

      if (leadCount && leadCount > 0) {
        const entryId = await getEntryStageId(workspaceId);
        if (!entryId) {
          return reply.status(400).send({
            error: 'Não foi possível remover o estágio: há leads vinculados e não há estágio de entrada.',
          });
        }
        const { error: moveErr } = await supabase
          .from('commercial_leads')
          .update({ stage_id: entryId, updated_at: new Date().toISOString() })
          .eq('workspace_id', workspaceId)
          .eq('stage_id', stageId);
        if (moveErr) return reply.status(500).send({ error: moveErr.message });
      }

      const { error: delErr } = await supabase
        .from('commercial_pipeline_stages')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('id', stageId);
      if (delErr) return reply.status(500).send({ error: delErr.message });
    }

    await writeAuditLog({
      workspace_id: workspaceId,
      actor_id: (request.user as { sub?: string }).sub ?? null,
      action: 'commercial.pipeline_stages.update',
      entity_type: 'commercial_pipeline_stages',
      entity_id: workspaceId,
      metadata: { count: saved.length, removed: removable.length },
    });

    const { data: finalStages, error: finalErr } = await supabase
      .from('commercial_pipeline_stages')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('sort_order', { ascending: true });
    if (finalErr) return reply.status(500).send({ error: finalErr.message });

    return reply.send((finalStages || []).map((r) => mapStageRow(r as Record<string, unknown>)));
  });

  // GET /loss-reasons
  app.get('/loss-reasons', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    await ensureCommercialDefaults(workspaceId);
    const { data, error } = await supabase
      .from('commercial_loss_reasons')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('sort_order', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  // PUT /loss-reasons
  app.put('/loss-reasons', { preHandler: [...commercialPre, requireCommercialSettings()] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = z.array(lossReasonInputSchema).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    await supabase.from('commercial_loss_reasons').delete().eq('workspace_id', workspaceId);
    const rows = parsed.data.map((r, i) => ({
      workspace_id: workspaceId,
      name: r.name,
      active: r.active ?? true,
      sort_order: r.sort_order ?? i,
    }));
    const { data, error } = await supabase.from('commercial_loss_reasons').insert(rows).select();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  // GET /erp-options
  app.get('/erp-options', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    await ensureCommercialDefaults(workspaceId);
    const { data, error } = await supabase
      .from('commercial_erp_options')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('sort_order', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  // PUT /erp-options
  app.put('/erp-options', { preHandler: [...commercialPre, requireCommercialSettings()] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = z.array(erpOptionInputSchema).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    await supabase.from('commercial_erp_options').delete().eq('workspace_id', workspaceId);
    const rows = parsed.data.map((r, i) => ({
      workspace_id: workspaceId,
      name: r.name,
      active: r.active ?? true,
      sort_order: r.sort_order ?? i,
    }));
    const { data, error } = await supabase.from('commercial_erp_options').insert(rows).select();
    if (error) return reply.status(500).send({ error: error.message });

    await writeAuditLog({
      workspace_id: workspaceId,
      actor_id: (request.user as { sub?: string }).sub ?? null,
      action: 'commercial.erp_options.update',
      entity_type: 'commercial_erp_options',
      entity_id: workspaceId,
      metadata: { count: rows.length },
    });

    return reply.send(data || []);
  });

  // GET /field-definitions
  app.get('/field-definitions', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    await ensureCommercialDefaults(workspaceId);
    const { data, error } = await supabase
      .from('commercial_field_definitions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('sort_order', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send((data || []).map((r) => mapFieldDefinitionRow(r as Record<string, unknown>)));
  });

  // PUT /field-definitions
  app.put('/field-definitions', { preHandler: [...commercialPre, requireCommercialSettings()] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = z.array(fieldDefinitionInputSchema).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    await supabase.from('commercial_field_definitions').delete().eq('workspace_id', workspaceId);
    const rows = parsed.data.map((f, i) => ({
      workspace_id: workspaceId,
      slug: f.slug,
      label: f.label,
      field_type: f.field_type || f.type || 'text',
      required: f.required ?? false,
      options: f.options ?? [],
      sort_order: f.sort_order ?? i,
    }));
    const { data, error } = await supabase.from('commercial_field_definitions').insert(rows).select();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send((data || []).map((r) => mapFieldDefinitionRow(r as Record<string, unknown>)));
  });
}
