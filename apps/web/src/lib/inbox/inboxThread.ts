import { format, isToday, isYesterday, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toMessageText } from '@/lib/inbox/inboxFormatters';
import type { ApiConversationDetail, ApiMessage, ThreadItem } from '@/lib/inbox/types';
import { humanizeInternalNoteContent } from '@/lib/humanizeInternalNote';

function daySeparatorLabel(dateMs: number): string {
  const d = new Date(dateMs);
  if (isToday(d)) return 'Hoje';
  if (isYesterday(d)) return 'Ontem';
  return format(d, "dd 'de' MMMM yyyy", { locale: ptBR });
}

function insertDaySeparators(sorted: ThreadItem[]): ThreadItem[] {
  const out: ThreadItem[] = [];
  let lastDayKey = '';
  for (const item of sorted) {
    if (item.kind === 'separator') continue;
    const dayKey = format(startOfDay(new Date(item.createdAtMs)), 'yyyy-MM-dd');
    if (dayKey !== lastDayKey) {
      out.push({ kind: 'separator', id: `sep-${dayKey}`, label: daySeparatorLabel(item.createdAtMs) });
      lastDayKey = dayKey;
    }
    out.push(item);
  }
  return out;
}

export function buildInboxThreadItems(detail: ApiConversationDetail | undefined): ThreadItem[] {
  const items: ThreadItem[] = [];

  for (const m of detail?.messages || []) {
    const ts = m.sent_at || m.created_at;
    const createdAtMs = new Date(ts).getTime();
    items.push({
      kind: 'message',
      id: m.id,
      from: m.direction === 'outbound' ? 'me' : 'them',
      text: toMessageText(m),
      time: format(new Date(createdAtMs), 'HH:mm', { locale: ptBR }),
      createdAtMs,
    });
  }

  for (const n of detail?.internal_notes || []) {
    const createdAtMs = new Date(n.created_at).getTime();
    items.push({
      kind: 'note',
      id: n.id,
      text: humanizeInternalNoteContent(n.content),
      author: n.author?.name || 'Equipe',
      time: format(new Date(createdAtMs), 'HH:mm', { locale: ptBR }),
      createdAtMs,
    });
  }

  return insertDaySeparators(items.sort((a, b) => a.createdAtMs - b.createdAtMs));
}

export function indexMessagesById(messages: ApiMessage[] | undefined): Map<string, ApiMessage> {
  const map = new Map<string, ApiMessage>();
  for (const msg of messages || []) map.set(msg.id, msg);
  return map;
}
