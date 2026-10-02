import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requireWorkspace } from '../../lib/workspaceContext';
import { supabase } from '../../lib/supabase';
import { buildCadastroSearchOrFilter, COMMERCIAL_LEAD_SEARCH_CONFIG } from '../../lib/cadastroSearch';
import { writeAuditLog } from '../../lib/auditLog';
import { normalizeBrazilPhone } from '../../lib/brCadastroNormalize';
import { upsertContactByWaPhone } from '../../lib/contactByPhone';
import { resolveOrReuseConversation, updatePrimaryConversationIfActive } from '../../lib/conversationResolve';
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
  contractOnboardingPatchSchema,
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
import {
  mergeContractOnboarding,
  parseContractOnboarding,
  parseSellerPatch,
  resolveContractOnboardingStatus,
  sellerContractChecklist,
  sellerContractMissingLabels,
} from '../../lib/commercial/contractOnboarding';
import { buildLeadScoringResponse } from '../../lib/commercial/scoring';
import { findCommercialLeadByPhone } from '../../lib/commercial/findCommercialLeadByPhone';
import { triggerCommercialLeadScoring, awaitCommercialLeadScoring } from '../../lib/commercial/leadScoringTrigger';
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

export async function registerCommercialLeadRoutes(app: FastifyInstance) {
  // GET /leads
  app.get('/leads', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    await ensureCommercialDefaults(workspaceId);
    const q = request.query as Record<string, string>;
    const { stage_id, owner_id, source, temperature, page = '1', limit = '50' } = q;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabase
      .from('commercial_leads')
      .select('*, stage:commercial_pipeline_stages!stage_id(id, name, is_won, is_lost, probability_pct)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (stage_id) query = query.eq('stage_id', stage_id);
    if (owner_id) query = query.eq('owner_id', owner_id);
    if (source) query = query.eq('source', source);
    if (temperature) query = query.eq('lead_temperature', temperature);

    const searchOr = buildCadastroSearchOrFilter(String(q.q || ''), COMMERCIAL_LEAD_SEARCH_CONFIG);
    if (searchOr) query = query.or(searchOr);

    const { data, error, count } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({
      data: (data || []).map((r) => mapLeadRow(r as Record<string, unknown>)),
      total: count ?? 0,
      page: Number(page),
      limit: Number(limit),
    });
  });

  // GET /leads/import/template
  app.get('/leads/import/template', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    await ensureCommercialDefaults(workspaceId);
    const { data: erpRows } = await supabase
      .from('commercial_erp_options')
      .select('name')
      .eq('workspace_id', workspaceId)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    const erpOptions = (erpRows || []).map((r) => String(r.name));
    const buf = await buildCommercialLeadImportTemplate(erpOptions);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="modelo_importacao_leads.xlsx"')
      .send(buf);
  });

  // POST /leads/import
  app.post('/leads/import', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'Arquivo não enviado.' });
    const buffer = await file.toBuffer();
    if (buffer.length > LEAD_IMPORT_MAX_BYTES) {
      return reply.status(400).send({ error: 'Arquivo excede o limite de 8MB.' });
    }

    await ensureCommercialDefaults(workspaceId);
    const stageId = await getEntryStageId(workspaceId);
    if (!stageId) return reply.status(400).send({ error: 'Estágio inicial não configurado.' });

    const { data: erpRows } = await supabase
      .from('commercial_erp_options')
      .select('name')
      .eq('workspace_id', workspaceId)
      .eq('active', true);
    const validErpNames = (erpRows || []).map((r) => String(r.name));

    const { rows, errors: parseErrors } = await parseCommercialLeadImportWorkbook(buffer, validErpNames);
    const skipped: Array<{ row: number; reason: string }> = [];
    const rowErrors: Array<{ row: number; message: string }> = [...parseErrors];
    let created = 0;

    const { data: existingCnpjs } = await supabase
      .from('commercial_leads')
      .select('cnpj')
      .eq('workspace_id', workspaceId)
      .not('cnpj', 'is', null);
    const cnpjSet = new Set((existingCnpjs || []).map((r) => String(r.cnpj)));
    const fileCnpjs = new Set<string>();

    for (const row of rows) {
      if (row.cnpj) {
        if (cnpjSet.has(row.cnpj) || fileCnpjs.has(row.cnpj)) {
          skipped.push({ row: row.row, reason: 'CNPJ já cadastrado' });
          continue;
        }
        fileCnpjs.add(row.cnpj);
      }

      const { error: insErr } = await supabase.from('commercial_leads').insert({
        workspace_id: workspaceId,
        stage_id: stageId,
        owner_id: user.sub,
        trade_name: row.trade_name,
        phone: row.phone,
        city: row.city,
        state: row.state,
        legal_name: row.legal_name ?? null,
        cnpj: row.cnpj ?? null,
        contact_name: row.contact_name ?? null,
        contact_email: row.contact_email ?? null,
        contact_role: row.contact_role ?? null,
        source: row.source,
        campaign: row.campaign ?? null,
        monthly_deliveries: row.monthly_deliveries ?? null,
        erp: row.erp ?? null,
        notes: row.notes ?? null,
        tags: row.tags,
        custom_fields: row.custom_fields,
      });
      if (insErr) {
        rowErrors.push({ row: row.row, message: insErr.message });
        continue;
      }
      created++;
    }

    await writeAuditLog({
      workspace_id: workspaceId,
      actor_id: user.sub,
      action: 'commercial.leads.import',
      entity_type: 'commercial_leads',
      entity_id: workspaceId,
      metadata: { created, skipped: skipped.length, errors: rowErrors.length },
    });

    return reply.send({ ok: true, created, skipped, errors: rowErrors });
  });

  // POST /leads
  app.post('/leads', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const parsed = leadCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    await ensureCommercialDefaults(workspaceId);
    const body = parsed.data;

    if (body.cnpj) {
      const { data: dup } = await supabase
        .from('commercial_leads')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('cnpj', body.cnpj)
        .maybeSingle();
      if (dup) return reply.status(400).send({ error: 'CNPJ já cadastrado neste workspace.' });
    }

    const phoneDup = await findCommercialLeadByPhone(workspaceId, body.phone);
    if (phoneDup) {
      return reply.status(409).send({
        error: 'Telefone já cadastrado neste workspace.',
        existing_lead_id: phoneDup.id,
      });
    }

    const stageId = body.stage_id || (await getEntryStageId(workspaceId));
    if (!stageId) return reply.status(400).send({ error: 'Estágio inicial não configurado.' });

    const row = {
      workspace_id: workspaceId,
      ...body,
      trade_name: body.trade_name ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      cnpj: body.cnpj ?? null,
      contact_name: body.contact_name ?? null,
      stage_id: stageId,
      owner_id: body.owner_id || user.sub,
      custom_fields: body.custom_fields ?? {},
      tags: body.tags ?? [],
    };

    const { data, error } = await supabase.from('commercial_leads').insert(row).select().single();
    if (error) return reply.status(500).send({ error: error.message });

    await appendLeadActivity({
      workspaceId,
      leadId: data.id as string,
      activityType: 'note',
      title: 'Lead criado',
      createdBy: user.sub,
    });

    await awaitCommercialLeadScoring({
      workspaceId,
      leadId: data.id as string,
      reason: 'lead_created',
    });

    return reply.status(201).send(mapLeadRow(data as Record<string, unknown>));
  });

  // GET /leads/:id
  app.get('/leads/:id', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('commercial_leads')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Lead não encontrado' });
    return reply.send(mapLeadRow(data as Record<string, unknown>));
  });

  // PATCH /leads/:id
  app.patch('/leads/:id', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const { id } = request.params as { id: string };
    const parsed = leadPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const { data: current, error: curErr } = await supabase
      .from('commercial_leads')
      .select('*, stage:commercial_pipeline_stages!stage_id(id, name, is_won, is_lost)')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (curErr) return reply.status(500).send({ error: curErr.message });
    if (!current) return reply.status(404).send({ error: 'Lead não encontrado' });
    if (current.converted_pharmacy_id) return reply.status(400).send({ error: 'Lead já convertido em farmácia.' });

    const updates: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };

    if (parsed.data.cnpj && parsed.data.cnpj !== current.cnpj) {
      const { data: dup } = await supabase
        .from('commercial_leads')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('cnpj', parsed.data.cnpj)
        .neq('id', id)
        .maybeSingle();
      if (dup) return reply.status(400).send({ error: 'CNPJ já cadastrado neste workspace.' });
    }

    if (parsed.data.phone && parsed.data.phone !== current.phone) {
      const phoneDup = await findCommercialLeadByPhone(workspaceId, parsed.data.phone);
      if (phoneDup && phoneDup.id !== id) {
        return reply.status(409).send({
          error: 'Telefone já cadastrado neste workspace.',
          existing_lead_id: phoneDup.id,
        });
      }
    }

    if (parsed.data.stage_id && parsed.data.stage_id !== current.stage_id) {
      const target = await getStageById(workspaceId, parsed.data.stage_id);
      if (!target) return reply.status(400).send({ error: 'Estágio inválido.' });
      if (target.is_won) {
        return reply.status(400).send({ error: 'Use POST /leads/:id/convert para marcar como ganho.' });
      }
      if (target.is_lost && !parsed.data.loss_reason_id) {
        return reply.status(400).send({ error: 'Informe loss_reason_id ou use POST /leads/:id/lose.' });
      }
      const fromName = (current.stage as { name?: string })?.name || '—';
      await appendLeadActivity({
        workspaceId,
        leadId: id,
        activityType: 'stage_change',
        title: `Estágio: ${fromName} → ${target.name}`,
        metadata: { from_stage_id: current.stage_id, to_stage_id: parsed.data.stage_id },
        createdBy: user.sub,
      });
    }

    const { data, error } = await supabase
      .from('commercial_leads')
      .update(updates)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    await awaitCommercialLeadScoring({
      workspaceId,
      leadId: id,
      reason: 'lead_updated',
    });

    return reply.send(mapLeadRow(data as Record<string, unknown>));
  });

  // GET /leads/:id/activities
  app.get('/leads/:id/activities', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('commercial_lead_activities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('lead_id', id)
      .order('created_at', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send((data || []).map((r) => mapActivityRow(r as Record<string, unknown>)));
  });

  // POST /leads/:id/lose
  app.post('/leads/:id/lose', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const { id } = request.params as { id: string };
    const parsed = leadLoseSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const lostStageId = await getTerminalStageId(workspaceId, 'lost');
    if (!lostStageId) return reply.status(400).send({ error: 'Estágio perdido não configurado.' });

    const { data, error } = await supabase
      .from('commercial_leads')
      .update({
        stage_id: lostStageId,
        loss_reason_id: parsed.data.loss_reason_id,
        loss_notes: parsed.data.notes ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .is('converted_pharmacy_id', null)
      .select()
      .single();
    if (error || !data) return reply.status(404).send({ error: 'Lead não encontrado ou já convertido.' });

    await appendLeadActivity({
      workspaceId,
      leadId: id,
      activityType: 'loss',
      title: 'Lead perdido',
      detail: parsed.data.notes || undefined,
      metadata: { loss_reason_id: parsed.data.loss_reason_id },
      createdBy: user.sub,
    });

    return reply.send(mapLeadRow(data as Record<string, unknown>));
  });

  // POST /leads/:id/convert
  app.post('/leads/:id/convert', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const { id } = request.params as { id: string };

    const { data: lead, error: leadErr } = await supabase
      .from('commercial_leads')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (leadErr) return reply.status(500).send({ error: leadErr.message });
    if (!lead) return reply.status(404).send({ error: 'Lead não encontrado' });
    if (lead.converted_pharmacy_id) {
      return reply.send({ pharmacy_id: lead.converted_pharmacy_id, lead: mapLeadRow(lead as Record<string, unknown>) });
    }

    const onboarding = parseContractOnboarding(lead.contract_onboarding);
    const sellerCheck = sellerContractChecklist(onboarding.seller, lead as Record<string, unknown>);
    if (!sellerCheck.complete) {
      const onboardingStatus = resolveContractOnboardingStatus(onboarding, lead as Record<string, unknown>);
      const missingLabels = sellerContractMissingLabels(sellerCheck.missing);
      return reply.status(400).send({
        error:
          missingLabels.length > 0
            ? `Complete o onboarding de contrato antes de converter. Pendente: ${missingLabels.join(', ')}.`
            : 'Complete o onboarding de contrato antes de converter.',
        contract_onboarding_status: onboardingStatus,
        seller_contract_checklist: sellerCheck,
        missing_fields: missingLabels,
      });
    }

    const seller = onboarding.seller || {};
    const wonStageId = await getTerminalStageId(workspaceId, 'won');
    const managerName = lead.legal_representative_name || lead.contact_name;
    const managerPhone = lead.legal_representative_phone || lead.phone;
    const managerEmail = lead.legal_representative_email || lead.contact_email || null;
    const pickupNote = seller.pickup_address_street
      ? [
          'Endereço de coleta:',
          [
            seller.pickup_address_street,
            seller.pickup_address_number,
            seller.pickup_address_neighborhood,
            seller.pickup_city,
            seller.pickup_state,
            seller.pickup_address_cep,
          ]
            .filter(Boolean)
            .join(', '),
        ].join(' ')
      : null;
    const setupNote =
      seller.setup_cents != null
        ? `Setup: R$ ${(seller.setup_cents / 100).toFixed(2)}${seller.setup_parcelado ? ` (${seller.setup_parcelas}x)` : ''}`
        : null;
    const notesParts = [lead.notes, pickupNote, setupNote].filter(Boolean);

    const pharmacyRow = {
      workspace_id: workspaceId,
      legal_name: lead.legal_name || lead.trade_name,
      trade_name: lead.trade_name,
      cnpj: lead.cnpj,
      phone: lead.phone,
      city: lead.city,
      state: lead.state,
      email: lead.contact_email || null,
      contact_manager_name: managerName,
      contact_manager_phone: managerPhone,
      contact_manager_email: managerEmail,
      contact_expedition_name: lead.contact_expedition_name || lead.contact_name,
      contact_expedition_phone: lead.contact_expedition_phone || lead.phone,
      contact_expedition_email: lead.contact_email || null,
      contact_financial_name: lead.contact_financial_name || null,
      contact_financial_phone: lead.contact_financial_phone || null,
      address_cep: lead.address_cep || null,
      address_street: lead.address_street || null,
      address_number: lead.address_number || null,
      address_neighborhood: lead.address_neighborhood || null,
      address_complement: lead.address_complement || null,
      delivery_fee_cents: seller.delivery_fee_cents ?? null,
      delivery_fee_driver_payout_cents: seller.delivery_fee_driver_payout_cents ?? null,
      minimum_guaranteed_cents: seller.minimum_guaranteed_cents ?? null,
      minimum_guaranteed_driver_payout_cents: seller.minimum_guaranteed_driver_payout_cents ?? null,
      delivery_schedule: seller.delivery_schedule || {},
      status: 'active',
      notes: notesParts.length ? notesParts.join('\n') : null,
      tags: lead.tags || [],
    };

    const { data: pharmacy, error: phErr } = await supabase.from('pharmacies').insert(pharmacyRow).select().single();
    if (phErr) return reply.status(500).send({ error: phErr.message });

    const { data: updated, error: updErr } = await supabase
      .from('commercial_leads')
      .update({
        converted_pharmacy_id: pharmacy.id,
        stage_id: wonStageId || lead.stage_id,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (updErr) return reply.status(500).send({ error: updErr.message });

    await appendLeadActivity({
      workspaceId,
      leadId: id,
      activityType: 'won',
      title: 'Lead convertido em farmácia',
      metadata: { pharmacy_id: pharmacy.id },
      createdBy: user.sub,
    });

    await writeAuditLog({
      workspace_id: workspaceId,
      actor_id: user.sub,
      action: 'commercial.lead.convert',
      entity_type: 'commercial_leads',
      entity_id: id,
      metadata: { pharmacy_id: pharmacy.id },
    });

    return reply.send({
      pharmacy_id: pharmacy.id,
      lead: mapLeadRow(updated as Record<string, unknown>),
      prefill: {
        pharmacy_id: pharmacy.id,
        lead_id: id,
        trade_name: lead.trade_name,
        legal_name: lead.legal_name || lead.trade_name,
        cnpj: lead.cnpj,
        phone: lead.phone,
        city: lead.city,
        state: lead.state,
        contact_expedition_name: lead.contact_expedition_name || lead.contact_name,
        contact_expedition_phone: lead.contact_expedition_phone || lead.phone,
        contact_expedition_email: lead.contact_email || '',
        contact_manager_name: managerName,
        contact_manager_phone: managerPhone,
        contact_manager_email: managerEmail || '',
        address_cep: lead.address_cep || '',
        address_street: lead.address_street || '',
        address_number: lead.address_number || '',
        address_neighborhood: lead.address_neighborhood || '',
        address_complement: lead.address_complement || '',
        notes: lead.notes || '',
        erp: lead.erp || '',
        estimated_monthly_deliveries: lead.monthly_deliveries != null ? String(lead.monthly_deliveries) : '',
        estimated_drivers: lead.drivers_count != null ? String(lead.drivers_count) : '',
      },
    });
  });

  // POST /leads/:id/conversation/start
  app.post('/leads/:id/conversation/start', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const { id } = request.params as { id: string };

    const { data: lead, error: leadErr } = await supabase
      .from('commercial_leads')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (leadErr) return reply.status(500).send({ error: leadErr.message });
    if (!lead) return reply.status(404).send({ error: 'Lead não encontrado' });

    let channelId: string;
    try {
      channelId = await resolveCommercialWhatsAppChannel(workspaceId);
    } catch (e) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : 'Canal comercial indisponível' });
    }

    const waPhone = normalizeBrazilPhone(String(lead.phone));
    const displayName = normalizeNameLike(String(lead.trade_name)) || lead.trade_name;

    let contact: Record<string, unknown>;
    try {
      const upserted = await upsertContactByWaPhone(supabase, workspaceId, waPhone, {
        display_name: displayName,
        profile_type: 'commercial_lead',
        commercial_lead_id: id,
      });
      contact = upserted.contact;
    } catch (e: unknown) {
      const message =
        e instanceof Error && e.message.trim()
          ? e.message
          : e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
            ? String((e as { message: string }).message)
            : 'Falha ao resolver contato';
      return reply.status(500).send({ error: message || 'Falha ao resolver contato' });
    }

    let conv: Record<string, unknown>;
    try {
      conv = await resolveOrReuseConversation(supabase, {
        workspaceId,
        contactId: String(contact.id),
        insert: {
          workspace_channel_id: channelId,
          priority: 'normal',
          attendant_id: user.sub,
          context_commercial_lead_id: id,
          tags: ['commercial'],
        },
        reopenPatch: {
          context_commercial_lead_id: id,
          workspace_channel_id: channelId,
          attendant_id: user.sub,
          status: 'open',
          resolved_at: null,
          close_reason: null,
        },
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Falha ao abrir conversa';
      return reply.status(500).send({ error: message });
    }

    await updatePrimaryConversationIfActive(
      supabase,
      workspaceId,
      id,
      String(conv.id),
      String(conv.status || 'open'),
    );

    return reply.status(201).send({ conversation_id: conv!.id, conversation: conv });
  });

  // GET /leads/:id/conversation
  app.get('/leads/:id/conversation', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { data: lead } = await supabase
      .from('commercial_leads')
      .select('primary_conversation_id')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (!lead?.primary_conversation_id) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('context_commercial_lead_id', id)
        .neq('status', 'closed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!conv) return reply.send({ conversation: null, messages: [] });
      return loadConversationWithMessages(workspaceId, conv.id as string, reply);
    }
    return loadConversationWithMessages(workspaceId, lead.primary_conversation_id as string, reply);
  });

  // GET /leads/:id/scoring
  app.get('/leads/:id/scoring', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('commercial_leads')
      .select(
        'ai_score, lead_temperature, ai_score_explanation, ai_score_set_at, updated_at, last_message_at, tags, stage:commercial_pipeline_stages!stage_id(is_won, is_lost)',
      )
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Lead não encontrado' });
    const stage = data.stage as { is_won?: boolean; is_lost?: boolean } | null;
    return reply.send(
      buildLeadScoringResponse({
        ai_score: data.ai_score,
        ai_score_set_at: data.ai_score_set_at,
        ai_score_explanation: data.ai_score_explanation,
        lead_temperature: data.lead_temperature,
        updated_at: data.updated_at,
        last_message_at: data.last_message_at,
        tags: data.tags as string[] | null,
        stage_is_won: stage?.is_won,
        stage_is_lost: stage?.is_lost,
      }),
    );
  });

  // POST /leads/:id/scoring/refresh
  app.post('/leads/:id/scoring/refresh', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('commercial_leads')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Lead não encontrado' });

    await awaitCommercialLeadScoring({
      workspaceId,
      leadId: id,
      reason: 'manual_refresh',
      force: true,
    });

    return reply.send({ ok: true, status: 'ready' });
  });

  // PATCH /leads/:id/contract-onboarding
  app.patch('/leads/:id/contract-onboarding', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const { id } = request.params as { id: string };

    const parsed = contractOnboardingPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }

    const { data: lead, error: leadErr } = await supabase
      .from('commercial_leads')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (leadErr) return reply.status(500).send({ error: leadErr.message });
    if (!lead) return reply.status(404).send({ error: 'Lead não encontrado' });

    const { seller: sellerPatch, leadPatch, error: parseErr } = parseSellerPatch(
      parsed.data as Record<string, unknown>,
    );
    if (parseErr) return reply.status(400).send({ error: parseErr });

    const mergedSeller = { ...(parseContractOnboarding(lead.contract_onboarding).seller || {}), ...sellerPatch };
    const interimLead = { ...lead, ...leadPatch };
    const sellerCheck = sellerContractChecklist(mergedSeller, interimLead as Record<string, unknown>);
    const now = new Date().toISOString();
    const status = sellerCheck.complete ? 'complete' : 'lead_submitted';

    const onboarding = mergeContractOnboarding(lead.contract_onboarding, {
      status,
      seller: mergedSeller,
      seller_completed_at: sellerCheck.complete ? now : null,
    });

    const { data: updated, error: updErr } = await supabase
      .from('commercial_leads')
      .update({
        ...leadPatch,
        contract_onboarding: onboarding,
        updated_at: now,
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (updErr) return reply.status(500).send({ error: updErr.message });

    if (sellerCheck.complete) {
      await appendLeadActivity({
        workspaceId,
        leadId: id,
        activityType: 'note',
        title: 'Dados de contrato completados pelo vendedor',
        metadata: { contract_onboarding_complete: true },
        createdBy: user.sub,
      });
    }

    return reply.send(mapLeadRow(updated as Record<string, unknown>));
  });

  // POST /leads/:id/data-request
  app.post('/leads/:id/data-request', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const { id } = request.params as { id: string };

    const { data: lead, error: leadErr } = await supabase
      .from('commercial_leads')
      .select('id, trade_name, contact_name, contract_onboarding')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (leadErr) return reply.status(500).send({ error: leadErr.message });
    if (!lead) return reply.status(404).send({ error: 'Lead não encontrado' });

    await supabase
      .from('commercial_data_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('lead_id', id)
      .eq('status', 'pending');

    const { token, tokenHash } = generateDataRequestToken();
    const ttlDays = commercialDataRequestTtlDays();
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: created, error: insErr } = await supabase
      .from('commercial_data_requests')
      .insert({
        workspace_id: workspaceId,
        lead_id: id,
        token_hash: tokenHash,
        status: 'pending',
        required_fields: defaultRequiredFields(),
        expires_at: expiresAt,
        created_by: user.sub,
      })
      .select('id, expires_at')
      .single();
    if (insErr) return reply.status(500).send({ error: insErr.message });

    const onboarding = mergeContractOnboarding(lead.contract_onboarding, {
      status: 'awaiting_lead',
      data_request_id: created.id,
      lead_submitted_at: null,
      lead_snapshot: null,
    });
    await supabase
      .from('commercial_leads')
      .update({ contract_onboarding: onboarding, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id);

    const url = resolveCommercialDataRequestPublicUrl(token);
    await appendLeadActivity({
      workspaceId,
      leadId: id,
      activityType: 'data_request_sent',
      title: 'Link de preenchimento de dados enviado',
      metadata: { data_request_id: created.id, url },
      createdBy: user.sub,
    });

    return reply.send({
      data_request_id: created.id,
      url,
      expires_at: created.expires_at,
      token,
    });
  });

  // Rotas específicas ANTES de /dimensioning (evita conflito no roteador)
  // POST /leads/:id/dimensioning/select
  app.post('/leads/:id/dimensioning/select', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = dimensioningSelectSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'cenario_id inválido (enxuto ou integral)' });
    try {
      console.info('[commercial][dimensioning/select] request', {
        workspaceId,
        leadId: id,
        cenarioId: parsed.data.cenario_id,
      });
      const snapshot = await selectLeadDimensioningScenario(workspaceId, id, parsed.data.cenario_id, {
        domingo_aberto: parsed.data.domingo_aberto,
      });
      console.info('[commercial][dimensioning/select] ok', {
        leadId: id,
        cenario_selecionado: snapshot.cenario_selecionado,
        entregadores: snapshot.quantidade_entregadores_recomendada,
        valor_lead_cents: snapshot.valor_lead_anual_cents,
      });
      return reply.send({ operational_snapshot: snapshot });
    } catch (e) {
      console.error('[commercial][dimensioning/select] fail', {
        leadId: id,
        message: e instanceof Error ? e.message : String(e),
      });
      if (e instanceof DimensionamentoMissingError || e instanceof DimensionamentoScenarioInvalidError) {
        return reply.status(400).send({ error: e.message });
      }
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao selecionar cenário' });
    }
  });

  // POST /leads/:id/dimensioning/commercial — setup, pacote e overrides
  app.post('/leads/:id/dimensioning/commercial', { preHandler: proposalPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const { id } = request.params as { id: string };
    const parsed = propostaComercialSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    try {
      const snapshot = await saveLeadPropostaComercial(workspaceId, id, parsed.data, user.sub);
      await appendLeadActivity({
        workspaceId,
        leadId: id,
        activityType: 'note',
        title: 'Proposta comercial atualizada',
        detail: `Setup: R$ ${((snapshot.proposta_comercial?.setup_cents ?? 0) / 100).toFixed(2)}`,
        metadata: { proposta_comercial: snapshot.proposta_comercial },
        createdBy: user.sub,
      });
      return reply.send({ operational_snapshot: snapshot });
    } catch (e) {
      if (e instanceof DimensionamentoMissingError) {
        return reply.status(400).send({ error: e.message });
      }
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao salvar proposta comercial' });
    }
  });

  // POST /leads/:id/dimensioning/confirm
  app.post('/leads/:id/dimensioning/confirm', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      const confirmed = await confirmLeadDimensioning(workspaceId, id);
      return reply.send({ confirmed: true, operational_snapshot: confirmed });
    } catch (e) {
      if (e instanceof DimensionamentoMissingError || e instanceof DimensionamentoScenarioRequiredError) {
        return reply.status(400).send({ error: e.message });
      }
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao confirmar análise' });
    }
  });

  // POST /leads/:id/dimensioning
  app.post('/leads/:id/dimensioning', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data: lead, error } = await supabase
      .from('commercial_leads')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!lead) return reply.status(404).send({ error: 'Lead não encontrado' });

    try {
      await assertLeadStageAllowsViability(workspaceId, String(lead.stage_id));
      assertLeadOperationalReadiness(lead as Record<string, unknown>);
      const { dimensionamento, meta } = await runLeadDimensioningWithConfig(
        workspaceId,
        lead as Record<string, unknown>,
      );
      await saveLeadDimensioningSnapshot(workspaceId, id, dimensionamento, meta);
      const result = await computeEnhancedViability(workspaceId, {
        ...(lead as Record<string, unknown>),
        operational_snapshot: attachConfigToSnapshot(dimensionamento, meta),
      });
      return reply.send(result);
    } catch (e) {
      if (e instanceof LeadStageViabilityForbiddenError) {
        return reply.status(403).send({ error: e.message });
      }
      if (e instanceof LeadOperationalNotReadyError) {
        return reply.status(400).send({ error: e.message, missing: e.missing });
      }
      if (e instanceof DimensionamentoValidationError) {
        return reply.status(400).send({ error: e.message });
      }
      return reply.status(400).send({ error: e instanceof Error ? e.message : 'Erro no dimensionamento' });
    }
  });

  // POST /leads/:id/viability
  app.post('/leads/:id/viability', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data: lead, error } = await supabase
      .from('commercial_leads')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!lead) return reply.status(404).send({ error: 'Lead não encontrado' });

    try {
      await assertLeadStageAllowsViability(workspaceId, String(lead.stage_id));
      assertLeadOperationalReadiness(lead as Record<string, unknown>);
      const result = await computeEnhancedViability(workspaceId, lead as Record<string, unknown>);
      const hydrated = rehydrateOperationalSnapshot(result.dimensionamento);
      await saveLeadDimensioningSnapshot(workspaceId, id, hydrated, {
        config_version: result.config_version ?? 1,
        config_hash: result.config_hash ?? '',
        config_applied_at: result.config_applied_at ?? new Date().toISOString(),
      });
      return reply.send({ ...result, dimensionamento: hydrated, valor_lead_anual_cents: hydrated.valor_lead_anual_cents });
    } catch (e) {
      if (e instanceof LeadStageViabilityForbiddenError) {
        return reply.status(403).send({ error: e.message });
      }
      if (e instanceof LeadOperationalNotReadyError) {
        return reply.status(400).send({ error: e.message, missing: e.missing });
      }
      if (e instanceof DimensionamentoValidationError) {
        return reply.status(400).send({ error: e.message });
      }
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro na viabilidade' });
    }
  });

async function loadConversationWithMessages(workspaceId: string, conversationId: string, reply: { send: (p: unknown) => unknown }) {
  const { data: conversation, error: cErr } = await supabase
    .from('conversations')
    .select('*, contacts(id, wa_phone, display_name, profile_type)')
    .eq('workspace_id', workspaceId)
    .eq('id', conversationId)
    .maybeSingle();
  if (cErr) return reply.send({ error: cErr.message });
  const { data: messages, error: mErr } = await supabase
    .from('messages')
    .select('id, direction, content, created_at, status, type')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (mErr) return reply.send({ error: mErr.message });
  return reply.send({ conversation, messages: messages || [] });
}
}
