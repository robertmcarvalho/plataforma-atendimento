import { createClient } from '@supabase/supabase-js';
import {
  listDemandsForSector as staticListDemandsForSector,
  normalizeMacroSectorName as staticNormalizeMacroSectorName,
  slaPresetForDemand as staticSlaPresetForDemand,
  type DemandRow,
  type GuidedDemandProfile,
} from './guidedIntake';
import { getActiveFlowRuntimeMode, loadWorkspaceFlowRuntimeMode, type FlowRuntimeMode } from './workspaceRuntimeMode';
import {
  defaultChannelMessagesConfig,
  intakePatchFromLegacyFlowMessages,
  mergeChannelMessagesConfig,
  parseChannelMessagesFromRaw,
  resolveChannelMessageText,
  type ChannelMessagesConfig,
} from '@plataforma/channel-runtime';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export type WorkspaceCatalogRuntime = {
  listDemandsForSector: (profile: GuidedDemandProfile, sectorDisplayName: string) => DemandRow[];
  slaPresetForDemand: (profile: GuidedDemandProfile | string, demandId: string) => Record<string, unknown>;
  normalizeMacroSectorName: (name: string) => string;
  getMessage: (messageKey: string, fallback: string) => string;
};

const cache = new Map<string, { expiresAt: number; catalog: WorkspaceCatalogRuntime }>();
const CACHE_TTL_MS = 60 * 1000;

let activeCatalog: WorkspaceCatalogRuntime | null = null;

export function setActiveWorkspaceCatalog(catalog: WorkspaceCatalogRuntime | null) {
  activeCatalog = catalog;
}

export function getActiveWorkspaceCatalog(): WorkspaceCatalogRuntime | null {
  return activeCatalog;
}

function normalizeSectorKey(name: string) {
  return staticNormalizeMacroSectorName(name).replace(/\s+/g, '-');
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function stringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
}

function defaultChannelSla() {
  return {
    first_response_action: 'alert_attendant',
    treatment_action: 'alert_and_reassign',
    resolution_action: 'escalate_supervisor',
    use_business_hours: true,
    business_hours_id: 'default',
    first_response_sla_minutes: 25,
    treatment_sla_minutes: 120,
    resolution_sla_minutes: 480,
  };
}

async function loadCatalogFromChannels(workspaceId: string, workspaceChannelId?: string | null): Promise<WorkspaceCatalogRuntime | null> {
  let query = supabase
    .from('workspace_channels')
    .select('id, display_name, channel_type, config, is_active')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);
  if (workspaceChannelId) query = query.eq('id', workspaceChannelId);
  const { data, error } = await query;
  if (error || !data?.length) return null;

  const demandsBySector = new Map<string, DemandRow[]>();
  const slaByDemand = new Map<string, Record<string, unknown>>();
  let messagesConfig: ChannelMessagesConfig = defaultChannelMessagesConfig();
  let foundOperationalData = false;

  for (const channel of data) {
    const config = asRecord(channel.config);
    const sectors = Array.isArray(config.sectors) ? (config.sectors as Record<string, unknown>[]) : [];
    const demands = Array.isArray(config.demands) ? (config.demands as Record<string, unknown>[]) : [];
    const sla = { ...defaultChannelSla(), ...asRecord(config.sla) };
    const messages = asRecord(config.messages);

    const sectorNameById = new Map<string, string>();
    for (const sector of sectors) {
      if (sector.is_active === false) continue;
      const id = String(sector.id || sector.sector_id || '').trim();
      const name = String(sector.name || '').trim();
      if (id && name) sectorNameById.set(id, name);
    }

    for (const demand of demands) {
      if (demand.is_active === false) continue;
      const id = String(demand.id || demand.demand_key || '').trim();
      const title = String(demand.title || demand.name || '').trim();
      if (!id || !title) continue;
      foundOperationalData = true;
      const row = { id, title };
      for (const sectorId of stringArray(demand.sector_ids)) {
        const sectorName = sectorNameById.get(sectorId) || sectorId;
        const key = normalizeSectorKey(sectorName);
        const bucket = demandsBySector.get(key) || [];
        if (!bucket.some((item) => item.id === id)) bucket.push(row);
        demandsBySector.set(key, bucket);
      }
      slaByDemand.set(id, { ...sla, ...asRecord(demand.sla_override) });
    }

    messagesConfig = mergeChannelMessagesConfig(parseChannelMessagesFromRaw(messages));
  }

  const hasIntake = Object.values(messagesConfig.intake).some((v) => String(v || '').trim().length > 0);
  if (!foundOperationalData && !hasIntake && !messagesConfig.greeting?.trim()) return null;

  return {
    listDemandsForSector(_profile, sectorDisplayName) {
      return demandsBySector.get(normalizeSectorKey(sectorDisplayName)) || [];
    },
    slaPresetForDemand(_profile, demandId) {
      return slaByDemand.get(demandId) || defaultChannelSla();
    },
    normalizeMacroSectorName: staticNormalizeMacroSectorName,
    getMessage(messageKey, fallback) {
      return resolveChannelMessageText(messagesConfig, messageKey, { fallback });
    },
  };
}

