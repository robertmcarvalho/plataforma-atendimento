import type { GeminiFunctionDeclaration } from '@plataforma/ai-core';
import {
  geminiGenerateContent,
  geminiGenerateWithTools,
  isGeminiRetryableStatus,
  type GeminiContent,
  type GeminiContentPart,
} from '@plataforma/ai-core';
import { COPILOT_TOOL_DECLARATIONS } from './copilotTools';
import { executeCopilotTool, type CopilotToolContext } from './copilotTools';
import type { JwtUser } from './copilotContext';
import type { ResolvedWorkspaceLlm } from './workspaceLlmRuntime';

export type StaffCopilotToolTrace = {
  name: string;
  args?: Record<string, unknown>;
  result_preview?: string;
};

export function isStaffLlmRetryable(status?: number): boolean {
  if (status === undefined) return false;
  if (isGeminiRetryableStatus(status)) return true;
  return status === 429 || status === 500 || status === 502 || status === 503;
}

/** Schema Gemini REST → JSON Schema OpenAI (tipos minúsculos). */
function geminiSchemaToJsonSchema(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(geminiSchemaToJsonSchema);
  const n = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof n.type === 'string') {
    const u = n.type.toUpperCase();
    const map: Record<string, string> = {
      OBJECT: 'object',
      STRING: 'string',
      INTEGER: 'integer',
      NUMBER: 'number',
      BOOLEAN: 'boolean',
      ARRAY: 'array',
    };
    out.type = map[u] || String(n.type).toLowerCase();
  }
  if (n.properties && typeof n.properties === 'object') {
    const props = n.properties as Record<string, unknown>;
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) mapped[k] = geminiSchemaToJsonSchema(v);
    out.properties = mapped;
  }
  if (Array.isArray(n.required)) out.required = n.required;
  if (typeof n.description === 'string') out.description = n.description;
  if (n.items !== undefined) out.items = geminiSchemaToJsonSchema(n.items);
  return out;
}

export function copilotToolsOpenAi(): Array<{
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}> {
  return COPILOT_TOOL_DECLARATIONS.map((d: GeminiFunctionDeclaration) => ({
    type: 'function' as const,
    function: {
      name: d.name,
      description: d.description,
      parameters: (geminiSchemaToJsonSchema(d.parameters || { type: 'OBJECT', properties: {} }) || {
        type: 'object',
        properties: {},
      }) as Record<string, unknown>,
    },
  }));
}

export function copilotToolsAnthropic(): Array<{ name: string; description?: string; input_schema: Record<string, unknown> }> {
  return COPILOT_TOOL_DECLARATIONS.map((d: GeminiFunctionDeclaration) => ({
    name: d.name,
    description: d.description,
    input_schema: (geminiSchemaToJsonSchema(d.parameters || { type: 'OBJECT', properties: {} }) || {
      type: 'object',
      properties: {},
    }) as Record<string, unknown>,
  }));
}

function openAiCompatibleEndpoint(
  runtime: ResolvedWorkspaceLlm,
  modelForUrl: string,
): { url: string; headers: Record<string, string>; deployment?: string } {
  const cfg = runtime.config;
  const apiKey = runtime.credentials.api_key || '';
  if (runtime.providerId === 'azure_openai') {
    const endpoint = String(cfg.azure_resource_url || '').replace(/\/$/, '');
    const deployment = modelForUrl || String(cfg.azure_deployment_name || '').trim();
    const ver = String(cfg.azure_api_version || '2024-02-15-preview').trim();
    return {
      url: `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(ver)}`,
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      deployment,
    };
  }
  const baseDefault =
    runtime.providerId === 'mistral'
      ? 'https://api.mistral.ai/v1'
      : 'https://api.openai.com/v1';
  const base = String(cfg.base_url || baseDefault).replace(/\/$/, '');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const org = String(cfg.organization_id || '').trim();
  if (org && runtime.providerId === 'openai') headers['OpenAI-Organization'] = org;
  return { url: `${base}/chat/completions`, headers };
}

