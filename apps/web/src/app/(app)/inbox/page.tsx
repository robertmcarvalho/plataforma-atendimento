'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalAppLink } from '@/components/navigation/ExternalAppLink';
import { openAppRouteInNewTab } from '@/lib/openAppRoute';
import { ChannelBadge, type Channel } from '@/components/ui/ChannelBadge';
import { StatusDot } from '@/components/ui/StatusDot';
import {
  CheckCheck,
  Bell,
  Clock,
  Filter,
  Mic,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  Send,
  Smile,
  Sparkles,
  Star,
  Tag,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { useAuth } from '@/store/auth';
import { features } from '@/lib/features';
import { useMergedAiFeatures } from '@/lib/ai/useAiFeatures';
import { SentimentBadge } from '@/components/inbox/ai/SentimentBadge';
import { UrgencyDot } from '@/components/inbox/ai/UrgencyBadge';
import { SuggestReplyButton } from '@/components/inbox/ai/SuggestReplyButton';
import { InboxTicketingSidecar } from '@/components/inbox/ticketing/InboxTicketingSidecar';
import { ContactProfileModal } from '@/components/inbox/ContactProfileModal';
import { ProfileTypeBadge } from '@/components/ui/ProfileTypeBadge';
import { OperationalContextBar } from '@/components/operational/OperationalContextBar';
import { format, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { NewConversationModal, type TemplatePickerOption } from '@/components/inbox/NewConversationModal';
import { CopilotPanel } from '@/components/copilot/CopilotPanel';
import {
  InboxAttendanceSlaStages,
  pickActiveSlaDeadlineForCountdown,
} from '@/components/inbox/InboxAttendanceSlaStages';
import { normalizeBrazilPhone, formatBrazilPhone } from '@/lib/brFormat';
import { supabase } from '@/lib/supabase';
import type { ContactDetail } from '@/types/contact';
import { useOperationalContext } from '@/hooks/useOperationalContext';
import { useInboxDensity } from '@/hooks/useInboxDensity';
import { humanizeInternalNoteContent } from '@/lib/humanizeInternalNote';

type MentionCandidate = { id: string; name: string };

function activeMentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const match = before.match(/@([^\n@]*)$/);
  if (!match) return null;
  return match[1];
}

function insertMentionAtCaret(text: string, caret: number, name: string): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const match = before.match(/@([^\n@]*)$/);
  if (!match) return { text, caret };
  const start = before.length - match[0].length;
  const next = `${text.slice(0, start)}@${name} ${after}`;
  return { text: next, caret: start + name.length + 2 };
}

type ApiConversationStatus = 'open' | 'pending' | 'resolved' | 'closed';
type ApiConversationPriority = 'low' | 'normal' | 'high' | 'urgent';

type ApiConversationMessagePreview = {
  content?: string | null;
  direction?: 'inbound' | 'outbound' | string;
  created_at: string;
  status?: string | null;
  ai_sentiment?: string | null;
  ai_sentiment_score?: number | null;
  ai_urgency?: string | null;
  ai_urgency_score?: number | null;
  ai_analyzed_at?: string | null;
};

type ApiConversation = {
  id: string;
  workspace_channel_id?: string | null;
  status: ApiConversationStatus;
  priority: ApiConversationPriority;
  last_message_at: string | null;
  resolved_at: string | null;
  attendant_id: string | null;
  opened_at: string;
  sla_first_response_deadline?: string | null;
  sla_first_response_at?: string | null;
  sla_first_response_ok?: boolean | null;
  sla_treatment_deadline?: string | null;
  sla_resolution_deadline: string | null;
  sla_resolved_ok?: boolean | null;
  has_unread?: boolean | null;
  tags?: string[] | null;
  contacts:
    | {
        id?: string;
        wa_phone: string;
        display_name: string | null;
        profile_type: string;
        driver_id?: string | null;
        pharmacy_id?: string | null;
        leader_id?: string | null;
      }
    | null;
  sectors: { id: string; name: string } | null;
  attendant: { id: string; name: string } | null;
  context_pharmacy: { id: string; trade_name: string } | null;
  ai_sentiment_last?: string | null;
  ai_urgency_score?: number | null;
  ai_nps_predicted?: number | null;
  ai_nps_set_at?: string | null;
  topic?: { id: string; name: string } | null;
  messages?: ApiConversationMessagePreview[];
};

type ApiConversationListResponse = {
  data: ApiConversation[];
  total: number;
  page: number;
  limit: number;
};

type ApiMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  content: string | null;
  media_url?: string | null;
  created_at: string;
  status: string;
  ai_sentiment?: string | null;
  ai_sentiment_score?: number | null;
  ai_urgency?: string | null;
  ai_urgency_score?: number | null;
  ai_analyzed_at?: string | null;
};

type ApiConversationAssignment = {
  id: string;
  reason?: string | null;
  created_at: string;
  assigned_by?: { name?: string | null } | null;
  from_attendant?: { name?: string | null } | null;
  to_attendant?: { name?: string | null } | null;
  from_sector?: { name?: string | null } | null;
  to_sector?: { name?: string | null } | null;
};

type ApiInternalNote = {
  id: string;
  content: string;
  created_at: string;
  author?: { name?: string | null } | null;
};

type ThreadItem =
  | {
      kind: 'message';
      id: string;
      from: 'me' | 'them';
      text: string;
      time: string;
      createdAtMs: number;
    }
  | {
      kind: 'note';
      id: string;
      text: string;
      author: string;
      time: string;
      createdAtMs: number;
    };

type ApiConversationDetail = ApiConversation & {
  close_reason?: string | null;
  context_driver?: { id: string; name: string } | null;
  context_leader?: { id: string; name: string } | null;
  messages?: ApiMessage[];
  internal_notes?: ApiInternalNote[];
  conversation_assignments?: ApiConversationAssignment[];
};

type ApiContactConversation = {
  id: string;
  status: ApiConversationStatus;
  priority: ApiConversationPriority;
  opened_at: string;
  last_message_at: string | null;
  resolved_at: string | null;
  close_reason?: string | null;
  summary?: string | null;
};

type ApiUser = {
  id: string;
  name: string;
  email?: string;
  role?: string;
  sector_id?: string | null;
  is_active?: boolean | null;
};

type ApiSector = {
  id: string;
  name: string;
  is_active?: boolean | null;
};

type ApiConversationTagCatalogRow = {
  slug: string;
  label_pt: string;
  sort_order: number;
  tone?: 'warning' | 'success' | 'primary' | 'info' | 'danger' | 'neutral';
  is_system?: boolean;
  is_user_editable?: boolean;
};

type ApiPendingTask = {
  id: string;
  task_type: string;
  title: string;
  description?: string | null;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  due_at?: string | null;
  conversation_id?: string | null;
  contact?: { display_name?: string | null; wa_phone?: string | null } | null;
  driver?: { name?: string | null } | null;
};

type ApiTaskSummary = {
  open: number;
  in_progress: number;
  mine_open: number;
  overdue: number;
};

type ApiSlaEventRow = {
  id: string;
  event_type: string;
  severity: string;
  notified_supervisor?: boolean | null;
  created_at: string;
  conversations?: {
    id: string;
    status?: string;
    sector_id?: string | null;
    contacts?: { display_name?: string | null };
    attendant?: { name?: string | null } | null;
    sectors?: { name?: string | null } | null;
  } | null;
};

type ApiOperationalTicket = {
  id: string;
  ticket_code?: string | null;
  status: string;
  conversation_id?: string | null;
  due_at?: string | null;
  assignee_user_id?: string | null;
  type?: string | null;
  priority?: string | null;
};

type UiPresence = 'online' | 'idle' | 'offline' | 'busy';
type UiTagTone = 'warning' | 'success' | 'primary';

type UiConversation = {
  id: string;
  name: string;
  phone: string;
  channel: Channel;
  preview: string;
  time: string;
  unread?: number;
  status: UiPresence;
  tag?: { label: string; tone: UiTagTone };
  raw: ApiConversation;
};

type FolderKey =
  | 'mine'
  | 'unassigned'
  | 'pending'
  | 'resolved_today'
  | 'mentions'
  | 'sector_all'
  | 'supervisor_escalated';

type InboxActivityTab = 'all' | 'sla' | 'tasks' | 'tickets';

const channels: Channel[] = [
  'whatsapp',
  ...(features.channels.instagram ? (['instagram'] as Channel[]) : []),
  ...(features.channels.email ? (['email'] as Channel[]) : []),
];

const toneClass: Record<UiTagTone, string> = {
  warning: 'bg-warning/15 text-warning border-warning/20',
  success: 'bg-success/15 text-success border-success/20',
  primary: 'bg-primary/15 text-primary border-primary/20',
};

const catalogToneClass: Record<string, string> = {
  warning: 'bg-warning/15 text-warning border-warning/20',
  success: 'bg-success/15 text-success border-success/20',
  primary: 'bg-primary/15 text-primary border-primary/20',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/20',
  danger: 'bg-destructive/15 text-destructive border-destructive/20',
  neutral: 'bg-background/60 text-muted-foreground border-border',
};

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;

function formatClientSince(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  const m = MONTHS[d.getMonth()] || '—';
  return `${m}/${d.getFullYear()}`;
}

