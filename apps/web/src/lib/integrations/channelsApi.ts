import api from '@/lib/api';
import {
  defaultChannelMessagesConfig,
  parseChannelMessagesFromRaw,
  serializeChannelMessagesForConfig,
  type ChannelIntakeMessages,
  type ChannelOperationalMessages,
} from '@plataforma/channel-runtime';

export type ChannelStatus = 'active' | 'paused' | 'error' | 'draft';

export type ChannelQueuePriority = 'low' | 'medium' | 'high' | 'urgent';

export type ChannelSlaSettings = {
  first_response_sla_minutes: number;
  treatment_sla_minutes: number;
  resolution_sla_minutes: number;
  use_business_hours: boolean;
  business_hours_id?: string;
  first_response_action?: string;
  treatment_action?: string;
  resolution_action?: string;
};

export type ChannelQueue = {
  name: string;
  sector_ids: string[];
  notify_email?: string;
  capacity?: number;
  priority?: ChannelQueuePriority;
  attendant_ids?: string[];
  overflow_queue_name?: string;
  sla?: Partial<ChannelSlaSettings>;
};

export type ChannelDemand = {
  id: string;
  title: string;
  sector_ids: string[];
  is_active: boolean;
  requires_pharmacy?: boolean;
  route_to?: 'queue' | 'sector' | 'attendant' | null;
  target_sector_id?: string | null;
  target_queue_name?: string | null;
  target_attendant_id?: string | null;
  sla_override?: Partial<ChannelSlaSettings> | null;
  sort_order?: number;
};

export type ChannelSectorConfig = {
  id: string;
  name: string;
  is_active: boolean;
  escalation_manager_id?: string | null;
  escalation_manager_name?: string | null;
};

export type ChannelBusinessDay = {
  is_open: boolean;
  start: string;
  end: string;
};

export type ChannelBusinessHours = {
  timezone: string;
  weekly: Record<'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday', ChannelBusinessDay>;
};

export type ChannelMessages = ChannelOperationalMessages & {
  intake: Partial<ChannelIntakeMessages>;
};

export type ChannelProfilesConfig = {
  accepted: Array<'entregador' | 'farmacia' | 'lider'>;
  pre_registration_fields: Record<'entregador' | 'farmacia' | 'lider', string[]>;
};

export type ChannelRoutingConfig = {
  default_queue_name: string;
};

export type ChannelOperationConfig = {
  csat_enabled: boolean;
  max_simultaneous_per_attendant: number;
  inactivity_timeout_minutes: number;
  /** Resposta automática de fora do horário no webhook (borda), antes do orchestrator. */
  ooh_reply_at_edge?: boolean;
  tags: string[];
};

export type ChannelOperationalConfig = {
  queues: ChannelQueue[];
  sectors: ChannelSectorConfig[];
  demands: ChannelDemand[];
  sla: ChannelSlaSettings;
  business_hours: ChannelBusinessHours;
  holidays: string[];
  routing: ChannelRoutingConfig;
  messages: ChannelMessages;
  profiles: ChannelProfilesConfig;
  operation: ChannelOperationConfig;
};

export type WorkspaceChannel = {
  id: string;
  workspace_id: string;
  channel_type: 'whatsapp' | 'instagram' | 'email' | 'webchat' | 'llm';
  provider: string;
  display_name: string | null;
  external_id: string | null;
  verify_token: string | null;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
  health: Record<string, unknown>;
  is_active: boolean;
  is_default: boolean;
  status?: ChannelStatus;
  last_message_at?: string | null;
  messages_24h?: number;
  webhook_callback_url?: string;
};

export type SectorOption = { id: string; name: string };

export async function listChannels(): Promise<WorkspaceChannel[]> {
  const { data } = await api.get<{ items: WorkspaceChannel[] }>('/api/integrations/channels');
  return data.items || [];
}

export async function createChannel(payload: {
  channel_type: WorkspaceChannel['channel_type'];
  provider: string;
  display_name?: string;
  external_id?: string | null;
  verify_token?: string | null;
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  status?: ChannelStatus;
}): Promise<WorkspaceChannel> {
  const { data } = await api.post<WorkspaceChannel>('/api/integrations/channels', payload);
  return data;
}

export async function updateChannel(
  id: string,
  payload: Partial<{
    display_name: string;
    external_id: string | null;
    verify_token: string | null;
    config: Record<string, unknown>;
    credentials: Record<string, unknown>;
    is_active: boolean;
    status: ChannelStatus;
  }>
): Promise<WorkspaceChannel> {
  const { data } = await api.put<WorkspaceChannel>(`/api/integrations/channels/${id}`, payload);
  return data;
}

export async function deleteChannel(id: string): Promise<void> {
  await api.delete(`/api/integrations/channels/${id}`);
}