async function openAiCompatibleSuggest(
  runtime: ResolvedWorkspaceLlm,
  model: string,
  systemInstruction: string,
  userText: string,
): Promise<string> {
  const { url, headers } = openAiCompatibleEndpoint(runtime, model);
  const body: Record<string, unknown> = {
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userText },
    ],
    max_tokens: 768,
    temperature: 0.25,
  };
  if (runtime.providerId !== 'azure_openai') {
    body.model = model;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const msg =
      (raw?.error as { message?: string } | undefined)?.message ||
      (typeof raw?.message === 'string' ? raw.message : '') ||
      res.statusText;
    const err = new Error(`OpenAI-compat HTTP ${res.status}: ${msg}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  const choices = raw?.choices as Array<{ message?: { content?: string } }> | undefined;
  const text = choices?.[0]?.message?.content || '';
  return String(text).trim();
}

async function anthropicSuggest(
  runtime: ResolvedWorkspaceLlm,
  model: string,
  systemInstruction: string,
  userText: string,
): Promise<string> {
  const apiKey = runtime.credentials.api_key || '';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 768,
      system: systemInstruction,
      messages: [{ role: 'user', content: userText }],
      temperature: 0.25,
    }),
  });
  const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const msg =
      (raw?.error as { message?: string } | undefined)?.message ||
      (typeof raw?.message === 'string' ? raw.message : '') ||
      res.statusText;
    const err = new Error(`Anthropic HTTP ${res.status}: ${msg}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  const content = raw?.content as Array<{ type?: string; text?: string }> | undefined;
  const block = content?.find((c) => c.type === 'text');
  return String(block?.text || '').trim();
}

export async function staffSuggestReply(
  runtime: ResolvedWorkspaceLlm,
  systemInstruction: string,
  userText: string,
  modelOverride?: string,
): Promise<{ text: string; model: string }> {
  const model = modelOverride || runtime.models[0] || 'gpt-4o-mini';
  if (!runtime.ok) throw new Error('LLM não configurado');

  if (runtime.adapter === 'gemini') {
    const apiKey = runtime.credentials.api_key || '';
    const { text } = await geminiGenerateContent({
      apiKey,
      model,
      systemInstruction,
      userText,
      maxOutputTokens: 768,
      temperature: 0.25,
    });
    return { text: text.trim(), model };
  }
  if (runtime.adapter === 'openai_compatible') {
    const text = await openAiCompatibleSuggest(runtime, model, systemInstruction, userText);
    return { text, model };
  }
  const text = await anthropicSuggest(runtime, model, systemInstruction, userText);
  return { text, model };
}

function extractGeminiFnCalls(parts: GeminiContentPart[]): Array<{ name: string; args?: Record<string, unknown> }> {
  const out: Array<{ name: string; args?: Record<string, unknown> }> = [];
  for (const p of parts) {
    if ('functionCall' in p && p.functionCall?.name) {
      out.push({ name: String(p.functionCall.name), args: p.functionCall.args });
    }
  }
  return out;
}

function geminiPartsText(parts: GeminiContentPart[]): string {
  return parts
    .map((p) => ('text' in p && typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

const MAX_TOOL_TURNS = 4;

export async function staffCopilotChat(params: {
  runtime: ResolvedWorkspaceLlm;
  jwt: JwtUser;
  systemInstruction: string;
  userText: string;
  model: string;
  workspaceId?: string;
  /** Tokens de saída por turno (default 1200). Inbound assist usa valor maior para JSON após tools. */
  maxOutputTokens?: number;
}): Promise<{ replyText: string; toolCallsTrace: StaffCopilotToolTrace[] }> {
  const { runtime, jwt, systemInstruction, userText, model, workspaceId, maxOutputTokens = 1200 } = params;
  const ctx: CopilotToolContext = { user: jwt, workspaceId };
  const toolCallsTrace: StaffCopilotToolTrace[] = [];

  if (runtime.adapter === 'gemini') {
    const apiKey = runtime.credentials.api_key || '';
    const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: userText }] }];
    let replyText = '';
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      const { parts } = await geminiGenerateWithTools({
        apiKey,
        model,
        systemInstruction,
        contents,
        tools: [{ functionDeclarations: COPILOT_TOOL_DECLARATIONS }],
        maxOutputTokens,
        temperature: 0.25,
      });
      contents.push({ role: 'model', parts });
      const calls = extractGeminiFnCalls(parts);
      const text = geminiPartsText(parts);
      if (calls.length === 0) {
        replyText = text || 'Nao foi possivel concluir a consulta.';
        break;
      }
      const responseParts: GeminiContentPart[] = [];
      for (const c of calls) {
        const result = await executeCopilotTool(c.name, c.args, ctx);
        toolCallsTrace.push({
          name: c.name,
          args: c.args,
          result_preview: JSON.stringify(result).slice(0, 400),
        });
        responseParts.push({ functionResponse: { name: c.name, response: result } });
      }
      contents.push({ role: 'user', parts: responseParts });
    }
    if (!replyText) replyText = 'Nao foi possivel concluir a consulta.';
    return { replyText, toolCallsTrace };
  }

  if (runtime.adapter === 'openai_compatible') {
    const tools = copilotToolsOpenAi();
    type Msg =
      | { role: 'system'; content: string }
      | { role: 'user'; content: string }
      | {
          role: 'assistant';
          content: string | null;
          tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
        }
      | { role: 'tool'; tool_call_id: string; content: string };

    const messages: Msg[] = [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userText },
    ];

    let replyText = '';
    const { url, headers } = openAiCompatibleEndpoint(runtime, model);

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      const chatBody: Record<string, unknown> = {
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.25,
        max_tokens: maxOutputTokens,
      };
      if (runtime.providerId !== 'azure_openai') {
        chatBody.model = model;
      }
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(chatBody),
      });
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        const msg =
          (raw?.error as { message?: string } | undefined)?.message ||
          (typeof raw?.message === 'string' ? raw.message : '') ||
          res.statusText;
        const err = new Error(`OpenAI-compat HTTP ${res.status}: ${msg}`);
        (err as { status?: number }).status = res.status;
        throw err;
      }
      const choice = (raw?.choices as Array<{ message?: Record<string, unknown> }> | undefined)?.[0];
      const msg = choice?.message as {
        role?: string;
        content?: string | null;
        tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
      };
      const toolCalls = msg?.tool_calls;
      if (!toolCalls?.length) {
        replyText = String(msg?.content || '').trim() || 'Nao foi possivel concluir a consulta.';
        break;
      }

      messages.push({
        role: 'assistant',
        content: msg.content ?? null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        let args: Record<string, unknown> | undefined;
        try {
          args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          args = {};
        }
        const result = await executeCopilotTool(tc.function.name, args, ctx);
        toolCallsTrace.push({
          name: tc.function.name,
          args,
          result_preview: JSON.stringify(result).slice(0, 400),
        });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }
    if (!replyText) replyText = 'Nao foi possivel concluir a consulta.';
    return { replyText, toolCallsTrace };
  }

  // anthropic
  const apiKey = runtime.credentials.api_key || '';
  const tools = copilotToolsAnthropic();
  type AnthropicMsg =
    | { role: 'user'; content: unknown[] }
    | { role: 'assistant'; content: unknown[] };

  let anthropicMessages: AnthropicMsg[] = [{ role: 'user', content: [{ type: 'text', text: userText }] }];

  let replyText = '';
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
      }),
    });
    const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const msg =
        (raw?.error as { message?: string } | undefined)?.message ||
        (typeof raw?.message === 'string' ? raw.message : '') ||
        res.statusText;
      const err = new Error(`Anthropic HTTP ${res.status}: ${msg}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }

    const content = (raw?.content as Array<Record<string, unknown>>) || [];
    const toolUses = content.filter((b) => b.type === 'tool_use') as Array<{
      type: string;
      id: string;
      name: string;
      input?: Record<string, unknown>;
    }>;
    const textBlocks = content.filter((b) => b.type === 'text') as Array<{ type: string; text?: string }>;
    const textPart = textBlocks.map((b) => b.text || '').join('').trim();

    anthropicMessages.push({ role: 'assistant', content });

    if (!toolUses.length) {
      replyText = textPart || 'Nao foi possivel concluir a consulta.';
      break;
    }

    const toolResults: unknown[] = [];
    for (const tu of toolUses) {
      const result = await executeCopilotTool(tu.name, tu.input, ctx);
      toolCallsTrace.push({
        name: tu.name,
        args: tu.input,
        result_preview: JSON.stringify(result).slice(0, 400),
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    anthropicMessages.push({ role: 'user', content: toolResults });
  }

  if (!replyText) replyText = 'Nao foi possivel concluir a consulta.';
  return { replyText, toolCallsTrace };
}

/** Ping leve por provedor (teste de conexão). */
export async function staffLlmPing(runtime: ResolvedWorkspaceLlm): Promise<void> {
  if (!runtime.ok) throw new Error('Canal LLM incompleto');
  await staffSuggestReply(runtime, 'Responder apenas OK.', 'ping');
}
