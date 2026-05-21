import {
  resolveGeminiApiKey as resolveEnvGeminiApiKey,
  resolveGeminiFallbackModels,
  resolveGeminiModel,
} from '@plataforma/ai-core';
import { applyLlmDefaults, getLlmProviderDefinition, secretCredentialKeysForProvider } from './llmProviderCatalog';
import { decryptLlmCredentialRecord, flattenedCredentials } from './workspaceLlmCrypto';
import { supabase } from './supabase';

const LLM_EXTERNAL_ID = 'default';

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((s) => s.trim()).filter(Boolean)));
}

export type ResolvedWorkspaceLlm = {
  ok: boolean;
  providerId: string;
  adapter: 'gemini' | 'openai_compatible' | 'anthropic';
  credentials: Record<string, string>;
  config: Record<string, unknown>;
  models: string[];
  source: 'workspace' | 'environment';
};

function modelsFromConfig(providerId: string, cfg: Record<string, unknown>): string[] {
  const merged = applyLlmDefaults(providerId, cfg);
  if (providerId === 'azure_openai') {
    const dep = String(merged.azure_deployment_name || '').trim();
    const fb = String(merged.fallback_models || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return uniqueStrings([dep, ...fb]);
  }
  const primary = String(merged.primary_model || '').trim();
  const fb = String(merged.fallback_models || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return uniqueStrings([primary, ...fb]);
}

/** Usa só os dados persistidos do canal (ex.: teste de conexão), sem fallback de ambiente. */
export function resolveWorkspaceLlmFromStoredRow(row: {
  provider: unknown;
  credentials: unknown;
  config: unknown;
}): ResolvedWorkspaceLlm | null {
  const providerId = String(row.provider || '').trim();
  const def = getLlmProviderDefinition(providerId);
  if (!def) return null;

  const credsRaw = (row.credentials as Record<string, unknown>) || {};
  const plain = decryptLlmCredentialRecord(providerId, credsRaw);
  const hasSecret = secretCredentialKeysForProvider(providerId).some((k) => {
    const v = plain[k];
    return typeof v === 'string' && v.trim().length > 0;
  });

  const cfg = applyLlmDefaults(providerId, (row.config as Record<string, unknown>) || {});
  const models = modelsFromConfig(providerId, cfg);
  const flat = flattenedCredentials(providerId, credsRaw);

  if (!hasSecret) {
    return {
      ok: false,
      providerId,
      adapter: def.adapter,
      credentials: flat,
      config: cfg,
      models: models.length ? models : [],
      source: 'workspace',
    };
  }

  return {
    ok: true,
    providerId,
    adapter: def.adapter,
    credentials: flat,
    config: cfg,
    models: models.length ? models : ['gpt-4o-mini'],
    source: 'workspace',
  };
}

function envGeminiFallback(): ResolvedWorkspaceLlm {
  const apiKey = resolveEnvGeminiApiKey() || '';
  const envPrimary = resolveGeminiModel();
  const envFb = resolveGeminiFallbackModels();
  const models = uniqueStrings([envPrimary, ...envFb]);
  return {
    ok: Boolean(apiKey),
    providerId: 'google_gemini',
    adapter: 'gemini',
    credentials: { api_key: apiKey },
    config: { primary_model: envPrimary, fallback_models: envFb.join(',') },
    models: models.length ? models : [envPrimary],
    source: 'environment',
  };
}

/**
 * Canal llm + external default por workspace; fallback Gemini por ambiente se inativo ou sem chave.
 */
export async function resolveWorkspaceLlmRuntime(workspaceId: string | null): Promise<ResolvedWorkspaceLlm> {
  const envFb = envGeminiFallback();

  if (!workspaceId) {
    return envFb;
  }

  const { data } = await supabase
    .from('workspace_channels')
    .select('provider, credentials, config, is_active')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'llm')
    .eq('external_id', LLM_EXTERNAL_ID)
    .maybeSingle();

  if (!data || !data.is_active) {
    return envFb;
  }

  const providerId = String(data.provider || '').trim();
  const def = getLlmProviderDefinition(providerId);
  if (!def) {
    return envFb;
  }

  const credsRaw = (data.credentials as Record<string, unknown>) || {};
  const plain = decryptLlmCredentialRecord(providerId, credsRaw);
  const flat = flattenedCredentials(providerId, credsRaw);
  const hasSecret = secretCredentialKeysForProvider(providerId).some((k) => {
    const v = plain[k];
    return typeof v === 'string' && v.trim().length > 0;
  });

  if (!hasSecret) {
    if (providerId === 'google_gemini') {
      const k = resolveEnvGeminiApiKey();
      if (!k) return { ...envFb, ok: false };
      const cfg = applyLlmDefaults(providerId, (data.config as Record<string, unknown>) || {});
      const models = modelsFromConfig(providerId, cfg);
      return {
        ok: true,
        providerId: 'google_gemini',
        adapter: 'gemini',
        credentials: { api_key: k },
        config: cfg,
        models: models.length ? models : envFb.models,
        source: 'environment',
      };
    }
    return { ...envFb, ok: false };
  }

  const cfg = applyLlmDefaults(providerId, (data.config as Record<string, unknown>) || {});
  const models = modelsFromConfig(providerId, cfg);

  return {
    ok: true,
    providerId,
    adapter: def.adapter,
    credentials: flat,
    config: cfg,
    models: models.length ? models : ['gpt-4o-mini'],
    source: 'workspace',
  };
}

/** Compat: só Gemini/chave única para código legado. */
export async function resolveGeminiRuntimeForWorkspace(workspaceId: string | null): Promise<{
  apiKey: string | null;
  models: string[];
}> {
  const r = await resolveWorkspaceLlmRuntime(workspaceId);
  const apiKey = r.credentials.api_key || null;
  return { apiKey: r.ok ? apiKey : null, models: r.models };
}
