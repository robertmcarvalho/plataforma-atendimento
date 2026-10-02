import { scheduleInboundAiAnalysis } from '@plataforma/ai-core';
import { supabase } from './supabase';
import { getWorkspaceWhatsAppChannel } from './channelResolver';
import {
  listIntakeDemandsForLeader,
  resolveIntakeDemandProfile,
  resolveSlaSettingsForDemand,
  type IntakeDemandProfile,
} from './intakeDemands';
import {
  assertPharmaciesInLeaderScope,
  isDriverInLeaderScope,
} from './leaderPortalScope';
import { previewSlaDeadlines } from './slaCalculator';
import { normalizeBusinessHours } from './businessHours';
import {
  ensureGuidedDemandTaskForConversation,
  resolveDemandTitle,
  upsertFinancialAdvanceRequestTask,
  upsertGuidedDemandTask,
} from './guidedDemandTasks';
import {
  buildDriverFinancialReviewContext,
  isLeaderAdvanceDemand,
  isLeaderFinancialDemand,
} from './leaderFinancialDemandContext';
import { formatConsolidatedAttendanceNote } from './advanceDecisionFollowup';
import { ensureLeaderContactByWaPhone } from './contactByPhone';

export { listIntakeDemandsForLeader, resolveIntakeDemandProfile };

async function getDefaultWhatsAppChannelId(workspaceId: string): Promise<string | null> {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID?.trim() || process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim();
  let query = supabase
    .from('workspace_channels')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'whatsapp')
    .eq('is_active', true);
  if (phoneNumberId) query = query.eq('external_id', phoneNumberId);
  const { data } = await query.order('is_default', { ascending: false }).limit(1).maybeSingle();
  return data?.id ? String(data.id) : null;
}

