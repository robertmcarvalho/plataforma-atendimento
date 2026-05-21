import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret } from './crypto';

export type ChannelType = 'whatsapp' | 'instagram' | 'email' | 'webchat';

export type ResolvedChannel = {
  id: string;
  workspace_id: string;
  channel_type: ChannelType;
  provider: string;
  display_name: string | null;
  external_id: string | null;
  verify_token: string | null;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
  status: string;
  source: 'workspace' | 'environment';
};

type ChannelRow = {
  id: string;
  workspace_id: string;
  channel_type: string;
  provider: string;
  display_name: string | null;
  external_id: string | null;
  verify_token: string | null;
  config: Record<string, unknown> | null;
  credentials: Record<string, unknown> | null;
  status?: string | null;
  is_active?: boolean;
  is_default?: boolean;
};

function decryptCredentials(raw: Record<string, unknown> | null): Record<string, unknown> {
  if (!raw) return {};
  const out: Record<string, unknown> = { ...raw };
  for (const key of ['access_token', 'password', 'api_key', 'secret', 'smtp_pass']) {
    const val = raw[key];
    if (typeof val === 'string') out[key] = decryptSecret(val);
  }
  return out;
}

function envWhatsAppFallback(): ResolvedChannel | null {
  const phoneId =
    process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim() ||
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ||
    process.env.META_PHONE_NUMBER_ID?.trim();
  const access =
    process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() ||
    process.env.WHATSAPP_ACCESS_TOKEN?.trim() ||
    process.env.META_ACCESS_TOKEN?.trim();
  if (!phoneId || !access) return null;
  return {
    id: 'env-whatsapp',
    workspace_id: '',
    channel_type: 'whatsapp',
    provider: 'meta_cloud',
    display_name: 'WhatsApp (env)',
    external_id: phoneId,
    verify_token: process.env.META_VERIFY_TOKEN?.trim() || null,
    config: {},
    credentials: { access_token: access, phone_number_id: phoneId },
    status: 'active',
    source: 'environment',
  };
}

function rowToResolved(row: ChannelRow): ResolvedChannel {
  const creds = row.credentials || {};
  const decrypted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(creds)) {
    decrypted[k] = typeof v === 'string' ? decryptSecret(v) : v;
  }
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    channel_type: row.channel_type as ChannelType,
    provider: row.provider,
    display_name: row.display_name,
    external_id: row.external_id,
    verify_token: row.verify_token,
    config: (row.config as Record<string, unknown>) || {},
    credentials: decrypted,
    status: String(row.status || 'active'),
    source: 'workspace',
  };
}

export async function getChannelById(
  db: SupabaseClient,
  channelId: string
): Promise<ResolvedChannel | null> {
  const { data, error } = await db.from('workspace_channels').select('*').eq('id', channelId).maybeSingle();
  if (error || !data) return null;
  return rowToResolved(data as ChannelRow);
}

export async function resolveWhatsAppChannel(
  db: SupabaseClient,
  workspaceId: string,
  phoneNumberId?: string | null
): Promise<ResolvedChannel | null> {
  const pid = String(phoneNumberId || '').trim();
  if (pid) {
    const { data } = await db
      .from('workspace_channels')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('channel_type', 'whatsapp')
      .eq('external_id', pid)
      .eq('is_active', true)
      .maybeSingle();
    if (data) return rowToResolved(data as ChannelRow);
  }

  const { data: defaultRow } = await db
    .from('workspace_channels')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'whatsapp')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (defaultRow) return rowToResolved(defaultRow as ChannelRow);

  const env = envWhatsAppFallback();
  if (env) return { ...env, workspace_id: workspaceId };
  return null;
}

export async function listActiveVerifyTokens(db: SupabaseClient): Promise<string[]> {
  const tokens = new Set<string>();
  const env = process.env.META_VERIFY_TOKEN?.trim();
  if (env) tokens.add(env);

  const { data } = await db
    .from('workspace_channels')
    .select('verify_token')
    .eq('is_active', true)
    .not('verify_token', 'is', null);

  for (const row of data || []) {
    const t = String((row as { verify_token?: string }).verify_token || '').trim();
    if (t) tokens.add(t);
  }
  return [...tokens];
}

export function webhookPublicBaseUrl(): string | null {
  const base =
    process.env.WEBHOOK_PUBLIC_BASE_URL?.trim() ||
    process.env.PUBLIC_WEBHOOK_BASE_URL?.trim() ||
    process.env.WEBHOOK_SERVICE_PUBLIC_URL?.trim();
  if (!base) return null;
  return base.replace(/\/$/, '');
}

export function buildWebhookCallbackUrl(channelId?: string): string | null {
  const base = webhookPublicBaseUrl();
  if (!base) return null;
  if (channelId) return `${base}/webhook?channel_id=${encodeURIComponent(channelId)}`;
  return `${base}/webhook`;
}

export async function resolveWorkspaceIdByPhoneNumberId(
  db: SupabaseClient,
  phoneNumberId: string
): Promise<string | null> {
  const pid = String(phoneNumberId || '').trim();
  if (!pid) return null;
  const { data } = await db
    .from('workspace_channels')
    .select('workspace_id')
    .eq('channel_type', 'whatsapp')
    .eq('external_id', pid)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.workspace_id) return String(data.workspace_id);

  const { data: defaultWorkspace } = await db
    .from('workspaces')
    .select('id')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  return defaultWorkspace?.id ? String(defaultWorkspace.id) : null;
}
