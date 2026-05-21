import type { SupabaseClient } from '@supabase/supabase-js';
import { postWhatsAppMessage } from './whatsappOutbound';
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

export async function maybeOutOfHoursNotice(
  supabase: SupabaseClient,
  conversationId: string,
  sectorId: string | null,
  options?: { skipWhenEdgeHandled?: boolean }
) {
  if (options?.skipWhenEdgeHandled) return;
  if (!sectorId) return;

  const { data: sector } = await supabase.from('sectors').select('business_hours').eq('id', sectorId).single();
  const raw = sector?.business_hours;
  if (!hasCanonicalBusinessHours(raw)) return;

  const cfg = normalizeBusinessHours(raw);
  if (isOpen(cfg, new Date())) return;

  const { data: conv } = await supabase.from('conversations').select('tags').eq('id', conversationId).single();
  const tags = ((conv?.tags || []) as string[]).filter(Boolean);
  if (tags.includes('out_of_hours')) return;

  const { data: convWorkspace } = await supabase.from('conversations').select('workspace_id').eq('id', conversationId).maybeSingle();
  const workspaceId = convWorkspace?.workspace_id ? String(convWorkspace.workspace_id) : null;

  let template =
    'Obrigado pelo contato. No momento estamos fora do horario de atendimento. Voltamos em {{next_open_at}}.';

  if (workspaceId) {
    const { data: oohRule } = await supabase
      .from('workspace_out_of_hours_rules')
      .select('message, is_active')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'whatsapp')
      .maybeSingle();
    if (oohRule?.is_active && String(oohRule.message || '').trim()) {
      template = String(oohRule.message);
    } else {
      const { data: setting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('workspace_id', workspaceId)
        .eq('key', 'auto_reply_out_of_hours')
        .maybeSingle();
      const v = setting?.value;
      if (typeof v === 'string' && v.trim()) template = v;
    }
  } else {
    const { data: setting } = await supabase.from('app_settings').select('value').eq('key', 'auto_reply_out_of_hours').single();
    const v = setting?.value;
    if (typeof v === 'string') template = v;
    else if (v && typeof v === 'object') template = JSON.stringify(v);
  }

  const nextOpen = nextOpenAt(cfg, new Date());
  const human = formatNextOpenHuman(cfg, nextOpen);
  const text = template.replace(/\{\{\s*next_open_at\s*\}\}/g, human);

  const { data: convFull } = await supabase
    .from('conversations')
    .select('workspace_id, contacts(wa_phone)')
    .eq('id', conversationId)
    .single();

  const wa =
    (convFull?.contacts as { wa_phone?: string } | null)?.wa_phone ||
    (Array.isArray(convFull?.contacts) ? (convFull?.contacts[0] as { wa_phone?: string })?.wa_phone : undefined);

  if (!wa || wa.startsWith('leader_')) return;

  try {
    const workspaceId = convFull?.workspace_id ? String(convFull.workspace_id) : null;
    await postWhatsAppMessage(
      supabase,
      {
        messaging_product: 'whatsapp',
        to: wa,
        type: 'text',
        text: { body: text },
      },
      workspaceId
    );

    await supabase.from('messages').insert({
      conversation_id: conversationId,
      meta_message_id: null,
      direction: 'outbound',
      type: 'text',
      content: text,
      status: 'sent',
      sent_at: new Date().toISOString(),
    });

    const nextTags = Array.from(new Set([...tags, 'out_of_hours']));
    await supabase
      .from('conversations')
      .update({
        tags: nextTags,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
  } catch (err) {
    console.error('maybeOutOfHoursNotice:', err);
  }
}
