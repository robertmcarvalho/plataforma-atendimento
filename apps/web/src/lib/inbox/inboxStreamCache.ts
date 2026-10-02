import type { QueryClient } from '@tanstack/react-query';
import type { ApiConversationDetail, ApiConversationListResponse, ApiMessage } from '@/lib/inbox/types';
import type { InboxStreamEvent } from '@/lib/inbox/useInboxEventStream';

function messageFromRecord(record: Record<string, unknown>): ApiMessage | null {
  const id = String(record.id || '').trim();
  if (!id) return null;
  const createdAt = String(record.created_at || record.sent_at || new Date().toISOString());
  return {
    id,
    direction: (record.direction === 'outbound' ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
    type: String(record.type || 'text'),
    content: record.content != null ? String(record.content) : null,
    media_url: record.media_url != null ? String(record.media_url) : null,
    sent_at: record.sent_at != null ? String(record.sent_at) : null,
    created_at: createdAt,
    status: String(record.status || 'sent'),
    ai_sentiment: record.ai_sentiment != null ? String(record.ai_sentiment) : null,
    ai_sentiment_score:
      typeof record.ai_sentiment_score === 'number' ? record.ai_sentiment_score : null,
    ai_urgency: record.ai_urgency != null ? String(record.ai_urgency) : null,
    ai_urgency_score: typeof record.ai_urgency_score === 'number' ? record.ai_urgency_score : null,
    ai_analyzed_at: record.ai_analyzed_at != null ? String(record.ai_analyzed_at) : null,
  };
}

function sortMessages(messages: ApiMessage[]): ApiMessage[] {
  return [...messages].sort((a, b) => {
    const ta = new Date(a.sent_at || a.created_at).getTime();
    const tb = new Date(b.sent_at || b.created_at).getTime();
    return ta - tb;
  });
}

function patchConversationList(
  prev: ApiConversationListResponse | undefined,
  convId: string,
  patch: (row: ApiConversationListResponse['data'][number]) => ApiConversationListResponse['data'][number]
): ApiConversationListResponse | undefined {
  if (!prev?.data?.length) return prev;
  let changed = false;
  const data = prev.data.map((row) => {
    if (row.id !== convId) return row;
    changed = true;
    return patch(row);
  });
  if (!changed) return prev;
  data.sort((a, b) => {
    const ta = new Date(a.last_message_at || a.opened_at).getTime();
    const tb = new Date(b.last_message_at || b.opened_at).getTime();
    return tb - ta;
  });
  return { ...prev, data };
}

type ApplyOpts = {
  activeId: string;
  convQuery: string;
  refetchConvs: () => void;
  refetchDetail: () => void;
};

/**
 * Aplica evento SSE na cache React Query — evita refetch completo da conversa quando possível.
 */
export function applyInboxStreamEvent(qc: QueryClient, event: InboxStreamEvent, opts: ApplyOpts): void {
  const { activeId, convQuery, refetchConvs, refetchDetail } = opts;
  const record = event.record;
  const eventType = event.eventType || 'INSERT';

  if (event.table === 'messages' && record && eventType !== 'DELETE') {
    const convId = String(record.conversation_id || '').trim();
    const msg = messageFromRecord(record);
    if (!convId || !msg) return;

    if (convId === activeId) {
      qc.setQueryData<ApiConversationDetail>(['inbox', 'conversation', activeId], (prev) => {
        if (!prev) return prev;
        const existing = (prev.messages || []) as ApiMessage[];
        if (existing.some((m) => m.id === msg.id)) return prev;
        return { ...prev, messages: sortMessages([...existing, msg]) };
      });
    }

    qc.setQueryData<ApiConversationListResponse>(['inbox', 'conversations', convQuery], (prev) =>
      patchConversationList(prev, convId, (row) => ({
        ...row,
        last_message_at: msg.created_at,
        has_unread: convId !== activeId ? true : row.has_unread,
        messages: [
          {
            content: msg.content,
            direction: msg.direction,
            created_at: msg.created_at,
            status: msg.status,
            ai_sentiment: msg.ai_sentiment,
            ai_sentiment_score: msg.ai_sentiment_score,
            ai_urgency: msg.ai_urgency,
            ai_urgency_score: msg.ai_urgency_score,
            ai_analyzed_at: msg.ai_analyzed_at,
          },
        ],
      }))
    );
    return;
  }

  if (event.table === 'internal_notes' && record && eventType !== 'DELETE') {
    const convId = String(record.conversation_id || '').trim();
    const noteId = String(record.id || '').trim();
    if (!convId || !noteId) return;
    if (convId !== activeId) return;

    qc.setQueryData<ApiConversationDetail>(['inbox', 'conversation', activeId], (prev) => {
      if (!prev) return prev;
      const existing = prev.internal_notes || [];
      if (existing.some((n) => n.id === noteId)) return prev;
      return {
        ...prev,
        internal_notes: [
          ...existing,
          {
            id: noteId,
            content: String(record.content || ''),
            created_at: String(record.created_at || new Date().toISOString()),
          },
        ],
      };
    });
    return;
  }

  if (event.table === 'conversations' && record) {
    const convId = String(record.id || '').trim();
    if (!convId) return;

    if (eventType === 'DELETE') {
      void refetchConvs();
      if (convId === activeId) void refetchDetail();
      return;
    }

    const listPatch: Partial<ApiConversationListResponse['data'][number]> = {};
    if (record.status != null) listPatch.status = record.status as ApiConversationListResponse['data'][number]['status'];
    if (record.priority != null) {
      listPatch.priority = record.priority as ApiConversationListResponse['data'][number]['priority'];
    }
    if (record.last_message_at != null) listPatch.last_message_at = String(record.last_message_at);
    if (record.attendant_id !== undefined) {
      listPatch.attendant_id = record.attendant_id != null ? String(record.attendant_id) : null;
    }
    if (record.has_unread !== undefined) listPatch.has_unread = Boolean(record.has_unread);
    if (record.resolved_at !== undefined) {
      listPatch.resolved_at = record.resolved_at != null ? String(record.resolved_at) : null;
    }

    qc.setQueryData<ApiConversationListResponse>(['inbox', 'conversations', convQuery], (prev) =>
      patchConversationList(prev, convId, (row) => ({ ...row, ...listPatch }))
    );

    if (convId === activeId) {
      qc.setQueryData<ApiConversationDetail>(['inbox', 'conversation', activeId], (prev) => {
        if (!prev) return prev;
        const detailPatch: Partial<ApiConversationDetail> = {};
        if (listPatch.status != null) detailPatch.status = listPatch.status;
        if (listPatch.priority != null) detailPatch.priority = listPatch.priority;
        if (listPatch.last_message_at != null) detailPatch.last_message_at = listPatch.last_message_at;
        if (listPatch.attendant_id !== undefined) detailPatch.attendant_id = listPatch.attendant_id;
        if (listPatch.has_unread !== undefined) detailPatch.has_unread = listPatch.has_unread;
        if (listPatch.resolved_at !== undefined) detailPatch.resolved_at = listPatch.resolved_at;
        return { ...prev, ...detailPatch };
      });
    }
    return;
  }

  void refetchConvs();
  if (activeId) void refetchDetail();
}
