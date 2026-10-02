import { isToday } from 'date-fns';
import type { Channel } from '@/components/ui/ChannelBadge';
import type { ApiConversationPriority, ApiConversationStatus, FolderKey, UiConversation } from '@/lib/inbox/types';

type SelectedChannel = { id: string; channel_type: string } | null | undefined;

export function filterInboxConversations(
  uiAll: UiConversation[],
  opts: {
    folder: FolderKey;
    userId?: string;
    mentionConversationIds: Set<string>;
    search: string;
    channelFilter: 'all' | Channel;
    selectedChannel: SelectedChannel;
    favorites: Record<string, true>;
    statusFilter?: 'all' | ApiConversationStatus;
    priorityFilter?: 'all' | ApiConversationPriority;
    /** Quando o supervisor usa attendance_group, o status já vem filtrado da API. */
    supervisorAttendanceGroup?: 'all' | 'active' | 'waiting' | 'finished';
    /** Filtro por atendente (supervisor/admin) — reforço no cliente quando a API já filtrou. */
    attendantFilterId?: string;
  }
): UiConversation[] {
  let list = uiAll;

  if (opts.attendantFilterId) {
    list = list.filter((c) => c.raw.attendant_id === opts.attendantFilterId);
  }

  const statusHandledByAttendanceGroup = Boolean(
    opts.supervisorAttendanceGroup && opts.supervisorAttendanceGroup !== 'all'
  );
  const explicitStatus = Boolean(
    !statusHandledByAttendanceGroup && opts.statusFilter && opts.statusFilter !== 'all'
  );
  const explicitPriority = Boolean(opts.priorityFilter && opts.priorityFilter !== 'all');

  if (explicitStatus) {
    list = list.filter((c) => c.raw.status === opts.statusFilter);
  }
  if (explicitPriority) {
    list = list.filter((c) => c.raw.priority === opts.priorityFilter);
  }

  if (opts.folder === 'mine') {
    list = list.filter(
      (c) => c.raw.attendant_id && opts.userId && c.raw.attendant_id === opts.userId
    );
    if (!explicitStatus) {
      list = list.filter((c) => c.raw.status !== 'resolved');
    }
  } else if (opts.folder === 'unassigned') {
    list = list.filter((c) => !c.raw.attendant_id);
    if (!explicitStatus) {
      list = list.filter((c) => c.raw.status !== 'resolved');
    }
  } else if (opts.folder === 'pending') {
    if (!explicitStatus) {
      list = list.filter((c) => c.raw.status === 'pending');
    }
  } else if (opts.folder === 'resolved_today') {
    if (!explicitStatus) {
      list = list.filter(
        (c) => c.raw.status === 'resolved' && c.raw.resolved_at && isToday(new Date(c.raw.resolved_at))
      );
    }
  } else if (opts.folder === 'mentions') {
    list = list.filter((c) => opts.mentionConversationIds.has(c.id));
    if (!explicitStatus) {
      list = list.filter((c) => c.raw.status !== 'resolved' && c.raw.status !== 'closed');
    }
  } else if (opts.folder === 'sector_all') {
    if (!explicitStatus) {
      list = list.filter((c) => c.raw.status !== 'closed' && c.raw.status !== 'resolved');
    }
  }

  const q = opts.search.trim().toLowerCase();
  if (q) {
    list = list.filter((c) => {
      const hay = `${c.name} ${c.phone} ${c.preview}`.toLowerCase();
      return hay.includes(q);
    });
  }

  if (opts.channelFilter !== 'all') list = list.filter((c) => c.channel === opts.channelFilter);
  if (opts.selectedChannel) {
    list = list.filter((c) =>
      c.raw.workspace_channel_id
        ? c.raw.workspace_channel_id === opts.selectedChannel!.id
        : c.channel === opts.selectedChannel!.channel_type
    );
  }

  return list.slice().sort((a, b) => {
    const favA = opts.favorites[a.id] ? 1 : 0;
    const favB = opts.favorites[b.id] ? 1 : 0;
    if (favA !== favB) return favB - favA;
    return 0;
  });
}

