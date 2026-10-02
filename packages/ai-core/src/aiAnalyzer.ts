import { z } from 'zod';
import {
  geminiGenerateJson,
  resolveGeminiApiKey,
  resolveGeminiModel,
  resolveGeminiFallbackModels,
  type GeminiResponseSchema,
} from './geminiClient';

export type SentimentLabel = 'positivo' | 'neutro' | 'negativo';
export type UrgencyLabel = 'alta' | 'media' | 'baixa';

export type SentimentUrgencyResult = {
  sentiment: SentimentLabel;
  sentimentScore: number;
  urgency: UrgencyLabel;
  urgencyScore: number;
};

export type NpsPredictionResult = {
  score: number;
  reasoning?: string;
};

export type TopicNameResult = {
  name: string;
};

export type CommercialLeadScoreTemperature = 'frio' | 'morno' | 'quente' | 'urgente';

export type CommercialLeadScoreResult = {
  score: number;
  temperature: CommercialLeadScoreTemperature;
  explanation: string;
  signals?: string[];
};

const sentimentUrgencySchemaZ = z.object({
  sentiment: z.enum(['positivo', 'neutro', 'negativo']),
  sentimentScore: z.coerce.number(),
  urgency: z.enum(['alta', 'media', 'baixa']),
  urgencyScore: z.coerce.number(),
});

const npsSchemaZ = z.object({
  score: z.coerce.number(),
  reasoning: z.string().optional(),
});

const topicNameSchemaZ = z.object({
  name: z.string().min(2).max(120),
});

const commercialLeadScoreSchemaZ = z.object({
  score: z.coerce.number(),
  temperature: z.enum(['frio', 'morno', 'quente', 'urgente']),
  explanation: z.string().min(4).max(500),
  signals: z.array(z.string()).optional(),
});

const sentimentUrgencyResponseSchema: GeminiResponseSchema = {
  type: 'OBJECT',
  properties: {
    sentiment: { type: 'STRING', enum: ['positivo', 'neutro', 'negativo'] },
    sentimentScore: { type: 'NUMBER', description: 'Confianca do sentimento entre 0 e 1' },
    urgency: { type: 'STRING', enum: ['alta', 'media', 'baixa'] },
    urgencyScore: { type: 'NUMBER', description: 'Confianca da urgencia entre 0 e 1' },
  },
  required: ['sentiment', 'sentimentScore', 'urgency', 'urgencyScore'],
};

const npsResponseSchema: GeminiResponseSchema = {
  type: 'OBJECT',
  properties: {
    score: { type: 'NUMBER', description: 'Nota NPS prevista de 0 a 10 (numero inteiro)' },
    reasoning: { type: 'STRING', description: 'Justificativa curta em pt-BR' },
  },
  required: ['score'],
};

const topicNameResponseSchema: GeminiResponseSchema = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: 'Nome curto do topico em pt-BR, maximo 80 caracteres' },
  },
  required: ['name'],
};

const commercialLeadScoreResponseSchema: GeminiResponseSchema = {
  type: 'OBJECT',
  properties: {
    score: { type: 'NUMBER', description: 'Probabilidade de conversao 0 a 100 (inteiro)' },
    temperature: { type: 'STRING', enum: ['frio', 'morno', 'quente', 'urgente'] },
    explanation: { type: 'STRING', description: 'Resumo curto em pt-BR para o vendedor' },
    signals: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Sinais objetivos que justificam o score',
    },
  },
  required: ['score', 'temperature', 'explanation'],
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function normalizeScores(raw: z.infer<typeof sentimentUrgencySchemaZ>): SentimentUrgencyResult {
  const sentimentScore = clamp01(raw.sentimentScore > 1 ? raw.sentimentScore / 100 : raw.sentimentScore);
  const urgencyScore = clamp01(raw.urgencyScore > 1 ? raw.urgencyScore / 100 : raw.urgencyScore);
  return {
    sentiment: raw.sentiment,
    sentimentScore,
    urgency: raw.urgency,
    urgencyScore,
  };
}

