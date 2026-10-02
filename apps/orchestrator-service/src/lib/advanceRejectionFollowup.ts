import type { SupabaseClient } from '@supabase/supabase-js';
import { insertSystemInternalNote } from '@plataforma/operational-notes';
import { postWhatsAppMessage } from './whatsappOutbound.js';

const REJECTION_TAG = 'adiantamento-reprovado-followup';
const APPROVAL_TAG = 'adiantamento-aprovado-followup';

function normalizeBrazilWaTo(input: string): string | null {
  const d = String(input || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55') && d.length >= 12 && d.length <= 13) return d;
  if (d.length >= 10 && d.length <= 11) return `55${d}`;
  return null;
}

async function resolveLeaderWaTo(
  client: SupabaseClient,
  workspaceId: string,
  contact: { wa_phone?: string; leader_id?: string } | null | undefined
): Promise<string | null> {
  const leaderId = contact?.leader_id ? String(contact.leader_id) : null;
  if (leaderId) {
    const { data: leader } = await client.from('leaders').select('phone').eq('id', leaderId).maybeSingle();
    const { data: verified } = await client
      .from('leader_whatsapp_verifications')
      .select('phone_e164')
      .eq('workspace_id', workspaceId)
      .eq('leader_id', leaderId)
      .eq('status', 'verified')
      .order('verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (
      (verified?.phone_e164 ? normalizeBrazilWaTo(String(verified.phone_e164)) : null) ||
      (leader?.phone ? normalizeBrazilWaTo(String(leader.phone)) : null) ||
      null
    );
  }
  const raw = String(contact?.wa_phone || '');
  if (raw.startsWith('leader_')) return null;
  return normalizeBrazilWaTo(raw);
}

async function sendFollowupText(
  client: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  text: string
): Promise<void> {
  const { data: convFull } = await client
    .from('conversations')
    .select('workspace_id, contacts(wa_phone, leader_id)')
    .eq('id', conversationId)
    .maybeSingle();
  const contact = Array.isArray(convFull?.contacts) ? convFull?.contacts[0] : convFull?.contacts;
  const wa = await resolveLeaderWaTo(client, workspaceId, contact as { wa_phone?: string; leader_id?: string });
  if (!wa) {
    await client.from('messages').insert({
      workspace_id: workspaceId,
      conversation_id: conversationId,
      direction: 'outbound',
      type: 'text',
      content: text,
      status: 'sent',
      sent_at: new Date().toISOString(),
    });
    return;
  }
  await postWhatsAppMessage(
    client,
    { messaging_product: 'whatsapp', to: wa, type: 'text', text: { body: text } },
    workspaceId
  );
  await client.from('messages').insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    direction: 'outbound',
    type: 'text',
    content: text,
    status: 'sent',
    sent_at: new Date().toISOString(),
  });
}

function parseReply(text: string): 'yes' | 'no' | null {
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!t) return null;
  if (/^(sim|s|yes|quero|pode|por favor|ajuda|preciso|gostaria)/.test(t)) return 'yes';
  if (/^(nao|não|n|no|obrigad|nada|so isso|isso mesmo|encerr|nao preciso|tudo certo|por enquanto nao)/.test(t)) return 'no';
  if (/\bnao\b/.test(t) && !/\bsim\b/.test(t)) return 'no';
  if (/\bsim\b/.test(t)) return 'yes';
  return null;
}

async function patchTags(client: SupabaseClient, conversationId: string, remove: string[], add: string[] = []) {
  const { data } = await client.from('conversations').select('tags').eq('id', conversationId).maybeSingle();
  const current = ((data?.tags || []) as string[]).filter(Boolean);
  const removeSet = new Set(remove);
  const next = [...current.filter((t) => !removeSet.has(t)), ...add.filter((t) => !current.includes(t))];
  await client.from('conversations').update({ tags: next, updated_at: new Date().toISOString() }).eq('id', conversationId);
}

type FollowupKind = 'rejection' | 'approval';

function activeFollowupTag(tags: string[]): { tag: string; kind: FollowupKind } | null {
  if (tags.includes(REJECTION_TAG)) return { tag: REJECTION_TAG, kind: 'rejection' };
  if (tags.includes(APPROVAL_TAG)) return { tag: APPROVAL_TAG, kind: 'approval' };
  return null;
}

/**
 * Responde ao líder após aprovação ou reprovação de adiantamento (Sim/Não).
 * Retorna true se a mensagem foi consumida por este fluxo.
 */
export async function tryHandleAdvanceRejectionFollowup(
  client: SupabaseClient,
  args: { workspaceId: string; conversationId: string; inboundText: string }
): Promise<boolean> {
  const { data: conv } = await client
    .from('conversations')
    .select('id, status, tags')
    .eq('workspace_id', args.workspaceId)
    .eq('id', args.conversationId)
    .maybeSingle();
  if (!conv?.id) return false;

  const tags = ((conv.tags || []) as string[]).filter(Boolean);
  const active = activeFollowupTag(tags);
  if (!active) return false;

  const reply = parseReply(args.inboundText);
  const now = new Date().toISOString();
  const kind = active.kind;

  if (reply === null) {
    await sendFollowupText(
      client,
      args.workspaceId,
      args.conversationId,
      'Para seguirmos, responda apenas *Sim* se precisar de mais ajuda, ou *Não* para encerrar este atendimento. Obrigado(a)!'
    );
    return true;
  }

  if (reply === 'yes') {
    await patchTags(client, args.conversationId, [active.tag]);
    await client
      .from('conversations')
      .update({ status: 'open', has_unread: true, updated_at: now })
      .eq('id', args.conversationId);
    const note =
      kind === 'rejection'
        ? '[ADIANTAMENTO] Líder solicitou continuidade após reprovação. Conversa mantida aberta.'
        : '[ADIANTAMENTO] Líder solicitou continuidade após aprovação. Conversa mantida aberta.';
    await insertSystemInternalNote(client, {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      content: note,
    });
    await sendFollowupText(
      client,
      args.workspaceId,
      args.conversationId,
      'Perfeito! Ficamos à disposição. Conte conosco: descreva como podemos ajudar que nossa equipe dará sequência.'
    );
    return true;
  }

  await patchTags(client, args.conversationId, [active.tag]);
  const closeReason =
    kind === 'rejection' ? 'adiantamento_reprovado_encerrado' : 'adiantamento_aprovado_encerrado';
  const closedNote =
    kind === 'rejection'
      ? '[ADIANTAMENTO] Líder não precisou de mais ajuda após reprovação. Atendimento encerrado.'
      : '[ADIANTAMENTO] Líder não precisou de mais ajuda após aprovação. Atendimento encerrado.';

  await client
    .from('conversations')
    .update({
      status: 'resolved',
      close_reason: closeReason,
      resolved_at: now,
      updated_at: now,
    })
    .eq('id', args.conversationId);
  await insertSystemInternalNote(client, {
    workspaceId: args.workspaceId,
    conversationId: args.conversationId,
    content: closedNote,
  });
  await sendFollowupText(
    client,
    args.workspaceId,
    args.conversationId,
    'Entendido. Agradecemos o contato e permanecemos à disposição quando precisar. Tenha um ótimo dia!'
  );
  return true;
}
