import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';
import type { ResolvedWorkspaceLlm } from '../lib/workspaceLlmRuntime';
import { resolveWorkspaceLlmRuntime } from '../lib/workspaceLlmRuntime';
import { copilotRateLimitHitAsync } from '../lib/copilotRateLimit';
import {
  assertConversationInWorkspace,
  gatherEntityToolResults,
  loadConversationCopilotContext,
  type JwtUser,
} from '../lib/copilotContext';
import { writeAuditLog } from '../lib/auditLog';
import { isAiAnalysisEnabled, loadAiFeaturesConfig } from '@plataforma/ai-core';
import { isStaffLlmRetryable, staffCopilotChat, staffSuggestReply } from '../lib/staffLlmInvoke';
import { INBOUND_ASSIST_COPILOT_SYSTEM, INBOUND_ASSIST_JSON_REPAIR_SYSTEM } from '../lib/inboundAssistPrompt';
import { normalizeInboundAssistPayload, parseInboundAssistJson } from '../lib/inboundAssistParse';

const suggestReplySchema = z.object({
  conversation_id: z.string().uuid(),
});

const inboundAssistSchema = z.object({
  conversation_id: z.string().uuid(),
});

const MAX_RETRIES_PER_MODEL = 3;
const RETRY_BASE_MS = 350;

const REPLY_ASSIST_SYSTEM = [
  'Voce auxilia um atendente de operacao (farmacia, entregas, WhatsApp).',
  'Gere UMA mensagem que o atendente pode enviar AO CLIENTE, em portugues do Brasil.',
  'Tom profissional, cordial e direto.',
  'Nao invente fatos nem dados financeiros/medidas/datas que nao estejam explicitos no CONTEXTO.',
  'Limite forte: no maximo 600 caracteres. Sem citar nome do provedor de IA, "Gemini", "GPT", "Claude" ou "prompt".',
].join('\n');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inboundAssistDisabledByEnv(): boolean {
  const v = String(process.env.AI_INBOUND_ASSIST_ENABLED ?? 'true').toLowerCase();
  return v === 'false' || v === '0' || v === 'off';
}

async function gateSuggestReply(reply: FastifyReply, workspaceId: string | null): Promise<boolean> {
  if (!isAiAnalysisEnabled()) {
    reply.status(503).send({ error: 'IA desativada (AI_ANALYSIS_ENABLED).' });
    return false;
  }
  const cfg = await loadAiFeaturesConfig(supabase, workspaceId);
  if (!cfg.suggest_reply) {
    reply.status(503).send({ error: 'Sugestao de resposta desativada em Configuracoes (ai_features_config).' });
    return false;
  }
  const runtime = await resolveWorkspaceLlmRuntime(workspaceId);
  if (!runtime.ok) {
    reply.status(503).send({
      error:
        'LLM nao configurado. Cadastre o provedor em Configuracoes > Canais > IA / LLM ou defina fallback (ex.: GOOGLE_API_KEY / GEMINI_API_KEY) no servidor.',
    });
    return false;
  }
  return true;
}

async function gateInboundAssist(reply: FastifyReply, workspaceId: string | null): Promise<boolean> {
  if (inboundAssistDisabledByEnv()) {
    reply.status(503).send({ error: 'Briefing automatico do Copiloto desativado (AI_INBOUND_ASSIST_ENABLED).' });
    return false;
  }
  if (!(await gateSuggestReply(reply, workspaceId))) return false;
  const cfg = await loadAiFeaturesConfig(supabase, workspaceId);
  if (!cfg.inbound_assist) {
    reply.status(503).send({ error: 'Briefing automatico do Copiloto desativado em Configuracoes de IA.' });
    return false;
  }
  return true;
}

async function repairInboundAssistJson(
  runtime: ResolvedWorkspaceLlm,
  raw: string,
  model: string,
): Promise<ReturnType<typeof parseInboundAssistJson>> {
  const repairUser = `Corrija para JSON PURO valido.\nTexto recebido:\n"""${raw.slice(0, 12_000)}"""`;
  const { text } = await staffSuggestReply(runtime, INBOUND_ASSIST_JSON_REPAIR_SYSTEM, repairUser, model);
  return parseInboundAssistJson(text);
}

