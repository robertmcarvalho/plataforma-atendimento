import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptSecret, maskSecret } from './credentialsCrypto';
import { getLlmProviderDefinition } from './llmProviderCatalog';
import { encryptLlmCredentialRecord } from './workspaceLlmCrypto';
import { supabase } from './supabase';
import { ensureChannelConfigMessages } from './channelConfigMessages';

function normalizeMessagingChannelConfig(
  channelType: WorkspaceChannelRecord['channel_type'],
  config: Record<string, unknown>
): Record<string, unknown> {
  if (channelType === 'whatsapp' || channelType === 'instagram') {
    return ensureChannelConfigMessages(config);
  }
  return config;
}

const SECRET_KEYS = ['access_token', 'password', 'api_key', 'secret', 'smtp_pass'] as const;

function encryptCredentials(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  const out: Record<string, unknown> = { ...raw };
  for (const key of SECRET_KEYS) {
    const val = raw[key];
    if (typeof val === 'string' && val && !val.startsWith('{')) out[key] = encryptSecret(val);
  }
  return out;
}

export function maskChannelForApi(row: WorkspaceChannelRecord): WorkspaceChannelRecord {
  const creds = { ...row.credentials };
  if (row.channel_type === 'llm') {
    const def = getLlmProviderDefinition(row.provider);
    if (def) {
      for (const f of def.credentialFields) {
        if (f.kind === 'secret' && typeof creds[f.key] === 'string') {
          creds[f.key] = maskSecret(String(creds[f.key])) ?? '••••';
        }
      }
      return { ...row, credentials: creds };
    }
  }
  for (const key of SECRET_KEYS) {
    if (typeof creds[key] === 'string') creds[key] = maskSecret(String(creds[key])) ?? '••••';
  }
  return { ...row, credentials: creds };
}

export type WorkspaceChannelRecord = {
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
  status: 'active' | 'paused' | 'error' | 'draft';
  last_message_at: string | null;
  messages_24h: number;
};

function normalizeChannel(row: Record<string, unknown>): WorkspaceChannelRecord {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    channel_type: String(row.channel_type) as WorkspaceChannelRecord['channel_type'],
    provider: String(row.provider || ''),
    display_name: row.display_name ? String(row.display_name) : null,
    external_id: row.external_id ? String(row.external_id) : null,
    verify_token: row.verify_token ? String(row.verify_token) : null,
    config: (row.config as Record<string, unknown>) || {},
    credentials: (row.credentials as Record<string, unknown>) || {},
    health: (row.health as Record<string, unknown>) || {},
    is_active: Boolean(row.is_active),
    is_default: Boolean(row.is_default),
    status: (String(row.status || 'active') as WorkspaceChannelRecord['status']) || 'active',
    last_message_at: row.last_message_at ? String(row.last_message_at) : null,
    messages_24h: Number(row.messages_24h ?? 0),
  };
}

export async function listWorkspaceChannels(workspaceId: string, db: SupabaseClient = supabase): Promise<WorkspaceChannelRecord[]> {
  const { data, error } = await db
    .from('workspace_channels')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('channel_type')
    .order('is_default', { ascending: false });

  if (error) {
    if ((error.message || '').includes('workspace_channels')) return [];
    throw new Error(error.message);
  }

  return (data || []).map((row) => maskChannelForApi(normalizeChannel(row as Record<string, unknown>)));
}

async function fetchWorkspaceChannelRow(
  workspaceId: string,
  channelId: string,
  db: SupabaseClient
): Promise<WorkspaceChannelRecord | null> {
  const { data, error } = await db
    .from('workspace_channels')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', channelId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return normalizeChannel(data as Record<string, unknown>);
}

export async function getWorkspaceChannelById(
  workspaceId: string,
  channelId: string,
  db: SupabaseClient = supabase
): Promise<WorkspaceChannelRecord | null> {
  const row = await fetchWorkspaceChannelRow(workspaceId, channelId, db);
  return row ? maskChannelForApi(row) : null;
}

/** Linha bruta do canal (credenciais criptografadas) — uso interno para envio SMTP. */
export async function getWorkspaceChannelRowForDelivery(
  workspaceId: string,
  channelId?: string,
  db: SupabaseClient = supabase
): Promise<WorkspaceChannelRecord | null> {
  if (channelId) return fetchWorkspaceChannelRow(workspaceId, channelId, db);

  const { data, error } = await db
    .from('workspace_channels')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'email')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if ((error.message || '').includes('workspace_channels')) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  return normalizeChannel(data as Record<string, unknown>);
}

/** ID do canal SMTP/e-mail padrão ativo do workspace (para convites = mesmo caminho do teste de conexão). */
export async function getDefaultWorkspaceEmailChannelId(
  workspaceId: string,
  db: SupabaseClient = supabase
): Promise<string | null> {
  const row = await getWorkspaceChannelRowForDelivery(workspaceId, undefined, db);
  return row?.channel_type === 'email' ? row.id : null;
}

function mergeCredentials(
  existing: Record<string, unknown>,
  incoming?: Record<string, unknown>
): Record<string, unknown> {
  if (!incoming) return existing;
  const out = { ...existing };
  for (const [key, val] of Object.entries(incoming)) {
    if (typeof val === 'string' && (val.startsWith('••••') || val === '')) continue;
    out[key] = val;
  }
  return out;
}

