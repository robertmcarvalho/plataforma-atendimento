/**
 * Catálogo extensível de provedores LLM (BYOK por workspace).
 * Para acrescentar um provedor: inclua uma entrada em LLM_PROVIDER_DEFINITIONS.
 */

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

export type LlmAdapterKind = 'gemini' | 'openai_compatible' | 'anthropic';

export type LlmProviderDefinition = {
  id: string;
  name: string;
  description: string;
  docsUrl?: string;
  adapter: LlmAdapterKind;
  credentialFields: LlmFieldSpec[];
  configFields: LlmFieldSpec[];
};

/** Definições — ordem exibida na UI (5 principais + espaço para expansão futura via código). */
export const LLM_PROVIDER_DEFINITIONS: LlmProviderDefinition[] = [
  {
    id: 'google_gemini',
    name: 'Google Gemini',
    description: 'API Google AI Studio / Vertex (Gemini).',
    docsUrl: 'https://aistudio.google.com/apikey',
    adapter: 'gemini',
    credentialFields: [
      {
        key: 'api_key',
        label: 'API key',
        kind: 'secret',
        required: true,
        placeholder: 'AIza…',
      },
    ],
    configFields: [
      {
        key: 'primary_model',
        label: 'Modelo principal',
        kind: 'text',
        required: true,
        defaultValue: 'gemini-2.5-flash',
        placeholder: 'ex.: gemini-2.5-flash',
      },
      {
        key: 'fallback_models',
        label: 'Modelos fallback (vírgula)',
        kind: 'text',
        required: false,
        defaultValue: 'gemini-2.5-flash-lite,gemini-2.0-flash',
        placeholder: 'modelo1, modelo2',
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT via API oficial OpenAI.',
    docsUrl: 'https://platform.openai.com/api-keys',
    adapter: 'openai_compatible',
    credentialFields: [
      {
        key: 'api_key',
        label: 'API key',
        kind: 'secret',
        required: true,
        placeholder: 'sk-…',
      },
    ],
    configFields: [
      {
        key: 'base_url',
        label: 'Base URL (opcional)',
        kind: 'url',
        required: false,
        defaultValue: 'https://api.openai.com/v1',
        placeholder: 'https://api.openai.com/v1',
        help: 'Deixe vazio para o default OpenAI ou use proxy compatível.',
      },
      {
        key: 'organization_id',
        label: 'Organization ID (opcional)',
        kind: 'text',
        required: false,
        placeholder: 'org-…',
      },
      {
        key: 'primary_model',
        label: 'Modelo principal',
        kind: 'text',
        required: true,
        defaultValue: 'gpt-4o-mini',
        placeholder: 'ex.: gpt-4o-mini',
      },
      {
        key: 'fallback_models',
        label: 'Modelos fallback (vírgula)',
        kind: 'text',
        required: false,
        defaultValue: 'gpt-4o-mini,gpt-4.1-mini',
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    description: 'API Claude Messages.',
    docsUrl: 'https://console.anthropic.com/',
    adapter: 'anthropic',
    credentialFields: [
      {
        key: 'api_key',
        label: 'API key',
        kind: 'secret',
        required: true,
        placeholder: 'sk-ant-…',
      },
    ],
    configFields: [
      {
        key: 'primary_model',
        label: 'Modelo principal',
        kind: 'text',
        required: true,
        defaultValue: 'claude-sonnet-4-20250514',
        placeholder: 'ex.: claude-sonnet-4-20250514',
      },
      {
        key: 'fallback_models',
        label: 'Modelos fallback (vírgula)',
        kind: 'text',
        required: false,
        defaultValue: 'claude-3-5-haiku-20241022',
      },
    ],
  },
  {
    id: 'azure_openai',
    name: 'Azure OpenAI',
    description: 'OpenAI hospedado na Azure (deployment).',
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai/',
    adapter: 'openai_compatible',
    credentialFields: [
      {
        key: 'api_key',
        label: 'API key do recurso',
        kind: 'secret',
        required: true,
      },
    ],
    configFields: [
      {
        key: 'azure_resource_url',
        label: 'Endpoint do recurso',
        kind: 'url',
        required: true,
        placeholder: 'https://SEU_RECURSO.openai.azure.com',
        help: 'Sem barra final; ex.: https://meu-recurso.openai.azure.com',
      },
      {
        key: 'azure_deployment_name',
        label: 'Nome do deployment',
        kind: 'text',
        required: true,
        placeholder: 'meu-deployment-gpt4',
      },
      {
        key: 'azure_api_version',
        label: 'Versão da API',
        kind: 'text',
        required: false,
        defaultValue: '2024-02-15-preview',
      },
      {
        key: 'primary_model',
        label: 'Identificador do modelo (opcional)',
        kind: 'text',
        required: false,
        help: 'Informativo; a chamada usa o deployment acima.',
      },
      {
        key: 'fallback_models',
        label: 'Deployments fallback (vírgula)',
        kind: 'text',
        required: false,
        help: 'Opcional; primeiro deployment é o principal.',
      },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'API compatível com OpenAI.',
    docsUrl: 'https://console.mistral.ai/',
    adapter: 'openai_compatible',
    credentialFields: [
      {
        key: 'api_key',
        label: 'API key',
        kind: 'secret',
        required: true,
      },
    ],
    configFields: [
      {
        key: 'base_url',
        label: 'Base URL',
        kind: 'url',
        required: false,
        defaultValue: 'https://api.mistral.ai/v1',
      },
      {
        key: 'primary_model',
        label: 'Modelo principal',
        kind: 'text',
        required: true,
        defaultValue: 'mistral-small-latest',
      },
      {
        key: 'fallback_models',
        label: 'Modelos fallback (vírgula)',
        kind: 'text',
        required: false,
        defaultValue: 'mistral-small-latest,mistral-large-latest',
      },
    ],
  },
];

const BY_ID = new Map(LLM_PROVIDER_DEFINITIONS.map((d) => [d.id, d]));

export function getLlmProviderDefinition(id: string): LlmProviderDefinition | undefined {
  return BY_ID.get(id);
}

export function listLlmProviderIds(): string[] {
  return LLM_PROVIDER_DEFINITIONS.map((d) => d.id);
}

/** Payload público para a UI (sem segredos). */
export function listLlmProvidersForApi(): LlmProviderDefinition[] {
  return LLM_PROVIDER_DEFINITIONS.map((d) => ({ ...d }));
}

export function secretCredentialKeysForProvider(providerId: string): string[] {
  const d = getLlmProviderDefinition(providerId);
  if (!d) return ['api_key'];
  return d.credentialFields.filter((f) => f.kind === 'secret').map((f) => f.key);
}

export function applyLlmDefaults(providerId: string, config: Record<string, unknown>): Record<string, unknown> {
  const d = getLlmProviderDefinition(providerId);
  if (!d) return config;
  const out = { ...config };
  for (const f of d.configFields) {
    if (f.defaultValue !== undefined && (out[f.key] === undefined || out[f.key] === '' || out[f.key] === null)) {
      out[f.key] = f.defaultValue;
    }
  }
  return out;
}

/** Valida credenciais/config guardadas (campos obrigatórios não vazios). */
export function validateLlmPayload(
  providerId: string,
  credentials: Record<string, unknown>,
  config: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const d = getLlmProviderDefinition(providerId);
  if (!d) return { ok: false, error: 'Provedor LLM desconhecido.' };

  for (const f of d.credentialFields) {
    if (!f.required) continue;
    const v = credentials[f.key];
    if (typeof v !== 'string' || !v.trim()) {
      return { ok: false, error: `Credencial obrigatória ausente: ${f.label}` };
    }
  }

  const cfgMerged = applyLlmDefaults(providerId, config);

  for (const f of d.configFields) {
    if (!f.required) continue;
    const v = cfgMerged[f.key];
    if (typeof v !== 'string' || !v.trim()) {
      return { ok: false, error: `Campo obrigatório: ${f.label}` };
    }
  }

  return { ok: true };
}
