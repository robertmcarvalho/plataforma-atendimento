import axios from 'axios';
import {
  applyMessageReplacements,
  canonicalBrazilWaPhone,
  onlyDigits,
  waPhoneLookupVariants,
  findOpenConversationForContact,
  findReopenableConversationForContact,
  isUniqueOpenConversationViolation,
  mergeDuplicateOpenConversations,
} from '@plataforma/channel-runtime';
import { resolveSystemNoteAuthorId } from '@plataforma/operational-notes';
import { addBusinessMinutes, hasCanonicalBusinessHours, isOpen, normalizeBusinessHours, type BusinessHoursConfig } from './lib/businessHours';
import { isSectorClosedNow, maybeOutOfHoursNotice, maybeQueueWaitingNotice, refreshConversationSla } from './lib/conversationSla';
import { tryOperationalOutOfHoursOnInbound } from './lib/operationalChannelMessaging';
import { executeToolCallMcp, getMcpToolRegistry, type McpCallInput } from './mcp/toolCallMcp';
import { type GuidedDemandProfile } from './guidedIntake';
import {
  loadWorkspaceCatalog,
  runtimeCatalogMessage,
  runtimeListDemandsForSector,
  runtimeSlaPresetForDemand,
  setActiveWorkspaceCatalog,
} from './workspaceCatalogRuntime';
import { tryConversationFlowTurn } from './conversationFlowRuntime';
import { resolveChannelPurpose, tryProcessCommercialBotTurn } from './commercialBotRuntime';
import {
  getActiveFlowRuntimeMode,
  loadWorkspaceFlowRuntimeMode,
  setActiveFlowRuntimeMode,
} from './workspaceRuntimeMode';
import { postWhatsAppMessage, setOutboundWorkspaceId } from './lib/whatsappOutbound';
import {
  formatQueueSlaAppliedNote,
  formatTriagemCompleteNote,
  formatTriagemGuidadaNote,
} from '@plataforma/operational-notes';
import {
  buildLeaderDriverListRows,
  getDriversAtPharmacyForLeader,
  isDriverLinkedToPharmacy,
  LEADER_DRIVER_NONE_ID,
  LEADER_DRIVER_NO_ID,
  LEADER_DRIVER_YES_ID,
  needsNumberedLeaderDriverMenu,
  normalizeLeaderPharmacyRows,
  type LeaderDriverOption,
  type LeaderPharmacyRow,
} from './leaderIntake';
import { supabase, orchestratorConsole as console } from './lib/orchestratorContext';
import {
  BOT_INBOUND_META_DEDUP_KEY,
  BOT_SESSION_TTL_HOURS,
  GUIDED_INTAKE_FIRST,
  LATENCY_TARGETS_MS,
  LEGACY_BOT_SESSION_ENABLED,
  LEGACY_INTENT_TO_SECTOR,
  NUMBERED_MENU_PAGE_SIZE,
  NUMBERED_MENU_TITLE_MAX,
  WA_BTN_TITLE_MAX,
  WA_LIST_BTN_DEMANDS,
  WA_LIST_BTN_DRIVERS,
  WA_LIST_BTN_PHARMACIES,
  WA_LIST_BTN_PROFILES,
  WA_LIST_BTN_SECTORS,
  WA_LIST_MAX_ROWS,
  WA_LIST_ROW_TITLE_MAX,
  WA_LIST_SECTION_DEMANDS,
  WA_LIST_SECTION_DRIVERS,
  WA_LIST_SECTION_PHARMACIES,
  WA_LIST_SECTION_PROFILES,
  WA_LIST_SECTION_SECTORS,
} from './lib/orchestratorConfig';
import {
  elapsedMs,
  isUuid,
  logDuration,
  normalizeIntent,
  normalizeText,
  toStringArray,
} from './lib/orchestratorUtils';