export async function testChannelConnection(id: string): Promise<{ ok: boolean; graph?: unknown }> {
  const { data } = await api.post<{ ok: boolean; graph?: unknown }>(`/api/integrations/channels/${id}/test-connection`, {});
  return data;
}

export async function testChannelEmail(id: string, to: string): Promise<{ ok: boolean }> {
  const { data } = await api.post<{ ok: boolean }>(`/api/integrations/channels/${id}/test-connection`, { to });
  return data;
}

export type LlmFieldKind = 'secret' | 'text' | 'url';

export type LlmFieldSpec = {
  key: string;
  label: string;
  kind: LlmFieldKind;
  required: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string;
};

export type LlmProviderCatalogEntry = {
  id: string;
  name: string;
  description: string;
  docsUrl?: string;
  adapter: string;
  credentialFields: LlmFieldSpec[];
  configFields: LlmFieldSpec[];
};

/** Catálogo de provedores LLM (campos dinâmicos na UI). */
export async function fetchLlmCatalog(): Promise<LlmProviderCatalogEntry[]> {
  const { data } = await api.get<{ items: LlmProviderCatalogEntry[] }>('/api/integrations/llm-catalog');
  return data.items || [];
}

/** Canal único LLM por workspace (BYOK); `provider` vem do catálogo da API. */
export async function upsertWorkspaceLlmConfig(payload: {
  provider: string;
  display_name?: string;
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  is_active?: boolean;
}): Promise<WorkspaceChannel> {
  const { data } = await api.put<WorkspaceChannel>('/api/integrations/channels/by-type/llm', payload);
  return data;
}

export async function registerMetaWebhook(id: string, callbackUrl?: string): Promise<{ ok: boolean; callback_url?: string }> {
  const { data } = await api.post<{ ok: boolean; callback_url?: string }>(
    `/api/integrations/channels/${id}/register-meta-webhook`,
    callbackUrl ? { callback_url: callbackUrl } : {}
  );
  return data;
}

export function providerForKind(kind: 'whatsapp' | 'instagram'): string {
  return kind === 'whatsapp' ? 'meta_cloud' : 'meta_instagram';
}

export function uiStatusFromChannel(ch: WorkspaceChannel): 'ativo' | 'pausado' | 'erro' | 'rascunho' {
  const s = ch.status || (ch.is_active ? 'active' : 'paused');
  if (s === 'active') return 'ativo';
  if (s === 'paused') return 'pausado';
  if (s === 'error') return 'erro';
  return 'rascunho';
}

export function channelStatusFromUi(ui: 'ativo' | 'pausado' | 'erro' | 'rascunho'): ChannelStatus {
  if (ui === 'ativo') return 'active';
  if (ui === 'pausado') return 'paused';
  if (ui === 'erro') return 'error';
  return 'draft';
}

export function defaultChannelSlaSettings(): ChannelSlaSettings {
  return {
    first_response_sla_minutes: 25,
    treatment_sla_minutes: 120,
    resolution_sla_minutes: 480,
    use_business_hours: true,
    business_hours_id: 'default',
    first_response_action: 'alert_attendant',
    treatment_action: 'alert_and_reassign',
    resolution_action: 'escalate_supervisor',
  };
}

export function defaultChannelBusinessHours(): ChannelBusinessHours {
  const open = { is_open: true, start: '08:00', end: '18:00' };
  const closed = { is_open: false, start: '08:00', end: '12:00' };
  return {
    timezone: 'America/Sao_Paulo',
    weekly: {
      sunday: { ...closed },
      monday: { ...open },
      tuesday: { ...open },
      wednesday: { ...open },
      thursday: { ...open },
      friday: { ...open },
      saturday: { ...closed },
    },
  };
}

export function defaultChannelMessages(): ChannelMessages {
  const cfg = defaultChannelMessagesConfig();
  return {
    greeting: cfg.greeting,
    out_of_hours: cfg.out_of_hours,
    queue_full: cfg.queue_full,
    closing: cfg.closing,
    csat: cfg.csat,
    intake: { ...cfg.intake },
  };
}

export function defaultChannelProfilesConfig(): ChannelProfilesConfig {
  return {
    accepted: ['entregador', 'farmacia', 'lider'],
    pre_registration_fields: {
      entregador: ['Nome', 'CPF/CNPJ', 'Telefone'],
      farmacia: ['Razão Social', 'Cidade', 'E-mail'],
      lider: ['Nome', 'Cargo', 'E-mail'],
    },
  };
}

