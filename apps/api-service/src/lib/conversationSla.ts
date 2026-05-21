import { supabase } from './supabase';
import {
  addBusinessMinutes,
  hasCanonicalBusinessHours,
  normalizeBusinessHours,
  slaEffectiveStart,
} from './businessHours';

type SlaPolicyRow = {
  id: string;
  use_business_hours: boolean | null;
  first_response_minutes: number | null;
  resolution_minutes: number | null;
  sector_id: string | null;
  priority: string | null;
  profile_type: string | null;
};

function scorePolicy(p: SlaPolicyRow): number {
  let s = 0;
  if (p.sector_id) s += 4;
  if (p.priority) s += 2;
  if (p.profile_type) s += 1;
  return s;
}

function pickSlaPolicy(
  policies: SlaPolicyRow[],
  sectorId: string,
  priority: string,
  profileType: string
): SlaPolicyRow | null {
  const candidates = policies.filter((p) => {
    if (p.sector_id && p.sector_id !== sectorId) return false;
    if (p.priority && p.priority !== priority) return false;
    if (p.profile_type && p.profile_type !== profileType) return false;
    return true;
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => scorePolicy(b) - scorePolicy(a));
  return candidates[0] || null;
}

export async function refreshConversationSla(conversationId: string) {
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, workspace_id, sector_id, priority, contacts(profile_type)')
    .eq('id', conversationId)
    .single();

  if (!conv?.sector_id || !conv?.workspace_id) return;

  const workspaceId = String(conv.workspace_id);

  const { data: sector } = await supabase
    .from('sectors')
    .select('business_hours')
    .eq('workspace_id', workspaceId)
    .eq('id', conv.sector_id)
    .single();

  const sectorBhRaw = sector?.business_hours;
  const sectorBh = normalizeBusinessHours(sectorBhRaw ?? {});

  const { data: policies } = await supabase
    .from('sla_policies')
    .select('*')
    .eq('workspace_id', workspaceId);
  const priority = (conv.priority || 'normal') as string;
  const profile =
    (conv.contacts as { profile_type?: string } | null)?.profile_type ||
    (Array.isArray(conv.contacts) ? (conv.contacts[0] as { profile_type?: string })?.profile_type : undefined) ||
    '';

  const policy = pickSlaPolicy((policies || []) as SlaPolicyRow[], conv.sector_id, priority, profile || '');
  if (!policy) return;

  const firstMin = policy.first_response_minutes ?? 30;
  const resMin = policy.resolution_minutes ?? 480;
  const treatmentMin = Math.max(firstMin, Math.min(resMin, Math.round(firstMin + (resMin - firstMin) / 2)));
  const useBh = policy.use_business_hours !== false && hasCanonicalBusinessHours(sectorBhRaw);

  const now = new Date();
  let firstDeadline: Date;
  let treatmentDeadline: Date;
  let resolutionDeadline: Date;

  if (useBh) {
    const start = slaEffectiveStart(sectorBh, now);
    firstDeadline = addBusinessMinutes(sectorBh, start, firstMin);
    treatmentDeadline = addBusinessMinutes(sectorBh, start, treatmentMin);
    resolutionDeadline = addBusinessMinutes(sectorBh, start, resMin);
  } else {
    firstDeadline = new Date(now.getTime() + firstMin * 60000);
    treatmentDeadline = new Date(now.getTime() + treatmentMin * 60000);
    resolutionDeadline = new Date(now.getTime() + resMin * 60000);
  }

  await supabase
    .from('conversations')
    .update({
      sla_policy_id: policy.id,
      sla_first_response_deadline: firstDeadline.toISOString(),
      sla_treatment_deadline: treatmentDeadline.toISOString(),
      sla_resolution_deadline: resolutionDeadline.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', conversationId);
}

/** Marca 1ª resposta humana (outbound do atendente) quando ainda não registrada. */
export async function markConversationFirstResponseIfNeeded(conversationId: string, at: Date = new Date()) {
  const { data } = await supabase
    .from('conversations')
    .select('sla_first_response_at, sla_first_response_deadline')
    .eq('id', conversationId)
    .maybeSingle();
  if (!data || data.sla_first_response_at) return;

  const deadline = data.sla_first_response_deadline ? new Date(String(data.sla_first_response_deadline)) : null;
  const ok = deadline ? at.getTime() <= deadline.getTime() : true;

  await supabase
    .from('conversations')
    .update({
      sla_first_response_at: at.toISOString(),
      sla_first_response_ok: ok,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);
}

/** Atualiza cumprimento de SLA de resolução ao encerrar a conversa. */
export async function markConversationResolvedSla(
  conversationId: string,
  resolvedAt: Date = new Date()
): Promise<{ sla_resolved_ok: boolean } | null> {
  const { data } = await supabase
    .from('conversations')
    .select('sla_resolution_deadline, sla_resolved_ok')
    .eq('id', conversationId)
    .maybeSingle();
  if (!data) return null;

  const deadline = data.sla_resolution_deadline ? new Date(String(data.sla_resolution_deadline)) : null;
  const ok = deadline ? resolvedAt.getTime() <= deadline.getTime() : true;

  await supabase
    .from('conversations')
    .update({
      sla_resolved_ok: ok,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return { sla_resolved_ok: ok };
}

/**
 * Corrige marcos de SLA em conversas antigas com base nas mensagens já persistidas.
 * Usa a 1ª mensagem outbound somente quando há atendente atribuído (evita contar só o bot na triagem).
 */
export async function syncConversationSlaMilestonesFromMessages(conversationId: string) {
  const { data: conv } = await supabase
    .from('conversations')
    .select('sla_first_response_at, sla_resolved_ok, status, resolved_at, attendant_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return;

  if (!conv.sla_first_response_at && conv.attendant_id) {
    const { data: firstOut } = await supabase
      .from('messages')
      .select('sent_at, created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstOut) {
      const at = new Date(String(firstOut.sent_at || firstOut.created_at));
      if (!Number.isNaN(at.getTime())) {
        await markConversationFirstResponseIfNeeded(conversationId, at);
      }
    }
  }

  const status = String(conv.status || '').toLowerCase();
  if (
    (status === 'resolved' || status === 'closed') &&
    conv.sla_resolved_ok == null &&
    conv.resolved_at
  ) {
    await markConversationResolvedSla(conversationId, new Date(String(conv.resolved_at)));
  }
}