export function isAiAnalysisEnabled(): boolean {
  const v = String(process.env.AI_ANALYSIS_ENABLED ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

export function resolveAiTopicThreshold(): number {
  const raw = process.env.AI_TOPIC_THRESHOLD;
  const n = raw != null && raw !== '' ? Number(raw) : 0.85;
  if (!Number.isFinite(n)) return 0.85;
  return Math.min(1, Math.max(0, n));
}

export function resolveAiMaxTopics(): number {
  const raw = process.env.AI_MAX_TOPICS;
  const n = raw != null && raw !== '' ? Number.parseInt(raw, 10) : 50;
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(500, n);
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function uniqueModels(primary: string, fallback: string[]): string[] {
  const all = [primary, ...fallback].map((m) => m.trim()).filter(Boolean);
  return Array.from(new Set(all));
}

/**
 * Analisa texto do cliente: sentimento e urgencia (uma chamada JSON estruturada ao Gemini).
 */
export async function analyzeSentimentUrgency(text: string, apiKey?: string | null): Promise<SentimentUrgencyResult> {
  const key = apiKey ?? resolveGeminiApiKey();
  if (!key) throw new Error('Gemini nao configurado (GOOGLE_API_KEY ou GEMINI_API_KEY).');

  const models = uniqueModels(resolveGeminiModel(), resolveGeminiFallbackModels());
  const userText = truncate(text, 8000);
  const systemInstruction = [
    'Voce classifica mensagens de clientes de operacao de farmacia/entregas.',
    'Responda apenas no formato JSON exigido pelo schema.',
    'sentimentScore e urgencyScore sao numeros entre 0 e 1 (confianca).',
    'urgencia "alta" para risco imediato, reclamacao grave, ou palavra "urgente".',
  ].join('\n');

  let lastErr: unknown = null;
  for (const model of models) {
    try {
      const { json } = await geminiGenerateJson({
        apiKey: key,
        model,
        systemInstruction,
        userText,
        responseSchema: sentimentUrgencyResponseSchema,
        maxOutputTokens: 256,
        temperature: 0.2,
      });
      const parsed = sentimentUrgencySchemaZ.safeParse(json);
      if (!parsed.success) {
        lastErr = parsed.error;
        continue;
      }
      return normalizeScores(parsed.data);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Preve NPS (0-10) com base em resumo ou ultimas mensagens da conversa.
 */
export async function predictNps(summary: string, apiKey?: string | null): Promise<NpsPredictionResult> {
  const key = apiKey ?? resolveGeminiApiKey();
  if (!key) throw new Error('Gemini nao configurado (GOOGLE_API_KEY ou GEMINI_API_KEY).');

  const models = uniqueModels(resolveGeminiModel(), resolveGeminiFallbackModels());
  const userText = truncate(summary, 12000);
  const systemInstruction = [
    'Voce estima a nota NPS (0 a 10) que o cliente daria apos o atendimento descrito.',
    'Use apenas o texto fornecido; nao invente fatos.',
    'score inteiro de 0 a 10.',
  ].join('\n');

  let lastErr: unknown = null;
  for (const model of models) {
    try {
      const { json } = await geminiGenerateJson({
        apiKey: key,
        model,
        systemInstruction,
        userText,
        responseSchema: npsResponseSchema,
        maxOutputTokens: 256,
        temperature: 0.25,
      });
      const parsed = npsSchemaZ.safeParse(json);
      if (!parsed.success) {
        lastErr = parsed.error;
        continue;
      }
      let score = Math.round(parsed.data.score);
      if (!Number.isFinite(score)) score = 7;
      score = Math.min(10, Math.max(0, score));
      return { score, reasoning: parsed.data.reasoning };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Gera um rotulo curto em pt-BR para um cluster de mensagens semelhantes.
 */
export async function nameTopicFromExamples(samples: string[], apiKey?: string | null): Promise<TopicNameResult> {
  const key = apiKey ?? resolveGeminiApiKey();
  if (!key) throw new Error('Gemini nao configurado (GOOGLE_API_KEY ou GEMINI_API_KEY).');

  const models = uniqueModels(resolveGeminiModel(), resolveGeminiFallbackModels());
  const cleaned = samples.map((s) => truncate(s, 500)).filter(Boolean).slice(0, 8);
  const userText = ['Exemplos de mensagens do mesmo topico:', ...cleaned.map((t, i) => `${i + 1}. ${t}`)].join('\n');

  const systemInstruction = [
    'Gere um nome CURTO (2 a 5 palavras) para agrupar essas mensagens, em portugues do Brasil.',
    'Sem aspas. Sem ponto final. Focado no assunto principal.',
  ].join('\n');

  let lastErr: unknown = null;
  for (const model of models) {
    try {
      const { json } = await geminiGenerateJson({
        apiKey: key,
        model,
        systemInstruction,
        userText,
        responseSchema: topicNameResponseSchema,
        maxOutputTokens: 128,
        temperature: 0.35,
      });
      const parsed = topicNameSchemaZ.safeParse(json);
      if (!parsed.success) {
        lastErr = parsed.error;
        continue;
      }
      const name = parsed.data.name.replace(/^["']|["']$/g, '').trim();
      if (name.length < 2) {
        lastErr = new Error('Nome de topico vazio');
        continue;
      }
      return { name: name.slice(0, 80) };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Score comercial de lead (0-100) + temperatura com base na ficha, atividades e conversa.
 */
export async function predictCommercialLeadScore(
  contextText: string,
  apiKey?: string | null,
): Promise<CommercialLeadScoreResult> {
  const key = apiKey ?? resolveGeminiApiKey();
  if (!key) throw new Error('Gemini nao configurado (GOOGLE_API_KEY ou GEMINI_API_KEY).');

  const models = uniqueModels(resolveGeminiModel(), resolveGeminiFallbackModels());
  const userText = truncate(contextText, 12000);
  const systemInstruction = [
    'Voce e analista comercial de prospeccao B2B para operacao de delivery de farmacias.',
    'Avalie a probabilidade de fechamento do lead (score 0-100) e a temperatura do engajamento.',
    'Use apenas os dados fornecidos; nao invente fatos.',
    'temperature: frio (baixo interesse), morno (interesse moderado), quente (alto interesse), urgente (decisao iminente ou pedido explicito de proposta).',
    'score inteiro de 0 a 100.',
    'explanation: 1-2 frases objetivas em pt-BR para o vendedor.',
  ].join('\n');

  let lastErr: unknown = null;
  for (const model of models) {
    try {
      const { json } = await geminiGenerateJson({
        apiKey: key,
        model,
        systemInstruction,
        userText,
        responseSchema: commercialLeadScoreResponseSchema,
        maxOutputTokens: 512,
        temperature: 0.3,
      });
      const parsed = commercialLeadScoreSchemaZ.safeParse(json);
      if (!parsed.success) {
        lastErr = parsed.error;
        continue;
      }
      let score = Math.round(parsed.data.score);
      if (!Number.isFinite(score)) score = 0;
      score = Math.min(100, Math.max(0, score));
      return {
        score,
        temperature: parsed.data.temperature,
        explanation: parsed.data.explanation.trim(),
        signals: parsed.data.signals?.map((s) => s.trim()).filter(Boolean),
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