export function defaultChannelOperationalConfig(): ChannelOperationalConfig {
  return {
    queues: [],
    sectors: [],
    demands: [],
    sla: defaultChannelSlaSettings(),
    business_hours: defaultChannelBusinessHours(),
    holidays: [],
    routing: { default_queue_name: '' },
    messages: defaultChannelMessages(),
    profiles: defaultChannelProfilesConfig(),
    operation: {
      csat_enabled: true,
      max_simultaneous_per_attendant: 5,
      inactivity_timeout_minutes: 10,
      ooh_reply_at_edge: true,
      tags: ['cadastro pendente', 'vip', 'urgente'],
    },
  };
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function parseNumber(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(String).map((x) => x.trim()).filter(Boolean) : [];
}

function parseSla(raw: unknown, fallback: ChannelSlaSettings = defaultChannelSlaSettings()): ChannelSlaSettings {
  const r = asRecord(raw);
  return {
    ...fallback,
    first_response_sla_minutes: parseNumber(r.first_response_sla_minutes ?? r.slaPrimeiraResposta, fallback.first_response_sla_minutes),
    treatment_sla_minutes: parseNumber(r.treatment_sla_minutes, fallback.treatment_sla_minutes),
    resolution_sla_minutes: parseNumber(r.resolution_sla_minutes ?? r.slaResolucao, fallback.resolution_sla_minutes),
    use_business_hours: r.use_business_hours !== false,
    business_hours_id: String(r.business_hours_id || fallback.business_hours_id || 'default'),
    first_response_action: String(r.first_response_action || fallback.first_response_action || 'alert_attendant'),
    treatment_action: String(r.treatment_action || fallback.treatment_action || 'alert_and_reassign'),
    resolution_action: String(r.resolution_action || fallback.resolution_action || 'escalate_supervisor'),
  };
}

function parseBusinessHours(raw: unknown): ChannelBusinessHours {
  const fallback = defaultChannelBusinessHours();
  const r = asRecord(raw);
  const weekly = asRecord(r.weekly);
  const legacyKeys: Array<[keyof ChannelBusinessHours['weekly'], string]> = [
    ['sunday', 'dom'],
    ['monday', 'seg'],
    ['tuesday', 'ter'],
    ['wednesday', 'qua'],
    ['thursday', 'qui'],
    ['friday', 'sex'],
    ['saturday', 'sab'],
  ];
  const next = { ...fallback.weekly };
  for (const [key, legacy] of legacyKeys) {
    const day = asRecord(weekly[key] || r[legacy]);
    if (Object.keys(day).length === 0) continue;
    next[key] = {
      is_open: day.is_open !== undefined ? day.is_open !== false : day.ativo !== false,
      start: String(day.start || day.inicio || fallback.weekly[key].start),
      end: String(day.end || day.fim || fallback.weekly[key].end),
    };
  }
  return {
    timezone: String(r.timezone || fallback.timezone),
    weekly: next,
  };
}

export function parseQueues(config: Record<string, unknown> | undefined): ChannelQueue[] {
  const raw = config?.queues;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q) => {
      const item = q as Record<string, unknown>;
      return {
        name: String(item.name || ''),
        sector_ids: Array.isArray(item.sector_ids) ? item.sector_ids.map(String) : [],
        notify_email: item.notify_email ? String(item.notify_email) : undefined,
        capacity: item.capacity !== undefined ? parseNumber(item.capacity, 50) : item.capacidade !== undefined ? parseNumber(item.capacidade, 50) : undefined,
        priority: (String(item.priority || item.prioridade || 'medium') as ChannelQueuePriority) || 'medium',
        attendant_ids: parseStringArray(item.attendant_ids || item.atendentes),
        overflow_queue_name: item.overflow_queue_name ? String(item.overflow_queue_name) : item.transbordoPara ? String(item.transbordoPara) : undefined,
        sla: item.sla ? parseSla(item.sla) : item.slaPrimeiraResposta || item.slaResolucao ? parseSla(item) : undefined,
      };
    })
    .filter((q) => q.name);
}

export function parseDemands(config: Record<string, unknown> | undefined): ChannelDemand[] {
  const raw = config?.demands;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) => {
      const item = d as Record<string, unknown>;
      const title = String(item.title || item.name || '').trim();
      const id = String(item.id || item.demand_key || slugDemandTitle(title)).trim();
      return {
        id,
        title,
        sector_ids: Array.isArray(item.sector_ids) ? item.sector_ids.map(String).filter(Boolean) : [],
        is_active: item.is_active !== false,
        requires_pharmacy: Boolean(item.requires_pharmacy),
        route_to: (item.route_to ? String(item.route_to) : null) as ChannelDemand['route_to'],
        target_sector_id: item.target_sector_id ? String(item.target_sector_id) : null,
        target_queue_name: item.target_queue_name ? String(item.target_queue_name) : null,
        target_attendant_id: item.target_attendant_id ? String(item.target_attendant_id) : null,
        sla_override: item.sla_override ? parseSla(item.sla_override) : null,
        sort_order: parseNumber(item.sort_order, 0),
      };
    })
    .filter((d) => d.id && d.title)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.title.localeCompare(b.title, 'pt-BR'));
}

