import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeaderFinancialReviewContext } from './leaderFinancialDemandContext';
import { formatLeaderFinancialContextNote } from './leaderFinancialDemandContext';
import { formatOriginLabel } from './financialHumanLabels';

export const ADVANCE_REJECTION_FOLLOWUP_TAG = 'adiantamento-reprovado-followup';
export const ADVANCE_APPROVAL_FOLLOWUP_TAG = 'adiantamento-aprovado-followup';

export const ADVANCE_FOLLOWUP_TAGS = [ADVANCE_REJECTION_FOLLOWUP_TAG, ADVANCE_APPROVAL_FOLLOWUP_TAG] as const;

export function parseAdvanceFollowupReply(text: string): 'yes' | 'no' | null {
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

function greetingName(contactName: string | null | undefined): string {
  const first = String(contactName || '')
    .trim()
    .split(/\s+/)[0];
  return first && first.length > 1 ? `Olá, ${first}` : 'Olá';
}

export function buildAdvanceRejectionOutboundText(contactName: string | null | undefined, reason: string): string {
  const motivo = reason.trim()
    ? ` Infelizmente, neste momento não conseguimos aprovar o adiantamento solicitado. Motivo: ${reason.trim()}.`
    : ' Infelizmente, neste momento não conseguimos aprovar o adiantamento solicitado.';
  return `${greetingName(contactName)}, obrigado(a) pelo contato.${motivo}\n\nPosso ajudá-lo(a) com mais alguma coisa? Responda *Sim* ou *Não*.`;
}

export function buildAdvanceApprovalOutboundText(
  contactName: string | null | undefined,
  driverName: string | null | undefined
): string {
  const driverLine = driverName?.trim()
    ? ` O adiantamento para o entregador *${driverName.trim()}* foi aprovado.`
    : ' O adiantamento solicitado foi aprovado.';
  return `${greetingName(contactName)}, obrigado(a) pelo contato.${driverLine} O depósito será processado em breve pela equipe financeira.\n\nPosso ajudá-lo(a) com mais alguma coisa? Responda *Sim* ou *Não*.`;
}

export type ConsolidatedNoteInput = {
  leaderName?: string | null;
  pharmacyLabel?: string | null;
  driverName?: string | null;
  sectorName?: string | null;
  demandTitle?: string | null;
  origin?: string | null;
  initialMessage?: string | null;
  requestedAmount?: number | null;
  requestReason?: string | null;
  financialReview?: LeaderFinancialReviewContext | null;
};

/** Nota única para o atendente: contexto + financeiro + dados coletados. */
export function formatConsolidatedAttendanceNote(input: ConsolidatedNoteInput): string {
  const lines: string[] = [
    'Contexto de atendimento (adiantamento):',
    `- Líder/contato: ${input.leaderName?.trim() || 'não informado'}`,
    `- Farmácia: ${input.pharmacyLabel?.trim() || '—'}`,
    `- Entregador: ${input.driverName?.trim() || '—'}`,
    `- Setor: ${input.sectorName?.trim() || '—'}`,
    `- Demanda: ${input.demandTitle?.trim() || 'Adiantamento'}`,
    `- Origem: ${formatOriginLabel(input.origin)}`,
  ];

  if (input.initialMessage?.trim()) {
    lines.push(`- Mensagem inicial: ${input.initialMessage.trim().slice(0, 500)}`);
  }
  if (input.requestedAmount != null && input.requestedAmount > 0) {
    lines.push(`- Valor solicitado: R$ ${input.requestedAmount.toFixed(2).replace('.', ',')}`);
  }
  if (input.requestReason?.trim()) {
    lines.push(`- Motivo informado: ${input.requestReason.trim().slice(0, 400)}`);
  }

  lines.push('');
  if (input.financialReview && input.driverName) {
    lines.push(formatLeaderFinancialContextNote(input.financialReview, input.driverName));
  } else if (input.financialReview) {
    lines.push(formatLeaderFinancialContextNote(input.financialReview, 'Entregador'));
  } else {
    lines.push('Situação financeira: sem dados de entregador vinculado para resumo automático.');
  }

  return lines.join('\n');
}

/** Resumo curto para card de pendência / notificação do gestor. */
export function formatTaskNotificationSummary(
  ctx: LeaderFinancialReviewContext | null | undefined,
  driverName: string,
  collected?: { requestedAmount?: number | null; requestReason?: string | null }
): string {
  const parts: string[] = [];
  const name = driverName?.trim() || 'Entregador';
  parts.push(`Entregador: ${name}.`);

  if (collected?.requestedAmount != null && collected.requestedAmount > 0) {
    parts.push(`Valor solicitado: R$ ${collected.requestedAmount.toFixed(2).replace('.', ',')}.`);
  }
  if (collected?.requestReason?.trim()) {
    parts.push(`Motivo: ${collected.requestReason.trim().slice(0, 120)}.`);
  }

  if (!ctx) {
    parts.push('Sem resumo financeiro automático.');
    return parts.join(' ');
  }

  const open = ctx.advance_eligibility.open_advance_count;
  parts.push(`Adiantamentos em aberto: ${open}.`);

  const discounts = ctx.recent_entries.filter((e) => e.type !== 'advance' && e.type !== 'daily');
  if (discounts.length) {
    parts.push(`${discounts.length} ocorrência(s) financeira(s) recente(s).`);
  } else if (open === 0) {
    parts.push('Sem outras pendências financeiras relevantes no histórico recente.');
  }

  const alert = ctx.advance_eligibility.alerts[0];
  if (alert) parts.push(`Alerta: ${alert.message}`);

  return parts.join(' ').slice(0, 480);
}

export async function appendConversationTags(
  client: SupabaseClient,
  conversationId: string,
  add: string[],
  remove: string[] = []
): Promise<string[]> {
  const { data } = await client.from('conversations').select('tags').eq('id', conversationId).maybeSingle();
  const current = ((data?.tags || []) as string[]).filter(Boolean);
  const removeSet = new Set(remove);
  const next = [...current.filter((t) => !removeSet.has(t)), ...add.filter((t) => !current.includes(t))];
  await client.from('conversations').update({ tags: next, updated_at: new Date().toISOString() }).eq('id', conversationId);
  return next;
}

export async function resolveAdvanceContactAndDriverNames(
  client: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  driverId: string | null
): Promise<{ contactName: string | null; driverName: string | null }> {
  const { data: convRow } = await client
    .from('conversations')
    .select('contacts(display_name), context_leader:leaders!context_leader_id(name), context_driver:drivers!context_driver_id(name)')
    .eq('workspace_id', workspaceId)
    .eq('id', conversationId)
    .maybeSingle();

  const leader = convRow?.context_leader as { name?: string } | { name?: string }[] | null;
  const leaderName = Array.isArray(leader) ? leader[0]?.name : leader?.name;
  const contacts = convRow?.contacts as { display_name?: string } | { display_name?: string }[] | null;
  const contactName =
    leaderName ||
    (Array.isArray(contacts) ? contacts[0]?.display_name : contacts?.display_name) ||
    null;

  let driverName: string | null = null;
  const ctxDriver = convRow?.context_driver as { name?: string } | { name?: string }[] | null;
  driverName = Array.isArray(ctxDriver) ? ctxDriver[0]?.name ?? null : ctxDriver?.name ?? null;

  if (!driverName && driverId) {
    const { data: d } = await client.from('drivers').select('name').eq('id', driverId).maybeSingle();
    driverName = (d?.name as string | undefined) ?? null;
  }

  return { contactName, driverName };
}
