import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channel } from '@/components/ui/ChannelBadge';
import type { ApiConversationPriority, ApiConversationStatus, FolderKey } from '@/lib/inbox/types';

type UseInboxPageStateOptions = {
  isSupervisor: boolean;
  roleName?: string;
};

function defaultInboxFolder(roleName: string, isSupervisor: boolean): FolderKey {
  const role = roleName.toLowerCase();
  if (role === 'admin' || isSupervisor) return 'sector_all';
  if (role === 'sales' || role === 'commercial') return 'sector_all';
  // Novas mensagens chegam sem atendente — pasta padrão é a fila aberta.
  return 'unassigned';
}

export function useInboxPageState({ isSupervisor, roleName = '' }: UseInboxPageStateOptions) {
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [folder, setFolder] = useState<FolderKey>(() => defaultInboxFolder(roleName, isSupervisor));
  const [supervisorMainTab, setSupervisorMainTab] = useState<'conversations' | 'tasks' | 'tickets'>('conversations');
  const [supervisorAttendantId, setSupervisorAttendantId] = useState('');
  const [supervisorAttendanceGroup, setSupervisorAttendanceGroup] = useState<'all' | 'active' | 'waiting' | 'finished'>('all');
  const [supervisorSlaStage, setSupervisorSlaStage] = useState<'' | 'first_response' | 'treatment' | 'resolution'>('');
  const [supervisorSlaBucket, setSupervisorSlaBucket] = useState<'' | 'breached' | 'at_risk' | 'on_track'>('');
  const [supervisorTaskStatus, setSupervisorTaskStatus] = useState<'all' | 'open' | 'in_progress' | 'done' | 'cancelled'>('open');
  const [supervisorTaskType, setSupervisorTaskType] = useState('');
  const [supervisorTicketStatus, setSupervisorTicketStatus] = useState<'all' | 'open' | 'in_progress' | 'overdue' | 'resolved'>('open');
  const [activeId, setActiveId] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ApiConversationStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | ApiConversationPriority>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | Channel>('all');
  const [sectorFilterId, setSectorFilterId] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteCaret, setNoteCaret] = useState(0);
  const [noteHint, setNoteHint] = useState<string | null>(null);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [favorites, setFavorites] = useState<Record<string, true>>({});
  const [copilotCollapsed, setCopilotCollapsed] = useState(true);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [advanceEntryDrawerOpen, setAdvanceEntryDrawerOpen] = useState(false);
  const [advanceEntryTaskId, setAdvanceEntryTaskId] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const priorityMenuRef = useRef<HTMLDivElement | null>(null);
  const tagPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('inbox-favorites-v1');
      const parsed = raw ? (JSON.parse(raw) as Record<string, true>) : {};
      if (parsed && typeof parsed === 'object') setFavorites(parsed);
    } catch {
      // ignore
    }
  }, []);

  const persistFavorites = useCallback((next: Record<string, true>) => {
    setFavorites(next);
    try {
      window.localStorage.setItem('inbox-favorites-v1', JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      setFilterOpen(false);
      setMoreOpen(false);
      setHistoryOpen(false);
      setNoteOpen(false);
      setTransferOpen(false);
      setPriorityOpen(false);
      setTagPickerOpen(false);
      setCopilotOpen(false);
    };
    const onMouseDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (moreOpen && moreMenuRef.current && !moreMenuRef.current.contains(target)) setMoreOpen(false);
      if (priorityOpen && priorityMenuRef.current && !priorityMenuRef.current.contains(target)) setPriorityOpen(false);
      if (tagPickerOpen && tagPickerRef.current && !tagPickerRef.current.contains(target)) setTagPickerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [moreOpen, priorityOpen, tagPickerOpen]);

  useEffect(() => {
    if (!isSupervisor || typeof window === 'undefined') return;
    const k = 'inbox-supervisor-default-folder-v1';
    if (window.localStorage.getItem(k)) return;
    window.localStorage.setItem(k, '1');
    setFolder('sector_all');
    setSupervisorMainTab('conversations');
  }, [isSupervisor]);

  useEffect(() => {
    if (supervisorAttendanceGroup !== 'all' && statusFilter !== 'all') {
      setStatusFilter('all');
    }
  }, [supervisorAttendanceGroup, statusFilter]);

  // Filtros explícitos conflitam com pastas (ex.: "Não atribuídas" + status Resolvidas).
  useEffect(() => {
    const role = roleName.toLowerCase();
    const hasSectorFolder = isSupervisor || role === 'admin' || role === 'sales' || role === 'commercial';
    if (!hasSectorFolder) return;
    const explicit =
      statusFilter !== 'all' || priorityFilter !== 'all' || Boolean(supervisorAttendantId.trim()) || Boolean(sectorFilterId.trim());
    if (!explicit) return;
    if (folder === 'sector_all' || folder === 'supervisor_escalated') return;
    setFolder('sector_all');
  }, [folder, isSupervisor, priorityFilter, roleName, sectorFilterId, statusFilter, supervisorAttendantId]);

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setSectorFilterId('');
    setSupervisorAttendantId('');
    setSupervisorAttendanceGroup('all');
    setSupervisorSlaStage('');
    setSupervisorSlaBucket('');
  }, []);

  const handleFolderSelect = useCallback((key: FolderKey, openNotifications: () => void) => {
    if (key === 'pending_tasks') {
      openNotifications();
      return;
    }
    setFolder(key);
  }, []);

  const openAdvanceEntry = useCallback((taskId: string) => {
    setAdvanceEntryTaskId(taskId);
    setAdvanceEntryDrawerOpen(true);
  }, []);

  const closeAdvanceEntry = useCallback(() => {
    setAdvanceEntryDrawerOpen(false);
    setAdvanceEntryTaskId(null);
  }, []);

  const toggleCopilot = useCallback(() => {
    setCopilotOpen((v) => {
      const next = !v;
      if (next) setCopilotCollapsed(true);
      return next;
    });
  }, []);

  const toggleChannelFilter = useCallback((ch: Channel) => {
    setChannelFilter((v) => (v === ch ? 'all' : ch));
  }, []);

  return {
    showNewConversation,
    setShowNewConversation,
    folder,
    setFolder,
    supervisorMainTab,
    setSupervisorMainTab,
    supervisorAttendantId,
    setSupervisorAttendantId,
    supervisorAttendanceGroup,
    setSupervisorAttendanceGroup,
    supervisorSlaStage,
    setSupervisorSlaStage,
    supervisorSlaBucket,
    setSupervisorSlaBucket,
    supervisorTaskStatus,
    setSupervisorTaskStatus,
    supervisorTaskType,
    setSupervisorTaskType,
    supervisorTicketStatus,
    setSupervisorTicketStatus,
    activeId,
    setActiveId,
    filterOpen,
    setFilterOpen,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    priorityFilter,
    setPriorityFilter,
    channelFilter,
    setChannelFilter,
    sectorFilterId,
    setSectorFilterId,
    moreOpen,
    setMoreOpen,
    historyOpen,
    setHistoryOpen,
    profileOpen,
    setProfileOpen,
    noteOpen,
    setNoteOpen,
    noteText,
    setNoteText,
    noteCaret,
    setNoteCaret,
    noteHint,
    setNoteHint,
    priorityOpen,
    setPriorityOpen,
    favorites,
    copilotCollapsed,
    setCopilotCollapsed,
    tagPickerOpen,
    setTagPickerOpen,
    copilotOpen,
    setCopilotOpen,
    advanceEntryDrawerOpen,
    advanceEntryTaskId,
    transferOpen,
    setTransferOpen,
    noteTextareaRef,
    moreMenuRef,
    priorityMenuRef,
    tagPickerRef,
    persistFavorites,
    clearFilters,
    handleFolderSelect,
    openAdvanceEntry,
    closeAdvanceEntry,
    toggleCopilot,
    toggleChannelFilter,
  };
}