/** Mantém uma thread por telefone na lista (BUG-003). */
export function dedupeInboxConversationsByPhone(list: UiConversation[]): UiConversation[] {
  const byPhone = new Map<string, UiConversation>();
  for (const item of list) {
    const digits = item.phone.replace(/\D/g, '') || item.id;
    const prev = byPhone.get(digits);
    if (!prev) {
      byPhone.set(digits, item);
      continue;
    }
    const prevTs = prev.raw.last_message_at ? new Date(prev.raw.last_message_at).getTime() : 0;
    const curTs = item.raw.last_message_at ? new Date(item.raw.last_message_at).getTime() : 0;
    const duplicateThreadCount = (prev.duplicateThreadCount || 1) + 1;
    if (curTs >= prevTs) {
      byPhone.set(digits, { ...item, duplicateThreadCount });
    } else {
      byPhone.set(digits, { ...prev, duplicateThreadCount });
    }
  }
  return [...byPhone.values()];
}

export function buildInboxFolderRows(
  counts: {
    mine: number;
    unassigned: number;
    pending: number;
    resolvedToday: number;
    mentions: number;
    sectorOpen: number;
  },
  opts: {
    isSupervisor: boolean;
    isAdmin?: boolean;
    isCommercialTeam?: boolean;
    escalatedTotal: number;
    pendingTasksOpen: number;
  }
) {
  const base = [
    { key: 'mine' as const, label: 'Atribuídas a mim', count: counts.mine },
    { key: 'unassigned' as const, label: 'Não atribuídas', count: counts.unassigned },
    { key: 'pending' as const, label: 'Aguardando cliente', count: counts.pending },
    { key: 'pending_tasks' as const, label: 'Pendências', count: opts.pendingTasksOpen },
    { key: 'resolved_today' as const, label: 'Resolvidas hoje', count: counts.resolvedToday },
    { key: 'mentions' as const, label: 'Menções', count: counts.mentions },
  ];
  if (opts.isCommercialTeam) {
    return [
      { key: 'sector_all' as const, label: 'Todos do comercial', count: counts.sectorOpen },
      ...base,
    ];
  }
  if (opts.isAdmin) {
    return [
      { key: 'sector_all' as const, label: 'Todas as conversas', count: counts.sectorOpen },
      ...base,
    ];
  }
  if (!opts.isSupervisor) return base;
  return [
    { key: 'sector_all' as const, label: 'Todos do setor', count: counts.sectorOpen },
    { key: 'supervisor_escalated' as const, label: 'Escalados (supervisão)', count: opts.escalatedTotal },
    ...base,
  ];
}

export function hasExplicitInboxFilters(input: {
  statusFilter: 'all' | ApiConversationStatus;
  priorityFilter: 'all' | ApiConversationPriority;
  search: string;
  attendantFilterId?: string;
  sectorFilterId?: string;
  supervisorAttendanceGroup?: 'all' | 'active' | 'waiting' | 'finished';
}): boolean {
  const statusActive =
    input.statusFilter !== 'all' &&
    (!input.supervisorAttendanceGroup || input.supervisorAttendanceGroup === 'all');
  return (
    statusActive ||
    input.priorityFilter !== 'all' ||
    Boolean(input.search.trim()) ||
    Boolean(input.attendantFilterId) ||
    Boolean(input.sectorFilterId) ||
    Boolean(input.supervisorAttendanceGroup && input.supervisorAttendanceGroup !== 'all')
  );
}

export function inboxStatusFilterLabel(status: 'all' | ApiConversationStatus): string | null {
  if (status === 'all') return null;
  const map: Record<ApiConversationStatus, string> = {
    open: 'Abertas',
    pending: 'Pendentes',
    resolved: 'Resolvidas',
    closed: 'Fechadas',
  };
  return map[status] ?? status;
}

export function inboxPriorityFilterLabel(priority: 'all' | ApiConversationPriority): string | null {
  if (priority === 'all') return null;
  const map: Record<ApiConversationPriority, string> = {
    low: 'Baixa',
    normal: 'Normal',
    high: 'Alta',
    urgent: 'Urgente',
  };
  return map[priority] ?? priority;
}