export async function aiRoutes(app: FastifyInstance) {
  app.post('/suggest-reply', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    if (!(await gateSuggestReply(reply, workspaceId))) return;
    const parsed = suggestReplySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados invalidos', details: parsed.error.flatten() });
    }

    const jwt = request.user as JwtUser;
    const userId = jwt.sub;
    if (!userId) return reply.status(401).send({ error: 'Nao autorizado' });

    if (await copilotRateLimitHitAsync(userId)) {
      return reply.status(429).send({
        error: 'Limite de uso de IA por minuto excedido. Tente novamente em instantes.',
      });
    }

    const { conversation_id } = parsed.data;
    const convOk = await assertConversationInWorkspace(conversation_id, workspaceId);
    if (!convOk) {
      return reply.status(404).send({ error: 'Conversa nao encontrada.' });
    }

    const conversationContext = await loadConversationCopilotContext(conversation_id, workspaceId);
    if (!conversationContext) {
      return reply.status(404).send({ error: 'Conversa nao encontrada.' });
    }

    const recent = (conversationContext.recent_messages || []) as Array<{
      direction?: string;
      content?: string;
    }>;
    const ctxRecord = conversationContext as unknown as Record<string, unknown>;
    const lastInbound = [...recent].reverse().find((m) => m.direction === 'inbound');
    const seedMsg = (lastInbound?.content || '').trim().slice(0, 600) || 'Continuar atendimento com cortesia.';
    const toolResults = await gatherEntityToolResults({
      message: seedMsg,
      user: jwt,
      conversationContext: ctxRecord,
    });

    const userText = [
      'CONTEXTO_JSON (use somente para embasar a resposta; nao exponha dados sensiveis do painel ao cliente):',
      JSON.stringify(
        {
          ...ctxRecord,
          entity_search: toolResults,
        },
        null,
        2
      ),
      '',
      'Instrucao final: gere o texto COMPLETO que o cliente receberia no WhatsApp (uma unica mensagem).',
      'Se precisar de informacao ausente para responder com seguranca, peca algo breve ao proprio cliente (ainda assim max 600 caracteres).',
    ].join('\n');

    const runtime = await resolveWorkspaceLlmRuntime(workspaceId);
    if (!runtime.ok) {
      return reply.status(503).send({ error: 'LLM indisponivel.' });
    }

    let lastError: unknown = null;
    let usedModel = runtime.models[0] || 'gpt-4o-mini';

    for (const model of runtime.models) {
      for (let attempt = 1; attempt <= MAX_RETRIES_PER_MODEL; attempt += 1) {
        usedModel = model;
        try {
          const { text } = await staffSuggestReply(runtime, REPLY_ASSIST_SYSTEM, userText, model);
          const replyText = text.replace(/\s+/g, ' ').trim().slice(0, 600);

          await writeAuditLog({
            actor_id: userId,
            action: 'ai.suggest_reply',
            entity_type: 'conversation',
            entity_id: conversation_id,
            workspace_id: workspaceId,
            metadata: { model, provider: runtime.providerId, attempt, chars: replyText.length },
          });

          return reply.send({ suggestion: replyText, model });
        } catch (e: unknown) {
          lastError = e;
          const status =
            typeof e === 'object' && e && 'status' in e ? Number((e as { status?: number }).status) : undefined;
          const retryable = isStaffLlmRetryable(status);
          request.log.warn({ err: e, model, attempt }, 'ai.suggest-reply.retry');
          if (!retryable) break;
          if (attempt < MAX_RETRIES_PER_MODEL) {
            await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
          }
        }
      }
    }

    const status =
      typeof lastError === 'object' && lastError && 'status' in lastError ? Number((lastError as { status?: number }).status) : 503;
    const msg =
      lastError instanceof Error ? lastError.message : 'Sugestao de resposta indisponivel no momento.';
    return reply.status(status >= 400 && status < 600 ? status : 503).send({ error: msg, model: usedModel });
  });

  /**
   * Rascunho para o cliente + proximos passos para o atendente (loop de tools + JSON).
   */
  app.post('/inbound-assist', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    if (!(await gateInboundAssist(reply, workspaceId))) return;
    const parsed = inboundAssistSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados invalidos', details: parsed.error.flatten() });
    }

    const jwt = request.user as JwtUser;
    const userId = jwt.sub;
    if (!userId) return reply.status(401).send({ error: 'Nao autorizado' });

    if (await copilotRateLimitHitAsync(userId)) {
      return reply.status(429).send({
        error: 'Limite de uso de IA por minuto excedido. Tente novamente em instantes.',
      });
    }

    const { conversation_id } = parsed.data;
    const convOk = await assertConversationInWorkspace(conversation_id, workspaceId);
    if (!convOk) {
      return reply.status(404).send({ error: 'Conversa nao encontrada.' });
    }

    const conversationContext = await loadConversationCopilotContext(conversation_id, workspaceId);
    if (!conversationContext) {
      return reply.status(404).send({ error: 'Conversa nao encontrada.' });
    }

    const recent = (conversationContext.recent_messages || []) as Array<{
      direction?: string;
      content?: string;
    }>;
    const ctxRecord = conversationContext as unknown as Record<string, unknown>;
    const lastInbound = [...recent].reverse().find((m) => m.direction === 'inbound');
    const seedMsg = (lastInbound?.content || '').trim().slice(0, 600) || 'Continuar atendimento com cortesia.';
    const toolResults = await gatherEntityToolResults({
      message: seedMsg,
      user: jwt,
      conversationContext: ctxRecord,
    });

    const userText = [
      'CONTEXTO_JSON (conversa, SLA, demand_key, entidades; use tools se precisar confirmar dados):',
      JSON.stringify(
        {
          ...ctxRecord,
          entity_search: toolResults,
        },
        null,
        2
      ),
      '',
      'ULTIMA_MENSAGEM_INBOUND_DO_CONTATO:',
      seedMsg,
      '',
      'TAREFA: use tools se necessario; depois responda APENAS com JSON {"draft_reply":"...","next_actions":["..."]} conforme instrucoes do system.',
    ].join('\n');

    const runtime = await resolveWorkspaceLlmRuntime(workspaceId);
    if (!runtime.ok) {
      return reply.status(503).send({ error: 'LLM indisponivel.' });
    }

    let lastError: unknown = null;
    let usedModel = runtime.models[0] || 'gpt-4o-mini';

    for (const model of runtime.models) {
      for (let attempt = 1; attempt <= MAX_RETRIES_PER_MODEL; attempt += 1) {
        usedModel = model;
        try {
          const { replyText: raw, toolCallsTrace } = await staffCopilotChat({
            runtime,
            jwt,
            systemInstruction: INBOUND_ASSIST_COPILOT_SYSTEM,
            userText,
            model,
            maxOutputTokens: 2048,
          });

          let parsedOut = parseInboundAssistJson(raw);
          if (!parsedOut) {
            parsedOut = await repairInboundAssistJson(runtime, raw, model);
          }
          if (!parsedOut) {
            throw new Error('Resposta IA sem JSON valido (draft_reply / next_actions).');
          }
          const body = normalizeInboundAssistPayload(parsedOut);

          await writeAuditLog({
            actor_id: userId,
            action: 'ai.inbound_assist',
            entity_type: 'conversation',
            entity_id: conversation_id,
            workspace_id: workspaceId,
            metadata: {
              model,
              provider: runtime.providerId,
              attempt,
              draft_chars: body.draft_reply.length,
              next_actions_count: body.next_actions.length,
              tool_calls: toolCallsTrace,
            },
          });

          return reply.send({
            draft_reply: body.draft_reply,
            next_actions: body.next_actions,
            model,
          });
        } catch (e: unknown) {
          lastError = e;
          const status =
            typeof e === 'object' && e && 'status' in e ? Number((e as { status?: number }).status) : undefined;
          const retryable = isStaffLlmRetryable(status);
          request.log.warn({ err: e, model, attempt }, 'ai.inbound-assist.retry');
          if (!retryable) break;
          if (attempt < MAX_RETRIES_PER_MODEL) {
            await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
          }
        }
      }
    }

    const status =
      typeof lastError === 'object' && lastError && 'status' in lastError ? Number((lastError as { status?: number }).status) : 503;
    const msg =
      lastError instanceof Error ? lastError.message : 'Briefing automatico do Copiloto indisponivel no momento.';
    return reply.status(status >= 400 && status < 600 ? status : 503).send({ error: msg, model: usedModel });
  });

  app.get('/topics', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('ai_topics')
      .select('id,name,sample_count,created_at')
      .order('sample_count', { ascending: false })
      .limit(200);

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ data: data ?? [] });
  });

  app.get('/topics/:topicId/conversations', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { topicId } = request.params as { topicId: string };
    const { page = '1', limit = '30' } = request.query as Record<string, string>;
    const safeLimit = Math.min(60, Math.max(1, Number(limit) || 30));
    const offset = (Math.max(1, Number(page) || 1) - 1) * safeLimit;

    const { data, error, count } = await supabase
      .from('conversations')
      .select(
        `
        id, status, last_message_at, opened_at, ai_topic_set_at,
        contacts(id, wa_phone, display_name, profile_type)
      `,
        { count: 'exact' }
      )
      .eq('workspace_id', workspaceId)
      .eq('ai_topic_id', topicId)
      .order('last_message_at', { ascending: false })
      .range(offset, offset + safeLimit - 1);

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ data: data ?? [], total: count, page: Number(page), limit: safeLimit });
  });
}