async function loadCatalogFromDatabase(workspaceId: string, mode: FlowRuntimeMode): Promise<WorkspaceCatalogRuntime | null> {
  const [demandsRes, slaRes, messagesRes] = await Promise.all([
    supabase
      .from('workspace_sector_demands')
      .select('profile_code, sector_key, demand_key, title, is_active, sort_order')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('workspace_sla_rules')
      .select('demand_key, profile_code, settings')
      .eq('workspace_id', workspaceId),
    supabase
      .from('workspace_flow_messages')
      .select('message_key, content, is_active')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true),
  ]);

  if (demandsRes.error || slaRes.error || messagesRes.error) return null;

  const legacyRowsEarly = (messagesRes.data || []) as Array<{ message_key: string; content: string }>;
  const legacyByKeyEarly: Record<string, string> = {};
  for (const row of legacyRowsEarly) {
    const key = String(row.message_key || '').trim();
    const content = String(row.content || '').trim();
    if (key && content) legacyByKeyEarly[key] = content;
  }
  const messagesConfigEarly = mergeChannelMessagesConfig({
    ...defaultChannelMessagesConfig(),
    intake: intakePatchFromLegacyFlowMessages(legacyRowsEarly),
  });

  if (!demandsRes.data?.length && mode === 'catalog') {
    return {
      listDemandsForSector: () => [],
      slaPresetForDemand: () => ({}),
      normalizeMacroSectorName: staticNormalizeMacroSectorName,
      getMessage: (messageKey, fallback) =>
        resolveChannelMessageText(messagesConfigEarly, messageKey, { fallback, legacyByKey: legacyByKeyEarly }),
    };
  }
  if (!demandsRes.data?.length) return null;

  const demandsByProfileSector = new Map<string, DemandRow[]>();
  for (const row of demandsRes.data) {
    const profile = String(row.profile_code || '').trim();
    const sectorKey = String(row.sector_key || '').trim();
    if (!profile || !sectorKey) continue;
    const bucketKey = `${profile}::${sectorKey}`;
    const bucket = demandsByProfileSector.get(bucketKey) || [];
    bucket.push({ id: String(row.demand_key), title: String(row.title) });
    demandsByProfileSector.set(bucketKey, bucket);
  }

  const slaByDemand = new Map<string, Record<string, unknown>>();
  for (const row of slaRes.data || []) {
    const demandKey = String(row.demand_key || '').trim();
    if (!demandKey) continue;
    slaByDemand.set(demandKey, (row.settings as Record<string, unknown>) || {});
  }

  const legacyRows = (messagesRes.data || []) as Array<{ message_key: string; content: string }>;
  const legacyByKey: Record<string, string> = {};
  for (const row of legacyRows) {
    const key = String(row.message_key || '').trim();
    const content = String(row.content || '').trim();
    if (key && content) legacyByKey[key] = content;
  }
  const messagesConfig = mergeChannelMessagesConfig({
    ...defaultChannelMessagesConfig(),
    intake: intakePatchFromLegacyFlowMessages(legacyRows),
  });

  return {
    listDemandsForSector(profile, sectorDisplayName) {
      const sectorKey = normalizeSectorKey(sectorDisplayName);
      const bucketKey = `${profile}::${sectorKey}`;
      const fromDb = demandsByProfileSector.get(bucketKey);
      if (fromDb?.length) return fromDb;
      if (mode === 'catalog') return [];
      return staticListDemandsForSector(profile, sectorDisplayName);
    },
    slaPresetForDemand(profile, demandId) {
      const fromDb = slaByDemand.get(demandId);
      if (fromDb && Object.keys(fromDb).length) return fromDb;
      if (mode === 'catalog') return {};
      return staticSlaPresetForDemand(profile as GuidedDemandProfile, demandId);
    },
    normalizeMacroSectorName: staticNormalizeMacroSectorName,
    getMessage(messageKey, fallback) {
      return resolveChannelMessageText(messagesConfig, messageKey, { fallback, legacyByKey });
    },
  };
}

function buildStaticCatalog(): WorkspaceCatalogRuntime {
  return {
    listDemandsForSector: staticListDemandsForSector,
    slaPresetForDemand: (profile, demandId) => staticSlaPresetForDemand(profile as GuidedDemandProfile, demandId),
    normalizeMacroSectorName: staticNormalizeMacroSectorName,
    getMessage: (_messageKey, fallback) => fallback,
  };
}

export async function loadWorkspaceCatalog(workspaceId: string, workspaceChannelId?: string | null): Promise<WorkspaceCatalogRuntime> {
  const cacheKey = workspaceChannelId ? `${workspaceId}:${workspaceChannelId}` : workspaceId;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.catalog;

  const mode = await loadWorkspaceFlowRuntimeMode(workspaceId);
  const fromChannel = await loadCatalogFromChannels(workspaceId, workspaceChannelId).catch(() => null);
  const fromDb = fromChannel ? null : await loadCatalogFromDatabase(workspaceId, mode).catch(() => null);
  const catalog = fromChannel || fromDb || (mode === 'catalog' ? buildEmptyCatalog() : buildStaticCatalog());
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
  return catalog;
}

function buildEmptyCatalog(): WorkspaceCatalogRuntime {
  const messagesConfig = defaultChannelMessagesConfig();
  return {
    listDemandsForSector: () => [],
    slaPresetForDemand: () => ({}),
    normalizeMacroSectorName: staticNormalizeMacroSectorName,
    getMessage: (messageKey, fallback) => resolveChannelMessageText(messagesConfig, messageKey, { fallback }),
  };
}

export function runtimeListDemandsForSector(profile: GuidedDemandProfile, sectorDisplayName: string) {
  return activeCatalog?.listDemandsForSector(profile, sectorDisplayName) ?? staticListDemandsForSector(profile, sectorDisplayName);
}

export function runtimeSlaPresetForDemand(profile: GuidedDemandProfile | string, demandId: string) {
  return activeCatalog?.slaPresetForDemand(profile, demandId) ?? staticSlaPresetForDemand(profile as GuidedDemandProfile, demandId);
}

export function runtimeCatalogMessage(messageKey: string, fallback: string) {
  if (!activeCatalog) {
    return resolveChannelMessageText(defaultChannelMessagesConfig(), messageKey, { fallback });
  }
  return activeCatalog.getMessage(messageKey, fallback);
}