function initials(input: string) {
  const trimmed = (input || '').trim();
  if (!trimmed) return '??';
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

function lastByDate<T extends { created_at: string }>(items: T[] | undefined) {
  if (!items || items.length === 0) return null;
  return items.reduce<T | null>((acc, item) => {
    if (!acc) return item;
    return new Date(item.created_at).getTime() > new Date(acc.created_at).getTime() ? item : acc;
  }, null);
}

/** Sentimento/urgência exibidos na lista e header: conversa pode trazer última inbound em `messages` (lista) ou só `ai_sentiment_last`. */
function conversationListAiBadges(conv: {
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

function shortRelativeTime(iso: string | null | undefined, nowMs: number) {
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

function presenceFromLastMessage(lastIso: string | null | undefined, status: ApiConversationStatus, nowMs: number): UiPresence {
  if (status === 'pending') return 'busy';
  if (!lastIso) return 'offline';
  const diffMin = (nowMs - new Date(lastIso).getTime()) / 60000;
  if (diffMin <= 5) return 'online';
  if (diffMin <= 60) return 'idle';
  return 'offline';
}

function formatCountdown(deadlineIso: string | null | undefined, nowMs: number) {
  if (!deadlineIso) return '--:--';
  const diff = new Date(deadlineIso).getTime() - nowMs;
  const total = Math.max(0, Math.floor(diff / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Rótulos para supervisão — alinhado aos status do banco. */
function conversationAttendanceLabelPt(status: ApiConversationStatus): string {
  const m: Record<ApiConversationStatus, string> = {
    open: 'Em andamento',
    pending: 'Aguardando cliente',
    resolved: 'Finalizado',
    closed: 'Encerrado',
  };
  return m[status] || status;
}

function taskStatusLabelPt(status: string): string {
  const m: Record<string, string> = {
    open: 'Aberta',
    in_progress: 'Em andamento',
    done: 'Concluída',
    cancelled: 'Cancelada',
  };
  return m[status] || status;
}

function ticketStatusLabelPt(status: string): string {
  const m: Record<string, string> = {
    open: 'Aberto',
    in_progress: 'Em andamento',
    resolved: 'Resolvido',
    overdue: 'Atrasado',
  };
  return m[status] || status;
}

function slaEventTypeLabelPt(eventType: string): string {
  const m: Record<string, string> = {
    breach_first_response: 'Violação · 1ª resposta',
    breach_treatment: 'Violação · tratamento',
    breach_resolution: 'Violação · resolução',
    queue_sla_applied: 'SLA de fila aplicado',
  };
  return m[eventType] || eventType;
}

function priorityPill(priority: ApiConversationPriority | null | undefined) {
  const p = (priority || 'normal') as ApiConversationPriority;
  if (p === 'urgent') return { label: 'Urgente', className: 'bg-destructive/15 text-destructive border-destructive/25 animate-pulse' };
  if (p === 'high') return { label: 'Alta', className: 'bg-warning/15 text-warning border-warning/25 animate-pulse' };
  if (p === 'low') return { label: 'Baixa', className: 'bg-success/15 text-success border-success/25' };
  return { label: 'Normal', className: 'bg-success/15 text-success border-success/25' };
}

function toMessageText(message: ApiMessage) {
  const body = (message.content || '').trim();
  if (body) return body;
  if (message.type === 'image') return '[Imagem]';
  if (message.type === 'audio') return '[Áudio]';
  if (message.type === 'document') return '[Documento]';
  if (message.type === 'template') return '[Template]';
  if (message.type === 'contact') return '[Contato]';
  return '[Mensagem]';
}

function toUiConversation(conv: ApiConversation, nowMs: number): UiConversation {
  const phone = conv.contacts?.wa_phone || '';
  const name = conv.contacts?.display_name || phone || 'Contato';
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
  } else if (conv.sla_resolution_deadline) {
    const minutes = Math.ceil((new Date(conv.sla_resolution_deadline).getTime() - nowMs) / 60000);
    if (minutes > 0 && minutes <= 15) tag = { label: `SLA ${minutes}min`, tone: 'warning' };
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

function buildNewContactBody(
  detail: ApiConversationDetail | undefined,
  displayName: string,
  phoneNormalized: string
): {
  wa_phone: string;
  display_name: string | null;
  profile_type: 'driver' | 'pharmacy' | 'leader' | 'unknown';
  driver_id: string | null;
  pharmacy_id: string | null;
  leader_id: string | null;
  is_blocked: boolean;
} {
  const c = detail?.contacts;
  let profile_type: 'driver' | 'pharmacy' | 'leader' | 'unknown' = 'unknown';
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
  } else if (c?.profile_type === 'driver' || c?.profile_type === 'pharmacy' || c?.profile_type === 'leader') {
    profile_type = c.profile_type as 'driver' | 'pharmacy' | 'leader';
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

function cadastroHrefFromContext(detail: ApiConversationDetail | undefined, contact: ContactDetail | undefined): string | null {
  const driverId = detail?.context_driver?.id || contact?.driver?.id || contact?.driver_id || null;
  if (driverId) return `/drivers/${driverId}`;

  const pharmacyId = detail?.context_pharmacy?.id || contact?.pharmacy?.id || contact?.pharmacy_id || null;
  if (pharmacyId) return `/pharmacies/${pharmacyId}`;

  const leaderId = detail?.context_leader?.id || contact?.leader?.id || contact?.leader_id || null;
  if (leaderId) return `/leaders/${leaderId}`;

  return null;
}

const INBOX_LS_FOLDER_W = 'inbox-col-folder-w';
const INBOX_LS_LIST_W = 'inbox-col-list-w';

function readInboxStoredWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === 'undefined') return fallback;
  const n = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export default function InboxPage() {
  const user = useAuth((s) => s.user);
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const canFetch = hasHydrated && isAuthenticated;
  const qc = useQueryClient();
  const { density: inboxDensity } = useInboxDensity();

  const aiRuntime = useMergedAiFeatures(canFetch);

  const roleName = String(user?.role || '').toLowerCase();
  const canStartStaffConversation =
    roleName === 'admin' || roleName === 'supervisor' || roleName === 'attendant';
  const canEditConversationTags = roleName === 'admin' || roleName === 'supervisor';

  const isSupervisor = roleName === 'supervisor';
  const canUseSlaAlerts = roleName === 'supervisor' || roleName === 'admin';
  const canUseSupervisorQueues = roleName === 'supervisor' || roleName === 'admin' || roleName === 'operational';

  const [showNewConversation, setShowNewConversation] = useState(false);
  const [folder, setFolder] = useState<FolderKey>('mine');
  const [supervisorMainTab, setSupervisorMainTab] = useState<'conversations' | 'tasks' | 'tickets'>('conversations');
  /** Filtro de atendente do setor (conversas, pendências filtradas por assignee quando aplicável e tickets por responsável). */
  const [supervisorAttendantId, setSupervisorAttendantId] = useState<string>('');
  const [supervisorAttendanceGroup, setSupervisorAttendanceGroup] = useState<'all' | 'active' | 'waiting' | 'finished'>('all');
  const [supervisorSlaStage, setSupervisorSlaStage] = useState<'' | 'first_response' | 'treatment' | 'resolution'>('');
  const [supervisorSlaBucket, setSupervisorSlaBucket] = useState<'' | 'breached' | 'at_risk' | 'on_track'>('');
  const [supervisorTaskStatus, setSupervisorTaskStatus] = useState<'all' | 'open' | 'in_progress' | 'done' | 'cancelled'>('open');
  const [supervisorTicketStatus, setSupervisorTicketStatus] = useState<'all' | 'open' | 'in_progress' | 'overdue' | 'resolved'>('open');
  /** Painel lateral unificado (SLA · pendências · tickets) */
  const [activityPanelOpen, setActivityPanelOpen] = useState(false);
  const [activityPanelTab, setActivityPanelTab] = useState<InboxActivityTab>('all');
  const [activeId, setActiveId] = useState<string>('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ApiConversationStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | ApiConversationPriority>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | Channel>('all');
  const [moreOpen, setMoreOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteCaret, setNoteCaret] = useState(0);
  const [noteHint, setNoteHint] = useState<string | null>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSectorId, setTransferSectorId] = useState<string>('');
  const [transferAttendantId, setTransferAttendantId] = useState<string>('');
  const [transferReason, setTransferReason] = useState('');
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const [favorites, setFavorites] = useState<Record<string, true>>({});

  const [folderColW, setFolderColW] = useState(() => readInboxStoredWidth(INBOX_LS_FOLDER_W, 224, 180, 380));
  const [listColW, setListColW] = useState(() => readInboxStoredWidth(INBOX_LS_LIST_W, 340, 260, 560));
  const { selectedChannel } = useOperationalContext({
    enabled: canFetch,
    channelTypes: ['whatsapp', 'instagram', 'email', 'webchat'],
  });

  const [composerText, setComposerText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [saveContactBusy, setSaveContactBusy] = useState(false);
  const [saveContactHint, setSaveContactHint] = useState<string | null>(null);
  const [saveContactDuplicateId, setSaveContactDuplicateId] = useState<string | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  const [nowMinute, setNowMinute] = useState(() => Date.now());
  const [nowTick, setNowTick] = useState(() => Date.now());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const filterPanelRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const emojiPanelRef = useRef<HTMLDivElement | null>(null);
  const priorityMenuRef = useRef<HTMLDivElement | null>(null);
  const tagPickerRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const t1 = setInterval(() => setNowMinute(Date.now()), 60_000);
    const t2 = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, []);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(INBOX_LS_FOLDER_W, String(folderColW));
  }, [folderColW]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(INBOX_LS_LIST_W, String(listColW));
  }, [listColW]);

  const persistFavorites = (next: Record<string, true>) => {
    setFavorites(next);
    try {
      window.localStorage.setItem('inbox-favorites-v1', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      setFilterOpen(false);
      setMoreOpen(false);
      setEmojiOpen(false);
      setHistoryOpen(false);
      setNoteOpen(false);
      setTransferOpen(false);
      setPriorityOpen(false);
      setTagPickerOpen(false);
      setCopilotOpen(false);
      setActivityPanelOpen(false);
      setContextDrawerOpen(false);
    };

    const onMouseDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (filterOpen && filterPanelRef.current && !filterPanelRef.current.contains(target)) setFilterOpen(false);
      if (moreOpen && moreMenuRef.current && !moreMenuRef.current.contains(target)) setMoreOpen(false);
      if (emojiOpen && emojiPanelRef.current && !emojiPanelRef.current.contains(target)) setEmojiOpen(false);
      if (priorityOpen && priorityMenuRef.current && !priorityMenuRef.current.contains(target)) setPriorityOpen(false);
      if (tagPickerOpen && tagPickerRef.current && !tagPickerRef.current.contains(target)) setTagPickerOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [emojiOpen, filterOpen, moreOpen, priorityOpen, tagPickerOpen]);

  useEffect(() => {
    if (!isSupervisor || typeof window === 'undefined') return;
    const k = 'inbox-supervisor-default-folder-v1';
    if (window.localStorage.getItem(k)) return;
    window.localStorage.setItem(k, '1');
    setFolder('sector_all');
    setSupervisorMainTab('conversations');
  }, [isSupervisor]);

  const convQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', isSupervisor ? '220' : '160');
    if (priorityFilter !== 'all') params.set('priority', priorityFilter);
    if (selectedChannel?.id) params.set('workspace_channel_id', selectedChannel.id);

    if (isSupervisor) {
      if (folder === 'supervisor_escalated') params.set('escalated_supervisor', '1');
      if (supervisorAttendanceGroup !== 'all') params.set('attendance_group', supervisorAttendanceGroup);
      else if (statusFilter !== 'all') params.set('status', statusFilter);

      if (supervisorAttendantId) params.set('attendant_id', supervisorAttendantId);
      if (supervisorSlaStage && supervisorSlaBucket) {
        params.set('sla_stage', supervisorSlaStage);
        params.set('sla_bucket', supervisorSlaBucket);
      }
    } else if (statusFilter !== 'all') {
      params.set('status', statusFilter);
    }

    return params.toString();
  }, [
    folder,
    isSupervisor,
    priorityFilter,
    selectedChannel?.id,
    statusFilter,
    supervisorAttendanceGroup,
    supervisorAttendantId,
    supervisorSlaBucket,
    supervisorSlaStage,
  ]);

  const { data: convResp, isLoading: isConvsLoading, isError: isConvsError, refetch: refetchConvs } = useQuery({
    queryKey: ['inbox', 'conversations', convQuery],
    enabled: canFetch,
    queryFn: () => api.get(`/api/conversations?${convQuery}`).then((r) => r.data as ApiConversationListResponse),
  });

  const { data: escCountResp } = useQuery({
    queryKey: ['inbox', 'supervisor-escalation-count'],
    enabled: canFetch && isSupervisor,
    queryFn: () =>
      api
        .get('/api/conversations?escalated_supervisor=1&limit=1&page=1')
        .then((r) => r.data as ApiConversationListResponse),
    staleTime: 45_000,
  });

  const uiAll = useMemo(() => (convResp?.data || []).map((c) => toUiConversation(c, nowMinute)), [convResp?.data, nowMinute]);

  const mentionTasksQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('status', 'open');
    p.set('limit', '200');
    if (user?.id) p.set('assignee_id', user.id);
    return p.toString();
  }, [user?.id]);

  const { data: myOpenTasks = [] } = useQuery({
    queryKey: ['inbox', 'my-open-tasks', mentionTasksQuery],
    enabled: canFetch && Boolean(user?.id),
    staleTime: 30_000,
    refetchInterval: 45_000,
    queryFn: () => api.get(`/api/tasks?${mentionTasksQuery}`).then((r) => r.data as ApiPendingTask[]),
  });

  const mentionConversationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of myOpenTasks) {
      if (t.task_type === 'internal_note_mention' && t.conversation_id) ids.add(t.conversation_id);
    }
    return ids;
  }, [myOpenTasks]);

  const counts = useMemo(() => {
    const mine = uiAll.filter((c) => c.raw.status !== 'resolved' && c.raw.attendant_id && user?.id && c.raw.attendant_id === user.id).length;
    const unassigned = uiAll.filter((c) => c.raw.status !== 'resolved' && !c.raw.attendant_id).length;
    const pending = uiAll.filter((c) => c.raw.status === 'pending').length;
    const resolvedToday = uiAll.filter((c) => c.raw.status === 'resolved' && c.raw.resolved_at && isToday(new Date(c.raw.resolved_at))).length;
    const sectorOpen = uiAll.filter((c) => c.raw.status !== 'closed').length;
    const mentions = myOpenTasks.filter((t) => t.task_type === 'internal_note_mention').length;
    return { mine, unassigned, pending, resolvedToday, mentions, sectorOpen };
  }, [myOpenTasks, uiAll, user?.id]);

  const folders = useMemo(() => {
    const base = [
      { key: 'mine' as const, label: 'Atribuídas a mim', count: counts.mine },
      { key: 'unassigned' as const, label: 'Não atribuídas', count: counts.unassigned },
      { key: 'pending' as const, label: 'Aguardando cliente', count: counts.pending },
      { key: 'resolved_today' as const, label: 'Resolvidas hoje', count: counts.resolvedToday },
      { key: 'mentions' as const, label: 'Menções', count: counts.mentions },
    ];
    if (!isSupervisor) return base;

    const escTotal = typeof escCountResp?.total === 'number' ? escCountResp.total : 0;

    return [
      { key: 'sector_all' as const, label: 'Todos do setor', count: counts.sectorOpen },
      { key: 'supervisor_escalated' as const, label: 'Escalados (supervisão)', count: escTotal },
      ...base,
    ];
  }, [counts, escCountResp?.total, isSupervisor]);

  const filteredConversations = useMemo(() => {
    let list = uiAll;

    if (folder === 'mine') list = list.filter((c) => c.raw.status !== 'resolved' && c.raw.attendant_id && user?.id && c.raw.attendant_id === user.id);
    else if (folder === 'unassigned') list = list.filter((c) => c.raw.status !== 'resolved' && !c.raw.attendant_id);
    else if (folder === 'pending') list = list.filter((c) => c.raw.status === 'pending');
    else if (folder === 'resolved_today') list = list.filter((c) => c.raw.status === 'resolved' && c.raw.resolved_at && isToday(new Date(c.raw.resolved_at)));
    else if (folder === 'mentions') list = list.filter((c) => mentionConversationIds.has(c.id));
    else if (folder === 'sector_all') list = list.filter((c) => c.raw.status !== 'closed');
    else if (folder === 'supervisor_escalated') list = [...uiAll];

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => {
        const hay = `${c.name} ${c.phone} ${c.preview}`.toLowerCase();
        return hay.includes(q);
      });
    }

    if (channelFilter !== 'all') list = list.filter((c) => c.channel === channelFilter);
    if (selectedChannel) {
      list = list.filter((c) =>
        c.raw.workspace_channel_id ? c.raw.workspace_channel_id === selectedChannel.id : c.channel === selectedChannel.channel_type
      );
    }

    const sorted = list.slice().sort((a, b) => {
      const favA = favorites[a.id] ? 1 : 0;
      const favB = favorites[b.id] ? 1 : 0;
      if (favA !== favB) return favB - favA;
      return 0;
    });
    return sorted;
  }, [channelFilter, favorites, folder, mentionConversationIds, search, selectedChannel, uiAll, user?.id]);

  useEffect(() => {
    if (isSupervisor && supervisorMainTab !== 'conversations') return;
    if (filteredConversations.length === 0) {
      setActiveId('');
      return;
    }
    if (!activeId || !filteredConversations.some((c) => c.id === activeId)) {
      setActiveId(filteredConversations[0].id);
    }
  }, [activeId, filteredConversations, isSupervisor, supervisorMainTab]);

  const active = useMemo(() => uiAll.find((c) => c.id === activeId) || null, [uiAll, activeId]);

  const { data: detail, isLoading: isDetailLoading, isError: isDetailError, refetch: refetchDetail } = useQuery({
    queryKey: ['inbox', 'conversation', activeId],
    enabled: canFetch && Boolean(activeId),
    queryFn: () => api.get(`/api/conversations/${activeId}`).then((r) => r.data as ApiConversationDetail),
  });

  useEffect(() => {
    if (!canFetch || !activeId) return;

    const refresh = () => {
      void refetchDetail();
      void refetchConvs();
    };

    const channel = supabase
      .channel(`inbox-realtime-${activeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_notes', filter: `conversation_id=eq.${activeId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `id=eq.${activeId}` }, refresh)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeId, canFetch, refetchConvs, refetchDetail]);

  const { data: users } = useQuery({
    queryKey: ['inbox', 'users'],
    enabled: canFetch && transferOpen,
    queryFn: () => api.get('/api/users/attendants').then((r) => r.data as ApiUser[]),
  });

  const { data: sectors } = useQuery({
    queryKey: ['inbox', 'sectors'],
    enabled: canFetch && (transferOpen || showNewConversation),
    queryFn: () => api.get('/api/sectors').then((r) => r.data as ApiSector[]),
  });

  const { data: supervisorAttendants = [] } = useQuery({
    queryKey: ['inbox', 'sector-attendants'],
    enabled: canFetch && isSupervisor,
    queryFn: () => api.get('/api/users/attendants').then((r) => r.data as ApiUser[]),
  });

  const supervisorTasksQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '120');
    p.set('status', supervisorTaskStatus);
    if (supervisorAttendantId) p.set('assignee_id', supervisorAttendantId);
    return p.toString();
  }, [supervisorTaskStatus, supervisorAttendantId]);

  const { data: supervisorTasksPanel = [] } = useQuery({
    queryKey: ['inbox', 'supervisor-tasks-panel', supervisorTasksQuery],
    enabled: canFetch && isSupervisor && supervisorMainTab === 'tasks',
    queryFn: () => api.get(`/api/tasks?${supervisorTasksQuery}`).then((r) => r.data as ApiPendingTask[]),
  });

  const supervisorTicketsQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '120');
    if (supervisorTicketStatus !== 'all') p.set('status', supervisorTicketStatus);
    if (supervisorAttendantId) p.set('assignee_user_id', supervisorAttendantId);
    return p.toString();
  }, [supervisorTicketStatus, supervisorAttendantId]);

  const { data: supervisorTicketsPanel = [] } = useQuery({
    queryKey: ['inbox', 'supervisor-tickets-panel', supervisorTicketsQuery],
    enabled: canFetch && isSupervisor && supervisorMainTab === 'tickets',
    queryFn: () => api.get(`/api/tickets?${supervisorTicketsQuery}`).then((r) => r.data as ApiOperationalTicket[]),
  });

  const { data: notificationPrefs } = useQuery({
    queryKey: ['notification-preferences'],
    enabled: canFetch && canStartStaffConversation,
    staleTime: 60_000,
    queryFn: async () => (await api.get<Record<string, unknown>>('/api/users/me/notification-preferences')).data,
  });

  const prefSlaInApp = notificationPrefs?.sla_warning !== false;
  const prefTasksInApp = notificationPrefs?.open_tasks_inbox !== false;

  const { data: slaFeed = [] } = useQuery({
    queryKey: ['inbox', 'sla-feed'],
    enabled: canFetch && canUseSlaAlerts && prefSlaInApp,
    staleTime: 25_000,
    refetchInterval: activityPanelOpen ? 25_000 : 55_000,
    queryFn: () => api.get('/api/sla/events').then((r) => r.data as ApiSlaEventRow[]),
  });

  const activityTasksQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('status', 'open');
    p.set('limit', '100');
    if (canUseSupervisorQueues && supervisorAttendantId) p.set('assignee_id', supervisorAttendantId);
    return p.toString();
  }, [canUseSupervisorQueues, supervisorAttendantId]);

  const activityTasksEnabled =
    canFetch &&
    activityPanelOpen &&
    prefTasksInApp &&
    (activityPanelTab === 'all' || activityPanelTab === 'tasks');

  const { data: activityTasks = [] } = useQuery({
    queryKey: ['inbox', 'activity-tasks', activityTasksQuery],
    enabled: activityTasksEnabled,
    queryFn: () => api.get(`/api/tasks?${activityTasksQuery}`).then((r) => r.data as ApiPendingTask[]),
  });

  const visibleActivityTasks = useMemo(() => {
    const guidedConvIds = new Set(
      activityTasks
        .filter((t) => t.task_type === 'guided_demand' && t.conversation_id)
        .map((t) => t.conversation_id as string)
    );
    return activityTasks.filter(
      (t) =>
        t.task_type !== 'queue_sla_treatment' ||
        !t.conversation_id ||
        !guidedConvIds.has(t.conversation_id)
    );
  }, [activityTasks]);

  const activityTicketsQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '80');
    p.set('status', 'open');
    if (supervisorAttendantId) p.set('assignee_user_id', supervisorAttendantId);
    return p.toString();
  }, [supervisorAttendantId]);

  const activityTicketsEnabled =
    canFetch &&
    activityPanelOpen &&
    canUseSupervisorQueues &&
    (activityPanelTab === 'all' || activityPanelTab === 'tickets');

  const { data: activityTickets = [] } = useQuery({
    queryKey: ['inbox', 'activity-tickets', activityTicketsQuery],
    enabled: activityTicketsEnabled,
    queryFn: () => api.get(`/api/tickets?${activityTicketsQuery}`).then((r) => r.data as ApiOperationalTicket[]),
  });

  const { data: taskSummary } = useQuery({
    queryKey: ['inbox', 'tasks-summary'],
    enabled: canFetch && canStartStaffConversation,
    queryFn: () => api.get('/api/tasks/summary').then((r) => r.data as ApiTaskSummary),
    refetchInterval: 30_000,
  });

  const { data: mentionCandidates = [] } = useQuery({
    queryKey: ['users', 'mention-candidates'],
    enabled: canFetch && noteOpen,
    queryFn: () => api.get<MentionCandidate[]>('/api/users/mention-candidates').then((r) => r.data),
    staleTime: 120_000,
  });

  const noteMentionQuery = useMemo(
    () => (noteOpen ? activeMentionQuery(noteText, noteCaret) : null),
    [noteOpen, noteText, noteCaret]
  );

  const filteredMentionCandidates = useMemo(() => {
    if (noteMentionQuery === null) return [];
    const q = noteMentionQuery.trim().toLowerCase();
    return mentionCandidates
      .filter((c) => c.name && (!q || c.name.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [mentionCandidates, noteMentionQuery]);

  const activityBellCount = useMemo(() => {
    let n = prefTasksInApp ? taskSummary?.open ?? 0 : 0;
    if (canUseSlaAlerts && prefSlaInApp) n += slaFeed.length;
    return Math.min(n, 99);
  }, [taskSummary?.open, prefTasksInApp, canUseSlaAlerts, prefSlaInApp, slaFeed.length]);

  useEffect(() => {
    if (!activityPanelOpen) return;
    if (activityPanelTab === 'sla' && (!canUseSlaAlerts || !prefSlaInApp)) setActivityPanelTab('all');
    else if (activityPanelTab === 'tasks' && !prefTasksInApp) setActivityPanelTab('all');
    else if (activityPanelTab === 'tickets' && !canUseSupervisorQueues) setActivityPanelTab('all');
  }, [activityPanelOpen, activityPanelTab, canUseSlaAlerts, prefSlaInApp, prefTasksInApp, canUseSupervisorQueues]);

  const { data: conversationTagCatalog = [] } = useQuery({
    queryKey: ['conversation-tags', 'catalog'],
    enabled: canFetch,
    queryFn: () => api.get('/api/conversation-tags').then((r) => r.data as ApiConversationTagCatalogRow[]),
    staleTime: 300_000,
  });

  const tagLabelBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of conversationTagCatalog) m.set(row.slug, row.label_pt);
    return m;
  }, [conversationTagCatalog]);

  const tagToneBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of conversationTagCatalog) m.set(row.slug, row.tone || 'neutral');
    return m;
  }, [conversationTagCatalog]);

  const { data: templatesData } = useQuery<TemplatePickerOption[]>({
    queryKey: ['approved-templates-for-inbox'],
    enabled: canFetch && showNewConversation,
    queryFn: () => api.get('/api/templates/list/approved').then((response) => response.data),
  });

  const contactId = detail?.contacts?.id || active?.raw?.contacts?.id || null;

  const { data: contact } = useQuery({
    queryKey: ['inbox', 'contact', contactId],
    enabled: canFetch && Boolean(contactId),
    queryFn: () => api.get(`/api/contacts/${contactId}`).then((r) => r.data as ContactDetail),
  });

  const cadastroHref = useMemo(() => cadastroHrefFromContext(detail, contact), [detail, contact]);

  const { data: previousConversations } = useQuery({
    queryKey: ['inbox', 'contact-conversations', contactId, activeId],
    enabled: canFetch && Boolean(contactId) && Boolean(activeId),
    queryFn: async () => {
      const res = await api.get(`/api/contacts/${contactId}/conversations`, { params: { exclude: activeId, limit: 5 } });
      return res.data as ApiContactConversation[];
    },
  });

  const lastReadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canFetch || !activeId) return;
    if (lastReadRef.current === activeId) return;
    lastReadRef.current = activeId;
    void api.patch(`/api/conversations/${activeId}/read`).catch(() => undefined);
  }, [activeId, canFetch]);

  useEffect(() => {
    setSaveContactHint(null);
    setSaveContactDuplicateId(null);
  }, [activeId]);

  const threadItems = useMemo<ThreadItem[]>(() => {
    const items: ThreadItem[] = [];

    for (const m of detail?.messages || []) {
      const createdAtMs = new Date(m.created_at).getTime();
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

    return items.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }, [detail?.internal_notes, detail?.messages]);

  const chatHeaderAi = useMemo(() => {
    const conv = detail || active?.raw;
    if (!conv) return { sentiment: null as string | null, urgency: null as string | null };
    return conversationListAiBadges(conv);
  }, [detail, active?.raw]);

  const unreadCount = useMemo(() => filteredConversations.filter((c) => Boolean(c.unread)).length, [filteredConversations]);

  const channelCounts = useMemo(() => {
    const map = new Map<Channel, number>();
    for (const ch of channels) map.set(ch, ch === 'whatsapp' ? uiAll.length : 0);
    return map;
  }, [uiAll.length]);

  const onResolve = async () => {
    if (!activeId || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      await api.patch(`/api/conversations/${activeId}`, { status: 'resolved' });
      await Promise.all([refetchConvs(), refetchDetail()]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSendError(msg || 'Não foi possível resolver a conversa.');
    } finally {
      setIsSending(false);
    }
  };

  const onSend = async () => {
    if (!activeId || isSending) return;
    const content = composerText.trim();
    if (!content) return;
    setIsSending(true);
    setSendError(null);
    try {
      await api.post('/api/messages/send', {
        conversation_id: activeId,
        type: 'text',
        content,
        signature: user?.name || undefined,
      });
      setComposerText('');
      await Promise.all([refetchConvs(), refetchDetail()]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSendError(msg || 'Falha ao enviar mensagem.');
    } finally {
      setIsSending(false);
    }
  };

  const toggleFavorite = () => {
    if (!activeId) return;
    const next = { ...favorites };
    if (next[activeId]) delete next[activeId];
    else next[activeId] = true;
    persistFavorites(next);
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setComposerText((t) => `${t}${emoji}`);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = `${el.value.slice(0, start)}${emoji}${el.value.slice(end)}`;
    setComposerText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const uploadFile = async (file: File | Blob, filename: string) => {
    if (!activeId || isUploading) return;
    setUploadError(null);
    setRecordingError(null);
    setIsUploading(true);
    try {
      const form = new FormData();
      form.append('file', file, filename);
      form.append('conversation_id', activeId);
      const caption = composerText.trim();
      if (caption) form.append('caption', caption);
      if (user?.name) form.append('signature', user.name);
      await api.post('/api/messages/upload', form);
      setComposerText('');
      await Promise.all([refetchConvs(), refetchDetail()]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setUploadError(msg || 'Falha ao enviar arquivo.');
    } finally {
      setIsUploading(false);
    }
  };

  const onFileChange = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    await uploadFile(file, file.name);
  };

  const openFilePicker = () => {
    setEmojiOpen(false);
    fileInputRef.current?.click();
  };

  const patchConversationTags = async (next: string[]) => {
    if (!activeId || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      await api.patch(`/api/conversations/${activeId}`, { tags: next });
      await Promise.all([refetchConvs(), refetchDetail()]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSendError(msg || 'Falha ao atualizar tags.');
    } finally {
      setIsSending(false);
    }
  };

  const toggleTagPicker = () => {
    if (!canEditConversationTags) return;
    setTagPickerOpen((o) => !o);
  };

  const addTagBySlug = async (slug: string) => {
    if (!activeId || isSending || !slug) return;
    const current = (detail?.tags || active?.raw.tags || []).filter(Boolean) as string[];
    const next = Array.from(new Set([...current, slug]));
    setTagPickerOpen(false);
    await patchConversationTags(next);
  };

  const removeTagBySlug = async (slug: string) => {
    if (!activeId || isSending || !slug) return;
    const current = (detail?.tags || active?.raw.tags || []).filter(Boolean) as string[];
    const next = current.filter((t) => t !== slug);
    await patchConversationTags(next);
  };

  const markTaskDone = async (taskId: string) => {
    try {
      await api.patch(`/api/tasks/${taskId}`, { status: 'done' });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inbox', 'activity-tasks'] }),
        qc.invalidateQueries({ queryKey: ['inbox', 'tasks-summary'] }),
      ]);
    } catch {
      setSendError('Falha ao concluir tarefa.');
    }
  };

  const decideTask = async (taskId: string, decision: 'approved' | 'rejected', reason?: string) => {
    try {
      const payload = decision === 'rejected' ? { decision, reason } : { decision };
      const { data } = await api.patch(`/api/tasks/${taskId}/decision`, payload);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inbox', 'activity-tasks'] }),
        qc.invalidateQueries({ queryKey: ['inbox', 'tasks-summary'] }),
      ]);
      if (decision === 'approved' && data?.next_action?.type === 'open_financial_entry' && data?.next_action?.url) {
        openAppRouteInNewTab(data.next_action.url as string);
        return;
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSendError(msg || 'Falha ao processar decisão de adiantamento.');
    }
  };

  const openConversationFromActivity = (conversationId: string | null | undefined) => {
    if (!conversationId) return;
    if (isSupervisor) setSupervisorMainTab('conversations');
    setActiveId(conversationId);
    setActivityPanelOpen(false);
  };

  const startRecording = async () => {
    if (isRecording || isUploading) return;
    setRecordingError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setRecordingError('Seu navegador não suporta gravação de áudio.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = candidates.find((t) => (window as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder?.isTypeSupported?.(t));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordChunksRef.current = [];

      recorder.addEventListener('dataavailable', (ev) => {
        if (ev.data && ev.data.size > 0) recordChunksRef.current.push(ev.data);
      });

      recorder.addEventListener('stop', async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
        await uploadFile(blob, `audio.${ext}`);
      });

      recorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSec(0);
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = window.setInterval(() => setRecordingSec((s) => s + 1), 1000);
      recorder.start();
    } catch {
      setRecordingError('Permissão de microfone negada ou indisponível.');
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    try {
      recorderRef.current?.stop();
    } catch {
      // ignore
    } finally {
      recorderRef.current = null;
      setIsRecording(false);
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else void startRecording();
  };

  const assignToMe = async () => {
    if (!activeId || !user?.id || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      await api.post(`/api/conversations/${activeId}/assign`, { attendant_id: user.id });
      await Promise.all([refetchConvs(), refetchDetail()]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSendError(msg || 'Falha ao assumir conversa.');
    } finally {
      setIsSending(false);
    }
  };

  const reopen = async () => {
    if (!activeId || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      await api.patch(`/api/conversations/${activeId}/reopen`);
      await Promise.all([refetchConvs(), refetchDetail()]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSendError(msg || 'Falha ao reabrir conversa.');
    } finally {
      setIsSending(false);
    }
  };

  const submitNote = async () => {
    if (!activeId || isSending) return;
    const content = noteText.trim();
    if (!content) return;
    setIsSending(true);
    setSendError(null);
    try {
      const { data } = await api.post<{
        side_effects?: { mentions?: unknown[]; tasks_created?: unknown[] };
      }>(`/api/conversations/${activeId}/notes`, { content });
      setNoteText('');
      setNoteOpen(false);
      const created = (data?.side_effects?.tasks_created?.length || 0) + (data?.side_effects?.mentions?.length || 0);
      setNoteHint(created > 0 ? `Nota salva. ${created} pendência(s) criada(s).` : 'Nota interna salva.');
      await Promise.all([
        refetchConvs(),
        refetchDetail(),
        qc.invalidateQueries({ queryKey: ['inbox', 'my-open-tasks'] }),
      ]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSendError(msg || 'Falha ao criar nota interna.');
    } finally {
      setIsSending(false);
    }
  };

  const openTransfer = () => {
    setTransferSectorId(detail?.sectors?.id || active?.raw.sectors?.id || '');
    setTransferAttendantId(detail?.attendant?.id || active?.raw.attendant?.id || '');
    setTransferReason('');
    setTransferOpen(true);
  };

  const submitTransfer = async () => {
    if (!activeId || isSending) return;
    const to_sector_id = transferSectorId || undefined;
    const to_attendant_id = transferAttendantId || undefined;
    const reason = transferReason.trim() || undefined;
    if (!to_sector_id && !to_attendant_id) return;

    setIsSending(true);
    setSendError(null);
    try {
      await api.post(`/api/conversations/${activeId}/transfer`, { to_sector_id, to_attendant_id, reason });
      setTransferOpen(false);
      await Promise.all([refetchConvs(), refetchDetail()]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSendError(msg || 'Falha ao transferir conversa.');
    } finally {
      setIsSending(false);
    }
  };

  const setPriority = async (priority: ApiConversationPriority) => {
    if (!activeId || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      await api.patch(`/api/conversations/${activeId}`, { priority });
      setPriorityOpen(false);
      await Promise.all([refetchConvs(), refetchDetail()]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSendError(msg || 'Falha ao atualizar prioridade.');
    } finally {
      setIsSending(false);
    }
  };

  const priorityLabel = useMemo(() => {
    const p = detail?.priority || active?.raw.priority;
    if (!p) return 'Normal';
    if (p === 'urgent') return 'Urgente';
    if (p === 'high') return 'Alta';
    if (p === 'low') return 'Baixa';
    return 'Normal';
  }, [detail?.priority, active?.raw.priority]);

  const currentPriority = useMemo(() => {
    return (detail?.priority || active?.raw.priority || 'normal') as ApiConversationPriority;
  }, [detail?.priority, active?.raw.priority]);

  const priorityUi = useMemo(() => {
    if (currentPriority === 'urgent') {
      return {
        pill: 'bg-destructive/15 text-destructive border border-destructive/25 animate-pulse',
        sla: 'text-destructive',
      };
    }
    if (currentPriority === 'high') {
      return {
        pill: 'bg-warning/15 text-warning border border-warning/25 animate-pulse',
        sla: 'text-warning',
      };
    }
    if (currentPriority === 'low') {
      return {
        pill: 'bg-success/15 text-success border border-success/25',
        sla: 'text-success',
      };
    }
    return {
      pill: 'bg-success/15 text-success border border-success/25',
      sla: 'text-success',
    };
  }, [currentPriority]);

  const slaCountdown = useMemo(() => {
    const merged = (detail || active?.raw) as
      | (ApiConversationDetail & { sla_first_response_at?: string | null })
      | undefined;
    const activeDeadline =
      pickActiveSlaDeadlineForCountdown(merged, nowTick) ??
      merged?.sla_resolution_deadline ??
      null;
    return formatCountdown(activeDeadline, nowTick);
  }, [detail, active?.raw, nowTick]);

  const displayName = active?.name || '—';
  const displayPhone = formatBrazilPhone(active?.phone || '') || active?.phone || '—';
  const clientSince = contact?.created_at ? formatClientSince(contact.created_at) : '—';
  const isFav = Boolean(activeId && favorites[activeId]);
  const currentStatus = (detail?.status || active?.raw.status || 'open') as ApiConversationStatus;

  const waNormalizedForSave = normalizeBrazilPhone(detail?.contacts?.wa_phone || active?.phone || '');
  const canManageContacts =
    roleName === 'admin' || roleName === 'supervisor' || roleName === 'operational';
  const showSaveToContacts =
    canManageContacts &&
    (currentStatus === 'open' || currentStatus === 'pending') &&
    Boolean(activeId) &&
    !contactId &&
    waNormalizedForSave.length >= 12;

  const onSaveConversationContact = async () => {
    if (!activeId || !showSaveToContacts) return;
    setSaveContactBusy(true);
    setSaveContactHint(null);
    setSaveContactDuplicateId(null);
    try {
      const body = buildNewContactBody(
        detail,
        displayName === '—' ? '' : displayName,
        waNormalizedForSave
      );
      const { data: created } = await api.post<{ id: string }>('/api/contacts', body);
      if (created?.id) {
        await api.patch(`/api/conversations/${activeId}`, { contact_id: created.id });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inbox', 'conversation', activeId] }),
        qc.invalidateQueries({ queryKey: ['inbox', 'conversations', convQuery] }),
      ]);
      await Promise.all([refetchDetail(), refetchConvs()]);
      setSaveContactHint('Contato salvo e vinculado a esta conversa.');
    } catch (e: unknown) {
      const ax = e as {
        response?: { status?: number; data?: { error?: string; existing_contact_id?: string | null } };
      };
      if (ax.response?.status === 409) {
        setSaveContactDuplicateId(ax.response.data?.existing_contact_id || null);
        setSaveContactHint(ax.response.data?.error || 'Telefone ja cadastrado.');
      } else {
        setSaveContactHint(ax.response?.data?.error || 'Nao foi possivel salvar o contato.');
      }
    } finally {
      setSaveContactBusy(false);
    }
  };

  const onLinkConversationToExistingContact = async () => {
    if (!activeId || !saveContactDuplicateId) return;
    setSaveContactBusy(true);
    try {
      await api.patch(`/api/conversations/${activeId}`, { contact_id: saveContactDuplicateId });
      setSaveContactDuplicateId(null);
      setSaveContactHint('Conversa vinculada ao contato existente.');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inbox', 'conversation', activeId] }),
        qc.invalidateQueries({ queryKey: ['inbox', 'conversations', convQuery] }),
      ]);
      await Promise.all([refetchDetail(), refetchConvs()]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSaveContactHint(msg || 'Falha ao vincular.');
    } finally {
      setSaveContactBusy(false);
    }
  };

  const startResizeFolderColumn = (e: { preventDefault: () => void; clientX: number }) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = folderColW;
    const onMove = (ev: MouseEvent) => {
      setFolderColW(Math.min(380, Math.max(180, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startResizeListColumn = (e: { preventDefault: () => void; clientX: number }) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = listColW;
    const onMove = (ev: MouseEvent) => {
      setListColW(Math.min(560, Math.max(260, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-inbox-density={inboxDensity}>
      <OperationalContextBar
        channelTypes={['whatsapp', 'instagram', 'email', 'webchat']}
        note="Filtro aplicado à caixa de entrada"
      />
      <div
        className="grid min-h-0 min-w-0 flex-1"
        style={{ gridTemplateColumns: `${folderColW}px 4px ${listColW}px 4px minmax(360px, 1fr)` }}
      >
      {/* Coluna 1 — filtros */}
      <div
        className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface"
      >
        <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
          <h2 className="text-sm font-semibold tracking-tight">Caixa de entrada</h2>
          <div className="flex shrink-0 items-center gap-0.5">
            {canStartStaffConversation ? (
              <button
                type="button"
                onClick={() =>
                  setActivityPanelOpen((was) => {
                    if (!was) setActivityPanelTab('all');
                    return !was;
                  })
                }
                className={cn(
                  'relative rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                  activityPanelOpen && 'bg-surface-hover text-foreground'
                )}
                title="Atividade (SLA · pendências · tickets)"
                aria-expanded={activityPanelOpen}
              >
                <Bell className="h-3.5 w-3.5 shrink-0" />
                {activityBellCount > 0 ? (
                  <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold leading-none text-destructive-foreground">
                    {activityBellCount}
                  </span>
                ) : null}
              </button>
            ) : null}
            <button
              onClick={() => setFilterOpen((v) => !v)}
              className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              title="Filtros"
              data-testid="inbox-filter"
              aria-expanded={filterOpen}
            >
              <Filter className="h-3.5 w-3.5 shrink-0" />
            </button>
          </div>
        </div>

        {filterOpen ? (
          <div
            ref={filterPanelRef}
            className="absolute left-3 right-3 top-[3.75rem] z-30 rounded-xl border border-border bg-surface-elevated p-3 shadow-glow"
          >
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-foreground">Filtros</div>
              <button
                onClick={() => setFilterOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                title="Fechar"
              >
                <X className="h-3.5 w-3.5 shrink-0" />
              </button>
            </div>

            <div className="mt-2 space-y-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, número ou mensagem"
                className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 placeholder:text-muted-foreground"
              />

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as never)}
                  disabled={isSupervisor && supervisorAttendanceGroup !== 'all'}
                  className="w-full rounded-md border border-border bg-background/50 px-2 py-2 inbox-t-control text-foreground outline-none focus:border-primary/50 disabled:opacity-50"
                >
                  <option value="all">Status</option>
                  <option value="open">Abertas</option>
                  <option value="pending">Pendentes</option>
                  <option value="resolved">Resolvidas</option>
                </select>

                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value as never)}
                  className="w-full rounded-md border border-border bg-background/50 px-2 py-2 inbox-t-control text-foreground outline-none focus:border-primary/50"
                >
                  <option value="all">Prioridade</option>
                  <option value="low">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>

              {isSupervisor ? (
                <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-2">
                  <div className="inbox-t-meta font-semibold uppercase tracking-wide text-primary">Supervisão do setor</div>
                  <select
                    value={supervisorAttendantId}
                    onChange={(e) => setSupervisorAttendantId(e.target.value)}
                    className="w-full rounded-md border border-border bg-background/70 px-2 py-2 inbox-t-control text-foreground outline-none focus:border-primary/50"
                  >
                    <option value="">Todos os atendentes</option>
                    {supervisorAttendants.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={supervisorAttendanceGroup}
                    onChange={(e) =>
                      setSupervisorAttendanceGroup(e.target.value as 'all' | 'active' | 'waiting' | 'finished')
                    }
                    className="w-full rounded-md border border-border bg-background/70 px-2 py-2 inbox-t-control text-foreground outline-none focus:border-primary/50"
                  >
                    <option value="all">Atendimentos · todos os status</option>
                    <option value="active">Atendimentos · em andamento</option>
                    <option value="waiting">Atendimentos · aguardando cliente</option>
                    <option value="finished">Atendimentos · finalizados</option>
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={supervisorSlaStage}
                      onChange={(e) =>
                        setSupervisorSlaStage(e.target.value as '' | 'first_response' | 'treatment' | 'resolution')
                      }
                      className="w-full rounded-md border border-border bg-background/70 px-2 py-2 inbox-t-control text-foreground outline-none focus:border-primary/50"
                    >
                      <option value="">SLA · etapa (todas)</option>
                      <option value="first_response">1ª resposta</option>
                      <option value="treatment">Tratamento</option>
                      <option value="resolution">Resolução</option>
                    </select>
                    <select
                      value={supervisorSlaBucket}
                      onChange={(e) =>
                        setSupervisorSlaBucket(e.target.value as '' | 'breached' | 'at_risk' | 'on_track')
                      }
                      disabled={!supervisorSlaStage}
                      className="w-full rounded-md border border-border bg-background/70 px-2 py-2 inbox-t-control text-foreground outline-none focus:border-primary/50 disabled:opacity-40"
                    >
                      <option value="">Situação</option>
                      <option value="breached">Em atraso</option>
                      <option value="at_risk">Risco (&lt; 10 min)</option>
                      <option value="on_track">Dentro do prazo</option>
                    </select>
                  </div>
                  <p className="inbox-t-meta leading-snug text-muted-foreground">
                    Use as abas “Pendências” e “Tickets” para listas consolidadas do setor com o mesmo atendente
                    filtrado.
                  </p>
                </div>
              ) : null}

              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('all');
                    setPriorityFilter('all');
                    setSupervisorAttendantId('');
                    setSupervisorAttendanceGroup('all');
                    setSupervisorSlaStage('');
                    setSupervisorSlaBucket('');
                  }}
                  className="inbox-t-control font-medium text-muted-foreground hover:text-foreground"
                >
                  Limpar
                </button>
                <button
                  onClick={() => setFilterOpen(false)}
                  className="rounded-md bg-primary px-2.5 py-1.5 inbox-t-control font-medium text-primary-foreground hover:bg-primary-glow transition-colors"
                >
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="space-y-0.5 p-2">
          {folders.map((f) => (
            <button
              key={f.key}
              onClick={() => setFolder(f.key)}
              data-testid={`inbox-folder-${f.key}`}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                folder === f.key
                  ? 'bg-surface-hover text-foreground'
                  : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
              )}
            >
              <span>{f.label}</span>
              <span className="font-mono inbox-t-meta text-subtle-foreground">{f.count}</span>
            </button>
          ))}
        </div>

        <div className="px-3 pt-4 pb-2">
          <h3 className="px-1 inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">Canais</h3>
        </div>
        <div className="space-y-0.5 px-2">
          {channels.map((ch) => (
            <button
              key={ch}
              onClick={() => setChannelFilter((v) => (v === ch ? 'all' : ch))}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors',
                channelFilter === ch
                  ? 'bg-surface-hover text-foreground'
                  : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
              )}
            >
              <ChannelBadge channel={ch} showLabel />
              <span className="font-mono inbox-t-meta text-subtle-foreground">{channelCounts.get(ch) ?? 0}</span>
            </button>
          ))}
        </div>

        {features.aiSuggestions ? (
          <div className="mt-auto p-3">
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Sparkles className="h-3 w-3 text-primary" />
                IA Sugestões
              </div>
              <p className="mt-1 inbox-t-control leading-relaxed text-muted-foreground">
                3 conversas podem ser resolvidas com respostas prontas.
              </p>
              <button className="mt-2 inbox-t-control font-medium text-primary hover:underline">Ver sugestões →</button>
            </div>
          </div>
        ) : null}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar coluna de pastas e filtros"
        onMouseDown={startResizeFolderColumn}
        className="relative min-h-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40"
        title="Arraste para ajustar a largura"
      >
        <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" aria-hidden />
      </div>

      {/* Coluna 2 — lista de conversas */}
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface/50">
        <div className="flex min-h-14 flex-col gap-2 border-b border-border px-4 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 pr-1">
              <div className="truncate text-sm font-semibold tracking-tight">
                {!isSupervisor || supervisorMainTab === 'conversations'
                  ? folders.find((f) => f.key === folder)?.label || 'Caixa de entrada'
                  : supervisorMainTab === 'tasks'
                    ? 'Pendências do setor'
                    : 'Tickets do setor'}
              </div>
              <div className="truncate font-mono inbox-t-meta text-muted-foreground">
                {!isSupervisor || supervisorMainTab === 'conversations'
                  ? `${filteredConversations.length} conversas · ${unreadCount} não lidas`
                  : supervisorMainTab === 'tasks'
                    ? `${supervisorTasksPanel.length} pendências`
                    : `${supervisorTicketsPanel.length} tickets`}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {canStartStaffConversation ? (
                <button
                  onClick={() => setShowNewConversation(true)}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 inbox-t-meta font-semibold text-primary-foreground transition-colors hover:bg-primary-glow"
                >
                  <Plus className="h-3 w-3" />
                  <span className="hidden sm:inline">Nova</span>
                </button>
              ) : null}
              <button
                onClick={() => void refetchConvs()}
                data-testid="inbox-refresh"
                className="inline-flex items-center rounded-md border border-border bg-background/60 px-2 py-1 inbox-t-meta font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="hidden sm:inline">Refresh</span>
                <span className="sm:hidden">Atualizar</span>
              </button>
            </div>
          </div>

          {isSupervisor ? (
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { key: 'conversations' as const, label: 'Atendimentos' },
                  { key: 'tasks' as const, label: 'Pendências' },
                  { key: 'tickets' as const, label: 'Tickets' },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setSupervisorMainTab(t.key)}
                  className={cn(
                    'rounded-md px-2 py-1 inbox-t-meta font-medium transition-colors',
                    supervisorMainTab === t.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background/60 text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}

          {isSupervisor && supervisorMainTab === 'tasks' ? (
            <select
              value={supervisorTaskStatus}
              onChange={(e) =>
                setSupervisorTaskStatus(e.target.value as 'all' | 'open' | 'in_progress' | 'done' | 'cancelled')
              }
              className="w-full rounded-md border border-border bg-background/50 px-2 py-1.5 inbox-t-meta text-foreground outline-none focus:border-primary/50"
            >
              <option value="all">Pendências · todos</option>
              <option value="open">{taskStatusLabelPt('open')}</option>
              <option value="in_progress">{taskStatusLabelPt('in_progress')}</option>
              <option value="done">{taskStatusLabelPt('done')}</option>
              <option value="cancelled">{taskStatusLabelPt('cancelled')}</option>
            </select>
          ) : null}

          {isSupervisor && supervisorMainTab === 'tickets' ? (
            <select
              value={supervisorTicketStatus}
              onChange={(e) =>
                setSupervisorTicketStatus(e.target.value as 'all' | 'open' | 'in_progress' | 'overdue' | 'resolved')
              }
              className="w-full rounded-md border border-border bg-background/50 px-2 py-1.5 inbox-t-meta text-foreground outline-none focus:border-primary/50"
            >
              <option value="all">Tickets · todos</option>
              <option value="open">{ticketStatusLabelPt('open')}</option>
              <option value="in_progress">{ticketStatusLabelPt('in_progress')}</option>
              <option value="overdue">{ticketStatusLabelPt('overdue')}</option>
              <option value="resolved">{ticketStatusLabelPt('resolved')}</option>
            </select>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isSupervisor && supervisorMainTab === 'tasks' ? (
            supervisorTasksPanel.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">Nenhuma pendência no filtro atual.</div>
            ) : (
              supervisorTasksPanel.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => {
                    if (task.conversation_id) {
                      setSupervisorMainTab('conversations');
                      setActiveId(task.conversation_id);
                    }
                  }}
                  className="flex w-full flex-col gap-0.5 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-surface-hover/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-foreground">{task.title}</span>
                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 inbox-t-meta text-muted-foreground">
                      {taskStatusLabelPt(task.status)}
                    </span>
                  </div>
                  {task.due_at ? (
                    <span className="font-mono inbox-t-meta text-subtle-foreground">Prazo · {task.due_at}</span>
                  ) : null}
                  {task.conversation_id ? (
                    <span className="inbox-t-meta text-primary">Abrir conversa →</span>
                  ) : (
                    <span className="inbox-t-meta text-muted-foreground">Sem conversa vinculada</span>
                  )}
                </button>
              ))
            )
          ) : isSupervisor && supervisorMainTab === 'tickets' ? (
            supervisorTicketsPanel.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">Nenhum ticket no filtro atual.</div>
            ) : (
              supervisorTicketsPanel.map((tk) => (
                <button
                  key={tk.id}
                  type="button"
                  onClick={() => {
                    if (tk.conversation_id) {
                      setSupervisorMainTab('conversations');
                      setActiveId(tk.conversation_id);
                    }
                  }}
                  className="flex w-full flex-col gap-0.5 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-surface-hover/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-foreground">
                      {tk.ticket_code || tk.id}
                    </span>
                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 inbox-t-meta text-muted-foreground">
                      {ticketStatusLabelPt(tk.status)}
                    </span>
                  </div>
                  {tk.type ? <span className="inbox-t-meta text-muted-foreground">Tipo · {tk.type}</span> : null}
                  {tk.conversation_id ? (
                    <span className="inbox-t-meta text-primary">Abrir conversa →</span>
                  ) : null}
                </button>
              ))
            )
          ) : isConvsLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
          ) : isConvsError ? (
            <div className="p-6 text-sm text-muted-foreground">
              Falha ao carregar conversas.
              <button onClick={() => void refetchConvs()} className="ml-2 text-primary hover:underline">
                Tentar novamente
              </button>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Nenhuma conversa.</div>
          ) : (
            filteredConversations.map((c) => {
              const pri = priorityPill(c.raw.priority);
              const listAi = conversationListAiBadges(c.raw);
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  data-testid={`inbox-conversation-${c.id}`}
                  className={cn(
                    'group relative flex w-full gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors',
                    activeId === c.id ? 'bg-surface-hover' : 'hover:bg-surface-hover/60'
                  )}
                >
                  {activeId === c.id ? <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-primary" /> : null}

                  <div className="relative shrink-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-muted to-surface-elevated text-xs font-semibold text-foreground">
                      {initials(c.name)}
                    </div>
                    <StatusDot status={c.status} className="absolute -bottom-0.5 -right-0.5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn('truncate text-sm font-medium', c.unread ? 'text-foreground' : 'text-foreground/90')}>
                        {c.name}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 font-mono inbox-t-meta',
                          c.unread ? 'text-primary' : 'text-subtle-foreground'
                        )}
                      >
                        {c.time}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <ChannelBadge channel={c.channel} />
                      {features.aiAnalysisBadges && aiRuntime.sentiment && listAi.sentiment ? (
                        <SentimentBadge sentiment={listAi.sentiment} />
                      ) : null}
                      {features.aiAnalysisBadges && aiRuntime.urgency && listAi.urgency ? (
                        <UrgencyDot urgency={listAi.urgency} />
                      ) : null}
                      <p className={cn('min-w-0 flex-1 truncate text-xs', c.unread ? 'text-foreground/80' : 'text-muted-foreground')}>
                        {c.preview}
                      </p>
                    </div>
                    {isSupervisor ? (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
                        <span className="rounded border border-border/60 bg-background/50 px-1.5 py-0.5 font-medium text-foreground/80">
                          {conversationAttendanceLabelPt(c.raw.status)}
                        </span>
                        {c.raw.attendant?.name ? (
                          <span className="truncate text-subtle-foreground">· {c.raw.attendant.name}</span>
                        ) : (
                          <span className="text-subtle-foreground">· sem atendente</span>
                        )}
                      </div>
                    ) : null}
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className={cn('rounded border px-1.5 py-0.5 inbox-t-meta font-medium', pri.className)}>
                        {pri.label}
                      </span>
                      {c.tag ? (
                        <span className={cn('rounded border px-1.5 py-0.5 inbox-t-meta font-medium', toneClass[c.tag.tone])}>
                          {c.tag.label}
                        </span>
                      ) : null}
                      {c.unread ? (
                        <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 font-mono inbox-t-meta font-semibold text-primary-foreground">
                          {c.unread}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar lista de conversas"
        onMouseDown={startResizeListColumn}
        className="relative min-h-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40"
        title="Arraste para ajustar a largura"
      >
        <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" aria-hidden />
      </div>

      {/* Coluna 3 — chat */}
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-channel-whatsapp to-success text-xs font-semibold text-foreground">
                {initials(displayName)}
              </div>
              <StatusDot status={active?.status || 'offline'} pulse className="absolute -bottom-0.5 -right-0.5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold tracking-tight">{displayName}</h3>
                {contactId ? <ProfileTypeBadge type={contact?.profile_type} /> : null}
                <ChannelBadge channel={active?.channel || 'whatsapp'} />
                {features.aiAnalysisBadges && aiRuntime.sentiment && chatHeaderAi.sentiment ? (
                  <SentimentBadge sentiment={chatHeaderAi.sentiment} className="h-4 w-4 inbox-t-control" />
                ) : null}
                {features.aiAnalysisBadges && aiRuntime.urgency && chatHeaderAi.urgency ? (
                  <span className="inline-flex items-center" title="Urgência (IA)">
                    <UrgencyDot urgency={chatHeaderAi.urgency} />
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 inbox-t-control text-muted-foreground">
                <span>{displayPhone || '—'}</span>
                <span className="text-subtle-foreground">·</span>
                <span>Cliente desde {clientSince}</span>
              </div>
            </div>
          </div>
          <div className="relative flex items-center gap-1">
            <button
              disabled
              className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
              title="Em breve"
            >
              <Phone className="h-4 w-4" />
            </button>
            <button
              disabled
              className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
              title="Em breve"
            >
              <Video className="h-4 w-4" />
            </button>
            <button
              onClick={toggleFavorite}
              className={cn(
                'rounded-md p-1.5 hover:bg-surface-hover transition-colors',
                isFav ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              title={isFav ? 'Remover favorito' : 'Favoritar'}
              aria-pressed={isFav}
            >
              <Star className="h-4 w-4" fill={isFav ? 'currentColor' : 'none'} />
            </button>
            <div className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              onClick={() => setCopilotOpen((v) => !v)}
              className={cn(
                'rounded-md p-1.5 hover:bg-surface-hover transition-colors',
                copilotOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              title="Copiloto interno"
              aria-expanded={copilotOpen}
            >
              <Sparkles className="h-4 w-4" />
            </button>
            <button
              onClick={() => void onResolve()}
              disabled={!activeId || isSending || isUploading || isRecording}
              data-testid="inbox-resolve"
              className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium hover:bg-surface-hover transition-colors disabled:opacity-60"
            >
              Resolver
            </button>
            <button
              onClick={() => setMoreOpen((v) => !v)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              title="Ações"
              aria-expanded={moreOpen}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {moreOpen ? (
              <div
                ref={moreMenuRef}
                className="absolute right-0 top-11 z-40 w-56 rounded-xl border border-border bg-surface-elevated p-1 shadow-glow"
              >
                <button
                  onClick={() => {
                    setMoreOpen(false);
                    void assignToMe();
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover"
                >
                  <span>Assumir conversa</span>
                  <span className="inbox-t-meta text-muted-foreground">/assign</span>
                </button>

                {currentStatus === 'resolved' ? (
                  <button
                    onClick={() => {
                      setMoreOpen(false);
                      void reopen();
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover"
                  >
                    <span>Reabrir</span>
                    <span className="inbox-t-meta text-muted-foreground">/reopen</span>
                  </button>
                ) : null}

                {canEditConversationTags ? (
                  <button
                    onClick={() => {
                      setMoreOpen(false);
                      setContextDrawerOpen(true);
                      setTagPickerOpen(true);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover"
                  >
                    <span>Adicionar tag</span>
                    <span className="inbox-t-meta text-muted-foreground">/patch</span>
                  </button>
                ) : null}

                <button
                  onClick={() => {
                    setMoreOpen(false);
                    setNoteOpen(true);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover"
                >
                  <span>Nota interna</span>
                  <span className="inbox-t-meta text-muted-foreground">/notes</span>
                </button>

                <button
                  onClick={() => {
                    setMoreOpen(false);
                    openTransfer();
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover"
                >
                  <span>Transferir</span>
                  <span className="inbox-t-meta text-muted-foreground">/transfer</span>
                </button>

                <button
                  onClick={() => {
                    setMoreOpen(false);
                    setContextDrawerOpen(true);
                  }}
                  disabled={!activeId}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover disabled:opacity-50"
                >
                  <span>Contexto de atendimento</span>
                  <span className="inbox-t-meta text-muted-foreground">panel</span>
                </button>

                <button
                  onClick={() => {
                    setMoreOpen(false);
                    setHistoryOpen(true);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover"
                >
                  <span>Histórico</span>
                  <span className="inbox-t-meta text-muted-foreground">thread</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {activeId ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border bg-muted/15 px-4 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {detail?.context_pharmacy?.trade_name ? (
              <span
                className="max-w-[12rem] truncate rounded-md border border-border bg-background/50 px-2 py-0.5 inbox-t-meta text-foreground"
                title={detail.context_pharmacy.trade_name}
              >
                Farmácia · {detail.context_pharmacy.trade_name}
              </span>
            ) : null}
            {detail?.context_driver?.name ? (
              <span className="max-w-[11rem] truncate rounded-md border border-border bg-background/50 px-2 py-0.5 inbox-t-meta text-foreground">
                Entregador · {detail.context_driver.name}
              </span>
            ) : null}
            {detail?.context_leader?.name ? (
              <span className="max-w-[11rem] truncate rounded-md border border-border bg-background/50 px-2 py-0.5 inbox-t-meta text-foreground">
                Líder · {detail.context_leader.name}
              </span>
            ) : null}
            {detail?.sectors?.name || active?.raw.sectors?.name ? (
              <span
                className="max-w-[8rem] truncate rounded-md border border-border bg-background/50 px-2 py-0.5 inbox-t-meta text-muted-foreground sm:max-w-[10rem]"
                title={detail?.sectors?.name || active?.raw.sectors?.name || ''}
              >
                Setor · {detail?.sectors?.name || active?.raw.sectors?.name}
              </span>
            ) : null}
          </div>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background/50 px-2 py-0.5 font-mono inbox-t-meta',
              priorityUi.sla
            )}
            title={`SLA · ${slaCountdown}`}
          >
            <Clock className="h-3 w-3 shrink-0" />
            SLA · {slaCountdown}
          </span>
          <button
            type="button"
            onClick={() => setContextDrawerOpen(true)}
            className="shrink-0 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 inbox-t-meta font-medium text-primary hover:bg-primary/15"
          >
            Contexto completo
          </button>
        </div>
        ) : null}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="flex items-center gap-3 inbox-t-meta font-mono text-subtle-foreground">
              <div className="h-px flex-1 bg-border" />
              <span>HOJE · {format(new Date(), 'dd MMM', { locale: ptBR }).toUpperCase().replace('.', '')}</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {isDetailLoading ? (
              <div className="text-sm text-muted-foreground">Carregando conversa…</div>
            ) : isDetailError ? (
              <div className="text-sm text-muted-foreground">
                Falha ao carregar a conversa.
                <button onClick={() => void refetchDetail()} className="ml-2 text-primary hover:underline">
                  Tentar novamente
                </button>
              </div>
            ) : threadItems.length === 0 ? (
              <div className="text-sm text-muted-foreground">Sem mensagens.</div>
            ) : (
              threadItems.map((m) =>
                m.kind === 'note' ? (
                  <div key={m.id} className="flex justify-center animate-fade-in">
                    <div className="max-w-[75%] rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-foreground/80">Nota interna · {m.author}</span>
                        <span className="font-mono inbox-t-meta text-subtle-foreground">{m.time}</span>
                      </div>
                      <div className="mt-1 whitespace-pre-line">{m.text}</div>
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className={cn('flex animate-fade-in', m.from === 'me' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line',
                        m.from === 'me'
                          ? 'bg-primary text-primary-foreground rounded-br-sm'
                          : 'bg-surface-elevated border border-border rounded-bl-sm'
                      )}
                    >
                      <p>{m.text}</p>
                      <div
                        className={cn(
                          'mt-1 flex items-center gap-1 inbox-t-meta',
                          m.from === 'me' ? 'text-primary-foreground/70 justify-end' : 'text-muted-foreground'
                        )}
                      >
                        <span className="font-mono">{m.time}</span>
                        {m.from === 'me' ? <CheckCheck className="h-3 w-3" /> : null}
                      </div>
                    </div>
                  </div>
                )
              )
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-border bg-surface/40 p-4">
          <div className="mx-auto max-w-3xl">
            {features.aiSuggestReply || features.aiSuggestions ? (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {features.aiSuggestReply && aiRuntime.suggest_reply ? (
                  <SuggestReplyButton
                    conversationId={activeId || null}
                    disabled={!activeId || isSending || isUploading || isRecording}
                    onInsert={(text) =>
                      setComposerText((prev) => {
                        const t = text.trim();
                        if (!t) return prev;
                        if (!prev.trim()) return t;
                        return `${prev.trimEnd()}\n\n${t}`;
                      })
                    }
                  />
                ) : features.aiSuggestions ? (
                  <button
                    type="button"
                    disabled
                    className="flex cursor-not-allowed items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 inbox-t-meta font-medium text-muted-foreground opacity-60"
                  >
                    <Sparkles className="h-3 w-3 text-primary" />
                    Sugerir resposta
                  </button>
                ) : null}
                {features.aiSuggestions ? (
                  <button
                    type="button"
                    disabled
                    className="rounded-md border border-border bg-surface px-2 py-1 inbox-t-meta font-medium text-muted-foreground opacity-60"
                  >
                    Respostas prontas
                  </button>
                ) : null}
              </div>
            ) : null}
            {sendError ? <div className="mb-2 text-xs text-destructive">{sendError}</div> : null}
            {uploadError ? <div className="mb-2 text-xs text-destructive">{uploadError}</div> : null}
            {recordingError ? <div className="mb-2 text-xs text-destructive">{recordingError}</div> : null}
            <div className="rounded-xl border border-border bg-surface-elevated focus-within:border-primary/50 focus-within:ring-glow transition-all">
              <input ref={fileInputRef} type="file" className="hidden" onChange={onFileChange} />
              {isRecording ? (
                <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs">
                  <div className="flex items-center gap-2 text-destructive">
                    <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                    <span className="font-medium">Gravando…</span>
                    <span className="font-mono text-muted-foreground">
                      {String(Math.floor(recordingSec / 60)).padStart(2, '0')}:{String(recordingSec % 60).padStart(2, '0')}
                    </span>
                  </div>
                  <button
                    onClick={stopRecording}
                    className="rounded-md border border-border bg-background/60 px-2 py-1 inbox-t-meta font-medium text-muted-foreground hover:text-foreground"
                  >
                    Parar
                  </button>
                </div>
              ) : null}
              <textarea
                rows={2}
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                placeholder="Escreva uma mensagem..."
                data-testid="inbox-composer"
                ref={textareaRef}
                className="block w-full resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <div className="flex items-center justify-between border-t border-border px-3 py-2">
                <div className="relative flex items-center gap-0.5">
                  <button
                    onClick={openFilePicker}
                    disabled={!activeId || isUploading || isRecording}
                    className="rounded p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
                    title="Anexar"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={toggleRecording}
                    disabled={!activeId || isUploading}
                    className={cn(
                      'rounded p-1.5 hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:pointer-events-none',
                      isRecording ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'
                    )}
                    title={isRecording ? 'Parar gravação' : 'Gravar áudio'}
                  >
                    <Mic className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setEmojiOpen((v) => !v)}
                    disabled={!activeId || isUploading || isRecording}
                    className="rounded p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
                    title="Emoji"
                  >
                    <Smile className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (!canEditConversationTags) return;
                      setContextDrawerOpen(true);
                      setTagPickerOpen((o) => !o);
                    }}
                    disabled={!activeId || isUploading || isRecording || !canEditConversationTags}
                    className="rounded p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
                    title={canEditConversationTags ? 'Tags' : 'Apenas administrador ou supervisor pode alterar tags'}
                  >
                    <Tag className="h-3.5 w-3.5" />
                  </button>

                  {emojiOpen ? (
                    <div
                      ref={emojiPanelRef}
                      className="absolute left-0 bottom-10 z-40 grid w-44 grid-cols-7 gap-1 rounded-xl border border-border bg-surface-elevated p-2 shadow-glow"
                    >
                      {['👍', '😊', '🙏', '😅', '🎉', '❤️', '😮', '😢', '✅', '🔥', '👏', '💬', '🚚', '📦'].map((em) => (
                        <button
                          key={em}
                          onClick={() => {
                            insertEmoji(em);
                            setEmojiOpen(false);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-hover text-base"
                          title={em}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  onClick={() => void onSend()}
                  disabled={!activeId || isSending || isUploading || isRecording || composerText.trim().length === 0}
                  data-testid="inbox-send"
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors shadow-glow disabled:opacity-60"
                >
                  Enviar
                  <Send className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      </div>

      {contextDrawerOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[45] cursor-default border-0 bg-black/45 p-0"
            aria-label="Fechar painel de contexto"
            onClick={() => setContextDrawerOpen(false)}
          />
          <aside
            className="fixed inset-y-0 right-0 z-[50] flex max-h-[100dvh] w-full max-w-md flex-col border-l border-border bg-surface shadow-glow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inbox-context-drawer-title"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <h3 id="inbox-context-drawer-title" className="text-sm font-semibold tracking-tight">
                Contexto de atendimento
              </h3>
              <button
                type="button"
                onClick={() => setContextDrawerOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col items-center border-b border-border px-4 py-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-channel-whatsapp to-success text-base font-semibold">
            {initials(displayName)}
          </div>
          <div className="mt-3 flex flex-col items-center gap-1.5">
            <span className="text-sm font-semibold">{displayName}</span>
            {contactId ? <ProfileTypeBadge type={contact?.profile_type} /> : null}
          </div>
          <div className="mt-0.5 inbox-t-control text-muted-foreground">—</div>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button
              onClick={() => {
                if (cadastroHref) {
                  openAppRouteInNewTab(cadastroHref);
                  return;
                }
                setProfileOpen(true);
              }}
              disabled={!cadastroHref && !contactId}
              className="rounded-md border border-border bg-background/60 px-2.5 py-1 text-xs font-medium hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:pointer-events-none"
              title={cadastroHref ? 'Abrir ficha de cadastro (nova aba)' : 'Ver perfil do contato'}
            >
              Perfil
            </button>
            <button
              onClick={() => setHistoryOpen(true)}
              disabled={!activeId}
              className="rounded-md border border-border bg-background/60 px-2.5 py-1 text-xs font-medium hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:pointer-events-none"
              title="Ver histórico"
            >
              Histórico
            </button>
            {showSaveToContacts ? (
              <button
                type="button"
                onClick={() => void onSaveConversationContact()}
                disabled={saveContactBusy || isDetailLoading}
                className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/15 transition-colors disabled:opacity-50"
                title="Criar registro em Contatos e vincular a esta conversa"
              >
                {saveContactBusy ? 'Salvando…' : 'Salvar nos contatos'}
              </button>
            ) : null}
          </div>
          {saveContactHint ? (
            <p className="mt-2 max-w-[14rem] text-center inbox-t-control text-muted-foreground">{saveContactHint}</p>
          ) : null}
          {saveContactDuplicateId ? (
            <div className="mt-2 flex flex-col items-center gap-1.5 inbox-t-control">
              <button
                type="button"
                onClick={() => void onLinkConversationToExistingContact()}
                disabled={saveContactBusy}
                className="text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
              >
                Vincular conversa ao contato existente
              </button>
              <ExternalAppLink href="/contacts" className="text-muted-foreground underline-offset-2 hover:underline">
                Ir para Contatos
              </ExternalAppLink>
            </div>
          ) : null}
        </div>

        <div className="border-b border-border px-4 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground mb-3">Atribuição</h4>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Agente</span>
              <span className="font-medium">{detail?.attendant?.name || 'Sem dono'}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Equipe</span>
              <span className="font-medium">{detail?.sectors?.name || active?.raw.sectors?.name || '—'}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Prioridade</span>
              <div className="relative">
                <button
                  onClick={() => setPriorityOpen((v) => !v)}
                  disabled={!activeId || isSending}
                  className={cn(
                    'rounded px-1.5 py-0.5 inbox-t-meta font-medium transition-colors hover:bg-surface-hover disabled:opacity-60',
                    priorityUi.pill
                  )}
                  title="Definir prioridade"
                  aria-expanded={priorityOpen}
                >
                  {priorityLabel}
                </button>

                {priorityOpen ? (
                  <div
                    ref={priorityMenuRef}
                    className="absolute right-0 top-7 z-[60] w-36 rounded-xl border border-border bg-surface-elevated p-1 shadow-glow"
                  >
                    {[
                      { key: 'low' as const, label: 'Baixa' },
                      { key: 'normal' as const, label: 'Normal' },
                      { key: 'high' as const, label: 'Alta' },
                      { key: 'urgent' as const, label: 'Urgente' },
                    ].map((p) => (
                      <button
                        key={p.key}
                        onClick={() => void setPriority(p.key)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-surface-hover',
                          currentPriority === p.key ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        <span>{p.label}</span>
                        {currentPriority === p.key ? <span className="font-mono inbox-t-meta text-primary">✓</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />SLA
              </span>
              <span className={cn('font-mono', priorityUi.sla)}>{slaCountdown}</span>
            </div>
          </div>
        </div>

        <div className="border-b border-border px-4 py-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle-foreground">SLAs por etapa</h4>
          <p className="mb-3 inbox-t-control leading-relaxed text-muted-foreground">
            Cada etapa aparece à medida que o atendimento avança (1ª resposta → tratamento → resolução).
          </p>
          <InboxAttendanceSlaStages detail={detail} nowMs={nowTick} />
        </div>

        {features.ticketingPanel ? (
          <InboxTicketingSidecar
            conversationId={activeId || null}
            detail={detail}
            aiAccordionFlags={features.aiAnalysisBadges ? aiRuntime : undefined}
          />
        ) : null}

        <div className="border-b border-border px-4 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground mb-3">Tags</h4>
          <div ref={tagPickerRef} className="relative flex flex-wrap items-center gap-1.5">
            {(detail?.tags || active?.raw.tags || []).map((t) => {
              const label = tagLabelBySlug.get(t) || t;
              return (
                <span
                  key={t}
                  className={cn(
                    'inline-flex max-w-full items-center gap-1 rounded border px-2 py-0.5 inbox-t-meta',
                    catalogToneClass[tagToneBySlug.get(t) || 'neutral'] || catalogToneClass.neutral
                  )}
                >
                  <span className="truncate">{label}</span>
                  {canEditConversationTags ? (
                    <button
                      type="button"
                      onClick={() => void removeTagBySlug(t)}
                      disabled={!activeId || isSending || isUploading || isRecording}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
                      title="Remover tag"
                      aria-label={`Remover tag ${label}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  ) : null}
                </span>
              );
            })}
            {canEditConversationTags ? (
              <>
                <button
                  type="button"
                  onClick={() => void toggleTagPicker()}
                  disabled={!activeId || isSending || isUploading || isRecording}
                  className="rounded border border-dashed border-border px-2 py-0.5 inbox-t-meta text-subtle-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
                  title="Adicionar tag"
                >
                  + adicionar
                </button>
                {tagPickerOpen ? (
                  <div className="absolute left-0 top-full z-[60] mt-1 max-h-52 w-[min(100%,18rem)] overflow-y-auto rounded-xl border border-border bg-surface-elevated p-1 shadow-glow">
                    {conversationTagCatalog.filter(
                      (row) => !(detail?.tags || active?.raw.tags || []).includes(row.slug)
                    ).length === 0 ? (
                      <p className="px-2 py-2 inbox-t-meta text-muted-foreground">Todas as tags do catálogo já foram aplicadas.</p>
                    ) : (
                      conversationTagCatalog
                        .filter((row) => !(detail?.tags || active?.raw.tags || []).includes(row.slug))
                        .map((row) => (
                          <button
                            key={row.slug}
                            type="button"
                            onClick={() => void addTagBySlug(row.slug)}
                            disabled={!activeId || isSending}
                            className="flex w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-surface-hover disabled:opacity-50"
                          >
                            {row.label_pt}
                          </button>
                        ))
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="px-4 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground mb-3">Conversas anteriores</h4>
          <div className="space-y-2">
            {previousConversations && previousConversations.length > 0 ? (
              previousConversations.map((h) => {
                const topic = (h.summary || h.close_reason || 'Conversa').trim();
                const dateIso = h.resolved_at || h.last_message_at || h.opened_at;
                const dateLabel = dateIso ? format(new Date(dateIso), 'dd MMM', { locale: ptBR }) : '—';
                return (
                  <div key={h.id} className="rounded-md border border-border bg-background/40 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">{topic}</span>
                      <span className="shrink-0 font-mono inbox-t-meta text-subtle-foreground">{dateLabel}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 inbox-t-meta text-success">
                      <CheckCheck className="h-2.5 w-2.5" />
                      {h.status === 'closed' ? 'Fechado' : 'Resolvido'}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-muted-foreground">Nenhuma conversa anterior.</div>
            )}
          </div>
        </div>
            </div>
          </aside>
        </>
      ) : null}

      {activityPanelOpen && canStartStaffConversation ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[45] cursor-default border-0 bg-black/45 p-0"
            aria-label="Fechar painel de atividade"
            onClick={() => setActivityPanelOpen(false)}
          />
          <aside
            className="fixed inset-y-0 right-0 z-[52] flex max-h-[100dvh] w-full max-w-md flex-col border-l border-border bg-surface shadow-glow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inbox-activity-title"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <h3 id="inbox-activity-title" className="text-sm font-semibold tracking-tight">
                Atividade
              </h3>
              <button
                type="button"
                onClick={() => setActivityPanelOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-2">
              <button
                type="button"
                onClick={() => setActivityPanelTab('all')}
                className={cn(
                  'whitespace-nowrap rounded-md border px-2.5 py-1.5 inbox-t-control font-medium transition-colors',
                  activityPanelTab === 'all'
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border bg-background/50 text-muted-foreground hover:text-foreground'
                )}
              >
                Tudo
              </button>
              {canUseSlaAlerts && prefSlaInApp ? (
                <button
                  type="button"
                  onClick={() => setActivityPanelTab('sla')}
                  className={cn(
                    'whitespace-nowrap rounded-md border px-2.5 py-1.5 inbox-t-control font-medium transition-colors',
                    activityPanelTab === 'sla'
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border bg-background/50 text-muted-foreground hover:text-foreground'
                  )}
                >
                  SLA
                  {slaFeed.length > 0 ? (
                    <span className="ml-1 font-mono inbox-t-meta">({slaFeed.length})</span>
                  ) : null}
                </button>
              ) : null}
              {prefTasksInApp ? (
                <button
                  type="button"
                  onClick={() => setActivityPanelTab('tasks')}
                  className={cn(
                    'whitespace-nowrap rounded-md border px-2.5 py-1.5 inbox-t-control font-medium transition-colors',
                    activityPanelTab === 'tasks'
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border bg-background/50 text-muted-foreground hover:text-foreground'
                  )}
                >
                  Pendências
                  {visibleActivityTasks.length > 0 ? (
                    <span className="ml-1 font-mono inbox-t-meta">({visibleActivityTasks.length})</span>
                  ) : null}
                </button>
              ) : null}
              {canUseSupervisorQueues ? (
                <button
                  type="button"
                  onClick={() => setActivityPanelTab('tickets')}
                  className={cn(
                    'whitespace-nowrap rounded-md border px-2.5 py-1.5 inbox-t-control font-medium transition-colors',
                    activityPanelTab === 'tickets'
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border bg-background/50 text-muted-foreground hover:text-foreground'
                  )}
                >
                  Tickets
                  {activityTickets.length > 0 ? (
                    <span className="ml-1 font-mono inbox-t-meta">({activityTickets.length})</span>
                  ) : null}
                </button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3">
              <p className="inbox-t-control leading-relaxed text-muted-foreground">
                Conteúdo conforme seu perfil
                {canUseSlaAlerts ? ' (gestor/admin: SLA do setor ou workspace)' : ''}.{' '}
                <ExternalAppLink href="/settings?section=notifications" className="text-primary hover:underline">
                  Preferências de notificação
                </ExternalAppLink>
              </p>
              {activityPanelTab === 'all' ? (
                <div className="flex flex-wrap gap-2 inbox-t-meta">
                  <span className="rounded border border-border bg-background/60 px-2 py-0.5">Abertas: {taskSummary?.open || 0}</span>
                  <span className="rounded border border-border bg-background/60 px-2 py-0.5">
                    Em andamento: {taskSummary?.in_progress || 0}
                  </span>
                  <span className="rounded border border-border bg-background/60 px-2 py-0.5">Minhas: {taskSummary?.mine_open || 0}</span>
                  <span className="rounded border border-border bg-background/60 px-2 py-0.5">Vencidas: {taskSummary?.overdue || 0}</span>
                </div>
              ) : null}

              {(activityPanelTab === 'all' || activityPanelTab === 'sla') && canUseSlaAlerts && prefSlaInApp ? (
                <section>
                  <h4 className="inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">
                    {activityPanelTab === 'all' ? 'SLA recente' : 'Alertas de SLA'}
                  </h4>
                  <div className="mt-2 space-y-2">
                    {slaFeed.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum alerta recente.</p>
                    ) : (
                      slaFeed.slice(0, activityPanelTab === 'all' ? 8 : 100).map((ev) => {
                        const cn = ev.conversations;
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => openConversationFromActivity(cn?.id)}
                            className="w-full rounded-lg border border-border bg-background/40 p-3 text-left text-xs transition-colors hover:bg-surface-hover"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-semibold text-foreground">{slaEventTypeLabelPt(ev.event_type)}</span>
                              <span className="shrink-0 font-mono inbox-t-meta text-muted-foreground">
                                {format(new Date(ev.created_at), 'dd/MM HH:mm', { locale: ptBR })}
                              </span>
                            </div>
                            <div className="mt-1 inbox-t-control text-muted-foreground">
                              {(cn?.contacts?.display_name || 'Contato').trim()} · {cn?.sectors?.name || 'Setor'}
                            </div>
                            {ev.severity === 'critical' ? (
                              <span className="mt-1.5 inline-block rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 inbox-t-meta text-destructive">
                                Crítico
                              </span>
                            ) : null}
                            {ev.notified_supervisor ? (
                              <span className="mt-1.5 inline-block rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 inbox-t-meta text-amber-800 dark:text-amber-200">
                                Escalado para supervisão
                              </span>
                            ) : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                </section>
              ) : null}

              {(activityPanelTab === 'all' || activityPanelTab === 'tasks') && prefTasksInApp ? (
                <section>
                  <h4 className="inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">
                    {activityPanelTab === 'all' ? 'Pendências abertas' : 'Tarefas'}
                  </h4>
                  <div className="mt-2 space-y-2">
                    {visibleActivityTasks.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sem pendências abertas no filtro atual.</p>
                    ) : (
                      visibleActivityTasks.slice(0, activityPanelTab === 'all' ? 12 : 200).map((task) => (
                        <div key={task.id} className="rounded-lg border border-border bg-background/40 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">{task.title}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{task.description || 'Sem descrição'}</p>
                              <p className="mt-1 inbox-t-control text-subtle-foreground">
                                {task.contact?.display_name || task.driver?.name || task.contact?.wa_phone || 'Contato não informado'}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              {task.conversation_id ? (
                                <button
                                  type="button"
                                  onClick={() => openConversationFromActivity(task.conversation_id)}
                                  className="rounded border border-border px-2 py-1 inbox-t-meta text-muted-foreground hover:text-foreground"
                                >
                                  Abrir conversa
                                </button>
                              ) : null}
                              {task.task_type === 'financial_advance_request' || task.task_type === 'driver_termination_request' ? (
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const reason = window.prompt('Informe o motivo da reprovação:');
                                      if (!reason || !reason.trim()) return;
                                      void decideTask(task.id, 'rejected', reason.trim());
                                    }}
                                    className="rounded border border-destructive/30 px-2 py-1 inbox-t-meta font-medium text-destructive hover:bg-destructive/10"
                                  >
                                    Reprovar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void decideTask(task.id, 'approved')}
                                    className="rounded bg-primary px-2 py-1 inbox-t-meta font-medium text-primary-foreground hover:bg-primary-glow"
                                  >
                                    {task.task_type === 'driver_termination_request' ? 'Aprovar desligamento' : 'Aprovar'}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void markTaskDone(task.id)}
                                  className="rounded bg-primary px-2 py-1 inbox-t-meta font-medium text-primary-foreground hover:bg-primary-glow"
                                >
                                  Concluir
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              ) : null}

              {(activityPanelTab === 'all' || activityPanelTab === 'tickets') && canUseSupervisorQueues ? (
                <section>
                  <h4 className="inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">
                    {activityPanelTab === 'all' ? 'Tickets operacionais' : 'Tickets'}
                  </h4>
                  <div className="mt-2 space-y-2">
                    {activityTickets.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum ticket aberto no filtro atual.</p>
                    ) : (
                      activityTickets.slice(0, activityPanelTab === 'all' ? 10 : 200).map((tk) => (
                        <button
                          key={tk.id}
                          type="button"
                          onClick={() => openConversationFromActivity(tk.conversation_id)}
                          className="flex w-full flex-col gap-0.5 rounded-lg border border-border bg-background/40 p-3 text-left transition-colors hover:bg-surface-hover"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-foreground">{tk.ticket_code || tk.id}</span>
                            <span className="shrink-0 rounded border border-border px-1.5 py-0.5 inbox-t-meta text-muted-foreground">
                              {ticketStatusLabelPt(tk.status)}
                            </span>
                          </div>
                          {tk.type ? <span className="inbox-t-meta text-muted-foreground">Tipo · {tk.type}</span> : null}
                          {tk.conversation_id ? (
                            <span className="inbox-t-meta text-primary">Abrir conversa →</span>
                          ) : (
                            <span className="inbox-t-meta text-muted-foreground">Sem conversa vinculada</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </section>
              ) : null}

              {!prefSlaInApp && !prefTasksInApp ? (
                <p className="text-xs text-muted-foreground">
                  Você desativou alertas na aplicação. Reative em{' '}
                  <ExternalAppLink href="/settings?section=notifications" className="text-primary hover:underline">
                    Configurações → Notificações
                  </ExternalAppLink>
                  .
                </p>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}

      <ContactProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        contactId={contactId}
        fallbackPhone={active?.phone}
        fallbackName={displayName === '—' ? undefined : displayName}
      />

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-4 shadow-glow">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold tracking-tight">Histórico da conversa</div>
              <button
                onClick={() => setHistoryOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 max-h-[70vh] overflow-y-auto space-y-4">
              <div>
                <div className="inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">
                  Atribuições / Transferências
                </div>
                {detail?.conversation_assignments?.length ? (
                  <div className="mt-2 space-y-2">
                    {detail.conversation_assignments.slice(0, 30).map((h) => (
                      <div key={h.id} className="rounded-lg border border-border bg-background/40 p-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-foreground">
                            {(h.from_attendant?.name || '—') + ' → ' + (h.to_attendant?.name || '—')}
                          </span>
                          <span className="font-mono inbox-t-meta text-subtle-foreground">
                            {format(new Date(h.created_at), 'dd/MM HH:mm', { locale: ptBR })}
                          </span>
                        </div>
                        <div className="mt-1 inbox-t-control text-muted-foreground">
                          {(h.from_sector?.name || '—') + ' → ' + (h.to_sector?.name || '—')}
                        </div>
                        {h.reason ? <div className="mt-1 inbox-t-control text-muted-foreground">Motivo: {h.reason}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">Sem eventos ainda.</div>
                )}
              </div>

              <div>
                <div className="inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">Notas internas</div>
                {detail?.internal_notes?.length ? (
                  <div className="mt-2 space-y-2">
                    {detail.internal_notes.slice(0, 30).map((n) => (
                      <div key={n.id} className="rounded-lg border border-border bg-background/40 p-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-foreground">{n.author?.name || '—'}</span>
                          <span className="font-mono inbox-t-meta text-subtle-foreground">
                            {format(new Date(n.created_at), 'dd/MM HH:mm', { locale: ptBR })}
                          </span>
                        </div>
                        <div className="mt-1 inbox-t-control text-muted-foreground whitespace-pre-line">{n.content}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">Sem notas internas.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {noteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-4 shadow-glow">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold tracking-tight">Nota interna</div>
              <button
                onClick={() => setNoteOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <p className="inbox-t-control text-muted-foreground">Use @ para avisar um colega (ex.: @Nome Completo).</p>
              <div className="relative">
                <textarea
                  rows={5}
                  value={noteText}
                  ref={noteTextareaRef}
                  onChange={(e) => {
                    setNoteText(e.target.value);
                    setNoteCaret(e.target.selectionStart ?? e.target.value.length);
                  }}
                  onClick={(e) => setNoteCaret(e.currentTarget.selectionStart ?? noteText.length)}
                  onKeyUp={(e) => setNoteCaret(e.currentTarget.selectionStart ?? noteText.length)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && filteredMentionCandidates[0]) {
                      e.preventDefault();
                      const pick = filteredMentionCandidates[0];
                      const next = insertMentionAtCaret(noteText, noteCaret, pick.name);
                      setNoteText(next.text);
                      setNoteCaret(next.caret);
                      requestAnimationFrame(() => {
                        const el = noteTextareaRef.current;
                        if (!el) return;
                        el.focus();
                        el.setSelectionRange(next.caret, next.caret);
                      });
                    }
                  }}
                  placeholder="Escreva uma nota visível apenas para a equipe…"
                  className="w-full resize-none rounded-xl border border-border bg-background/50 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 placeholder:text-muted-foreground"
                />
                {filteredMentionCandidates.length ? (
                  <ul className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface-elevated py-1 shadow-glow">
                    {filteredMentionCandidates.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="flex w-full px-3 py-1.5 text-left text-xs hover:bg-surface-hover"
                          onClick={() => {
                            const next = insertMentionAtCaret(noteText, noteCaret, c.name);
                            setNoteText(next.text);
                            setNoteCaret(next.caret);
                            requestAnimationFrame(() => {
                              const el = noteTextareaRef.current;
                              if (!el) return;
                              el.focus();
                              el.setSelectionRange(next.caret, next.caret);
                            });
                          }}
                        >
                          @{c.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {noteHint ? <p className="text-xs text-primary">{noteHint}</p> : null}

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setNoteOpen(false)}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void submitNote()}
                  disabled={!noteText.trim() || isSending}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors disabled:opacity-60"
                >
                  Salvar nota
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {transferOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-4 shadow-glow">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold tracking-tight">Transferir conversa</div>
              <button
                onClick={() => setTransferOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">
                    Setor
                  </div>
                  <select
                    value={transferSectorId}
                    onChange={(e) => setTransferSectorId(e.target.value)}
                    className="w-full rounded-md border border-border bg-background/50 px-2 py-2 text-xs text-foreground outline-none focus:border-primary/50"
                  >
                    <option value="">Manter</option>
                    {(sectors || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="mb-1 inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">
                    Atendente
                  </div>
                  <select
                    value={transferAttendantId}
                    onChange={(e) => setTransferAttendantId(e.target.value)}
                    className="w-full rounded-md border border-border bg-background/50 px-2 py-2 text-xs text-foreground outline-none focus:border-primary/50"
                  >
                    <option value="">Sem dono</option>
                    {(users || []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="mb-1 inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">
                  Motivo (opcional)
                </div>
                <input
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="Ex.: Escalar para N2 / Financeiro / etc"
                  className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 placeholder:text-muted-foreground"
                />
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setTransferOpen(false)}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void submitTransfer()}
                  disabled={isSending || (!transferSectorId && !transferAttendantId)}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors disabled:opacity-60"
                >
                  Transferir
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showNewConversation ? (
        <NewConversationModal
          open={showNewConversation}
          onClose={() => setShowNewConversation(false)}
          sectors={(sectors || []).map((s) => ({ id: s.id, name: s.name }))}
          templates={templatesData || []}
          onCreated={(id) => {
            setActiveId(id);
            setFolder('mine');
            void refetchConvs();
          }}
        />
      ) : null}

      <CopilotPanel
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        conversationId={activeId || null}
        onOpenContext={() => setContextDrawerOpen(true)}
        onInsertToComposer={(text) => setComposerText((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text))}
      />
    </div>
  );
}
