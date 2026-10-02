import type { SupabaseClient } from '@supabase/supabase-js';
import { getWorkspaceChannelById, getWorkspaceWhatsAppChannel, type ResolvedChannel } from './channelResolver';

type MetaTemplateComponent = {
  type?: string;
  text?: string;
  format?: string;
};

type MetaTemplateRow = {
  id?: string;
  name: string;
  status: string;
  language: string;
  category?: string;
  components?: MetaTemplateComponent[];
};

export type MetaTemplateSyncResult = {
  waba_id: string;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  channels_synced?: number;
  templates: Array<{ name: string; language: string; status: string }>;
};

const STATUS_MAP: Record<string, string> = {
  APPROVED: 'approved',
  PENDING: 'pending',
  REJECTED: 'rejected',
  PAUSED: 'paused',
  DISABLED: 'paused',
  DRAFT: 'draft',
};

function graphVersion(): string {
  return process.env.META_GRAPH_VERSION?.trim() || 'v19.0';
}

function humanizeTemplateName(slug: string): string {
  return slug
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Texto do BODY (+ HEADER se houver placeholders) para persistência e extração de variáveis. */
export function extractTemplateDisplayText(components: MetaTemplateComponent[] | undefined): string {
  if (!components?.length) return '';
  const body = components.find((c) => String(c.type || '').toUpperCase() === 'BODY');
  const bodyText = String(body?.text || '').trim();
  if (bodyText) return bodyText;
  const header = components.find((c) => String(c.type || '').toUpperCase() === 'HEADER');
  return String(header?.text || '').trim();
}

/** Concatena textos de HEADER + BODY para detectar variáveis em qualquer componente. */
export function extractTemplateVariableSourceText(components: MetaTemplateComponent[] | undefined): string {
  if (!components?.length) return '';
  const parts: string[] = [];
  for (const c of components) {
    const type = String(c.type || '').toUpperCase();
    if (type !== 'BODY' && type !== 'HEADER') continue;
    const text = String(c.text || '').trim();
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

/**
 * Extrai placeholders válidos da Meta: {{1}} / {{nome}}.
 * `{{}}` vazio NÃO é parâmetro Meta — não gera variável (evita #132000).
 */
export function extractTemplateVariables(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /\{\{(\d+|\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || ''))) !== null) {
    const key = m[1];
    const varName = /^\d+$/.test(key) ? `var_${key}` : key;
    if (!seen.has(varName)) {
      seen.add(varName);
      out.push(varName);
    }
  }
  return out;
}

/** Detecta placeholder vazio {{}} (template Meta mal configurado). */
export function hasInvalidEmptyPlaceholders(text: string): boolean {
  return /\{\{\s*\}\}/.test(String(text || ''));
}

/** Mantém body como veio da Meta (não reescreve {{}} → {{1}}). */
export function normalizeEmptyTemplatePlaceholders(text: string): string {
  return String(text || '');
}

/** Chaves efetivas: coluna variables, ou derivação do body (só placeholders válidos). */
export function resolveTemplateVariableKeys(template: {
  variables?: unknown;
  body?: string | null;
} | null | undefined): string[] {
  const fromDb = Array.isArray(template?.variables)
    ? (template!.variables as unknown[]).map(String).filter(Boolean)
    : [];
  if (fromDb.length) {
    // Se o body só tem {{}} inválido, ignore variables inventadas localmente.
    if (hasInvalidEmptyPlaceholders(String(template?.body || '')) && !/\{\{(\d+|\w+)\}\}/.test(String(template?.body || ''))) {
      return [];
    }
    return fromDb;
  }
  return extractTemplateVariables(String(template?.body || ''));
}

async function resolveWabaId(accessToken: string, phoneNumberId: string, configWabaId?: string): Promise<string> {
  const fromConfig = String(configWabaId || process.env.META_WABA_ID || '').trim();
  if (fromConfig) return fromConfig;

  const version = graphVersion();
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}?fields=whatsapp_business_account`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    whatsapp_business_account?: { id?: string };
  };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Falha ao obter WABA (${res.status})`);
  }
  const waba = String(json.whatsapp_business_account?.id || '').trim();
  if (!waba) {
    throw new Error(
      'WABA ID não encontrado. Configure waba_id no canal WhatsApp (Configurações → Canais) ou META_WABA_ID na API.'
    );
  }
  return waba;
}