/** Cache do primeiro `users.id` usado como autor de notas internas geradas pelo bot. */
function buildSummary(raw: string) {
  const text = (raw || '').replaceAll(/\s+/g, ' ').trim();
  if (!text) return null;
  const max = 220;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function ensureConversationSummary(conversationId: string, inboundText: string) {
  const summary = buildSummary(inboundText);
  if (!summary) return;

  const { data: current } = await supabase
    .from('conversations')
    .select('summary')
    .eq('id', conversationId)
    .single();

  if (current?.summary) return;

  await supabase
    .from('conversations')
    .update({ summary, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
}

async function dispatchLegacyBotStep(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  msg: Record<string, unknown>,
  rawContent: string
) {
  switch (session.current_step) {
    case 'identify':
      await stepIdentify(contact, conversation, session, rawContent);
      break;
    case 'ask_if_driver':
      await stepAskIfDriver(contact, conversation, session, msg);
      break;
    case 'ask_profile_type':
      await stepAskProfileType(contact, conversation, session, msg);
      break;
    case 'ask_name':
      await stepAskName(contact, conversation, session, rawContent);
      break;
    case 'ask_city':
      await stepAskCity(contact, conversation, session, rawContent);
      break;
    case 'ask_pharmacy_link':
      await stepAskPharmacyLink(contact, conversation, session, msg);
      break;
    case 'ask_pharmacy':
      await stepAskPharmacy(contact, conversation, session, msg);
      break;
    case 'ask_intent':
      await stepAskIntent(contact, conversation, session, msg);
      break;
    case 'ask_demand':
      await stepAskDemand(contact, conversation, session, msg);
      break;
    case 'ask_leader_about_driver':
      await stepAskLeaderAboutDriver(contact, conversation, session, msg);
      break;
    case 'ask_leader_driver':
      await stepAskLeaderDriver(contact, conversation, session, msg);
      break;
    default:
      break;
  }
}

export async function processBotSession(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  msg: Record<string, unknown>
) {
  const inboundFrom = onlyDigits(String((msg as { from?: string }).from || ''));
  if (inboundFrom) {
    contact = { ...contact, wa_phone: inboundFrom };
  }
  const workspaceId = String((conversation.workspace_id || contact.workspace_id) as string || '').trim();
  const workspaceChannelId = String((conversation.workspace_channel_id || msg.workspace_channel_id || '') as string).trim();
  if (workspaceId) {
    setActiveFlowRuntimeMode(await loadWorkspaceFlowRuntimeMode(workspaceId));
    setActiveWorkspaceCatalog(await loadWorkspaceCatalog(workspaceId, workspaceChannelId || null));
  } else {
    setActiveFlowRuntimeMode('catalog');
  }
  const session = await getOrCreateSession(contact.id as string, conversation.id as string, workspaceId);
  const metaMessageId = String((msg as { id?: string }).id || '').trim();
  const sessCtx = ((session.context_data as Record<string, unknown>) || {}) as Record<string, unknown>;
  if (metaMessageId && sessCtx[BOT_INBOUND_META_DEDUP_KEY] === metaMessageId) {
    return;
  }

  const rawContent = extractContent(msg) || '';

  if (workspaceChannelId) {
    const purpose = await resolveChannelPurpose(workspaceId, workspaceChannelId);
    if (purpose !== 'commercial') {
      await tryOperationalOutOfHoursOnInbound(supabase, String(conversation.id));
    }
  }

  if (conversation.attendant_id) return;

  if (workspaceChannelId) {
    const purpose = await resolveChannelPurpose(workspaceId, workspaceChannelId);
    if (purpose === 'commercial') {
      const commercialHandled = await tryProcessCommercialBotTurn({
        workspaceId,
        workspaceChannelId,
        conversationId: String(conversation.id),
        contactWa: String(contact.wa_phone || '').trim(),
        session,
      });
      if (commercialHandled) return;
    }
  }

  const guidedDone = Boolean((sessCtx.guided_intake as { completed?: boolean } | undefined)?.completed);

  const waPhone = String(contact.wa_phone || '').trim();

  try {
    if (workspaceId && getActiveFlowRuntimeMode() === 'flow' && waPhone && session.id) {
      const flowDeps = {
        sendText: sendTextMessage,
        sendButtons: sendButtonMessage,
        sendList: sendListMessage,
        extractInteractiveId,
      };
      const flowResult = await tryConversationFlowTurn(supabase, flowDeps, {
        workspaceId,
        workspaceChannelId: workspaceChannelId || null,
        conversationId: String(conversation.id),
        contactWa: waPhone,
        botSessionId: String(session.id),
        msg,
        rawText: rawContent,
      });
      if (flowResult === 'handled') return;
      if (flowResult === 'defer_catalog') {
        if (GUIDED_INTAKE_FIRST && !guidedDone) {
          await dispatchLegacyBotStep(contact, conversation, session, msg, rawContent);
          return;
        }
        if (!LEGACY_BOT_SESSION_ENABLED) return;
        await dispatchLegacyBotStep(contact, conversation, session, msg, rawContent);
        return;
      }
      if (flowResult === 'defer_triagem_por_perfil') {
        let flowWelcome = '';
        const { data: flowSess } = await supabase
          .from('conversation_flow_sessions')
          .select('state')
          .eq('workspace_id', workspaceId)
          .eq('conversation_id', String(conversation.id))
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const st = ((flowSess as { state?: { vars?: Record<string, string> } } | null)?.state || {}) as {
          vars?: Record<string, string>;
        };
        flowWelcome = String(st.vars?.flow_welcome || '').trim();

        await mergeBotSessionContext(String(session.id), {
          triagem_mode: 'por_perfil',
          ...(flowWelcome ? { flow_welcome: flowWelcome } : {}),
        });
        const refreshed = await supabase.from('bot_sessions').select('*').eq('id', session.id).single();
        const activeSession = refreshed.data || session;
        if (GUIDED_INTAKE_FIRST && !guidedDone) {
          await dispatchLegacyBotStep(contact, conversation, activeSession, msg, rawContent);
          return;
        }
        if (!LEGACY_BOT_SESSION_ENABLED) return;
        await dispatchLegacyBotStep(contact, conversation, activeSession, msg, rawContent);
        return;
      }
    }

    if (GUIDED_INTAKE_FIRST && !guidedDone) {
      await dispatchLegacyBotStep(contact, conversation, session, msg, rawContent);
      return;
    }
    /** Após triagem guiada concluída, não reenviar listas do funil legado. */
    if (guidedDone) return;
    if (!LEGACY_BOT_SESSION_ENABLED) return;

    await dispatchLegacyBotStep(contact, conversation, session, msg, rawContent);
  } finally {
    setActiveWorkspaceCatalog(null);
    setActiveFlowRuntimeMode('catalog');
    if (metaMessageId && session.id) {
      await mergeBotInboundDedupeMarker(String(session.id), metaMessageId);
    }
  }
}

type MacroPharmacyLinkRow = { pharmacy_id: string; trade_name: string };

function normalizeLinkedPharmaciesForMacro(rows: unknown[]): MacroPharmacyLinkRow[] {
  const out: MacroPharmacyLinkRow[] = [];
  for (const row of rows || []) {
    const r = row as { pharmacy_id?: string; pharmacies?: unknown };
    let trade = 'Farmácia';
    const p = r.pharmacies;
    if (p && typeof p === 'object' && !Array.isArray(p) && 'trade_name' in p) {
      trade = String((p as { trade_name?: string }).trade_name || trade);
    } else if (Array.isArray(p) && p[0] && typeof p[0] === 'object' && 'trade_name' in p[0]) {
      trade = String((p[0] as { trade_name?: string }).trade_name || trade);
    }
    const id = String(r.pharmacy_id || '').trim();
    if (id) out.push({ pharmacy_id: id, trade_name: trade });
  }
  return out;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function buildPlantaoBusinessHours(): BusinessHoursConfig {
  const open = { is_open: true, intervals: [{ start: '07:00', end: '22:00' }] };
  return {
    timezone: 'America/Sao_Paulo',
    weekly: {
      monday: open,
      tuesday: open,
      wednesday: open,
      thursday: open,
      friday: open,
      saturday: open,
      sunday: open,
    },
    holidays: [],
  };
}

const SECTOR_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveQueueSlaBusinessHours(conversationId: string, cfg: Record<string, unknown>): Promise<BusinessHoursConfig | null> {
  const useBusinessHours = cfg.use_business_hours !== false;
  if (!useBusinessHours) return null;
  const rawBhId = String(cfg.business_hours_id || '').trim();
  const businessHoursId = rawBhId.toLowerCase();
  if (businessHoursId === 'plantao') return buildPlantaoBusinessHours();

  /** Horário explícito do setor escolhido no catálogo (`workspace_sla_rules.settings.business_hours_id` = UUID). */
  if (rawBhId && SECTOR_UUID_RE.test(rawBhId)) {
    const { data: picked } = await supabase.from('sectors').select('business_hours').eq('id', rawBhId).single();
    if (!hasCanonicalBusinessHours(picked?.business_hours)) return null;
    return normalizeBusinessHours(picked?.business_hours);
  }

  const { data: conv } = await supabase.from('conversations').select('sector_id').eq('id', conversationId).single();
  const sectorId = String(conv?.sector_id || '').trim();
  if (!sectorId) return null;

  const { data: sector } = await supabase.from('sectors').select('business_hours').eq('id', sectorId).single();
  if (!hasCanonicalBusinessHours(sector?.business_hours)) return null;
  return normalizeBusinessHours(sector?.business_hours);
}

async function resolveConversationTaskRouting(conversationId: string): Promise<{
  assigneeId: string | null;
  sectorId: string | null;
}> {
  const { data } = await supabase
    .from('conversations')
    .select('attendant_id, sector_id, intent_sector_id')
    .eq('id', conversationId)
    .maybeSingle();
  return {
    assigneeId: (data?.attendant_id as string | undefined) || null,
    sectorId: (data?.sector_id as string | undefined) || (data?.intent_sector_id as string | undefined) || null,
  };
}

async function upsertQueueSlaTreatmentTask(args: {
  conversationId: string;
  treatmentDeadlineIso: string;
  minutes: number;
  action: string;
  nodeLabel: string;
}) {
  const { data: existing } = await supabase
    .from('pending_tasks')
    .select('id')
    .eq('task_type', 'queue_sla_treatment')
    .eq('conversation_id', args.conversationId)
    .in('status', ['open', 'in_progress'])
    .limit(1)
    .maybeSingle();

  const routing = await resolveConversationTaskRouting(args.conversationId);

  const basePayload: Record<string, unknown> = {
    title: `SLA tratamento: ${args.nodeLabel}`,
    description: `SLA de tratamento: ${args.minutes} min. action=${args.action}`,
    priority: 'high',
    due_at: args.treatmentDeadlineIso,
    metadata: {
      queue_sla: true,
      action: args.action,
      treatment_minutes: args.minutes,
    },
    updated_at: new Date().toISOString(),
  };
  if (routing.assigneeId) basePayload.assignee_id = routing.assigneeId;
  if (routing.sectorId) basePayload.sector_id = routing.sectorId;

  if (existing?.id) {
    await supabase.from('pending_tasks').update(basePayload).eq('id', existing.id);
    return;
  }

  await supabase.from('pending_tasks').insert({
    task_type: 'queue_sla_treatment',
    status: 'open',
    source: 'system',
    conversation_id: args.conversationId,
    ...basePayload,
  });
}

async function upsertGuidedDemandTask(args: {
  conversationId: string;
  demandKey: string;
  demandTitle: string;
  sectorName: string;
}) {
  const routing = await resolveConversationTaskRouting(args.conversationId);
  const { data: conv } = await supabase
    .from('conversations')
    .select('sla_treatment_deadline, workspace_id')
    .eq('id', args.conversationId)
    .maybeSingle();

  const { data: existing } = await supabase
    .from('pending_tasks')
    .select('id')
    .eq('task_type', 'guided_demand')
    .eq('conversation_id', args.conversationId)
    .in('status', ['open', 'in_progress'])
    .limit(1)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    title: args.demandTitle,
    description: `Demanda registrada no setor ${args.sectorName}.`,
    priority: 'high',
    due_at: (conv?.sla_treatment_deadline as string | undefined) || null,
    metadata: {
      demand_key: args.demandKey,
      demand_title: args.demandTitle,
      sector_name: args.sectorName,
    },
    updated_at: new Date().toISOString(),
  };
  if (routing.assigneeId) payload.assignee_id = routing.assigneeId;
  if (routing.sectorId) payload.sector_id = routing.sectorId;

  if (existing?.id) {
    await supabase.from('pending_tasks').update(payload).eq('id', existing.id);
    return;
  }

  const workspaceId = String(conv?.workspace_id || '');
  if (!workspaceId) return;
  const { isTaskTypeCreatableForWorkspace } = await import('./lib/opsTaskCatalog');
  const allowed = await isTaskTypeCreatableForWorkspace(supabase, workspaceId, 'guided_demand', 'orchestrator');
  if (!allowed) return;

  await supabase.from('pending_tasks').insert({
    task_type: 'guided_demand',
    status: 'open',
    source: 'system',
    conversation_id: args.conversationId,
    workspace_id: workspaceId,
    ...payload,
  });
}

async function applyQueueSlaNode(
  conversationId: string,
  nodeLabel: string,
  cfg: Record<string, unknown>,
  opts?: { skipInternalNote?: boolean }
) {
  const first = toPositiveInt(cfg.first_response_sla_minutes, 30);
  const treatment = Math.max(first, toPositiveInt(cfg.treatment_sla_minutes, 120));
  const resolution = Math.max(treatment, toPositiveInt(cfg.resolution_sla_minutes, 480));
  const useBusinessHours = cfg.use_business_hours !== false;

  const now = new Date();
  const bh = await resolveQueueSlaBusinessHours(conversationId, cfg);
  const calc = (minutes: number) =>
    bh ? addBusinessMinutes(bh, now, minutes) : new Date(now.getTime() + minutes * 60 * 1000);
  const firstDeadline = calc(first);
  const treatmentDeadline = calc(treatment);
  const resolutionDeadline = calc(resolution);

  await supabase
    .from('conversations')
    .update({
      sla_policy_id: null,
      sla_first_response_deadline: firstDeadline.toISOString(),
      sla_first_response_at: null,
      sla_first_response_ok: false,
      sla_treatment_deadline: treatmentDeadline.toISOString(),
      sla_resolution_deadline: resolutionDeadline.toISOString(),
      sla_resolved_ok: false,
      updated_at: now.toISOString(),
    })
    .eq('id', conversationId);

  await upsertQueueSlaTreatmentTask({
    conversationId,
    treatmentDeadlineIso: treatmentDeadline.toISOString(),
    minutes: treatment,
    action: String(cfg.treatment_action || 'alert_and_reassign'),
    nodeLabel,
  });

  await supabase.from('sla_events').insert({
    conversation_id: conversationId,
    event_type: 'queue_sla_applied',
    severity: 'warning',
    notified_attendant: false,
    notified_supervisor: false,
  });

  const slaMeta = {
    firstMin: first,
    treatmentMin: treatment,
    resolutionMin: resolution,
    deadlines: {
      first: firstDeadline,
      treatment: treatmentDeadline,
      resolution: resolutionDeadline,
    },
    businessHours: Boolean(useBusinessHours && bh),
  };

  if (!opts?.skipInternalNote) {
    await createBotInternalNote(
      conversationId,
      formatQueueSlaAppliedNote({
        nodeLabel,
        ...slaMeta,
      })
    );
  }

  return slaMeta;
}

async function completeGuidedIntakeSession(sessionId: string, patch: Record<string, unknown>) {
  const { data } = await supabase.from('bot_sessions').select('context_data').eq('id', sessionId).maybeSingle();
  const prev = ((data?.context_data as Record<string, unknown>) || {}) as Record<string, unknown>;
  const prevGi = (prev.guided_intake as Record<string, unknown> | undefined) || {};
  const patchGi = (patch.guided_intake as Record<string, unknown> | undefined) || {};
  const merged: Record<string, unknown> = {
    ...prev,
    ...patch,
    guided_intake: {
      ...prevGi,
      ...patchGi,
      completed: true,
      completed_at: new Date().toISOString(),
    },
  };
  await supabase.from('bot_sessions').update({ context_data: merged, updated_at: new Date().toISOString() }).eq('id', sessionId);
}

async function stepAskDemand(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  msg: Record<string, unknown>
) {
  const ctx = (session.context_data as Record<string, unknown>) || {};
  const pendingId = String(ctx.pending_sector_id || '').trim();
  const pendingName = String(ctx.pending_sector_name || '').trim();
  const profile = ctx.demand_profile as GuidedDemandProfile | undefined;
  const conversationId = conversation.id as string;

  if (!pendingId || !profile) {
    await sendTextMessage(
      contact.wa_phone as string,
      'Sessão incompleta. Envie "menu" ou aguarde um atendente.'
    );
    return;
  }

  const demands = runtimeListDemandsForSector(profile, pendingName);
  const pharmacyIdOnContact = String((contact as { pharmacy_id?: string }).pharmacy_id || '').trim();
  let pharmaciesForRouting = (ctx.pharmacies || []) as Array<{ pharmacy_id: string; pharmacies?: { trade_name: string } }>;
  if (profile === 'driver' && (!pharmaciesForRouting || pharmaciesForRouting.length === 0) && contact.driver_id) {
    const links = await getDriverPharmacies(contact.driver_id as string);
    pharmaciesForRouting = Array.isArray(links)
      ? links
          .map((row: { pharmacy_id?: string }) => ({
            pharmacy_id: String(row.pharmacy_id || ''),
          }))
          .filter((r) => r.pharmacy_id.length > 0)
      : [];
  }

  if (demands.length === 0) {
    if (profile === 'pharmacy' && pharmacyIdOnContact) {
      await routeToPharmacyAttendant(conversationId, pharmacyIdOnContact, pendingId);
    } else if (profile === 'driver' && pharmaciesForRouting.length === 1) {
      await routeToPharmacyAttendant(conversationId, pharmaciesForRouting[0].pharmacy_id, pendingId);
    } else {
      await routeToSectorId(conversationId, pendingId);
      await setIntentSectorIfMissing(conversationId, pendingId);
    }
    await applyQueueSlaNode(conversationId, 'Triagem guiada (sem lista de demandas)', {
      first_response_sla_minutes: 25,
      treatment_sla_minutes: 120,
      resolution_sla_minutes: 480,
      first_response_action: 'alert_attendant',
      treatment_action: 'alert_and_reassign',
      resolution_action: 'escalate_supervisor',
      use_business_hours: true,
      business_hours_id: 'default',
      business_hours_label: 'Padrão · seg-sex 08h-18h',
    });
    await completeGuidedIntakeSession(session.id as string, {
      guided_intake: { path: 'demand_fallback_empty_list' },
    });
    return;
  }

  let demandId = extractInteractiveId(msg);
  if (!demandId) {
    const raw = (extractContent(msg) || '').trim();
    const idx = Number.parseInt(raw, 10) - 1;
    if (!Number.isNaN(idx) && idx >= 0 && idx < demands.length) {
      demandId = demands[idx].id;
    }
  }

  const picked = demands.find((d) => d.id === demandId);
  if (!picked) {
    if (needsNumberedDemandMenu(demands)) {
      await sendNumberedDemandMenu(
        contact.wa_phone as string,
        `Setor: ${pendingName}. Escolha a demanda pelo número:`,
        demands
      );
      return;
    }
    await sendListMessage(
      contact.wa_phone as string,
      `Escolha o tipo de demanda para ${pendingName}. Toque em Ver demandas ou envie o número (1–${demands.length}).`,
      WA_LIST_BTN_DEMANDS,
      WA_LIST_SECTION_DEMANDS,
      demands.map((d) => ({ id: d.id, title: d.title }))
    );
    return;
  }

  if (ctx.leader_flow === true) {
    const { data: convRow } = await supabase
      .from('conversations')
      .select('context_pharmacy_id, context_driver_id')
      .eq('id', conversationId)
      .maybeSingle();
    const pharmacyId = String(convRow?.context_pharmacy_id || ctx.leader_pharmacy_id || '').trim() || null;
    const driverId = String(convRow?.context_driver_id || ctx.leader_driver_id || '').trim() || null;
    const leaderProfile: GuidedDemandProfile = driverId ? 'driver' : 'pharmacy';

    await routeToSectorId(conversationId, pendingId);
    await setIntentSectorIfMissing(conversationId, pendingId);
    if (pharmacyId) {
      await routeToPharmacyAttendant(conversationId, pharmacyId, pendingId);
    } else {
      await routeToSector(conversationId, pendingName);
    }

    const slaCfg = runtimeSlaPresetForDemand(leaderProfile, picked.id);
    await applyQueueSlaNode(conversationId, `Triagem guiada (líder): ${picked.title}`, slaCfg);
    const runtimeMode = getActiveFlowRuntimeMode();
    await supabase
      .from('conversations')
      .update({
        demand_key: picked.id,
        sla_applied_from: runtimeMode === 'catalog' || runtimeMode === 'shadow' ? 'catalog' : 'legacy',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    await appendConversationTags(conversationId, [`demanda:${picked.id}`]);
    await upsertGuidedDemandTask({
      conversationId,
      demandKey: picked.id,
      demandTitle: picked.title,
      sectorName: pendingName,
    });

    const driverLabel = String(ctx.leader_driver_name || '').trim();
    const pharmacyLabel =
      pharmaciesFromCtx(ctx).find((p) => p.pharmacy_id === pharmacyId)?.pharmacies?.trade_name ||
      (pharmacyId ? 'Farmácia' : '');
    const noteParts = [
      `Triagem guiada (líder): ${picked.title} (${picked.id})`,
      `setor ${pendingName}`,
      pharmacyLabel ? `farmácia ${pharmacyLabel}` : null,
      driverLabel ? `entregador ${driverLabel}` : null,
    ].filter(Boolean);
    await createBotInternalNote(conversationId, noteParts.join(', ') + '.');

    await completeGuidedIntakeSession(session.id as string, {
      guided_intake: {
        path: 'leader_pharmacy_driver_sector_demand',
        sector_id: pendingId,
        sector_name: pendingName,
        pharmacy_id: pharmacyId,
        driver_id: driverId,
        demand_id: picked.id,
        demand_title: picked.title,
      },
    });
    return;
  }

  /**
   * Herança do vínculo farmácia ↔ atendente por setor (`pharmacy_sector_attendants`), igual ao fluxo legado.
   * Farmácia e entregador com uma farmácia vinculada usam routeToPharmacyAttendant; caso não haja atendente
   * disponível para aquele setor, routeToPharmacyAttendant cai na fila do setor (com context_pharmacy_id).
   */
  if (profile === 'pharmacy' && pharmacyIdOnContact) {
    await routeToPharmacyAttendant(conversationId, pharmacyIdOnContact, pendingId);
  } else if (profile === 'driver' && pharmaciesForRouting.length === 1) {
    await routeToPharmacyAttendant(conversationId, pharmaciesForRouting[0].pharmacy_id, pendingId);
  } else {
    await routeToSectorId(conversationId, pendingId);
    await setIntentSectorIfMissing(conversationId, pendingId);
  }
  const slaCfg = runtimeSlaPresetForDemand(profile, picked.id);
  const nodeLabel = `Triagem guiada: ${picked.title}`;
  const slaMeta = await applyQueueSlaNode(conversationId, nodeLabel, slaCfg, { skipInternalNote: true });
  const runtimeMode = getActiveFlowRuntimeMode();
  await supabase
    .from('conversations')
    .update({
      demand_key: picked.id,
      sla_applied_from: runtimeMode === 'catalog' || runtimeMode === 'shadow' ? 'catalog' : 'legacy',
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);
  await appendConversationTags(conversationId, [`demanda:${picked.id}`]);
  await upsertGuidedDemandTask({
    conversationId,
    demandKey: picked.id,
    demandTitle: picked.title,
    sectorName: pendingName,
  });
  await createBotInternalNote(
    conversationId,
    formatTriagemCompleteNote({
      profile,
      sectorName: pendingName,
      demandTitle: picked.title,
      nodeLabel,
      ...slaMeta,
    })
  );
  await completeGuidedIntakeSession(session.id as string, {
    guided_intake: {
      demand_id: picked.id,
      demand_title: picked.title,
    },
  });
}

async function markConversationFirstResponseIfNeeded(conversationId: string) {
  const { data } = await supabase
    .from('conversations')
    .select('sla_first_response_at, sla_first_response_deadline, sla_first_response_ok')
    .eq('id', conversationId)
    .maybeSingle();
  if (!data || data.sla_first_response_at) return;

  const now = new Date();
  const deadline = data.sla_first_response_deadline ? new Date(String(data.sla_first_response_deadline)) : null;
  const ok = deadline ? now.getTime() <= deadline.getTime() : true;
  await supabase
    .from('conversations')
    .update({
      sla_first_response_at: now.toISOString(),
      sla_first_response_ok: ok,
      updated_at: now.toISOString(),
    })
    .eq('id', conversationId);
}

async function appendConversationTags(conversationId: string, tagsToAdd: string[]) {
  const { data } = await supabase.from('conversations').select('tags').eq('id', conversationId).single();
  const existing = (data?.tags as string[]) || [];
  const next = [...new Set([...existing, ...tagsToAdd])];
  await supabase.from('conversations').update({ tags: next, updated_at: new Date().toISOString() }).eq('id', conversationId);
}

async function getSystemNoteAuthorId(workspaceId?: string): Promise<string | null> {
  if (!workspaceId) return null;
  return resolveSystemNoteAuthorId(supabase, workspaceId);
}

async function createBotInternalNote(conversationId: string, content: string) {
  const { data: conv } = await supabase
    .from('conversations')
    .select('workspace_id')
    .eq('id', conversationId)
    .maybeSingle();
  const workspaceId = conv?.workspace_id ? String(conv.workspace_id) : '';
  const authorId = workspaceId ? await getSystemNoteAuthorId(workspaceId) : null;
  if (!authorId || !workspaceId) {
    console.warn('[Orchestrator] Sem author_id para internal_notes; nota omitida.');
    return;
  }
  await supabase.from('internal_notes').insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    author_id: authorId,
    content,
  });
}

async function mergeBotSessionContext(sessionId: string, patch: Record<string, unknown>) {
  const { data } = await supabase.from('bot_sessions').select('context_data').eq('id', sessionId).maybeSingle();
  const prev = ((data?.context_data as Record<string, unknown>) || {}) as Record<string, unknown>;
  await supabase
    .from('bot_sessions')
    .update({
      context_data: { ...prev, ...patch },
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);
}

async function mergeBotInboundDedupeMarker(sessionId: string, metaMessageId: string) {
  const { data } = await supabase.from('bot_sessions').select('context_data').eq('id', sessionId).maybeSingle();
  const prev = ((data?.context_data as Record<string, unknown>) || {}) as Record<string, unknown>;
  await supabase
    .from('bot_sessions')
    .update({
      context_data: { ...prev, [BOT_INBOUND_META_DEDUP_KEY]: metaMessageId },
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);
}

function needsNumberedPharmacyMenu(options: Array<{ trade_name: string }>) {
  return options.length > WA_LIST_MAX_ROWS || options.some((o) => String(o.trade_name || '').length > WA_LIST_ROW_TITLE_MAX);
}

function paginateOptions<T>(items: T[], page: number, size: number) {
  const safePage = Math.max(0, page);
  const start = safePage * size;
  return items.slice(start, start + size);
}

function needsNumberedDemandMenu(demands: Array<{ title: string }>) {
  return demands.length > WA_LIST_MAX_ROWS || demands.some((d) => String(d.title || '').length > WA_LIST_ROW_TITLE_MAX);
}

async function sendNumberedDemandMenu(to: string, intro: string, demands: Array<{ title: string }>) {
  const lines = demands.slice(0, NUMBERED_MENU_PAGE_SIZE).map((d, idx) => `${idx + 1}) ${truncateWa(d.title, NUMBERED_MENU_TITLE_MAX)}`);
  const suffix =
    demands.length > NUMBERED_MENU_PAGE_SIZE
      ? `\n\nMostrando ${NUMBERED_MENU_PAGE_SIZE} de ${demands.length}. Envie o número da opção desejada.`
      : `\n\nResponda com o número da opção (1–${demands.length}).`;
  await sendTextMessage(to, `${intro}\n\n${lines.join('\n')}${suffix}`);
}

async function sendNumberedDriverMenu(
  to: string,
  intro: string,
  drivers: LeaderDriverOption[],
  page: number
) {
  const options = drivers.map((d) => ({ id: d.id, trade_name: d.name }));
  const totalPages = Math.max(1, Math.ceil(options.length / NUMBERED_MENU_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const visible = paginateOptions(options, safePage, NUMBERED_MENU_PAGE_SIZE);
  const lines = visible.map((item, idx) => {
    const prefix = idx + 1;
    return `${prefix}) ${truncateWa(item.trade_name, NUMBERED_MENU_TITLE_MAX)}`;
  });
  const nav =
    totalPages > 1
      ? '\n\nEnvie "9" para a próxima página e "0" para voltar. Digite "n" se o entregador não estiver na lista.'
      : '\n\nResponda com o número do entregador (1–8). Digite "n" se não estiver na lista.';
  const header =
    totalPages > 1
      ? `${intro}\n\nOpções nesta página: ${visible.length} de ${options.length} entregadores.`
      : intro;
  await sendTextMessage(to, `${header}\n\nPágina ${safePage + 1}/${totalPages}\n${lines.join('\n')}${nav}`);
}

async function sendNumberedPharmacyMenu(
  to: string,
  intro: string,
  options: Array<{ id: string; trade_name: string; city?: string | null }>,
  page: number
) {
  const totalPages = Math.max(1, Math.ceil(options.length / NUMBERED_MENU_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const visible = paginateOptions(options, safePage, NUMBERED_MENU_PAGE_SIZE);
  const lines = visible.map((item, idx) => {
    const prefix = idx + 1;
    const cityRaw = item.city ? String(item.city) : '';
    const city = cityRaw ? ` (${truncateWa(cityRaw, 24)})` : '';
    const title = truncateWa(item.trade_name, NUMBERED_MENU_TITLE_MAX);
    return `${prefix}) ${title}${city}`;
  });
  const nav =
    totalPages > 1
      ? '\n\nEnvie "9" para a próxima página e "0" para voltar. Você também pode digitar parte do nome da farmácia para filtrar.'
      : '\n\nResponda com o número da opção (1–8).';
  const header =
    totalPages > 1
      ? `${intro}\n\nOpções nesta página: ${visible.length} de ${options.length} farmácias.`
      : intro;
  const msg = `${header}\n\nPágina ${safePage + 1}/${totalPages}\n${lines.join('\n')}${nav}`;
  await sendTextMessage(to, msg);
}

function parseNumberedSelection(raw: string) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return { kind: 'invalid' as const };
  if (text === '9' || text === 'mais' || text === 'proxima' || text === 'próxima') return { kind: 'next' as const };
  if (text === '0' || text === 'voltar' || text === 'anterior') return { kind: 'prev' as const };
  const num = Number.parseInt(text, 10);
  if (!Number.isNaN(num) && num >= 1 && num <= NUMBERED_MENU_PAGE_SIZE) return { kind: 'pick' as const, value: num };
  if (text.length >= 3) return { kind: 'search' as const, value: text };
  return { kind: 'invalid' as const };
}

async function createPendingDriverTask(args: {
  conversationId: string;
  contactId: string;
  driverId: string;
  pharmacyTradeName: string;
  pharmacyId: string;
}) {
  const { data: existing } = await supabase
    .from('pending_tasks')
    .select('id')
    .eq('task_type', 'driver_registration_completion')
    .eq('driver_id', args.driverId)
    .in('status', ['open', 'in_progress'])
    .maybeSingle();
  if (existing?.id) return;

  const { data: driverRow } = await supabase
    .from('drivers')
    .select('doc_status, tags')
    .eq('id', args.driverId)
    .maybeSingle();
  const tags = Array.isArray(driverRow?.tags) ? driverRow.tags.map(String) : [];
  if (String(driverRow?.doc_status || '') === 'ok' && !tags.includes('cadastro-pendente')) return;

  const { data: terminationOpen } = await supabase
    .from('pending_tasks')
    .select('id')
    .eq('driver_id', args.driverId)
    .in('task_type', [
      'driver_termination_prep',
      'driver_termination_request',
      'driver_termination_financial_review',
    ])
    .in('status', ['open', 'in_progress'])
    .limit(1)
    .maybeSingle();
  if (terminationOpen?.id) return;

  const { data: conv } = await supabase
    .from('conversations')
    .select('attendant_id, sector_id, workspace_id')
    .eq('id', args.conversationId)
    .maybeSingle();

  let assigneeId = (conv?.attendant_id as string | null) || null;
  let sectorId = (conv?.sector_id as string | null) || null;

  if (!assigneeId && args.pharmacyId) {
    const { data: pharmacy } = await supabase
      .from('pharmacies')
      .select('primary_attendant_id')
      .eq('id', args.pharmacyId)
      .maybeSingle();
    if (pharmacy?.primary_attendant_id) {
      assigneeId = pharmacy.primary_attendant_id as string;
      const { data: attendantRow } = await supabase
        .from('users')
        .select('sector_id')
        .eq('id', assigneeId)
        .maybeSingle();
      if (attendantRow?.sector_id) sectorId = attendantRow.sector_id as string;
    }
  }

  const workspaceId = String(conv?.workspace_id || '');
  if (!workspaceId) return;
  const { isTaskTypeCreatableForWorkspace } = await import('./lib/opsTaskCatalog');
  const allowed = await isTaskTypeCreatableForWorkspace(
    supabase,
    workspaceId,
    'driver_registration_completion',
    'orchestrator'
  );
  if (!allowed) return;

  const { error: insErr } = await supabase.from('pending_tasks').insert({
    workspace_id: workspaceId,
    task_type: 'driver_registration_completion',
    title: 'Finalizar cadastro de entregador',
    description: `Completar CPF, documentos e dados operacionais. Farmácia informada: ${args.pharmacyTradeName}.`,
    status: 'open',
    priority: 'high',
    conversation_id: args.conversationId,
    contact_id: args.contactId,
    driver_id: args.driverId,
    assignee_id: assigneeId,
    sector_id: sectorId,
    source: 'bot',
    metadata: { reason: 'pre_cadastro_whatsapp', pharmacy_id: args.pharmacyId },
    due_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  });
  if (insErr) {
    console.error('[Orchestrator] Falha ao inserir pending_tasks:', insErr);
    throw insErr;
  }
}

async function registerDriverAndLink(
  name: string,
  phone: string,
  pharmacyId: string,
  pharmacyTradeName: string,
  contactId: string,
  conversationId: string,
  workspaceId: string
) {
  if (!workspaceId) throw new Error('workspace_id_required_for_driver_pre_registration');
  const { data: driver, error: dErr } = await supabase
    .from('drivers')
    .insert({
      workspace_id: workspaceId,
      name: name.trim() || 'Entregador',
      phone,
      status: 'active',
      primary_pharmacy_id: pharmacyId,
    })
    .select()
    .single();

  if (dErr || !driver) {
    console.error('[Orchestrator] Falha ao criar driver:', dErr);
    throw dErr || new Error('driver_insert_failed');
  }

  const { error: linkErr } = await supabase.from('driver_pharmacy_links').insert({
    workspace_id: workspaceId,
    driver_id: driver.id,
    pharmacy_id: pharmacyId,
    is_primary: true,
    is_active: true,
  });
  if (linkErr) console.error('[Orchestrator] Falha ao vincular farmacia:', linkErr);

  await supabase
    .from('contacts')
    .update({
      profile_type: 'driver',
      driver_id: driver.id,
      pharmacy_id: null,
      leader_id: null,
      display_name: name.trim() || undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId);

  await appendConversationTags(conversationId, ['cadastro-pendente']);

  const when = new Date().toISOString();
  await createBotInternalNote(
    conversationId,
    `Pre-cadastro via WhatsApp (${when}). Nome: ${name.trim() || '—'} | Tel: ${phone} | Farmacia: ${pharmacyTradeName}. Completar: CPF, documentos e dados adicionais pelo painel.`
  );

  try {
    await createPendingDriverTask({
      conversationId,
      contactId,
      driverId: driver.id as string,
      pharmacyTradeName,
      pharmacyId,
    });
  } catch (err) {
    console.error('[Orchestrator] Falha ao criar pendência de cadastro:', err);
  }
}

async function stepAskProfileType(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  msg: Record<string, unknown>
) {
  const replyId = extractInteractiveId(msg);
  if (replyId === 'profile_driver') {
    await updateSession(session.id as string, 'ask_name', { intake_profile: 'driver' });
    await sendTextMessage(
      contact.wa_phone as string,
      await getBotMessage('ask_driver_name', 'Qual e o seu nome completo?')
    );
    return;
  }
  if (replyId === 'profile_pharmacy') {
    await updateSession(session.id as string, 'handoff', { reason: 'precadastro_farmacia', intake_profile: 'pharmacy' });
    await appendConversationTags(conversation.id as string, ['sem-cadastro', 'precadastro-farmacia']);
    await createBotInternalNote(
      conversation.id as string,
      'Contato desconhecido escolheu perfil Farmácia. Encaminhado para Atendimento Geral (pré-cadastro).'
    );
    await routeToSector(conversation.id as string, 'Atendimento Geral');
    await sendTextMessage(
      contact.wa_phone as string,
      await getBotMessage(
        'unknown_pharmacy_precadastro',
        'Entendido. Nossa equipe do atendimento geral vai ajudar com seu pré-cadastro de farmácia. Informe razão social, CNPJ, seu nome e e-mail se possível.'
      )
    );
    return;
  }
  if (replyId === 'profile_leader') {
    await updateSession(session.id as string, 'handoff', { reason: 'precadastro_lider', intake_profile: 'leader' });
    await appendConversationTags(conversation.id as string, ['sem-cadastro', 'precadastro-lider']);
    await createBotInternalNote(
      conversation.id as string,
      'Contato desconhecido escolheu perfil Líder. Encaminhado para Atendimento Geral.'
    );
    await routeToSector(conversation.id as string, 'Atendimento Geral');
    await sendTextMessage(
      contact.wa_phone as string,
      await getBotMessage(
        'unknown_leader_precadastro',
        'Entendido. Nossa equipe vai te atender para validar seu cadastro de líder em instantes.'
      )
    );
    return;
  }
  if (replyId === 'profile_partner') {
    await supabase
      .from('contacts')
      .update({ profile_type: 'partner', updated_at: new Date().toISOString() })
      .eq('id', contact.id);
    await appendConversationTags(conversation.id as string, ['parceiro']);
    await createBotInternalNote(
      conversation.id as string,
      'Contato identificado como Parceiro pelo menu de perfil.'
    );
    await beginPartnerSectorFlow({ ...contact, profile_type: 'partner' }, conversation, session);
    return;
  }
  const ctx = (session.context_data as Record<string, unknown>) || {};
  const welcome =
    String(ctx.flow_welcome || '').trim() ||
    (await getBotMessage(
      'unknown_welcome_profile',
      'Olá! Não encontrei seu cadastro. Qual é o seu perfil? Toque em Ver perfis.'
    ));
  await sendProfileTypePicker(contact.wa_phone as string, welcome);
}

async function stepAskIfDriver(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  msg: Record<string, unknown>
) {
  const replyId = extractInteractiveId(msg);
  if (replyId === 'is_driver') {
    await updateSession(session.id as string, 'ask_name', {});
    await sendTextMessage(
      contact.wa_phone as string,
      await getBotMessage('ask_driver_name', 'Qual e o seu nome completo?')
    );
    return;
  }
  if (replyId === 'not_driver') {
    await updateSession(session.id as string, 'handoff', { reason: 'not_driver' });
    await appendConversationTags(conversation.id as string, ['sem-cadastro']);
    await createBotInternalNote(
      conversation.id as string,
      'Contato sem cadastro informou que nao e entregador. Encaminhado para Atendimento Geral.'
    );
    await routeToSector(conversation.id as string, 'Atendimento Geral');
    await sendTextMessage(
      contact.wa_phone as string,
      await getBotMessage(
        'unknown_not_driver',
        'Entendido. Nossa equipe vai te atender em instantes pelo setor geral.'
      )
    );
    return;
  }
  await sendButtonMessage(contact.wa_phone as string, 'Por favor, use os botoes abaixo para responder.', [
    { id: 'is_driver', title: 'Sim, sou entregador' },
    { id: 'not_driver', title: 'Nao' },
  ]);
}

async function stepAskName(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  rawContent: string
) {
  const name = rawContent.replaceAll(/\s+/g, ' ').trim();
  if (!name) {
    await sendTextMessage(
      contact.wa_phone as string,
      await getBotMessage('ask_driver_name_retry', 'Nao entendi o nome. Digite seu nome completo, por favor.')
    );
    return;
  }
  await updateSession(session.id as string, 'ask_city', { driver_display_name: name });
  await sendTextMessage(
    contact.wa_phone as string,
    await getBotMessage('ask_driver_city', 'Em qual cidade voce atua? (digite o nome da cidade)')
  );
}

async function stepAskCity(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  rawContent: string
) {
  const ctx = session.context_data as Record<string, unknown>;
  const driverName = String(ctx.driver_display_name || '').trim();
  const city = rawContent.replaceAll(/\s+/g, ' ').trim();
  if (!city) {
    await sendTextMessage(
      contact.wa_phone as string,
      await getBotMessage('ask_driver_city_retry', 'Digite o nome da cidade, por favor.')
    );
    return;
  }

  const { data: pharmacies } = await supabase
    .from('pharmacies')
    .select('id, trade_name, city')
    .eq('status', 'active')
    .ilike('city', `%${city}%`)
    .order('trade_name')
    .limit(80);

  const list = (pharmacies || []) as Array<{ id: string; trade_name: string; city: string | null }>;

  if (list.length === 0) {
    await updateSession(session.id as string, 'handoff', { reason: 'no_pharmacy_in_city', city });
    await appendConversationTags(conversation.id as string, ['sem-cadastro']);
    await createBotInternalNote(
      conversation.id as string,
      `Nenhuma farmacia ativa encontrada para a cidade informada: "${city}". Encaminhado para Atendimento Geral.`
    );
    await routeToSector(conversation.id as string, 'Atendimento Geral');
    await sendTextMessage(
      contact.wa_phone as string,
      await getBotMessage(
        'no_pharmacy_city',
        `Nao encontrei farmacias ativas em ${city} no nosso cadastro. Vou encaminhar seu atendimento para a equipe operacional finalizar o pre-cadastro. Para agilizar, informe CPF/CNPJ, telefone, CNH e placa se tiver, e a farmacia/unidade onde pretende atuar.`
      )
    );
    return;
  }

  if (list.length === 1) {
    const p = list[0];
    try {
      await registerDriverAndLink(
        driverName,
        contact.wa_phone as string,
        p.id,
        p.trade_name,
        contact.id as string,
        conversation.id as string,
        String(conversation.workspace_id || contact.workspace_id || '')
      );
    } catch (err) {
      console.error('[Orchestrator] Falha ao concluir pre-cadastro automatico:', err);
      await createBotInternalNote(
        conversation.id as string,
        `Falha ao concluir pre-cadastro automatico para entregador "${driverName}" na farmacia "${p.trade_name}". Encaminhado para atendimento manual.`
      );
      await sendTextMessage(
        contact.wa_phone as string,
        `Encontrei a farmacia ${p.trade_name} em ${p.city || city}, mas nao consegui concluir o pre-cadastro automatico agora. Vou encaminhar para a equipe operacional finalizar manualmente. Para agilizar, envie CPF/CNPJ, telefone, CNH e placa se tiver.`
      );
      await routeToSector(conversation.id as string, 'Atendimento Geral');
      return;
    }
    const { data: fresh } = await supabase.from('contacts').select('*').eq('id', contact.id).single();
    const pharmacies = await getDriverPharmacies((fresh as { driver_id?: string }).driver_id as string);
    const sectors = await getActiveSectors();
    await updateSession(session.id as string, 'ask_intent', { pharmacies, profile_type: 'driver', sectors });
    await sendSectorListMessage(
      contact.wa_phone as string,
      await getBotMessage('driver_greeting_list', 'Ola! Como posso te ajudar? Toque em Ver setores e escolha o tipo de atendimento:'),
      sectors
    );
    return;
  }

  if (needsNumberedPharmacyMenu(list)) {
    await updateSession(session.id as string, 'ask_pharmacy_link', {
      driver_display_name: driverName,
      city_query: city,
      pharmacy_options: list.map((p) => ({ id: p.id, trade_name: p.trade_name, city: p.city })),
      pharmacy_page: 0,
      pharmacy_selection_mode: 'numbered',
      pharmacy_search: '',
    });
    await sendNumberedPharmacyMenu(
      contact.wa_phone as string,
      await getBotMessage(
        'ask_pharmacy_city_numbered',
        `Encontrei ${list.length} farmácia(s) em "${city}". Escolha uma opção pelo número:`
      ),
      list,
      0
    );
    return;
  }

  const shown = list.slice(0, WA_LIST_MAX_ROWS);
  await updateSession(session.id as string, 'ask_pharmacy_link', {
    driver_display_name: driverName,
    city_query: city,
    pharmacy_options: shown.map((p) => ({ id: p.id, trade_name: p.trade_name })),
    pharmacy_selection_mode: 'interactive',
  });
  const body = await getBotMessage(
    'ask_pharmacy_city_list',
    `Encontrei ${shown.length} farmacia(s) em "${city}". Toque em Ver opcoes e escolha a sua farmacia:`
  );
  await sendListMessage(
    contact.wa_phone as string,
    body,
    WA_LIST_BTN_PHARMACIES,
    WA_LIST_SECTION_PHARMACIES,
    shown.map((p) => ({ id: p.id, title: p.trade_name }))
  );
}

async function stepAskPharmacyLink(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  msg: Record<string, unknown>
) {
  const ctx = session.context_data as Record<string, unknown>;
  const driverName = String(ctx.driver_display_name || '').trim();
  const pharmacyId = extractInteractiveId(msg);
  const selectionMode = String(ctx.pharmacy_selection_mode || 'interactive');
  const options = (ctx.pharmacy_options || []) as Array<{ id: string; trade_name: string; city?: string | null }>;

  if (selectionMode === 'numbered') {
    const input = extractContent(msg);
    const parsed = parseNumberedSelection(input);
    const search = String(ctx.pharmacy_search || '').trim().toLowerCase();
    const base = options;
    const filtered = search ? base.filter((p) => p.trade_name.toLowerCase().includes(search)) : base;
    let page = Number(ctx.pharmacy_page || 0);

    if (parsed.kind === 'search') {
      const filteredByText = base.filter((p) => p.trade_name.toLowerCase().includes(parsed.value));
      if (filteredByText.length === 0) {
        await sendTextMessage(
          contact.wa_phone as string,
          'Não encontrei farmácia com esse trecho. Tente outro nome, outra cidade ou digite 0 para voltar.'
        );
        return;
      }
      await updateSession(session.id as string, 'ask_pharmacy_link', {
        ...ctx,
        pharmacy_search: parsed.value,
        pharmacy_page: 0,
      });
      await sendNumberedPharmacyMenu(
        contact.wa_phone as string,
        `Filtrando por "${parsed.value}" (${filteredByText.length} resultado(s)).`,
        filteredByText,
        0
      );
      return;
    }

    if (parsed.kind === 'next') {
      const totalPages = Math.max(1, Math.ceil(filtered.length / NUMBERED_MENU_PAGE_SIZE));
      page = Math.min(totalPages - 1, page + 1);
      await updateSession(session.id as string, 'ask_pharmacy_link', { ...ctx, pharmacy_page: page });
      await sendNumberedPharmacyMenu(contact.wa_phone as string, 'Escolha a farmácia pelo número:', filtered, page);
      return;
    }
    if (parsed.kind === 'prev') {
      page = Math.max(0, page - 1);
      await updateSession(session.id as string, 'ask_pharmacy_link', { ...ctx, pharmacy_page: page });
      await sendNumberedPharmacyMenu(contact.wa_phone as string, 'Escolha a farmácia pelo número:', filtered, page);
      return;
    }
    if (parsed.kind !== 'pick') {
      await sendTextMessage(
        contact.wa_phone as string,
        'Resposta inválida. Envie o número da opção, "9" para próxima página, "0" para voltar ou parte do nome da farmácia.'
      );
      return;
    }

    const visible = paginateOptions(filtered, page, NUMBERED_MENU_PAGE_SIZE);
    const selectedByNumber = visible[parsed.value - 1];
    if (!selectedByNumber) {
      await sendTextMessage(contact.wa_phone as string, 'Número fora da página atual. Escolha uma opção visível.');
      return;
    }
    try {
      await registerDriverAndLink(
        driverName,
        contact.wa_phone as string,
        selectedByNumber.id,
        selectedByNumber.trade_name,
        contact.id as string,
        conversation.id as string,
        String(conversation.workspace_id || contact.workspace_id || '')
      );
    } catch {
      await sendTextMessage(
        contact.wa_phone as string,
        'Nao foi possivel concluir o cadastro agora. Nossa equipe vai te atender.'
      );
      await routeToSector(conversation.id as string, 'Atendimento Geral');
      return;
    }

    const { data: fresh } = await supabase.from('contacts').select('*').eq('id', contact.id).single();
    const pharmacies = await getDriverPharmacies((fresh as { driver_id: string }).driver_id);
    const sectors = await getActiveSectors();
    await updateSession(session.id as string, 'ask_intent', { pharmacies, profile_type: 'driver', sectors });
    await sendSectorListMessage(
      contact.wa_phone as string,
      await getBotMessage('driver_greeting_list', 'Ola! Como posso te ajudar? Toque em Ver setores e escolha o tipo de atendimento:'),
      sectors
    );
    return;
  }

  if (!pharmacyId) {
    await sendTextMessage(
      contact.wa_phone as string,
      'Toque em Ver opcoes e selecione uma farmacia da lista.'
    );
    return;
  }

  const selected = options.find((p) => p.id === pharmacyId);
  if (!selected) {
    await sendTextMessage(contact.wa_phone as string, 'Opcao invalida. Abra a lista novamente e escolha uma farmacia.');
    return;
  }

  try {
    await registerDriverAndLink(
      driverName,
      contact.wa_phone as string,
      selected.id,
      selected.trade_name,
      contact.id as string,
      conversation.id as string,
      String(conversation.workspace_id || contact.workspace_id || '')
    );
  } catch {
    await sendTextMessage(
      contact.wa_phone as string,
      'Nao foi possivel concluir o cadastro agora. Nossa equipe vai te atender.'
    );
    await routeToSector(conversation.id as string, 'Atendimento Geral');
    return;
  }

  const { data: fresh } = await supabase.from('contacts').select('*').eq('id', contact.id).single();
  const pharmacies = await getDriverPharmacies((fresh as { driver_id: string }).driver_id);
  const sectors = await getActiveSectors();
  await updateSession(session.id as string, 'ask_intent', { pharmacies, profile_type: 'driver', sectors });
  await sendSectorListMessage(
    contact.wa_phone as string,
    await getBotMessage('driver_greeting_list', 'Ola! Como posso te ajudar? Toque em Ver setores e escolha o tipo de atendimento:'),
    sectors
  );
}

async function sendSectorListMessage(
  to: string,
  bodyText: string,
  sectors: Array<{ id: string; name: string; is_active?: boolean }>
) {
  const rows = sectors.map((s) => ({ id: s.id, title: s.name }));
  await sendListMessage(to, bodyText, WA_LIST_BTN_SECTORS, WA_LIST_SECTION_SECTORS, rows);
}

const PROFILE_PICKER_ROWS = [
  { id: 'profile_driver', title: 'Entregador' },
  { id: 'profile_pharmacy', title: 'Farmácia' },
  { id: 'profile_leader', title: 'Líder' },
  { id: 'profile_partner', title: 'Parceiro' },
] as const;

async function sendProfileTypePicker(to: string, welcome: string) {
  await sendListMessage(to, welcome, WA_LIST_BTN_PROFILES, WA_LIST_SECTION_PROFILES, [...PROFILE_PICKER_ROWS]);
}

async function beginPartnerSectorFlow(
  contact: Record<string, unknown>,
  _conversation: Record<string, unknown>,
  session: Record<string, unknown>
) {
  const sectors = await getActiveSectors();
  await updateSession(session.id as string, 'ask_intent', { profile_type: 'partner', sectors });
  await sendSectorListMessage(
    contact.wa_phone as string,
    await getBotMessage(
      'partner_greeting_list',
      'Olá! Escolha o setor para seu atendimento. Toque em Ver setores e selecione a área:'
    ),
    sectors
  );
}

async function loadLeaderPharmaciesForContact(contact: Record<string, unknown>): Promise<LeaderPharmacyRow[]> {
  if (!contact.leader_id) return [];
  const raw = await getLeaderPharmacies(String(contact.leader_id));
  return normalizeLeaderPharmacyRows(raw);
}

async function transitionLeaderToSectorPicker(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  ctx: Record<string, unknown>
) {
  const sectors = await getActiveSectors();
  await updateSession(session.id as string, 'ask_intent', {
    ...ctx,
    profile_type: 'leader',
    leader_flow: true,
    sectors,
  });
  await sendSectorListMessage(
    contact.wa_phone as string,
    await getBotMessage('leader_ask_sector', 'Escolha o setor para encaminhar o atendimento. Toque em Ver setores.'),
    sectors
  );
}

async function beginLeaderAskAboutDriver(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  ctx: Record<string, unknown>,
  pharmacyId: string
) {
  await supabase
    .from('conversations')
    .update({ context_pharmacy_id: pharmacyId, updated_at: new Date().toISOString() })
    .eq('id', conversation.id as string);

  await updateSession(session.id as string, 'ask_leader_about_driver', {
    ...ctx,
    profile_type: 'leader',
    leader_flow: true,
    leader_pharmacy_id: pharmacyId,
  });

  await sendButtonMessage(
    contact.wa_phone as string,
    await getBotMessage('leader_ask_about_driver', 'O assunto é sobre algum entregador desta farmácia?'),
    [
      { id: LEADER_DRIVER_YES_ID, title: 'Sim' },
      { id: LEADER_DRIVER_NO_ID, title: 'Não' },
    ]
  );
}

async function sendLeaderPharmacyPicker(
  contact: Record<string, unknown>,
  session: Record<string, unknown>,
  pharmacies: LeaderPharmacyRow[],
  ctx: Record<string, unknown>
) {
  const options = pharmacies.map((item) => ({
    id: item.pharmacy_id,
    trade_name: item.pharmacies.trade_name,
  }));
  const numbered = needsNumberedPharmacyMenu(options);
  if (numbered) {
    await sendNumberedPharmacyMenu(
      contact.wa_phone as string,
      await getBotMessage(
        'leader_ask_pharmacy_numbered',
        'Qual farmácia? Escolha pelo número (vínculos do líder):'
      ),
      options,
      0
    );
  } else {
    const rows = options.slice(0, WA_LIST_MAX_ROWS).map((item) => ({
      id: item.id,
      title: item.trade_name,
    }));
    const body =
      (await getBotMessage(
        'leader_ask_pharmacy',
        'Sobre qual farmácia você quer falar? Toque em Ver opções.'
      )) + (pharmacies.length > WA_LIST_MAX_ROWS ? ` Mostrando as primeiras ${WA_LIST_MAX_ROWS} opções.` : '');
    await sendListMessage(contact.wa_phone as string, body, WA_LIST_BTN_PHARMACIES, WA_LIST_SECTION_PHARMACIES, rows);
  }
  await updateSession(session.id as string, 'ask_pharmacy', {
    ...ctx,
    profile_type: 'leader',
    leader_flow: true,
    pharmacies,
    pharmacy_selection_mode: numbered ? 'numbered' : 'interactive',
    pharmacy_page: 0,
    pharmacy_search: '',
  });
}

function pharmaciesFromCtx(ctx: Record<string, unknown>): LeaderPharmacyRow[] {
  return normalizeLeaderPharmacyRows(ctx.pharmacies);
}

async function stepAskLeaderAboutDriver(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  msg: Record<string, unknown>
) {
  const ctx = session.context_data as Record<string, unknown>;
  const pharmacyId = String(ctx.leader_pharmacy_id || '').trim();
  const choice = extractInteractiveId(msg) || extractContent(msg).trim().toLowerCase();

  const isYes =
    choice === LEADER_DRIVER_YES_ID ||
    choice === 'sim' ||
    choice === 's' ||
    choice.startsWith('sim');
  const isNo =
    choice === LEADER_DRIVER_NO_ID ||
    choice === 'nao' ||
    choice === 'não' ||
    choice === 'n' ||
    choice.startsWith('nao');

  if (!isYes && !isNo) {
    await sendButtonMessage(
      contact.wa_phone as string,
      'Por favor, use os botões Sim ou Não.',
      [
        { id: LEADER_DRIVER_YES_ID, title: 'Sim' },
        { id: LEADER_DRIVER_NO_ID, title: 'Não' },
      ]
    );
    return;
  }

  if (isNo) {
    await supabase
      .from('conversations')
      .update({ context_driver_id: null, updated_at: new Date().toISOString() })
      .eq('id', conversation.id as string);
    await transitionLeaderToSectorPicker(contact, conversation, session, {
      ...ctx,
      leader_pharmacy_id: pharmacyId,
      leader_driver_id: null,
    });
    return;
  }

  let drivers: LeaderDriverOption[] = [];
  try {
    drivers = await getDriversAtPharmacyForLeader(supabase, pharmacyId);
  } catch (err) {
    console.error('[Orchestrator] getDriversAtPharmacyForLeader:', err);
  }

  if (!drivers.length) {
    await sendTextMessage(
      contact.wa_phone as string,
      await getBotMessage(
        'leader_no_drivers_at_pharmacy',
        'Não há entregadores ativos vinculados a esta farmácia. Vamos escolher o setor de atendimento.'
      )
    );
    await supabase
      .from('conversations')
      .update({ context_driver_id: null, updated_at: new Date().toISOString() })
      .eq('id', conversation.id as string);
    await transitionLeaderToSectorPicker(contact, conversation, session, {
      ...ctx,
      leader_pharmacy_id: pharmacyId,
    });
    return;
  }

  if (needsNumberedLeaderDriverMenu(drivers)) {
    await updateSession(session.id as string, 'ask_leader_driver', {
      ...ctx,
      leader_pharmacy_id: pharmacyId,
      leader_driver_options: drivers,
      leader_driver_selection_mode: 'numbered',
      leader_driver_page: 0,
    });
    await sendNumberedDriverMenu(
      contact.wa_phone as string,
      await getBotMessage('leader_ask_driver_list', 'Qual entregador? Escolha pelo número:'),
      drivers,
      0
    );
    return;
  }

  const rows = buildLeaderDriverListRows(drivers);
  await updateSession(session.id as string, 'ask_leader_driver', {
    ...ctx,
    leader_pharmacy_id: pharmacyId,
    leader_driver_options: drivers,
    leader_driver_selection_mode: 'interactive',
  });
  await sendListMessage(
    contact.wa_phone as string,
    await getBotMessage('leader_ask_driver_list', 'Qual entregador? Toque em Ver opções e escolha na lista.'),
    WA_LIST_BTN_DRIVERS,
    WA_LIST_SECTION_DRIVERS,
    rows
  );
}

async function stepAskLeaderDriver(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  msg: Record<string, unknown>
) {
  const ctx = session.context_data as Record<string, unknown>;
  const pharmacyId = String(ctx.leader_pharmacy_id || '').trim();
  const drivers = (ctx.leader_driver_options || []) as LeaderDriverOption[];
  const selectionMode = String(ctx.leader_driver_selection_mode || 'interactive');

  let driverId = extractInteractiveId(msg);
  const rawContent = extractContent(msg).trim().toLowerCase();

  if (driverId === LEADER_DRIVER_NONE_ID || rawContent === 'n' || rawContent === 'nao' || rawContent === 'não') {
    await supabase
      .from('conversations')
      .update({ context_driver_id: null, updated_at: new Date().toISOString() })
      .eq('id', conversation.id as string);
    await transitionLeaderToSectorPicker(contact, conversation, session, {
      ...ctx,
      leader_pharmacy_id: pharmacyId,
      leader_driver_id: null,
    });
    return;
  }

  if (!driverId && selectionMode === 'numbered') {
    const parsed = parseNumberedSelection(rawContent);
    let page = Number(ctx.leader_driver_page || 0);
    if (parsed.kind === 'next') {
      const totalPages = Math.max(1, Math.ceil(drivers.length / NUMBERED_MENU_PAGE_SIZE));
      page = Math.min(totalPages - 1, page + 1);
      await updateSession(session.id as string, 'ask_leader_driver', { ...ctx, leader_driver_page: page });
      await sendNumberedDriverMenu(
        contact.wa_phone as string,
        await getBotMessage('leader_ask_driver_list', 'Escolha o entregador pelo número:'),
        drivers,
        page
      );
      return;
    }
    if (parsed.kind === 'prev') {
      page = Math.max(0, page - 1);
      await updateSession(session.id as string, 'ask_leader_driver', { ...ctx, leader_driver_page: page });
      await sendNumberedDriverMenu(
        contact.wa_phone as string,
        await getBotMessage('leader_ask_driver_list', 'Escolha o entregador pelo número:'),
        drivers,
        page
      );
      return;
    }
    if (parsed.kind === 'pick') {
      const visible = paginateOptions(drivers, page, NUMBERED_MENU_PAGE_SIZE);
      const picked = visible[parsed.value - 1];
      if (picked) driverId = picked.id;
    }
  }

  if (!driverId) {
    const legacy = Number.parseInt(rawContent, 10) - 1;
    if (!Number.isNaN(legacy) && legacy >= 0 && legacy < drivers.length) {
      driverId = drivers[legacy].id;
    }
  }

  if (!driverId || !(await isDriverLinkedToPharmacy(supabase, pharmacyId, driverId))) {
    if (selectionMode === 'numbered') {
      await sendNumberedDriverMenu(
        contact.wa_phone as string,
        await getBotMessage(
          'leader_ask_driver_invalid_numbered',
          'Resposta inválida. Envie o número do entregador, "9" para próxima página ou "0" para voltar.'
        ),
        drivers,
        Number(ctx.leader_driver_page || 0)
      );
    } else {
      await sendListMessage(
        contact.wa_phone as string,
        await getBotMessage(
          'leader_ask_driver_invalid',
          'Por favor, abra a lista e selecione um entregador ou "Não está na lista".'
        ),
        WA_LIST_BTN_DRIVERS,
        WA_LIST_SECTION_DRIVERS,
        buildLeaderDriverListRows(drivers)
      );
    }
    return;
  }

  const driver = drivers.find((d) => d.id === driverId);
  await supabase
    .from('conversations')
    .update({ context_driver_id: driverId, updated_at: new Date().toISOString() })
    .eq('id', conversation.id as string);

  await transitionLeaderToSectorPicker(contact, conversation, session, {
    ...ctx,
    leader_pharmacy_id: pharmacyId,
    leader_driver_id: driverId,
    leader_driver_name: driver?.name || '',
  });
}

async function stepIdentify(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  inboundText: string
) {
  const profileType = contact.profile_type as string;

  if (profileType === 'unknown') {
    const ctx = (session.context_data as Record<string, unknown>) || {};
    const triagemMode = String(ctx.triagem_mode || '').trim();
    if (triagemMode === 'por_perfil') {
      await updateSession(session.id as string, 'ask_profile_type', {});
      const welcome =
        String(ctx.flow_welcome || '').trim() ||
        (await getBotMessage(
          'unknown_welcome_profile',
          'Olá! Não encontrei seu cadastro. Qual é o seu perfil? Toque em Ver perfis.'
        ));
      await sendProfileTypePicker(contact.wa_phone as string, welcome);
      return;
    }
    await updateSession(session.id as string, 'ask_if_driver', {});
    await sendButtonMessage(
      contact.wa_phone as string,
      await getBotMessage(
        'unknown_ask_driver',
        'Ola! Nao encontrei seu cadastro neste numero. Voce e entregador?'
      ),
      [
        { id: 'is_driver', title: 'Sim, sou entregador' },
        { id: 'not_driver', title: 'Nao' },
      ]
    );
    return;
  }

  if (profileType === 'driver') {
    const pharmacies = await getDriverPharmacies(contact.driver_id as string);
    const sectors = await getActiveSectors();
    await updateSession(session.id as string, 'ask_intent', { pharmacies, profile_type: profileType, sectors });

    await sendSectorListMessage(
      contact.wa_phone as string,
      await getBotMessage(
        'driver_greeting_list',
        'Ola! Como posso te ajudar? Toque em Ver setores e escolha o tipo de atendimento:'
      ),
      sectors
    );
    return;
  }

  if (profileType === 'pharmacy') {
    const sectors = await getActiveSectors();
    await updateSession(session.id as string, 'ask_intent', {
      profile_type: 'pharmacy',
      pharmacy_id: contact.pharmacy_id,
      sectors,
    });
    await sendSectorListMessage(
      contact.wa_phone as string,
      await getBotMessage(
        'pharmacy_greeting_list',
        'Ola! Escolha o setor macro e depois o tipo de demanda.'
      ),
      sectors
    );
    return;
  }

  if (profileType === 'partner') {
    await beginPartnerSectorFlow(contact, conversation, session);
    return;
  }

  if (profileType === 'leader') {
    const leaderPharmacies = await loadLeaderPharmaciesForContact(contact);
    const baseCtx = { profile_type: 'leader', leader_flow: true, pharmacies: leaderPharmacies };

    if (!leaderPharmacies.length) {
      await sendTextMessage(
        contact.wa_phone as string,
        await getBotMessage(
          'leader_no_pharmacy',
          'Não encontramos farmácias vinculadas ao seu cadastro. Escolha o setor para encaminharmos o atendimento.'
        )
      );
      await transitionLeaderToSectorPicker(contact, conversation, session, baseCtx);
      return;
    }

    if (leaderPharmacies.length === 1) {
      await beginLeaderAskAboutDriver(contact, conversation, session, baseCtx, leaderPharmacies[0].pharmacy_id);
      return;
    }

    await sendTextMessage(
      contact.wa_phone as string,
      await getBotMessage(
        'leader_greeting_pharmacy',
        'Olá! Sobre qual farmácia você quer falar? Toque em Ver opções ou responda com o número da opção.'
      )
    );
    await sendLeaderPharmacyPicker(contact, session, leaderPharmacies, baseCtx);
    return;
  }
}

async function stepAskIntent(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  msg: Record<string, unknown>
) {
  const ctx = session.context_data as Record<string, unknown>;
  const pharmacies = (ctx.pharmacies || []) as Array<{ pharmacy_id: string; pharmacies: { trade_name: string } }>;
  const sectors = (ctx.sectors || []) as Array<{ id: string; name: string; is_active?: boolean }>;

  const sectorId = extractInteractiveId(msg);
  let selectedSector = sectorId ? sectors.find((s) => s.id === sectorId) : undefined;

  if (!selectedSector) {
    const legacy = Number.parseInt((extractContent(msg) || '').trim(), 10) - 1;
    if (!Number.isNaN(legacy) && legacy >= 0 && legacy < sectors.length) {
      selectedSector = sectors[legacy];
    }
  }

  if (!selectedSector) {
    await sendSectorListMessage(
      contact.wa_phone as string,
      await getBotMessage(
        'ask_intent_invalid',
        'Opcao invalida. Toque em Ver setores e escolha um setor da lista.'
      ),
      sectors
    );
    return;
  }

  const profileType = String(
    ctx.profile_type || (contact as { profile_type?: string }).profile_type || ''
  ).trim();
  const intent = normalizeIntent(selectedSector.name);
  const conversationId = conversation.id as string;
  await maybeOutOfHoursNotice(supabase, conversationId, selectedSector.id);

  if (profileType === 'partner') {
    await routeToSectorId(conversation.id as string, selectedSector.id);
    await setIntentSectorIfMissing(conversation.id as string, selectedSector.id);
    const handled = await applyRoutingRule(conversation.id as string, {
      profile_type: 'partner',
      intent,
      intent_sector_id: selectedSector.id,
      intent_name: selectedSector.name,
    });
    if (!handled) {
      await routeToSector(conversation.id as string, selectedSector.name);
    }
    await applyQueueSlaNode(conversation.id as string, `Triagem parceiro: ${selectedSector.name}`, {
      first_response_sla_minutes: 25,
      treatment_sla_minutes: 120,
      resolution_sla_minutes: 480,
      first_response_action: 'alert_attendant',
      treatment_action: 'alert_and_reassign',
      resolution_action: 'escalate_supervisor',
      use_business_hours: true,
      business_hours_id: 'default',
      business_hours_label: 'Padrão · seg-sex 08h-18h',
    });
    await createBotInternalNote(
      conversation.id as string,
      `Triagem parceiro: setor ${selectedSector.name} — encaminhamento direto ao atendente do setor.`
    );
    await completeGuidedIntakeSession(session.id as string, {
      guided_intake: {
        path: 'partner_sector_direct',
        sector_id: selectedSector.id,
        sector_name: selectedSector.name,
      },
    });
    return;
  }

  if (profileType === 'leader') {
    const leaderDriverId = String(ctx.leader_driver_id || '').trim();
    const demandProfile = leaderDriverId ? 'driver' : 'pharmacy';
    await updateSession(session.id as string, 'ask_demand', {
      ...ctx,
      leader_flow: true,
      pending_sector_id: selectedSector.id,
      pending_sector_name: selectedSector.name,
      demand_profile: demandProfile,
      intent,
      intent_sector_id: selectedSector.id,
      intent_name: selectedSector.name,
    });
    const demands = runtimeListDemandsForSector(demandProfile, selectedSector.name);
    if (needsNumberedDemandMenu(demands)) {
      await sendNumberedDemandMenu(
        contact.wa_phone as string,
        `Setor: ${selectedSector.name}. Escolha a demanda pelo número:`,
        demands
      );
      return;
    }
    await sendListMessage(
      contact.wa_phone as string,
      `Setor: ${selectedSector.name}. Escolha a demanda ou envie o número (1–${demands.length}).`,
      WA_LIST_BTN_DEMANDS,
      WA_LIST_SECTION_DEMANDS,
      demands.map((d) => ({ id: d.id, title: d.title }))
    );
    return;
  }

  if (profileType === 'pharmacy') {
    await updateSession(session.id as string, 'ask_demand', {
      ...ctx,
      pending_sector_id: selectedSector.id,
      pending_sector_name: selectedSector.name,
      demand_profile: 'pharmacy',
      intent,
      intent_sector_id: selectedSector.id,
      intent_name: selectedSector.name,
    });
    const demands = runtimeListDemandsForSector('pharmacy', selectedSector.name);
    await sendListMessage(
      contact.wa_phone as string,
      `Setor: ${selectedSector.name}. Escolha a demanda ou envie o número (1–${demands.length}).`,
      WA_LIST_BTN_DEMANDS,
      WA_LIST_SECTION_DEMANDS,
      demands.map((d) => ({ id: d.id, title: d.title }))
    );
    return;
  }

  const requiresContext = await hasRuleRequiringContextPharmacy({
    profile_type: 'driver',
    intent,
    intent_sector_id: selectedSector.id,
    intent_name: selectedSector.name,
  });
  if (requiresContext) {
    await routeToSectorId(conversation.id as string, selectedSector.id);
    await setIntentSectorIfMissing(conversation.id as string, selectedSector.id);

    if (pharmacies.length === 1) {
      const pharmacy = pharmacies[0];
      await supabase.from('conversations').update({ context_pharmacy_id: pharmacy.pharmacy_id }).eq('id', conversation.id);
      const handled = await applyRoutingRule(conversation.id as string, {
        profile_type: 'driver',
        intent,
        intent_sector_id: selectedSector.id,
        intent_name: selectedSector.name,
        pharmacy_id: pharmacy.pharmacy_id,
        requires_context_pharmacy: true,
      });
      if (!handled) {
        await routeToPharmacyAttendant(conversation.id as string, pharmacy.pharmacy_id, selectedSector.id);
      }
      await applyQueueSlaNode(conversation.id as string, 'Triagem guiada (entregador + farmácia)', {
        first_response_sla_minutes: 25,
        treatment_sla_minutes: 120,
        resolution_sla_minutes: 480,
        first_response_action: 'alert_attendant',
        treatment_action: 'alert_and_reassign',
        resolution_action: 'escalate_supervisor',
        use_business_hours: true,
        business_hours_id: 'default',
        business_hours_label: 'Padrão · seg-sex 08h-18h',
      });
      await completeGuidedIntakeSession(session.id as string, {
        guided_intake: { path: 'driver_single_pharmacy' },
      });
    } else {
      const rows = pharmacies.slice(0, WA_LIST_MAX_ROWS).map((item) => ({
        id: item.pharmacy_id,
        title: (item.pharmacies?.trade_name as string) || 'Farmacia',
      }));
      const optionsForSelection = pharmacies.map((item) => ({
        id: item.pharmacy_id,
        trade_name: (item.pharmacies?.trade_name as string) || 'Farmacia',
      }));
      if (needsNumberedPharmacyMenu(optionsForSelection)) {
        await sendNumberedPharmacyMenu(
          contact.wa_phone as string,
          await getBotMessage('ask_pharmacy_numbered', 'Sobre qual farmácia é o atendimento? Escolha pelo número:'),
          optionsForSelection,
          0
        );
      } else {
        const body =
          (await getBotMessage(
            'ask_pharmacy',
            'Sobre qual farmácia é o seu atendimento? Toque em Ver opções e escolha:'
          )) + (pharmacies.length > WA_LIST_MAX_ROWS ? ` Mostrando as primeiras ${WA_LIST_MAX_ROWS} opções.` : '');
        await sendListMessage(contact.wa_phone as string, body, WA_LIST_BTN_PHARMACIES, WA_LIST_SECTION_PHARMACIES, rows);
      }
      await updateSession(session.id as string, 'ask_pharmacy', {
        ...ctx,
        intent,
        intent_sector_id: selectedSector.id,
        intent_name: selectedSector.name,
        pharmacy_selection_mode: needsNumberedPharmacyMenu(optionsForSelection) ? 'numbered' : 'interactive',
        pharmacy_page: 0,
        pharmacy_search: '',
      });
    }
    return;
  }

  /** Várias farmácias: sempre escolher farmácia antes da lista de demandas (herança atendente/setor). */
  if (pharmacies.length > 1) {
    await routeToSectorId(conversation.id as string, selectedSector.id);
    await setIntentSectorIfMissing(conversation.id as string, selectedSector.id);

    const rowsMulti = pharmacies.slice(0, WA_LIST_MAX_ROWS).map((item) => ({
      id: item.pharmacy_id,
      title: (item.pharmacies?.trade_name as string) || 'Farmacia',
    }));
    const optionsMulti = pharmacies.map((item) => ({
      id: item.pharmacy_id,
      trade_name: (item.pharmacies?.trade_name as string) || 'Farmacia',
    }));
    if (needsNumberedPharmacyMenu(optionsMulti)) {
      await sendNumberedPharmacyMenu(
        contact.wa_phone as string,
        await getBotMessage(
          'ask_pharmacy_before_demand_numbered',
          'Antes da demanda: qual farmácia? Escolha pelo número:'
        ),
        optionsMulti,
        0
      );
    } else {
      const bodyMulti =
        (await getBotMessage(
          'ask_pharmacy_before_demand',
          'Antes de escolher a demanda: qual farmácia? Toque em Ver opções e escolha:'
        )) + (pharmacies.length > WA_LIST_MAX_ROWS ? ` Mostrando as primeiras ${WA_LIST_MAX_ROWS} opções.` : '');
      await sendListMessage(
        contact.wa_phone as string,
        bodyMulti,
        WA_LIST_BTN_PHARMACIES,
        WA_LIST_SECTION_PHARMACIES,
        rowsMulti
      );
    }
    await updateSession(session.id as string, 'ask_pharmacy', {
      ...ctx,
      intent,
      intent_sector_id: selectedSector.id,
      intent_name: selectedSector.name,
      pharmacy_selection_mode: needsNumberedPharmacyMenu(optionsMulti) ? 'numbered' : 'interactive',
      pharmacy_page: 0,
      pharmacy_search: '',
      pharmacy_then_demand: true,
    });
    return;
  }

  await updateSession(session.id as string, 'ask_demand', {
    ...ctx,
    pending_sector_id: selectedSector.id,
    pending_sector_name: selectedSector.name,
    demand_profile: 'driver',
    intent,
    intent_sector_id: selectedSector.id,
    intent_name: selectedSector.name,
  });
  const demandsDr = runtimeListDemandsForSector('driver', selectedSector.name);
  await sendListMessage(
    contact.wa_phone as string,
    `Setor: ${selectedSector.name}. Escolha a demanda ou envie o número (1–${demandsDr.length}).`,
    WA_LIST_BTN_DEMANDS,
    WA_LIST_SECTION_DEMANDS,
    demandsDr.map((d) => ({ id: d.id, title: d.title }))
  );
}

async function stepAskPharmacy(
  contact: Record<string, unknown>,
  conversation: Record<string, unknown>,
  session: Record<string, unknown>,
  msg: Record<string, unknown>
) {
  const ctx = session.context_data as Record<string, unknown>;
  const pharmacies = (ctx.pharmacies || []) as Array<{ pharmacy_id: string; pharmacies: { trade_name: string } }>;
  const intent = normalizeIntent((ctx.intent as string | undefined) || '');
  const intentSectorId = (ctx.intent_sector_id as string | undefined) || undefined;
  const intentName = (ctx.intent_name as string | undefined) || undefined;

  const selectionMode = String(ctx.pharmacy_selection_mode || 'interactive');
  const pharmacyId = extractInteractiveId(msg);
  let selected = pharmacyId ? pharmacies.find((p) => p.pharmacy_id === pharmacyId) : undefined;

  if (!selected && selectionMode === 'numbered') {
    const options = pharmacies.map((item) => ({
      id: item.pharmacy_id,
      trade_name: (item.pharmacies?.trade_name as string) || 'Farmacia',
    }));
    const parsed = parseNumberedSelection(extractContent(msg));
    const search = String(ctx.pharmacy_search || '').trim().toLowerCase();
    const filtered = search ? options.filter((p) => p.trade_name.toLowerCase().includes(search)) : options;
    let page = Number(ctx.pharmacy_page || 0);

    if (parsed.kind === 'search') {
      const byText = options.filter((p) => p.trade_name.toLowerCase().includes(parsed.value));
      if (byText.length === 0) {
        await sendTextMessage(contact.wa_phone as string, 'Não encontrei essa farmácia. Tente outro trecho.');
        return;
      }
      await updateSession(session.id as string, 'ask_pharmacy', { ...ctx, pharmacy_search: parsed.value, pharmacy_page: 0 });
      await sendNumberedPharmacyMenu(contact.wa_phone as string, 'Resultados filtrados:', byText, 0);
      return;
    }
    if (parsed.kind === 'next') {
      const totalPages = Math.max(1, Math.ceil(filtered.length / NUMBERED_MENU_PAGE_SIZE));
      page = Math.min(totalPages - 1, page + 1);
      await updateSession(session.id as string, 'ask_pharmacy', { ...ctx, pharmacy_page: page });
      await sendNumberedPharmacyMenu(contact.wa_phone as string, 'Escolha a farmácia pelo número:', filtered, page);
      return;
    }
    if (parsed.kind === 'prev') {
      page = Math.max(0, page - 1);
      await updateSession(session.id as string, 'ask_pharmacy', { ...ctx, pharmacy_page: page });
      await sendNumberedPharmacyMenu(contact.wa_phone as string, 'Escolha a farmácia pelo número:', filtered, page);
      return;
    }
    if (parsed.kind === 'pick') {
      const visible = paginateOptions(filtered, page, NUMBERED_MENU_PAGE_SIZE);
      const selectedOption = visible[parsed.value - 1];
      if (selectedOption) {
        selected = pharmacies.find((p) => p.pharmacy_id === selectedOption.id);
      }
    }
  }

  if (!selected) {
    const content = (extractContent(msg) || '').toLowerCase().trim();
    const choice = Number.parseInt(content, 10) - 1;
    if (!Number.isNaN(choice) && choice >= 0 && choice < pharmacies.length) {
      selected = pharmacies[choice];
    }
  }

  if (!selected) {
    const options = pharmacies.map((item) => ({
      id: item.pharmacy_id,
      trade_name: (item.pharmacies?.trade_name as string) || 'Farmacia',
    }));
    if (selectionMode === 'numbered') {
      await sendNumberedPharmacyMenu(
        contact.wa_phone as string,
        await getBotMessage(
          'ask_pharmacy_invalid_numbered',
          'Resposta inválida. Envie o número da farmácia, "9" para próxima página ou "0" para voltar.'
        ),
        options,
        Number(ctx.pharmacy_page || 0)
      );
    } else {
      const rows = options.slice(0, WA_LIST_MAX_ROWS).map((item) => ({
        id: item.id,
        title: item.trade_name,
      }));
      await sendListMessage(
        contact.wa_phone as string,
        await getBotMessage('ask_pharmacy_invalid', 'Por favor, abra a lista e selecione uma farmácia.'),
        WA_LIST_BTN_PHARMACIES,
        WA_LIST_SECTION_PHARMACIES,
        rows
      );
    }
    return;
  }
  await supabase.from('conversations').update({ context_pharmacy_id: selected.pharmacy_id }).eq('id', conversation.id as string);

  if (ctx.leader_flow === true) {
    await beginLeaderAskAboutDriver(contact, conversation, session, ctx, selected.pharmacy_id);
    return;
  }

  const pharmacyThenDemand = ctx.pharmacy_then_demand === true;
  if (pharmacyThenDemand && intentSectorId && intentName) {
    const demandsNext = runtimeListDemandsForSector('driver', intentName);
    await updateSession(session.id as string, 'ask_demand', {
      ...ctx,
      pharmacies: [selected],
      pharmacy_then_demand: false,
      pending_sector_id: intentSectorId,
      pending_sector_name: intentName,
      demand_profile: 'driver',
    });
    await sendListMessage(
      contact.wa_phone as string,
      `Farmácia definida. Setor: ${intentName}. Escolha a demanda ou envie o número (1–${demandsNext.length}).`,
      WA_LIST_BTN_DEMANDS,
      WA_LIST_SECTION_DEMANDS,
      demandsNext.map((d) => ({ id: d.id, title: d.title }))
    );
    return;
  }

  const handled = await applyRoutingRule(conversation.id as string, {
    profile_type: 'driver',
    intent,
    intent_sector_id: intentSectorId,
    intent_name: intentName,
    pharmacy_id: selected.pharmacy_id,
    requires_context_pharmacy: true,
  });

  if (!handled) {
    await routeToPharmacyAttendant(conversation.id as string, selected.pharmacy_id, intentSectorId);
  }
  await applyQueueSlaNode(conversation.id as string, 'Triagem guiada (farmácia escolhida)', {
    first_response_sla_minutes: 25,
    treatment_sla_minutes: 120,
    resolution_sla_minutes: 480,
    first_response_action: 'alert_attendant',
    treatment_action: 'alert_and_reassign',
    resolution_action: 'escalate_supervisor',
    use_business_hours: true,
    business_hours_id: 'default',
    business_hours_label: 'Padrão · seg-sex 08h-18h',
  });
  await completeGuidedIntakeSession(session.id as string, {
    guided_intake: { path: 'driver_pick_pharmacy' },
  });
}

async function routeToPharmacyAttendant(conversationId: string, pharmacyId: string, sectorId?: string) {
  const { data: general } = await supabase.from('sectors').select('id').eq('name', 'Atendimento Geral').single();
  const fallbackSectorId = sectorId || (general?.id as string | undefined);

  if (sectorId && (await isSectorClosedNow(supabase, sectorId))) {
    await supabase
      .from('conversations')
      .update({
        sector_id: sectorId,
        attendant_id: null,
        context_pharmacy_id: pharmacyId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    await setIntentSectorIfMissing(conversationId, sectorId);
    await refreshConversationSla(supabase, conversationId);
    await maybeOutOfHoursNotice(supabase, conversationId, sectorId);
    await maybeQueueWaitingNotice(supabase, conversationId);
    return;
  }

  const { data: pharmacy } = await supabase
    .from('pharmacies')
    .select('primary_attendant_id')
    .eq('id', pharmacyId)
    .single();

  const { data: sectorRows } = await supabase
    .from('pharmacy_sector_attendants')
    .select('sector_id, attendant_id')
    .eq('pharmacy_id', pharmacyId);

  const bySector = new Map<string, string>();
  for (const r of sectorRows || []) {
    if (r.sector_id && r.attendant_id) bySector.set(String(r.sector_id), String(r.attendant_id));
  }

  const seenAttendant = new Set<string>();
  const candidates: string[] = [];
  const pushCandidate = (id: string | undefined) => {
    if (!id || seenAttendant.has(id)) return;
    seenAttendant.add(id);
    candidates.push(id);
  };
  if (sectorId && bySector.has(sectorId)) pushCandidate(bySector.get(sectorId));
  if (pharmacy?.primary_attendant_id) pushCandidate(pharmacy.primary_attendant_id as string);

  for (const attendantUserId of candidates) {
    const { data: attendant } = await supabase
      .from('users')
      .select('business_hours')
      .eq('id', attendantUserId)
      .single();

    const ucfg = normalizeBusinessHours(attendant?.business_hours ?? {});
    const attendantClosed =
      hasCanonicalBusinessHours(attendant?.business_hours) && !isOpen(ucfg, new Date());

    if (attendantClosed) continue;

    await supabase
      .from('conversations')
      .update({
        attendant_id: attendantUserId,
        context_pharmacy_id: pharmacyId,
        ...(fallbackSectorId ? { sector_id: fallbackSectorId } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    if (sectorId) {
      await setIntentSectorIfMissing(conversationId, sectorId);
    } else if (general?.id) {
      await setIntentSectorIfMissing(conversationId, general.id as string);
    }
    await refreshConversationSla(supabase, conversationId);
    const { data: convRow } = await supabase.from('conversations').select('sector_id').eq('id', conversationId).single();
    await maybeOutOfHoursNotice(supabase, conversationId, (convRow?.sector_id as string | null) || null);
    return;
  }

  if (pharmacy?.primary_attendant_id) {
    await supabase
      .from('conversations')
      .update({
        attendant_id: null,
        context_pharmacy_id: pharmacyId,
        ...(fallbackSectorId ? { sector_id: fallbackSectorId } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    if (sectorId) await setIntentSectorIfMissing(conversationId, sectorId);
    else if (general?.id) await setIntentSectorIfMissing(conversationId, general.id as string);

    await refreshConversationSla(supabase, conversationId);
    const { data: convRow2 } = await supabase.from('conversations').select('sector_id').eq('id', conversationId).single();
    await maybeOutOfHoursNotice(supabase, conversationId, (convRow2?.sector_id as string | null) || null);
    await maybeQueueWaitingNotice(supabase, conversationId);
    return;
  }

  /** Sem atendente disponível: fila do setor escolhido (mantém contexto da farmácia quando houver). */
  if (sectorId) {
    await supabase
      .from('conversations')
      .update({
        sector_id: sectorId,
        attendant_id: null,
        context_pharmacy_id: pharmacyId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    await setIntentSectorIfMissing(conversationId, sectorId);
    await refreshConversationSla(supabase, conversationId);
    const { data: convQueue } = await supabase.from('conversations').select('sector_id').eq('id', conversationId).single();
    await maybeOutOfHoursNotice(supabase, conversationId, (convQueue?.sector_id as string | null) || null);
    await maybeQueueWaitingNotice(supabase, conversationId);
    return;
  }

  await routeToSector(conversationId, 'Atendimento Geral');
}

async function routeToSector(conversationId: string, sectorName: string) {
  const { data: sector } = await supabase.from('sectors').select('id').eq('name', sectorName).single();
  if (!sector) return;

  await supabase
    .from('conversations')
    .update({ sector_id: sector.id, updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  await setIntentSectorIfMissing(conversationId, sector.id as string);

  await refreshConversationSla(supabase, conversationId);
  await maybeOutOfHoursNotice(supabase, conversationId, sector.id as string);
  await maybeQueueWaitingNotice(supabase, conversationId);

  return sector.id as string;
}

async function routeToSectorId(conversationId: string, sectorId: string) {
  await supabase
    .from('conversations')
    .update({ sector_id: sectorId, updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  await refreshConversationSla(supabase, conversationId);
  await maybeOutOfHoursNotice(supabase, conversationId, sectorId);
  await maybeQueueWaitingNotice(supabase, conversationId);
}

async function setIntentSectorIfMissing(conversationId: string, sectorId: string) {
  const { data: current } = await supabase
    .from('conversations')
    .select('intent_sector_id')
    .eq('id', conversationId)
    .single();

  if (current?.intent_sector_id) return;

  await supabase
    .from('conversations')
    .update({ intent_sector_id: sectorId, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
}

async function getActiveSectors() {
  const { data } = await supabase.from('sectors').select('id, name, is_active').eq('is_active', true).order('name');
  return (data || []) as Array<{ id: string; name: string; is_active: boolean }>;
}

async function hasRuleRequiringContextPharmacy(context: {
  profile_type?: string;
  intent?: string;
  intent_sector_id?: string;
  intent_name?: string;
}) {
  const { data: rules } = await supabase
    .from('routing_rules')
    .select('conditions, is_active')
    .eq('is_active', true)
    .order('priority', { ascending: false });

  const wantedIntent = normalizeIntent(context.intent);
  for (const rule of rules || []) {
    const conditions = (rule.conditions || {}) as Record<string, unknown>;
    if (conditions.profile_type && conditions.profile_type !== context.profile_type) continue;
    if (conditions.intent_sector_id && String(conditions.intent_sector_id) !== String(context.intent_sector_id || '')) continue;
    if (conditions.intent && normalizeIntent(String(conditions.intent)) !== normalizeIntent(context.intent_name || wantedIntent)) continue;
    if (conditions.requires_context_pharmacy === true) return true;
  }

  return false;
}

async function handleStatusUpdate(status: { id: string; status: string }, workspaceId: string | null) {
  const updates: Record<string, string> = {};
  if (status.status === 'delivered') updates.delivered_at = new Date().toISOString();
  if (status.status === 'read') updates.read_at = new Date().toISOString();

  if (Object.keys(updates).length > 0) {
    updates.status = status.status;
    let query = supabase.from('messages').update(updates).eq('meta_message_id', status.id);
    if (workspaceId) query = query.eq('workspace_id', workspaceId);
    await query;
  }
}

async function resolveCommercialLeadIdForPhone(workspaceId: string, canonicalPhone: string): Promise<string | null> {
  for (const variant of waPhoneLookupVariants(canonicalPhone)) {
    const { data } = await supabase
      .from('commercial_leads')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('phone', variant)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }
  return null;
}

async function enrichContactDisplayNameFromCadastro(
  workspaceId: string,
  contact: Record<string, unknown>,
  phoneVariants: string[]
): Promise<Record<string, unknown>> {
  const displayName = String(contact.display_name || '').trim();
  const digits = displayName.replace(/\D/g, '');
  const looksLikePhone = digits.length >= 10 && digits.length <= 13;
  if (displayName && !looksLikePhone) return contact;

  let driverId = contact.driver_id ? String(contact.driver_id) : '';
  if (!driverId) {
    const { data: driverByPhone } = await supabase
      .from('drivers')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .in('phone', phoneVariants.length ? phoneVariants : [String(contact.wa_phone || '')])
      .limit(1)
      .maybeSingle();
    if (driverByPhone?.id) driverId = String(driverByPhone.id);
    if (driverByPhone?.name) {
      await supabase
        .from('contacts')
        .update({
          display_name: String(driverByPhone.name),
          profile_type: contact.profile_type === 'unknown' ? 'driver' : contact.profile_type,
          driver_id: driverId || contact.driver_id || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contact.id);
      return {
        ...contact,
        display_name: String(driverByPhone.name),
        driver_id: driverId || contact.driver_id,
        profile_type: contact.profile_type === 'unknown' ? 'driver' : contact.profile_type,
      };
    }
  }

  if (driverId) {
    const { data: driver } = await supabase
      .from('drivers')
      .select('name')
      .eq('id', driverId)
      .maybeSingle();
    const driverName = String(driver?.name || '').trim();
    if (driverName) {
      await supabase
        .from('contacts')
        .update({ display_name: driverName, updated_at: new Date().toISOString() })
        .eq('id', contact.id);
      return { ...contact, display_name: driverName };
    }
  }

  return contact;
}

export async function getOrCreateContact(phone: string, msg: Record<string, unknown>, workspaceId: string) {
  const canonical = canonicalBrazilWaPhone(phone) || String(phone || '').replace(/\D/g, '');
  const lookupPhones = waPhoneLookupVariants(canonical);

  for (const variant of lookupPhones) {
    const { data: existing, error: existingError } = await supabase
      .from('contacts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('wa_phone', variant)
      .maybeSingle();
    if (existingError) {
      throw new Error(`Falha ao consultar contato: ${existingError.message}`);
    }
    if (existing) {
      if (existing.wa_phone !== canonical) {
        const commercialLeadId =
          existing.commercial_lead_id || (await resolveCommercialLeadIdForPhone(workspaceId, canonical));
        await supabase
          .from('contacts')
          .update({
            wa_phone: canonical,
            commercial_lead_id: commercialLeadId || existing.commercial_lead_id || null,
            profile_type: commercialLeadId ? 'commercial_lead' : existing.profile_type,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        const merged = {
          ...existing,
          wa_phone: canonical,
          commercial_lead_id: commercialLeadId || existing.commercial_lead_id,
        };
        return enrichContactDisplayNameFromCadastro(workspaceId, merged, lookupPhones);
      }
      return enrichContactDisplayNameFromCadastro(workspaceId, existing, lookupPhones);
    }
  }

  const phoneVariants = lookupPhones.length ? lookupPhones : [canonical];
  const [driver, pharmacy, leader, commercialLeadId] = await Promise.all([
    supabase.from('drivers').select('id, name').eq('workspace_id', workspaceId).in('phone', phoneVariants).limit(1).maybeSingle(),
    supabase.from('pharmacies').select('id').eq('workspace_id', workspaceId).in('phone', phoneVariants).limit(1).maybeSingle(),
    supabase.from('leaders').select('id').eq('workspace_id', workspaceId).in('phone', phoneVariants).limit(1).maybeSingle(),
    resolveCommercialLeadIdForPhone(workspaceId, canonical),
  ]);

  const profileType = commercialLeadId
    ? 'commercial_lead'
    : driver.data
      ? 'driver'
      : pharmacy.data
        ? 'pharmacy'
        : leader.data
          ? 'leader'
          : 'unknown';
  const waProfileName = (msg.contacts as Array<{ profile?: { name?: string } }>)?.[0]?.profile?.name?.trim();
  const driverName = driver.data?.name ? String(driver.data.name).trim() : '';
  const displayName = driverName || waProfileName || canonical;

  const { data: newContact, error: insertError } = await supabase
    .from('contacts')
    .insert({
      workspace_id: workspaceId,
      wa_phone: canonical,
      display_name: displayName,
      profile_type: profileType,
      driver_id: driver.data?.id || null,
      pharmacy_id: pharmacy.data?.id || null,
      leader_id: leader.data?.id || null,
      commercial_lead_id: commercialLeadId,
    })
    .select()
    .single();
  if (insertError) {
    throw new Error(`Falha ao criar contato: ${insertError.message}`);
  }

  return newContact;
}

export async function getActiveConversation(contactId: string, workspaceId: string, _workspaceChannelId?: string | null) {
  return findOpenConversationForContact(supabase, workspaceId, contactId);
}

/** Última conversa encerrada do contato — reaberta no próximo inbound (preserva setor/contexto). */
export async function getReopenableConversation(
  contactId: string,
  workspaceId: string,
  _workspaceChannelId?: string | null
) {
  return findReopenableConversationForContact(supabase, workspaceId, contactId);
}

export async function createConversation(
  contact: Record<string, unknown>,
  firstInboundText: string,
  workspaceId: string,
  workspaceChannelId?: string | null
) {
  const summary = buildSummary(firstInboundText);

  const contactId = contact.id as string | undefined;
  const profileType = String(contact.profile_type || '').trim().toLowerCase();
  const driverId = contact.driver_id ? String(contact.driver_id) : null;
  const pharmacyId = contact.pharmacy_id ? String(contact.pharmacy_id) : null;
  const leaderId = contact.leader_id ? String(contact.leader_id) : null;
  const commercialLeadId = contact.commercial_lead_id ? String(contact.commercial_lead_id) : null;

  const payload: Record<string, unknown> = {
    workspace_id: workspaceId,
    workspace_channel_id: workspaceChannelId || null,
    contact_id: contactId,
    status: 'open',
    opened_at: new Date().toISOString(),
    summary,
    tags: [],
    context_driver_id: profileType === 'driver' ? driverId : null,
    context_pharmacy_id: profileType === 'pharmacy' ? pharmacyId : null,
    context_leader_id: profileType === 'leader' ? leaderId : null,
    context_commercial_lead_id: commercialLeadId,
  };
  const { data, error } = await supabase
    .from('conversations')
    .insert(payload)
    .select()
    .single();
  if (error) {
    if (contactId && isUniqueOpenConversationViolation(error)) {
      await mergeDuplicateOpenConversations(supabase, workspaceId, contactId);
      const existing = await findOpenConversationForContact(supabase, workspaceId, contactId);
      if (existing) return existing;
    }
    throw new Error(`Falha ao criar conversa: ${error.message}`);
  }

  if (commercialLeadId && data?.id) {
    await supabase
      .from('commercial_leads')
      .update({ primary_conversation_id: data.id, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', commercialLeadId)
      .is('primary_conversation_id', null);
  }

  return data;
}

async function getOrCreateSession(contactId: string, conversationId: string, workspaceId: string) {
  const expiresAt = new Date(Date.now() + BOT_SESSION_TTL_HOURS * 3_600_000).toISOString();

  const { data: existing } = await supabase
    .from('bot_sessions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .eq('conversation_id', conversationId)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (existing) return existing;

  const { data } = await supabase
    .from('bot_sessions')
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      conversation_id: conversationId,
      current_step: 'identify',
      context_data: {},
      expires_at: expiresAt,
    })
    .select()
    .single();

  return data;
}

async function updateSession(sessionId: string, step: string, contextData: Record<string, unknown>) {
  const { data } = await supabase.from('bot_sessions').select('context_data').eq('id', sessionId).maybeSingle();
  const prev = ((data?.context_data as Record<string, unknown>) || {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...prev, ...contextData };
  if (!(BOT_INBOUND_META_DEDUP_KEY in contextData) && prev[BOT_INBOUND_META_DEDUP_KEY] !== undefined) {
    merged[BOT_INBOUND_META_DEDUP_KEY] = prev[BOT_INBOUND_META_DEDUP_KEY];
  }
  await supabase
    .from('bot_sessions')
    .update({
      current_step: step,
      context_data: merged,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);
}

async function getDriverPharmacies(driverId: string) {
  const { data } = await supabase
    .from('driver_pharmacy_links')
    .select('pharmacy_id, is_primary, pharmacies(trade_name)')
    .eq('driver_id', driverId)
    .eq('is_active', true);
  return data || [];
}

async function getLeaderPharmacies(leaderId: string) {
  const { data } = await supabase
    .from('leader_pharmacy_links')
    .select('pharmacy_id, is_active, pharmacies(trade_name)')
    .eq('leader_id', leaderId)
    .eq('is_active', true);
  return data || [];
}

async function getBotMessage(flowName: string, fallback: string, replacements: Record<string, string> = {}) {
  const mode = getActiveFlowRuntimeMode();
  const fromCatalog = runtimeCatalogMessage(flowName, fallback);

  if (mode === 'legacy') {
    const { data } = await supabase
      .from('bot_flows')
      .select('steps')
      .eq('name', flowName)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    const steps = (data?.steps as Array<{ content?: string; message?: string }> | undefined) || [];
    const legacyText = steps[0]?.content || steps[0]?.message;
    if (legacyText) {
      return applyMessageReplacements(String(legacyText), replacements);
    }
  }

  if (mode === 'shadow') {
    const { data } = await supabase
      .from('bot_flows')
      .select('steps')
      .eq('name', flowName)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    const steps = (data?.steps as Array<{ content?: string; message?: string }> | undefined) || [];
    const legacyText = String(steps[0]?.content || steps[0]?.message || '').trim();
    if (legacyText && legacyText !== fromCatalog.trim()) {
      console.log('[shadow] message diff', { key: flowName, catalog_len: fromCatalog.length, legacy_len: legacyText.length });
    }
  }

  return applyMessageReplacements(fromCatalog, replacements);
}

async function applyRoutingRule(
  conversationId: string,
  context: {
    profile_type?: string;
    intent?: string;
    intent_sector_id?: string;
    intent_name?: string;
    pharmacy_id?: string;
    requires_context_pharmacy?: boolean;
    message_text?: string;
  }
) {
  const { data: rules } = await supabase
    .from('routing_rules')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: false });

  const wantedIntent = normalizeIntent(context.intent_name || context.intent);
  const wantedIntentSectorId = context.intent_sector_id || undefined;
  const wantedText = normalizeText(context.message_text);

  for (const rule of rules || []) {
    const conditions = (rule.conditions || {}) as Record<string, unknown>;
    const action = (rule.action || {}) as Record<string, unknown>;

    if (conditions.profile_type && conditions.profile_type !== context.profile_type) continue;
    if (conditions.intent_sector_id && String(conditions.intent_sector_id) !== String(wantedIntentSectorId || '')) continue;
    if (conditions.intent && normalizeIntent(String(conditions.intent)) !== wantedIntent) continue;
    if (conditions.requires_context_pharmacy && !context.pharmacy_id) continue;

    const keywordsAny = toStringArray(conditions.keywords_any);
    const keywordsAll = toStringArray(conditions.keywords_all);
    if (keywordsAny.length > 0 || keywordsAll.length > 0) {
      // Rules with keyword constraints only make sense when we have text.
      if (!wantedText) continue;

      if (keywordsAny.length > 0) {
        const ok = keywordsAny.some((kw: string) => wantedText.includes(normalizeText(kw)));
        if (!ok) continue;
      }

      if (keywordsAll.length > 0) {
        const ok = keywordsAll.every((kw: string) => wantedText.includes(normalizeText(kw)));
        if (!ok) continue;
      }
    }

    const routeTo = action.route_to as string | undefined;

    if (routeTo === 'sector' && (action.target_id || action.target_name)) {
      let sectorId: string | undefined;
      if (action.target_id) {
        sectorId = String(action.target_id);
        await routeToSectorId(conversationId, sectorId);
        if (sectorId) await setIntentSectorIfMissing(conversationId, sectorId);
      } else if (action.target_name) {
        sectorId = await routeToSector(conversationId, String(action.target_name));
      }
      return true;
    }

    if (routeTo === 'attendant' && action.target_id) {
      const { data: attendantUser } = await supabase
        .from('users')
        .select('business_hours')
        .eq('id', action.target_id as string)
        .single();

      const ucfg = normalizeBusinessHours(attendantUser?.business_hours ?? {});
      const attendantClosed =
        hasCanonicalBusinessHours(attendantUser?.business_hours) && !isOpen(ucfg, new Date());

      if (attendantClosed) {
        const sid = conditions.intent_sector_id
          ? String(conditions.intent_sector_id)
          : (
              await supabase.from('sectors').select('id').eq('name', 'Atendimento Geral').single()
            ).data?.id;

        if (sid) {
          await routeToSectorId(conversationId, sid as string);
        }
        return true;
      }

      await supabase
        .from('conversations')
        .update({ attendant_id: action.target_id, updated_at: new Date().toISOString() })
        .eq('id', conversationId);
      if (conditions.intent_sector_id) {
        await setIntentSectorIfMissing(conversationId, String(conditions.intent_sector_id));
      }
      await refreshConversationSla(supabase, conversationId);
      return true;
    }

    if (routeTo === 'pharmacy_attendant' && (context.pharmacy_id || action.target_id)) {
      const intentSectorId =
        (context.intent_sector_id as string | undefined) ||
        (conditions.intent_sector_id ? String(conditions.intent_sector_id) : undefined);

      await routeToPharmacyAttendant(conversationId, (context.pharmacy_id || action.target_id) as string, intentSectorId);
      if (intentSectorId) await setIntentSectorIfMissing(conversationId, intentSectorId);
      return true;
    }
  }

  return false;
}

async function findActiveConversationByPhone(phone: string): Promise<{ id: string; workspace_id: string } | null> {
  const waPhone = onlyDigits(String(phone || '').trim());
  if (!waPhone) return null;

  const variants = waPhoneLookupVariants(waPhone);
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, workspace_id')
    .in('wa_phone', variants.length ? variants : [waPhone])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!contact?.id) return null;

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, workspace_id')
    .eq('workspace_id', contact.workspace_id)
    .eq('contact_id', contact.id)
    .in('status', ['open', 'pending'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation?.id || !conversation.workspace_id) return null;
  return { id: String(conversation.id), workspace_id: String(conversation.workspace_id) };
}

async function persistOutboundBotMessage(args: {
  to: string;
  type: string;
  content: string;
  metaMessageId?: string;
}) {
  try {
    const conversation = await findActiveConversationByPhone(args.to);
    if (!conversation) return;
    await supabase.from('messages').insert({
      workspace_id: conversation.workspace_id,
      conversation_id: conversation.id,
      meta_message_id: args.metaMessageId || null,
      direction: 'outbound',
      type: args.type,
      content: args.content,
      status: 'sent',
      sent_at: new Date().toISOString(),
    });
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', conversation.id);
  } catch (err) {
    console.error('[Orchestrator] Falha ao persistir outbound do bot:', err);
  }
}

async function sendTextMessage(to: string, text: string) {
  try {
    const startedAt = Date.now();
    const metaMessageId = await postMetaMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    });
    logDuration('meta_send_text', startedAt, { wa_to: to, meta_message_id: metaMessageId || null }, LATENCY_TARGETS_MS.bot_reply_sent);
    await persistOutboundBotMessage({ to, type: 'text', content: text, metaMessageId });
  } catch (err) {
    console.error('Erro ao enviar mensagem do bot:', err);
  }
}

function truncateWa(str: string, max: number) {
  const t = String(str || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

async function postMetaMessage(body: Record<string, unknown>): Promise<string | undefined> {
  return postWhatsAppMessage(supabase, body);
}

/** Reply buttons (máx. 3). `id` usado no webhook (list_reply/button_reply). */
async function sendButtonMessage(
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>
) {
  try {
    const startedAt = Date.now();
    const trimmed = buttons.slice(0, 3).map((b) => ({
      type: 'reply' as const,
      reply: {
        id: b.id.slice(0, 256),
        title: truncateWa(b.title, WA_BTN_TITLE_MAX),
      },
    }));
    const metaMessageId = await postMetaMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: truncateWa(bodyText, 1024) },
        action: { buttons: trimmed },
      },
    });
    logDuration('meta_send_buttons', startedAt, { wa_to: to, meta_message_id: metaMessageId || null }, LATENCY_TARGETS_MS.bot_reply_sent);
    await persistOutboundBotMessage({ to, type: 'text', content: bodyText, metaMessageId });
  } catch (err) {
    console.error('Erro ao enviar botoes WhatsApp:', err);
  }
}

/** Lista interativa (máx. 10 linhas). `rows[].id` = UUID ou identificador estável. */
async function sendListMessage(
  to: string,
  bodyText: string,
  buttonLabel: string,
  sectionTitle: string,
  rows: Array<{ id: string; title: string; description?: string }>
) {
  try {
    const startedAt = Date.now();
    const limited = rows.slice(0, WA_LIST_MAX_ROWS).map((r) => ({
      id: r.id.slice(0, 200),
      title: truncateWa(r.title, WA_LIST_ROW_TITLE_MAX),
      ...(r.description ? { description: truncateWa(r.description, 72) } : {}),
    }));
    const metaMessageId = await postMetaMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: truncateWa(bodyText, 1024) },
        action: {
          button: truncateWa(buttonLabel, 20),
          sections: [{ title: truncateWa(sectionTitle, 24), rows: limited }],
        },
      },
    });
    logDuration('meta_send_list', startedAt, { wa_to: to, meta_message_id: metaMessageId || null }, LATENCY_TARGETS_MS.bot_reply_sent);
    await persistOutboundBotMessage({ to, type: 'text', content: bodyText, metaMessageId });
  } catch (err) {
    console.error('Erro ao enviar lista WhatsApp:', err);
  }
}

function extractInteractiveId(msg: Record<string, unknown>): string | undefined {
  if (msg.type !== 'interactive') return undefined;
  const interactive = msg.interactive as {
    button_reply?: { id?: string };
    list_reply?: { id?: string };
  };
  const id = interactive?.button_reply?.id || interactive?.list_reply?.id;
  return id ? String(id).trim() : undefined;
}

function resolveMacroSectorFromInbound(
  sectors: Array<{ id: string; name: string }>,
  inboundPayload: Record<string, unknown> | undefined,
  inboundRaw: string
): { id: string; name: string } | null {
  const sid = inboundPayload ? extractInteractiveId(inboundPayload) : undefined;
  if (sid) {
    const hit = sectors.find((s) => s.id === sid);
    if (hit) return hit;
  }
  const idx = Number.parseInt(String(inboundRaw || '').trim(), 10) - 1;
  if (!Number.isNaN(idx) && idx >= 0 && idx < sectors.length) return sectors[idx];
  return null;
}

function resolveDemandPickFromInbound(
  demands: Array<{ id: string; title: string }>,
  inboundPayload: Record<string, unknown> | undefined,
  inboundRaw: string
): { id: string; title: string } | null {
  let demandId = inboundPayload ? extractInteractiveId(inboundPayload) : undefined;
  if (!demandId) {
    const idx = Number.parseInt(String(inboundRaw || '').trim(), 10) - 1;
    if (!Number.isNaN(idx) && idx >= 0 && idx < demands.length) {
      demandId = demands[idx].id;
    }
  }
  return demands.find((d) => d.id === demandId) ?? null;
}

export function extractContent(msg: Record<string, unknown>) {
  if (msg.type === 'text') return (msg.text as { body?: string })?.body || '';

  if (msg.type === 'interactive') {
    const interactive = msg.interactive as {
      button_reply?: { title?: string };
      list_reply?: { title?: string };
    };
    return interactive?.button_reply?.title || interactive?.list_reply?.title || '';
  }

  return `[${msg.type}]`;
}
