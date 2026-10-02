import { describe, expect, it } from 'vitest';
import { filterInboxConversations } from './inboxListFilters';
import type { UiConversation } from './types';

function conv(partial: Partial<UiConversation['raw']> & { id: string }): UiConversation {
  return {
    id: partial.id,
    name: 'Contato',
    phone: '11999999999',
    channel: 'whatsapp',
    preview: 'oi',
    time: 'agora',
    status: 'offline',
    raw: {
      id: partial.id,
      status: partial.status ?? 'open',
      priority: partial.priority ?? 'normal',
      attendant_id: partial.attendant_id ?? null,
      resolved_at: partial.resolved_at ?? null,
      workspace_channel_id: null,
      contacts: null,
      last_message_at: null,
    } as UiConversation['raw'],
  };
}

describe('filterInboxConversations', () => {
  const base = [
    conv({ id: '1', status: 'open', attendant_id: null }),
    conv({ id: '2', status: 'resolved', attendant_id: null }),
    conv({ id: '4', status: 'resolved', attendant_id: 'user-1' }),
    conv({ id: '3', status: 'pending', priority: 'urgent', attendant_id: null }),
  ];

  it('unassigned + status resolvido não zera lista quando filtro explícito', () => {
    const list = filterInboxConversations(base, {
      folder: 'unassigned',
      search: '',
      channelFilter: 'all',
      selectedChannel: null,
      favorites: {},
      mentionConversationIds: new Set(),
      statusFilter: 'resolved',
      priorityFilter: 'all',
    });
    expect(list.map((c) => c.id)).toEqual(['2']);
  });

  it('aplica prioridade explícita na pasta unassigned', () => {
    const list = filterInboxConversations(base, {
      folder: 'unassigned',
      search: '',
      channelFilter: 'all',
      selectedChannel: null,
      favorites: {},
      mentionConversationIds: new Set(),
      statusFilter: 'all',
      priorityFilter: 'urgent',
    });
    expect(list.map((c) => c.id)).toEqual(['3']);
  });

  it('mine mantém resolvidas com status explícito', () => {
    const list = filterInboxConversations(base, {
      folder: 'mine',
      userId: 'user-1',
      search: '',
      channelFilter: 'all',
      selectedChannel: null,
      favorites: {},
      mentionConversationIds: new Set(),
      statusFilter: 'resolved',
      priorityFilter: 'all',
    });
    expect(list.map((c) => c.id)).toEqual(['4']);
  });

  it('não reaplica status no cliente quando attendance_group já filtra na API', () => {
    const openOnly = [
      conv({ id: '10', status: 'open', attendant_id: 'user-2' }),
      conv({ id: '11', status: 'open', attendant_id: 'user-2' }),
    ];
    const list = filterInboxConversations(openOnly, {
      folder: 'sector_all',
      search: '',
      channelFilter: 'all',
      selectedChannel: null,
      favorites: {},
      mentionConversationIds: new Set(),
      statusFilter: 'resolved',
      priorityFilter: 'all',
      supervisorAttendanceGroup: 'active',
    });
    expect(list.map((c) => c.id)).toEqual(['10', '11']);
  });

  it('filtra por atendente quando attendantFilterId está definido', () => {
    const list = filterInboxConversations(base, {
      folder: 'sector_all',
      search: '',
      channelFilter: 'all',
      selectedChannel: null,
      favorites: {},
      mentionConversationIds: new Set(),
      attendantFilterId: 'user-1',
    });
    expect(list.map((c) => c.id)).toEqual(['4']);
  });
});