async function fetchAllMetaTemplates(wabaId: string, accessToken: string): Promise<MetaTemplateRow[]> {
  const version = graphVersion();
  const out: MetaTemplateRow[] = [];
  let url: string | null =
    `https://graph.facebook.com/${version}/${wabaId}/message_templates?limit=100&fields=name,status,language,category,components`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: MetaTemplateRow[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!res.ok || json.error) {
      throw new Error(json.error?.message || `Meta API message_templates (${res.status})`);
    }
    out.push(...(json.data || []));
    url = json.paging?.next || null;
  }
  return out;
}

export async function syncMetaTemplatesForWorkspace(
  db: SupabaseClient,
  workspaceId: string,
  createdBy?: string | null
): Promise<MetaTemplateSyncResult> {
  const { data: channelRows, error: channelError } = await db
    .from('workspace_channels')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'whatsapp')
    .eq('is_active', true)
    .order('is_default', { ascending: false });
  if (channelError) throw channelError;

  const channels = (
    await Promise.all(
      (channelRows || []).map((row) => getWorkspaceChannelById(String(row.id)))
    )
  ).filter((channel): channel is ResolvedChannel => Boolean(channel));

  if (!channels.length) {
    const fallback = await getWorkspaceWhatsAppChannel(workspaceId);
    if (fallback) channels.push(fallback);
  }
  if (!channels.length) {
    throw new Error(
      'Canal WhatsApp não configurado. Vá em Configurações → Canais e configure Phone Number ID + Access Token.'
    );
  }

  let firstWabaId = '';
  let totalFetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const templates: Array<{ name: string; language: string; status: string }> = [];

  for (const channel of channels) {
    const accessToken = String(channel?.credentials?.access_token || '').trim();
    const phoneNumberId = String(channel?.external_id || channel?.credentials?.phone_number_id || '').trim();

    if (!accessToken || !phoneNumberId) {
      skipped += 1;
      continue;
    }

    const wabaId = await resolveWabaId(
      accessToken,
      phoneNumberId,
      String(channel?.config?.waba_id || '')
    );
    if (!firstWabaId) firstWabaId = wabaId;

    const metaRows = await fetchAllMetaTemplates(wabaId, accessToken);
    totalFetched += metaRows.length;
    const purpose = String(channel.config?.purpose || '').toLowerCase();
    const channelIsCommercial = purpose === 'commercial';

    for (const row of metaRows) {
      const metaName = String(row.name || '').trim();
      const language = String(row.language || 'pt_BR').trim() || 'pt_BR';
      if (!metaName) {
        skipped += 1;
        continue;
      }

      const rawBody = extractTemplateDisplayText(row.components);
      if (!rawBody) {
        skipped += 1;
        continue;
      }

      const body = normalizeEmptyTemplatePlaceholders(rawBody);
      const variableSource = normalizeEmptyTemplatePlaceholders(
        extractTemplateVariableSourceText(row.components) || rawBody
      );
      const variables = extractTemplateVariables(variableSource);
      const metaStatus = STATUS_MAP[String(row.status || '').toUpperCase()] || 'draft';
      // Category de produto segue o canal de origem (purpose), não a categoria Meta (MARKETING/UTILITY).
      // MARKETING no WABA operacional deve continuar disponível no inbox de atendimento.
      const purposeCategory = channelIsCommercial
        ? 'commercial'
        : String(channel.config?.purpose || '').toLowerCase() === 'leader'
          ? 'leader'
          : 'operational';
      const category = purposeCategory;
      const displayName = humanizeTemplateName(metaName);
      const now = new Date().toISOString();

      const { data: existing } = await db
        .from('message_templates')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('meta_template_name', metaName)
        .eq('meta_template_language', language)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await db
          .from('message_templates')
          .update({
            body,
            variables,
            category,
            meta_template_status: metaStatus,
            is_active: metaStatus === 'approved',
            updated_at: now,
          })
          .eq('id', existing.id);
        if (error) throw error;
        updated += 1;
      } else {
        const { error } = await db.from('message_templates').insert({
          workspace_id: workspaceId,
          name: displayName,
          category,
          body,
          variables,
          meta_template_name: metaName,
          meta_template_status: metaStatus,
          meta_template_language: language,
          is_active: metaStatus === 'approved',
          created_by: createdBy || null,
          created_at: now,
          updated_at: now,
        });
        if (error) throw error;
        created += 1;
      }
    }

    templates.push(...metaRows.map((r) => ({
      name: r.name,
      language: r.language,
      status: r.status,
    })));
  }

  return {
    waba_id: firstWabaId,
    fetched: totalFetched,
    created,
    updated,
    skipped,
    channels_synced: channels.length,
    templates,
  };
}
