import type {
  ApiConversation,
  ApiConversationDetail,
  ApiConversationMessagePreview,
  ApiConversationStatus,
  ApiMessage,
  UiConversation,
  UiPresence,
} from '@/lib/inbox/types';
import { formatSlaCountdownFromDeadline } from '@/lib/sla/formatSlaDuration';
import type { ContactDetail } from '@/types/contact';

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;

export function formatClientSince(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  const m = MONTHS[d.getMonth()] || '—';
  return `${m}/${d.getFullYear()}`;
}

export function initials(input: string) {
  const trimmed = (input || '').trim();
  if (!trimmed) return '??';
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

export function lastByDate<T extends { created_at: string }>(items: T[] | undefined) {
  if (!items || items.length === 0) return null;
  return items.reduce<T | null>((acc, item) => {
    if (!acc) return item;
    return new Date(item.created_at).getTime() > new Date(acc.created_at).getTime() ? item : acc;
  }, null);
}

/** Sentimento/urgência exibidos na lista e header: conversa pode trazer última inbound em `messages` (lista) ou só `ai_sentiment_last`. */
export function conversationListAiBadges(conv: {
  ai_sentiment_last?: string | null;
  messages?: ApiConversationMessagePreview[] | null;
}): { sentiment: string | null; urgency: string | null } {
  const inbound = (conv.messages || []).filter((m) => m.direction === 'inbound');
  const lastIn = lastByDate(inbound);
  return {
    sentiment: conv.ai_sentiment_last || lastIn?.ai_sentiment || null,
    urgency: lastIn?.ai_urgency || null,
  };
}

export function shortRelativeTime(iso: string | null | undefined, nowMs: number) {
  if (!iso) return '';
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'agora';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function presenceFromLastMessage(
  lastIso: string | null | undefined,
  status: ApiConversationStatus,
  nowMs: number
): UiPresence {
  if (status === 'pending') return 'busy';
  if (!lastIso) return 'offline';
  const diffMin = (nowMs - new Date(lastIso).getTime()) / 60000;
  if (diffMin <= 5) return 'online';
  if (diffMin <= 60) return 'idle';
  return 'offline';
}

export function formatCountdown(deadlineIso: string | null | undefined, nowMs: number) {
  return formatSlaCountdownFromDeadline(deadlineIso, nowMs);
}

/** Rótulos para supervisão — alinhado aos status do banco. */
export function conversationAttendanceLabelPt(status: ApiConversationStatus): string {
  const m: Record<ApiConversationStatus, string> = {
    open: 'Em andamento',
    pending: 'Aguardando cliente',
    resolved: 'Finalizado',
    closed: 'Encerrado',
  };
  return m[status] || status;
}

export function taskStatusLabelPt(status: string): string {
  const m: Record<string, string> = {
    open: 'Aberta',
    in_progress: 'Em andamento',
    done: 'Concluída',
    cancelled: 'Cancelada',
  };
  return m[status] || status;
}

export function ticketStatusLabelPt(status: string): string {
  const m: Record<string, string> = {
    open: 'Aberto',
    in_progress: 'Em andamento',
    resolved: 'Resolvido',
    overdue: 'Atrasado',
  };
  return m[status] || status;
}

export function toMessageText(message: ApiMessage) {
  const body = (message.content || '').trim();
  if (body) return body;
  if (message.type === 'image') return '[Imagem]';
  if (message.type === 'audio') return '[Áudio]';
  if (message.type === 'document') return '[Documento]';
  if (message.type === 'video') return '[Vídeo]';
  if (message.type === 'template') return '[Template]';
  if (message.type === 'contact') return '[Contato]';
  return '[Mensagem]';
}

function looksLikePhoneLabel(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 13;
}

/** Nome exibido no inbox: contato, entregador vinculado ou telefone. */
export function resolveConversationDisplayName(input: {
  contactDisplayName?: string | null;
  contactPhone?: string | null;
  contextDriverName?: string | null;
}): string {
  const phone = String(input.contactPhone || '').trim();
  const driverName = String(input.contextDriverName || '').trim();
  const raw = String(input.contactDisplayName || '').trim();
  if (driverName) return driverName;
  if (raw && !looksLikePhoneLabel(raw)) return raw;
  if (phone) return phone;
  return raw || 'Contato';
}

export function toUiConversation(conv: ApiConversation, nowMs: number): UiConversation {
  const phone = conv.contacts?.wa_phone || '';
  const name = resolveConversationDisplayName({
    contactDisplayName: conv.contacts?.display_name,
    contactPhone: phone,
    contextDriverName: conv.context_driver?.name,
  });
  const last = lastByDate(conv.messages || []);
  const preview = (last?.content || '').trim() || 'Sem mensagens.';
  const time = shortRelativeTime(conv.last_message_at || last?.created_at, nowMs);
  const status = presenceFromLastMessage(conv.last_message_at || last?.created_at || null, conv.status, nowMs);
  const unread = conv.has_unread ? 1 : 0;

  let tag: UiConversation['tag'] | undefined;
  if (conv.status === 'resolved') {
    tag = { label: 'Resolvido', tone: 'success' };
  } else if (conv.sectors?.name?.toLowerCase().includes('venda')) {
    tag = { label: 'Vendas', tone: 'primary' };
  }

  return {
    id: conv.id,
    name,
    phone,
    channel: 'whatsapp',
    preview,
    time,
    unread: unread || undefined,
    status,
    tag,
    raw: conv,
  };
}

export function buildNewContactBody(
  detail: ApiConversationDetail | undefined,
  displayName: string,
  phoneNormalized: string
): {
  wa_phone: string;
  display_name: string | null;
  profile_type: 'driver' | 'pharmacy' | 'leader' | 'partner' | 'unknown';
  driver_id: string | null;
  pharmacy_id: string | null;
  leader_id: string | null;
  is_blocked: boolean;
} {
  const c = detail?.contacts;
  let profile_type: 'driver' | 'pharmacy' | 'leader' | 'partner' | 'unknown' = 'unknown';
  let driver_id: string | null = null;
  let pharmacy_id: string | null = null;
  let leader_id: string | null = null;

  if (detail?.context_driver?.id) {
    profile_type = 'driver';
    driver_id = detail.context_driver.id;
  } else if (detail?.context_pharmacy?.id) {
    profile_type = 'pharmacy';
    pharmacy_id = detail.context_pharmacy.id;
  } else if (detail?.context_leader?.id) {
    profile_type = 'leader';
    leader_id = detail.context_leader.id;
  } else if (c?.profile_type === 'driver' && c.driver_id) {
    profile_type = 'driver';
    driver_id = c.driver_id;
  } else if (c?.profile_type === 'pharmacy' && c.pharmacy_id) {
    profile_type = 'pharmacy';
    pharmacy_id = c.pharmacy_id;
  } else if (c?.profile_type === 'leader' && c.leader_id) {
    profile_type = 'leader';
    leader_id = c.leader_id;
  } else if (
    c?.profile_type === 'driver' ||
    c?.profile_type === 'pharmacy' ||
    c?.profile_type === 'leader' ||
    c?.profile_type === 'partner'
  ) {
    profile_type = c.profile_type as 'driver' | 'pharmacy' | 'leader' | 'partner';
  }

  const name = (c?.display_name || displayName || '').trim();
  return {
    wa_phone: phoneNormalized,
    display_name: name.length ? name : null,
    profile_type,
    driver_id,
    pharmacy_id,
    leader_id,
    is_blocked: false,
  };
}

export function cadastroHrefFromContext(
  detail: ApiConversationDetail | undefined,
  contact: ContactDetail | undefined
): string | null {
  const driverId = detail?.context_driver?.id || contact?.driver?.id || contact?.driver_id || null;
  if (driverId) return `/drivers/${driverId}`;

  const pharmacyId = detail?.context_pharmacy?.id || contact?.pharmacy?.id || contact?.pharmacy_id || null;
  if (pharmacyId) return `/pharmacies/${pharmacyId}`;

  const leaderId = detail?.context_leader?.id || contact?.leader?.id || contact?.leader_id || null;
  if (leaderId) return `/leaders/${leaderId}`;

  return null;
}