export async function updateWorkspaceChannelById(
  workspaceId: string,
  channelId: string,
  input: Partial<WorkspaceChannelRecord>,
  db: SupabaseClient = supabase
): Promise<WorkspaceChannelRecord> {
  const existing = await fetchWorkspaceChannelRow(workspaceId, channelId, db);
  if (!existing) throw new Error('Canal não encontrado');

  const nextProvider = String(input.provider ?? existing.provider);
  const mergedCred = mergeCredentials(existing.credentials, input.credentials);
  const encryptedCreds =
    existing.channel_type === 'llm'
      ? encryptLlmCredentialRecord(nextProvider, mergedCred)
      : encryptCredentials(mergedCred);

  let mergedConfig: Record<string, unknown> =
    existing.channel_type === 'llm' && input.config
      ? { ...(existing.config as Record<string, unknown>), ...(input.config as Record<string, unknown>) }
      : ((input.config ?? existing.config) as Record<string, unknown>);
  mergedConfig = normalizeMessagingChannelConfig(existing.channel_type, mergedConfig);

  const payload = {
    provider: nextProvider,
    display_name: input.display_name !== undefined ? input.display_name : existing.display_name,
    external_id: input.external_id !== undefined ? input.external_id : existing.external_id,
    verify_token: input.verify_token !== undefined ? input.verify_token : existing.verify_token,
    config: mergedConfig as never,
    credentials: encryptedCreds as never,
    is_active: input.is_active ?? existing.is_active,
    is_default: input.is_default ?? existing.is_default,
    status: input.status ?? existing.status,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('workspace_channels')
    .update(payload)
    .eq('workspace_id', workspaceId)
    .eq('id', channelId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return maskChannelForApi(normalizeChannel(data as Record<string, unknown>));
}

export async function deleteWorkspaceChannel(
  workspaceId: string,
  channelId: string,
  db: SupabaseClient = supabase
): Promise<void> {
  const { error } = await db.from('workspace_channels').delete().eq('workspace_id', workspaceId).eq('id', channelId);
  if (error) throw new Error(error.message);
}

const WORKSPACE_LLM_EXTERNAL_ID = 'default';

/** Canal LLM único por workspace (provedor configurável pelo catálogo). */
export async function upsertWorkspaceLlmChannel(
  workspaceId: string,
  patch: {
    provider: string;
    credentials?: Record<string, unknown>;
    config?: Record<string, unknown>;
    is_active?: boolean;
    display_name?: string | null;
  },
  db: SupabaseClient = supabase,
): Promise<WorkspaceChannelRecord> {
  const { data: existing } = await db
    .from('workspace_channels')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'llm')
    .eq('external_id', WORKSPACE_LLM_EXTERNAL_ID)
    .maybeSingle();

  const labelDefault = patch.display_name ?? getLlmProviderDefinition(patch.provider)?.name ?? 'LLM';

  if (existing) {
    const row = normalizeChannel(existing as Record<string, unknown>);
    return updateWorkspaceChannelById(
      workspaceId,
      row.id,
      {
        provider: patch.provider,
        credentials: patch.credentials,
        config: patch.config !== undefined ? { ...row.config, ...patch.config } : undefined,
        is_active: patch.is_active,
        display_name: patch.display_name !== undefined ? patch.display_name : undefined,
      },
      db,
    );
  }

  return upsertWorkspaceChannel(
    {
      workspace_id: workspaceId,
      channel_type: 'llm',
      provider: patch.provider,
      display_name: labelDefault,
      external_id: WORKSPACE_LLM_EXTERNAL_ID,
      verify_token: null,
      config: patch.config || {},
      credentials: patch.credentials || {},
      is_active: patch.is_active ?? true,
      is_default: true,
    },
    db,
  );
}

export async function getDefaultWorkspaceChannel(
  workspaceId: string,
  channelType: WorkspaceChannelRecord['channel_type'],
  db: SupabaseClient = supabase
): Promise<WorkspaceChannelRecord | null> {
  const { data, error } = await db
    .from('workspace_channels')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', channelType)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if ((error.message || '').includes('workspace_channels')) return null;
    throw new Error(error.message);
  }

  if (!data) return null;
  return maskChannelForApi(normalizeChannel(data as Record<string, unknown>));
}

export async function upsertWorkspaceChannel(
  input: Partial<WorkspaceChannelRecord> & {
    workspace_id: string;
    channel_type: WorkspaceChannelRecord['channel_type'];
    provider: string;
  },
  db: SupabaseClient = supabase
): Promise<WorkspaceChannelRecord> {
  const config = normalizeMessagingChannelConfig(
    input.channel_type,
    (input.config || {}) as Record<string, unknown>
  );

  const payload = {
    workspace_id: input.workspace_id,
    channel_type: input.channel_type,
    provider: input.provider,
    display_name: input.display_name ?? null,
    external_id: input.external_id ?? null,
    verify_token: input.verify_token ?? null,
    config: config as never,
    credentials:
      (input.channel_type === 'llm'
        ? encryptLlmCredentialRecord(input.provider, input.credentials || {})
        : encryptCredentials(input.credentials)) as never,
    health: (input.health || {}) as never,
    is_active: input.is_active ?? true,
    is_default: input.is_default ?? false,
    status: input.status ?? 'active',
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('workspace_channels')
    .upsert(payload, { onConflict: 'workspace_id,channel_type,provider,external_id' })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return maskChannelForApi(normalizeChannel(data as Record<string, unknown>));
}