async function applyDemandSlaToConversation(
  conversationId: string,
  workspaceId: string,
  sectorId: string,
  slaSettings: Record<string, unknown>
) {
  const { data: sector } = await supabase
    .from('sectors')
    .select('business_hours')
    .eq('id', sectorId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  const bh = normalizeBusinessHours(sector?.business_hours ?? {});
  const preview = previewSlaDeadlines(
    {
      first_response_sla_minutes: Number(slaSettings.first_response_sla_minutes) || 25,
      treatment_sla_minutes: Number(slaSettings.treatment_sla_minutes) || 120,
      resolution_sla_minutes: Number(slaSettings.resolution_sla_minutes) || 480,
      use_business_hours: slaSettings.use_business_hours !== false,
    },
    bh
  );

  await supabase
    .from('conversations')
    .update({
      sla_policy_id: null,
      sla_first_response_deadline: preview.first_response_deadline,
      sla_first_response_at: null,
      sla_first_response_ok: false,
      sla_treatment_deadline: preview.treatment_deadline,
      sla_resolution_deadline: preview.resolution_deadline,
      sla_resolved_ok: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);
}

export async function startLeaderPortalConversation(args: {
  leaderId: string;
  userId: string;
  workspaceId: string;
  pharmacy_id: string;
  driver_id?: string | null;
  sector_id: string;
  demand_key: string;
  initial_message?: string;
}) {
  const { data: leader, error: leaderErr } = await supabase
    .from('leaders')
    .select('*')
    .eq('id', args.leaderId)
    .eq('workspace_id', args.workspaceId)
    .single();
  if (leaderErr || !leader) throw Object.assign(new Error('Perfil de líder não encontrado.'), { statusCode: 403 });

  const verifiedAt = leader.whatsapp_verified_at ? new Date(String(leader.whatsapp_verified_at)) : null;
  const revokedAt = leader.whatsapp_session_revoked_at ? new Date(String(leader.whatsapp_session_revoked_at)) : null;
  if (!leader.phone || !verifiedAt || (revokedAt && revokedAt > verifiedAt)) {
    throw Object.assign(new Error('Vincule e verifique seu WhatsApp antes de iniciar uma conversa.'), { statusCode: 403 });
  }

  const pharmacyIds = [args.pharmacy_id];
  const inScope = await assertPharmaciesInLeaderScope(supabase, args.leaderId, pharmacyIds, args.workspaceId);
  if (!inScope) throw Object.assign(new Error('Farmácia fora da sua rede.'), { statusCode: 403 });

  const driverId = args.driver_id?.trim() || null;
  if (driverId) {
    const driverOk = await isDriverInLeaderScope(supabase, args.leaderId, driverId);
    if (!driverOk) throw Object.assign(new Error('Entregador fora da sua rede.'), { statusCode: 403 });
  }

  const demandList = await listIntakeDemandsForLeader({
    workspaceId: args.workspaceId,
    sectorId: args.sector_id,
    driverId,
  });
  const picked = demandList.demands.find((d) => d.demand_key === args.demand_key);
  if (!picked) throw Object.assign(new Error('Demanda inválida para o setor e contexto selecionados.'), { statusCode: 400 });

  const { data: pharmacy } = await supabase
    .from('pharmacies')
    .select('id, trade_name')
    .eq('id', args.pharmacy_id)
    .maybeSingle();

  let driverName: string | null = null;
  if (driverId) {
    const { data: driver } = await supabase.from('drivers').select('name').eq('id', driverId).maybeSingle();
    driverName = driver?.name ? String(driver.name) : null;
  }

  // Prefer contact already linked to this leader; otherwise attach by phone variants
  // (with/without mobile 9). Blind insert hits idx_contacts_workspace_phone_unique when
  // the number already exists on another contact (often the same person as driver).
  let contact: { id: string };
  try {
    const ensured = await ensureLeaderContactByWaPhone(
      supabase,
      args.workspaceId,
      args.leaderId,
      String(leader.phone || ''),
      leader.name,
    );
    contact = { id: String(ensured.contact.id) };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Falha ao resolver contato do líder';
    throw new Error(message);
  }

  const workspaceChannelId = await getDefaultWhatsAppChannelId(args.workspaceId);
  const pharmacyLabel = String(pharmacy?.trade_name || 'Farmácia');
  const sectorName = demandList.sector_name;
  const summaryParts = [
    `Atendimento iniciado pelo líder ${leader.name || 'líder'}`,
    `setor ${sectorName}`,
    `demanda ${picked.title}`,
    pharmacyLabel ? `farmácia ${pharmacyLabel}` : null,
    driverName ? `entregador ${driverName}` : null,
  ].filter(Boolean);

  const { data: conversation, error: convErr } = await supabase
    .from('conversations')
    .insert({
      workspace_id: args.workspaceId,
      workspace_channel_id: workspaceChannelId,
      contact_id: contact!.id,
      status: 'open',
      priority: isLeaderAdvanceDemand(args.demand_key) ? 'high' : 'normal',
      sector_id: args.sector_id,
      intent_sector_id: args.sector_id,
      context_leader_id: args.leaderId,
      context_pharmacy_id: args.pharmacy_id,
      context_driver_id: driverId,
      demand_key: args.demand_key,
      sla_applied_from: 'portal_lider',
      summary: summaryParts.join(' · '),
      tags: ['portal-lider', `demanda:${args.demand_key}`],
    })
    .select('id, status')
    .single();

  if (convErr) throw new Error(convErr.message);

  const conversationId = String(conversation.id);
  const profile: IntakeDemandProfile = demandList.demand_profile;
  const slaSettings = await resolveSlaSettingsForDemand(args.workspaceId, args.demand_key, profile);
  await applyDemandSlaToConversation(conversationId, args.workspaceId, args.sector_id, slaSettings);

  const demandTitle =
    (await resolveDemandTitle(supabase, args.workspaceId, args.demand_key)) || picked.title;

  let financialReview: Awaited<ReturnType<typeof buildDriverFinancialReviewContext>> | null = null;
  if (driverId && isLeaderFinancialDemand(args.demand_key, sectorName)) {
    financialReview = await buildDriverFinancialReviewContext(supabase, args.workspaceId, driverId);
  }

  const consolidatedNote = formatConsolidatedAttendanceNote({
    leaderName: leader.name,
    pharmacyLabel,
    driverName: driverName || null,
    sectorName,
    demandTitle,
    origin: 'portal_lider',
    initialMessage: args.initial_message?.trim() || null,
    financialReview,
  });

  await supabase.from('internal_notes').insert({
    workspace_id: args.workspaceId,
    conversation_id: conversationId,
    author_id: args.userId,
    content: consolidatedNote,
  });

  if (driverId && isLeaderAdvanceDemand(args.demand_key)) {
    await upsertFinancialAdvanceRequestTask(supabase, {
      workspaceId: args.workspaceId,
      conversationId,
      driverId,
      driverName: driverName || null,
      demandTitle,
      sectorId: args.sector_id,
      financialReview,
    });
  } else {
    await upsertGuidedDemandTask(supabase, {
      conversationId,
      demandKey: args.demand_key,
      demandTitle,
      sectorName,
      sectorId: args.sector_id,
      driverId,
      metadataExtra: financialReview
        ? { financial_review: financialReview as unknown as Record<string, unknown> }
        : undefined,
    });
  }

  if (args.initial_message?.trim()) {
    const inboundText = args.initial_message.trim();
    const { data: msgRow } = await supabase
      .from('messages')
      .insert({
        workspace_id: args.workspaceId,
        conversation_id: conversationId,
        direction: 'inbound',
        type: 'text',
        content: inboundText,
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString(), has_unread: true })
      .eq('id', conversationId);
    if (msgRow?.id) {
      scheduleInboundAiAnalysis(supabase, {
        conversationId,
        messageId: String(msgRow.id),
        inboundText,
        tenantId: args.workspaceId,
        reason: 'portal_first_message',
      });
    }
  }

  if (!isLeaderAdvanceDemand(args.demand_key)) {
    await ensureGuidedDemandTaskForConversation(supabase, args.workspaceId, conversationId).catch(() => undefined);
  }

  return {
    conversation,
    demand_title: demandTitle,
    pharmacy_label: pharmacyLabel,
    driver_name: driverName,
    sector_name: sectorName,
    demand_profile: profile,
  };
}
