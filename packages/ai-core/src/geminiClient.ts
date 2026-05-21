const GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Schema fragment accepted by Gemini `generateContent` (`responseSchema`). Uses Google's REST Schema subset (uppercase type enums). */
export type GeminiResponseSchema = Record<string, unknown>;

export type GeminiGenerateInput = {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userText: string;
  maxOutputTokens?: number;
  temperature?: number;
};

export type GeminiGenerateResult = {
  text: string;
  raw?: unknown;
};

function getApiKey(): string {
  return (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
}

export function resolveGeminiApiKey(): string | null {
  const k = getApiKey();
  return k || null;
}

export function resolveGeminiModel(): string {
  return (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash';
}

export function resolveGeminiFallbackModels(): string[] {
  const raw = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash-lite,gemini-2.0-flash').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

export function resolveGeminiEmbeddingModel(): string {
  return (process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004').trim() || 'text-embedding-004';
}

export type GeminiEmbedInput = {
  apiKey: string;
  /** Resource id e.g. `text-embedding-004` */
  model?: string;
  text: string;
};

/** Embedding vector (Gemini `text-embedding-004` defaults to length 768). */
export async function geminiEmbedContent(input: GeminiEmbedInput): Promise<number[]> {
  const model = (input.model || resolveGeminiEmbeddingModel()).replace(/^models\//, '');
  const url = `${GEMINI_GENERATE_URL}/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(input.apiKey)}`;

  const body = {
    model: `models/${model}`,
    content: { parts: [{ text: input.text }] },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const errMsg =
      (raw?.error as { message?: string } | undefined)?.message ||
      (typeof raw === 'object' && raw && 'message' in raw ? String((raw as { message?: unknown }).message) : '') ||
      res.statusText;
    const err = new Error(`Gemini embed HTTP ${res.status}: ${errMsg}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }

  const emb = raw?.embedding as { values?: number[] } | undefined;
  const values = emb?.values;
  if (!values || !Array.isArray(values) || values.length === 0) {
    throw new Error('Gemini embed: resposta sem embedding.values');
  }
  return values;
}

export type GeminiGenerateJsonInput = {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userText: string;
  /** Pass-through JSON schema for structured output (Gemini REST `responseSchema`). */
  responseSchema: GeminiResponseSchema;
  maxOutputTokens?: number;
  temperature?: number;
};

export async function geminiGenerateJson(input: GeminiGenerateJsonInput): Promise<{ json: unknown; raw?: unknown }> {
  const model = input.model.replace(/^models\//, '');
  const url = `${GEMINI_GENERATE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;

  const body = {
    systemInstruction: { parts: [{ text: input.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: input.userText }] }],
    generationConfig: {
      temperature: input.temperature ?? 0.2,
      maxOutputTokens: input.maxOutputTokens ?? 512,
      responseMimeType: 'application/json',
      responseSchema: input.responseSchema,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const errMsg =
      (raw?.error as { message?: string } | undefined)?.message ||
      (typeof raw === 'object' && raw && 'message' in raw ? String((raw as { message?: unknown }).message) : '') ||
      res.statusText;
    const err = new Error(`Gemini HTTP ${res.status}: ${errMsg}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }

  const candidates = raw?.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  const text =
    candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('')
      .trim() || '';

  if (!text) {
    throw new Error('Gemini JSON: resposta vazia');
  }

  try {
    const json = JSON.parse(text) as unknown;
    return { json, raw };
  } catch {
    throw new Error(`Gemini JSON: parse falhou — trecho: ${text.slice(0, 200)}`);
  }
}

export function isGeminiRetryableStatus(status: number | undefined): boolean {
  if (!status) return false;
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/** JSON Schema fragment for a single function the model may call (Gemini `functionDeclarations`). */
export type GeminiFunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type GeminiTool = {
  functionDeclarations: GeminiFunctionDeclaration[];
};

/** Single part in a Content message (text, tool call, or tool response). */
export type GeminiContentPart =
  | { text?: string }
  | { functionCall?: { name: string; args?: Record<string, unknown> } }
  | { functionResponse?: { name: string; response: unknown } };

export type GeminiContent = {
  role: 'user' | 'model';
  parts: GeminiContentPart[];
};

export type GeminiGenerateWithToolsInput = {
  apiKey: string;
  model: string;
  systemInstruction: string;
  /** Full conversation turns (user / model / user with functionResponse). */
  contents: GeminiContent[];
  tools: GeminiTool[];
  maxOutputTokens?: number;
  temperature?: number;
};

export type GeminiGenerateWithToolsResult = {
  parts: GeminiContentPart[];
  finishReason?: string;
  raw?: unknown;
};

function normalizeFunctionCallArgs(args: unknown): Record<string, unknown> | undefined {
  if (args == null) return undefined;
  if (typeof args === 'object' && !Array.isArray(args)) return args as Record<string, unknown>;
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * generateContent with function declarations. Returns model parts (text and/or functionCall).
 * Send follow-up turns with role `user` and parts `[{ functionResponse: { name, response } }]`.
 */
export async function geminiGenerateWithTools(input: GeminiGenerateWithToolsInput): Promise<GeminiGenerateWithToolsResult> {
  const model = input.model.replace(/^models\//, '');
  const url = `${GEMINI_GENERATE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: input.systemInstruction }] },
    contents: input.contents,
    tools: input.tools,
    toolConfig: {
      functionCallingConfig: {
        mode: 'AUTO',
      },
    },
    generationConfig: {
      temperature: input.temperature ?? 0.25,
      maxOutputTokens: input.maxOutputTokens ?? 1200,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const errMsg =
      (raw?.error as { message?: string } | undefined)?.message ||
      (typeof raw === 'object' && raw && 'message' in raw ? String((raw as { message?: unknown }).message) : '') ||
      res.statusText;
    const err = new Error(`Gemini HTTP ${res.status}: ${errMsg}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }

  const candidates = raw?.candidates as
    | Array<{
        finishReason?: string;
        content?: { parts?: Array<Record<string, unknown>> };
      }>
    | undefined;
  const cand = candidates?.[0];
  const finishReason = cand?.finishReason ? String(cand.finishReason) : undefined;
  const rawParts = cand?.content?.parts || [];

  const parts: GeminiContentPart[] = [];
  for (const p of rawParts) {
    if (typeof p.text === 'string') {
      parts.push({ text: p.text });
      continue;
    }
    const fc = p.functionCall as { name?: string; args?: unknown } | undefined;
    if (fc && fc.name) {
      parts.push({
        functionCall: {
          name: String(fc.name),
          args: normalizeFunctionCallArgs(fc.args),
        },
      });
    }
  }

  return { parts, finishReason, raw };
}

export async function geminiGenerateContent(input: GeminiGenerateInput): Promise<GeminiGenerateResult> {
  const model = input.model.replace(/^models\//, '');
  const url = `${GEMINI_GENERATE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;

  const body = {
    systemInstruction: { parts: [{ text: input.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: input.userText }] }],
    generationConfig: {
      temperature: input.temperature ?? 0.25,
      maxOutputTokens: input.maxOutputTokens ?? 1024,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const errMsg =
      (raw?.error as { message?: string } | undefined)?.message ||
      (typeof raw === 'object' && raw && 'message' in raw ? String((raw as { message?: unknown }).message) : '') ||
      res.statusText;
    const err = new Error(`Gemini HTTP ${res.status}: ${errMsg}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }

  const candidates = raw?.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  const text =
    candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('')
      .trim() || '';

  return { text, raw };
}