export function parseChannelSectors(config: Record<string, unknown> | undefined): ChannelSectorConfig[] {
  const raw = config?.sectors || config?.setoresCfg;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      const item = s as Record<string, unknown>;
      const id = String(item.id || item.sector_id || item.name || '').trim();
      const name = String(item.name || item.display_name || '').trim();
      return {
        id,
        name,
        is_active: item.is_active !== false,
        escalation_manager_id: item.escalation_manager_id ? String(item.escalation_manager_id) : null,
        escalation_manager_name: item.escalation_manager_name ? String(item.escalation_manager_name) : item.gestorEscalacao ? String(item.gestorEscalacao) : null,
      };
    })
    .filter((s) => s.id && s.name);
}

export function parseChannelOperationalConfig(config: Record<string, unknown> | undefined): ChannelOperationalConfig {
  const raw = config || {};
  const defaults = defaultChannelOperationalConfig();
  const messagesRaw = asRecord(raw.messages || raw.mensagens);
  const profilesRaw = asRecord(raw.profiles || {});
  const operationRaw = asRecord(raw.operation || {});
  const legacyLimits = asRecord(raw.limites);
  const acceptedProfiles = parseStringArray(profilesRaw.accepted || raw.perfisAceitos).filter((x) =>
    ['entregador', 'farmacia', 'lider'].includes(x)
  ) as ChannelProfilesConfig['accepted'];

  return {
    queues: parseQueues(raw),
    sectors: parseChannelSectors(raw),
    demands: parseDemands(raw),
    sla: parseSla(raw.sla),
    business_hours: parseBusinessHours(raw.business_hours || raw.horario),
    holidays: parseStringArray(raw.holidays || raw.feriados),
    routing: {
      default_queue_name: String(asRecord(raw.routing).default_queue_name || raw.filaDefault || ''),
    },
    messages: (() => {
      const parsed = parseChannelMessagesFromRaw(messagesRaw);
      return {
        greeting: parsed.greeting,
        out_of_hours: parsed.out_of_hours,
        queue_full: parsed.queue_full,
        closing: parsed.closing,
        csat: parsed.csat,
        intake: { ...parsed.intake },
      };
    })(),
    profiles: {
      accepted: acceptedProfiles.length ? acceptedProfiles : defaults.profiles.accepted,
      pre_registration_fields: {
        ...defaults.profiles.pre_registration_fields,
        ...(asRecord(profilesRaw.pre_registration_fields || raw.camposPreCadastro) as ChannelProfilesConfig['pre_registration_fields']),
      },
    },
    operation: {
      csat_enabled: operationRaw.csat_enabled !== undefined ? operationRaw.csat_enabled !== false : raw.csatAtivo !== false,
      max_simultaneous_per_attendant: parseNumber(
        operationRaw.max_simultaneous_per_attendant ?? legacyLimits.maxSimultaneasPorAtendente,
        defaults.operation.max_simultaneous_per_attendant
      ),
      inactivity_timeout_minutes: parseNumber(
        operationRaw.inactivity_timeout_minutes ?? legacyLimits.timeoutInatividadeMin,
        defaults.operation.inactivity_timeout_minutes
      ),
      ooh_reply_at_edge: operationRaw.ooh_reply_at_edge !== false,
      tags: parseStringArray(operationRaw.tags || raw.tags).length ? parseStringArray(operationRaw.tags || raw.tags) : defaults.operation.tags,
    },
  };
}

export function serializeChannelOperationalConfig(current: Record<string, unknown>, operational: ChannelOperationalConfig): Record<string, unknown> {
  return {
    ...current,
    queues: operational.queues,
    sectors: operational.sectors,
    demands: operational.demands,
    sla: operational.sla,
    business_hours: operational.business_hours,
    holidays: operational.holidays,
    routing: operational.routing,
    messages: serializeChannelMessagesForConfig({
      greeting: operational.messages.greeting,
      out_of_hours: operational.messages.out_of_hours,
      queue_full: operational.messages.queue_full,
      closing: operational.messages.closing,
      csat: operational.messages.csat,
      intake: operational.messages.intake || {},
    }),
    profiles: operational.profiles,
    operation: operational.operation,
  };
}

export function slugDemandTitle(title: string): string {
  const slug = String(title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return slug || `demanda-${Date.now().toString(36)}`;
}

export function formatLastMessageAt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'há instantes';
  if (diff < 3600_000) return `há ${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `há ${Math.floor(diff / 3600_000)}h`;
  return d.toLocaleString('pt-BR');
}
