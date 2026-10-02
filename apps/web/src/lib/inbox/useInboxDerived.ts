import { useMemo } from 'react';
import { formatBrazilPhone } from '@/lib/brFormat';
import { conversationListAiBadges, formatClientSince, resolveConversationDisplayName } from '@/lib/inbox/inboxFormatters';
import { buildInboxThreadItems, indexMessagesById } from '@/lib/inbox/inboxThread';
import { isWithinWhatsAppMessagingWindow } from '@/lib/inbox/messagingWindow';
import { useInboxSlaMeta } from '@/lib/inbox/useInboxSLA';
import type { ApiConversationDetail, ApiConversationStatus, UiConversation } from '@/lib/inbox/types';
import type { ContactDetail } from '@/types/contact';

type UseInboxDerivedInput = {
  detail?: ApiConversationDetail;
  active: UiConversation | null;
  activeId: string;
  favorites: Record<string, true>;
  contact?: ContactDetail;
  nowTick: number;
};

export function useInboxDerived({ detail, active, activeId, favorites, contact, nowTick }: UseInboxDerivedInput) {
  const threadItems = useMemo(() => buildInboxThreadItems(detail), [detail]);
  const messageById = useMemo(() => indexMessagesById(detail?.messages), [detail?.messages]);

  const chatHeaderAi = useMemo(() => {
    const conv = detail || active?.raw;
    if (!conv) return { sentiment: null as string | null, urgency: null as string | null };
    return conversationListAiBadges(conv);
  }, [detail, active?.raw]);

  const { currentPriority, priorityLabel, priorityUi, slaCountdown } = useInboxSlaMeta(detail, active?.raw, nowTick);

  const displayName = useMemo(() => {
    if (detail) {
      return resolveConversationDisplayName({
        contactDisplayName: detail.contacts?.display_name,
        contactPhone: detail.contacts?.wa_phone || active?.phone,
        contextDriverName: detail.context_driver?.name,
      });
    }
    return active?.name || '—';
  }, [detail, active?.name, active?.phone]);
  const displayPhone = formatBrazilPhone(active?.phone || '') || active?.phone || '—';
  const clientSince = contact?.created_at ? formatClientSince(contact.created_at) : '—';
  const isFav = Boolean(activeId && favorites[activeId]);
  const currentStatus = (detail?.status || active?.raw.status || 'open') as ApiConversationStatus;
  const whatsappWindowOpen = useMemo(
    () => isWithinWhatsAppMessagingWindow(detail?.messages),
    [detail?.messages],
  );

  return {
    threadItems,
    messageById,
    chatHeaderAi,
    currentPriority,
    priorityLabel,
    priorityUi,
    slaCountdown,
    displayName,
    displayPhone,
    clientSince,
    isFav,
    currentStatus,
    whatsappWindowOpen,
  };
}
