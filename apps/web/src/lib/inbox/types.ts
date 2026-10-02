import type { Channel } from '@/components/ui/ChannelBadge';

export type MentionCandidate = { id: string; name: string };

export type ApiConversationStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type ApiConversationPriority = 'low' | 'normal' | 'high' | 'urgent';

export type ApiConversationMessagePreview = {
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

export type ApiConversation = {
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
  demand_key?: string | null;
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
  context_driver?: { id: string; name?: string | null } | null;
  context_pharmacy: { id: string; trade_name: string } | null;
  ai_sentiment_last?: string | null;
  ai_urgency_score?: number | null;
  ai_nps_predicted?: number | null;
  ai_nps_set_at?: string | null;
  topic?: { id: string; name: string } | null;
  messages?: ApiConversationMessagePreview[];
};

export type ApiConversationListResponse = {
  data: ApiConversation[];
  total: number;
  page: number;
  limit: number;
};

export type ApiMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  content: string | null;
  media_url?: string | null;
  sent_at?: string | null;
  created_at: string;
  status: string;
  ai_sentiment?: string | null;
  ai_sentiment_score?: number | null;
  ai_urgency?: string | null;
  ai_urgency_score?: number | null;
  ai_analyzed_at?: string | null;
};

export type ApiConversationAssignment = {
  id: string;
  reason?: string | null;
  created_at: string;
  assigned_by?: { name?: string | null } | null;
  from_attendant?: { name?: string | null } | null;
  to_attendant?: { name?: string | null } | null;
  from_sector?: { name?: string | null } | null;
  to_sector?: { name?: string | null } | null;
};

export type ApiInternalNote = {
  id: string;
  content: string;
  created_at: string;
  author?: { name?: string | null } | null;
};

export type ThreadItem =
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
    }
  | {
      kind: 'separator';
      id: string;
      label: string;
    };

export type ApiConversationDetail = ApiConversation & {
  close_reason?: string | null;
  context_driver?: { id: string; name: string } | null;
  context_leader?: { id: string; name: string } | null;
  messages?: ApiMessage[];
  internal_notes?: ApiInternalNote[];
  conversation_assignments?: ApiConversationAssignment[];
};

export type ApiContactConversation = {
  id: string;
  status: ApiConversationStatus;
  priority: ApiConversationPriority;
  opened_at: string;
  last_message_at: string | null;
  resolved_at: string | null;
  close_reason?: string | null;
  summary?: string | null;
};

export type ApiUser = {
  id: string;
  name: string;
  email?: string;
  role?: string;
  sector_id?: string | null;
  sector_ids?: string[];
  is_active?: boolean | null;
};

export type ApiSector = {
  id: string;
  name: string;
  is_active?: boolean | null;
};

export type ApiConversationTagCatalogRow = {
  slug: string;
  label_pt: string;
  sort_order: number;
  tone?: 'warning' | 'success' | 'primary' | 'info' | 'danger' | 'neutral';
  is_system?: boolean;
  is_user_editable?: boolean;
};

export type ApiPendingTask = {
  id: string;
  created_at?: string;
  task_type: string;
  title: string;
  description?: string | null;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  due_at?: string | null;
  conversation_id?: string | null;
  metadata?: Record<string, unknown> | null;
  contact?: { display_name?: string | null; wa_phone?: string | null } | null;
  driver?: { name?: string | null } | null;
};

export type ApiTaskSummary = {
  open: number;
  in_progress: number;
  mine_open: number;
  overdue: number;
};

export type ApiSlaEventRow = {
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

export type ApiOperationalTicket = {
  id: string;
  ticket_code?: string | null;
  status: string;
  conversation_id?: string | null;
  due_at?: string | null;
  assignee_user_id?: string | null;
  type?: string | null;
  priority?: string | null;
};

export type UiPresence = 'online' | 'idle' | 'offline' | 'busy';
export type UiTagTone = 'warning' | 'success' | 'primary';

export type UiConversation = {
  id: string;
  name: string;
  phone: string;
  channel: Channel;
  preview: string;
  time: string;
  unread?: number;
  status: UiPresence;
  tag?: { label: string; tone: UiTagTone };
  duplicateThreadCount?: number;
  raw: ApiConversation;
};

export type FolderKey =
  | 'mine'
  | 'unassigned'
  | 'pending'
  | 'pending_tasks'
  | 'resolved_today'
  | 'mentions'
  | 'sector_all'
  | 'supervisor_escalated';

export type InboxConvQueryFilters = {
  isSupervisor: boolean;
  isAdmin?: boolean;
  folder: FolderKey;
  priorityFilter: 'all' | ApiConversationPriority;
  statusFilter: 'all' | ApiConversationStatus;
  selectedChannelId?: string | null;
  supervisorAttendanceGroup: 'all' | 'active' | 'waiting' | 'finished';
  supervisorAttendantId: string;
  supervisorSlaStage: '' | 'first_response' | 'treatment' | 'resolution';
  supervisorSlaBucket: '' | 'breached' | 'at_risk' | 'on_track';
  sectorFilterId?: string;
};
