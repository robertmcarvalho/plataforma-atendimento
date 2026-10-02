import type { SupabaseClient } from '@supabase/supabase-js';
import {
  tryOperationalOutOfHoursNotice,
  tryOperationalQueueWaitingNotice,
} from './operationalChannelMessaging';
import {
  addBusinessMinutes,
  formatNextOpenHuman,
  hasCanonicalBusinessHours,
  isOpen,
  normalizeBusinessHours,
  nextOpenAt,
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

export async function refreshConversationSla(supabase: SupabaseClient, conversationId: string) {
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
    .select('id, use_business_hours, first_response_minutes, resolution_minutes, sector_id, priority, profile_type')
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

export async function isSectorClosedNow(
  supabase: SupabaseClient,
  sectorId: string,
  now: Date = new Date()
): Promise<boolean> {
  const { data: sector } = await supabase.from('sectors').select('business_hours').eq('id', sectorId).single();
  const raw = sector?.business_hours;
  if (!hasCanonicalBusinessHours(raw)) return false;
  return !isOpen(normalizeBusinessHours(raw), now);
}

export async function maybeOutOfHoursNotice(
  supabase: SupabaseClient,
  conversationId: string,
  sectorId: string | null
) {
  if (!sectorId) return;
  await tryOperationalOutOfHoursNotice(supabase, { conversationId, sectorId });
}

export async function maybeQueueWaitingNotice(supabase: SupabaseClient, conversationId: string) {
  await tryOperationalQueueWaitingNotice(supabase, conversationId);
}
