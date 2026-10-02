import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadAiFeaturesConfig } from '@plataforma/ai-core';
import { authenticate } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';
import { resolveWorkspaceLlmRuntime } from '../lib/workspaceLlmRuntime';
import { extractCopilotComposerText } from '../lib/copilotComposerText';
import { writeAuditLog } from '../lib/auditLog';
import { copilotRateLimitHitAsync } from '../lib/copilotRateLimit';
import { COPILOT_SYSTEM_PROMPT } from '../lib/copilotSystemPrompt';
import { buildCommercialCopilotSystemPrompt } from '../lib/commercial/commercialCopilotPrompt';
import { resolveCommercialMotorConfig } from '../lib/commercial/commercialMotorConfig';
import { gatherEntityToolResults, loadConversationCopilotContext, maskCpf, maskPhone, type JwtUser } from '../lib/copilotContext';
import { botStepPt, clientSincePt, demandTitleFromKey, profileTypePt } from '../lib/copilotLabels';
import { isStaffLlmRetryable, staffCopilotChat, staffSuggestReply, type StaffCopilotToolTrace } from '../lib/staffLlmInvoke';
import { supabase } from '../lib/supabase';
import { enrichPharmacyApiRow } from '../lib/pharmacyCommercial';
import { buildCopilotInsightSignals } from '../lib/copilotInsightSignals';

const assistSchema = z.object({
  message: z.string().min(1).max(8000),
  conversation_id: z.string().uuid(),
});

const chatSchema = z.object({
  message: z.string().min(1).max(8000),
  conversation_id: z.string().uuid().optional(),
  commercial_lead_id: z.string().uuid().optional(),
});

const briefingSchema = z.object({
  conversation_id: z.string().uuid(),
  instruction: z.string().max(1000).optional(),
  response_tone: z.enum(['Empática', 'Direta', 'Formal']).optional(),
});

const briefingResponseSchema = z.object({
  summary: z.string().default(''),
  signals: z
    .array(
      z.object({
        label: z.string().default('Sinal'),
        value: z.string().default('Não informado'),
        tone: z.enum(['default', 'primary', 'warning', 'danger']).default('default'),
      }),
    )
    .default([]),
  operational_context: z.array(z.string()).default([]),
  contact_sheet: z
    .object({
      name: z.string().default('Contato não identificado'),
      profile: z.string().default('unknown'),
      phone: z.string().default(''),
      email: z.string().default(''),
      city: z.string().default(''),
      document: z.string().default(''),
      client_since: z.string().default(''),
      entity_type: z.enum(['driver', 'pharmacy', 'leader', 'contact']).default('contact'),
      entity_id: z.string().default(''),
      href: z.string().default(''),
    })
    .default({}),
  timeline: z
    .array(
      z.object({
        date: z.string().default(''),
        title: z.string().default('Evento'),
        summary: z.string().default(''),
        source: z.string().default('contexto'),
      }),
    )
    .default([]),
  next_steps: z
    .array(
      z.object({
        type: z.enum(['Verificar', 'Perguntar', 'Consultar', 'Escalar', 'Responder']).default('Verificar'),
        text: z.string().default(''),
      }),
    )
    .default([]),
  draft_reply: z.string().default(''),
  reply_variants: z
    .array(
      z.object({
        tone: z.string().default('Operacional'),
        text: z.string().default(''),
      }),
    )
    .default([]),
  warnings: z.array(z.string()).default([]),
});

type CopilotBriefingPayload = z.infer<typeof briefingResponseSchema>;

const MAX_RETRIES_PER_MODEL = 3;
const RETRY_BASE_MS = 350;

function copilotDisabled(): boolean {
  const v = String(process.env.COPILOT_ENABLED ?? 'true').toLowerCase();
  return v === 'false' || v === '0' || v === 'off';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Limita espaços verticais excessivos preservando Markdown na UI. */
function normalizeCopilotReply(text: string): string {
  return text.replace(/\n{5,}/g, '\n\n\n').trim();
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const raw = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function briefText(value: unknown, max = 240): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isTechnicalText(value: string): boolean {
  return /"\w+"\s*:|orchestrator_inbound|message_id|classification|source|payload|\{|\}|\[object Object\]/i.test(value || '');
}

function operationalText(value: unknown, fallback: string, max = 360): string {
  const text = briefText(value, max);
  if (!text || isTechnicalText(text)) return fallback;
  return text;
}

function parseJsonish(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text.startsWith('{') && !text.includes('"{')) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function humanizeType(value: unknown): string {
  const raw = String(value || '').toLowerCase();
  const map: Record<string, string> = {
    advance: 'adiantamento',
    question: 'dúvida',
    document: 'documentação',
    delivery: 'operação/entrega',
    ticket: 'atendimento',
  };
  return map[raw] || briefText(value || 'atendimento');
}

function toneForPriority(value: unknown): 'default' | 'primary' | 'warning' | 'danger' {
  const raw = String(value || '').toLowerCase();
  if (raw === 'high' || raw === 'urgent' || raw === 'alta') return 'danger';
  if (raw === 'normal' || raw === 'medium') return 'warning';
  return 'default';
}

function recentMessagesFromContext(conversationContext: Record<string, unknown> | null) {
  return ((conversationContext?.recent_messages as Array<Record<string, unknown>> | undefined) || []).map((m) => ({
    direction: String(m.direction || ''),
    content: briefText(m.content, 500),
    created_at: String(m.created_at || ''),
    ai_sentiment: (m.ai_sentiment as string | null | undefined) ?? null,
    ai_sentiment_score: (m.ai_sentiment_score as number | null | undefined) ?? null,
    ai_urgency: (m.ai_urgency as string | null | undefined) ?? null,
    ai_urgency_score: (m.ai_urgency_score as number | null | undefined) ?? null,
  }));
}

function inferDriverIntake(messages: Array<{ direction: string; content: string }>) {
  const inbound = messages.filter((m) => m.direction === 'inbound').map((m) => m.content).filter(Boolean);
  const name = inbound.find((x) => /\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+){1,}/.test(x)) || '';
  const city = inbound.find((x) => /\b(uberl[aâ]ndia|s[aã]o paulo|rio de janeiro|belo horizonte|bras[ií]lia)\b/i.test(x)) || '';
  const lastInbound = inbound.at(-1) || '';
  return { name, city, lastInbound };
}

type ContactSheetPayload = CopilotBriefingPayload['contact_sheet'];

async function buildContactSheetFromConversation(
  workspaceId: string,
  conversationContext: Record<string, unknown> | null,
): Promise<ContactSheetPayload> {
  const conv = conversationOf(conversationContext);
  const contact = (conv.contact || {}) as Record<string, unknown>;
  const messages = recentMessagesFromContext(conversationContext);
  const inferred = inferDriverIntake(messages);
  const displayName = inferred.name || briefText(contact.display_name || 'Contato não identificado');

  const ctxDriver = conv.context_driver as { id?: string; name?: string; cpf?: string; phone?: string } | null;
  if (ctxDriver?.id) {
    const { data: d } = await supabase
      .from('drivers')
      .select('id, name, phone, email, cpf, mei_cnpj, city, created_at')
      .eq('workspace_id', workspaceId)
      .eq('id', ctxDriver.id)
      .maybeSingle();
    if (d) {
      const doc = d.mei_cnpj || d.cpf;
      return {
        name: String(d.name || displayName),
        profile: profileTypePt('driver'),
        phone: maskPhone(d.phone) || briefText(contact.wa_phone || ''),
        email: briefText(d.email || ''),
        city: briefText(d.city || inferred.city || ''),
        document: doc ? maskCpf(String(doc)) || String(doc) : '',
        client_since: clientSincePt(d.created_at as string),
        entity_type: 'driver',
        entity_id: String(d.id),
        href: `/drivers/${d.id}`,
      };
    }
  }

  const ctxPharmacy = conv.context_pharmacy as { id?: string; trade_name?: string } | null;
  if (ctxPharmacy?.id) {
    const { data: p } = await supabase
      .from('pharmacies')
      .select(
        'id, trade_name, phone, cnpj, city, state, created_at, delivery_fee_cents, delivery_fee_driver_payout_cents, minimum_guaranteed_cents, minimum_guaranteed_driver_payout_cents, delivery_schedule',
      )
      .eq('workspace_id', workspaceId)
      .eq('id', ctxPharmacy.id)
      .maybeSingle();
    if (p) {
      return {
        name: String(p.trade_name || displayName),
        profile: profileTypePt('pharmacy'),
        phone: maskPhone(p.phone) || briefText(contact.wa_phone || ''),
        email: '',
        city: briefText([p.city, p.state].filter(Boolean).join(' / ') || ''),
        document: p.cnpj ? String(p.cnpj) : '',
        client_since: clientSincePt(p.created_at as string),
        entity_type: 'pharmacy',
        entity_id: String(p.id),
        href: `/pharmacies/${p.id}`,
      };
    }
  }

  const ctxLeader = conv.context_leader as { id?: string; name?: string } | null;
  if (ctxLeader?.id) {
    const { data: l } = await supabase
      .from('leaders')
      .select('id, name, phone, email, created_at')
      .eq('workspace_id', workspaceId)
      .eq('id', ctxLeader.id)
      .maybeSingle();
    if (l) {
      return {
        name: String(l.name || displayName),
        profile: profileTypePt('leader'),
        phone: maskPhone(l.phone) || briefText(contact.wa_phone || ''),
        email: briefText(l.email || ''),
        city: '',
        document: '',
        client_since: clientSincePt(l.created_at as string),
        entity_type: 'leader',
        entity_id: String(l.id),
        href: `/leaders/${l.id}`,
      };
    }
  }

  return {
    name: displayName,
    profile: profileTypePt(contact.profile_type),
    phone: briefText(contact.wa_phone || ''),
    email: '',
    city: inferred.city || '',
    document: '',
    client_since: clientSincePt(typeof conv.opened_at === 'string' ? conv.opened_at : null),
    entity_type: 'contact',
    entity_id: '',
    href: '',
  };
}

async function loadDriverRegistrationFields(workspaceId: string): Promise<string[]> {
  const { data } = await supabase
    .from('workspace_channels')
    .select('config')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'whatsapp')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  const cfg = (data?.config || {}) as { profiles?: { pre_registration_fields?: Record<string, unknown> } };
  const fields = cfg.profiles?.pre_registration_fields?.entregador;
  if (Array.isArray(fields)) return fields.map((x) => String(x)).filter(Boolean);
  return ['Nome', 'CPF/CNPJ', 'Telefone'];
}

async function buildDriverRegistrationGuidance(workspaceId: string, conversationContext: Record<string, unknown> | null) {
  const messages = recentMessagesFromContext(conversationContext);
  const inferred = inferDriverIntake(messages);
  const fields = await loadDriverRegistrationFields(workspaceId);
  const already = [
    inferred.name ? `nome informado: ${inferred.name}` : '',
    inferred.city ? `cidade informada: ${inferred.city}` : '',
    'telefone do WhatsApp já disponível na conversa',
  ].filter(Boolean);
  const missing = fields.filter((f) => !/nome|telefone/i.test(f));
  const cityLine = inferred.city ? `Cidade informada: ${inferred.city}. A farmácia/unidade de atuação precisa ser confirmada no painel.` : 'A cidade/farmácia de atuação precisa ser confirmada.';
  return [
    'Para finalizar o pré-cadastro do entregador, solicite apenas os dados que faltam e confirme a unidade de atuação.',
    '',
    `Já temos: ${already.join('; ')}.`,
    `Ainda peça/valide: ${missing.length ? missing.join(', ') : 'dados obrigatórios pendentes no cadastro'}; farmácia/unidade onde pretende atuar; CNH e placa, se fizerem parte da operação local.`,
    cityLine,
    '',
    'Texto sugerido para o cliente:',
    `Obrigado, ${inferred.name ? inferred.name.split(' ')[0] : 'tudo certo'}. Para finalizarmos seu pré-cadastro de entregador, por favor envie ${missing.length ? missing.join(', ') : 'os dados obrigatórios'} e confirme a farmácia/unidade onde pretende atuar. A equipe operacional vai validar esse vínculo antes de concluir o cadastro.`,
  ].join('\n');
}

type OperationalProfile = {
  signals: CopilotBriefingPayload['signals'];
  contact_sheet: CopilotBriefingPayload['contact_sheet'];
  operational_context: string[];
  next_steps: CopilotBriefingPayload['next_steps'];
  reply_variants: CopilotBriefingPayload['reply_variants'];
};

function conversationOf(conversationContext: Record<string, unknown> | null) {
  return (conversationContext?.conversation || {}) as Record<string, unknown>;
}

async function loadChannelConfig(workspaceId: string, conversationContext: Record<string, unknown> | null): Promise<Record<string, unknown>> {
  const conv = conversationOf(conversationContext);
  const channelId = String(conv.workspace_channel_id || '').trim();
  let query = supabase.from('workspace_channels').select('config, display_name').eq('workspace_id', workspaceId).eq('is_active', true).limit(1);
  if (channelId) query = query.eq('id', channelId);
  const { data } = await query.maybeSingle();
  return ((data?.config || {}) as Record<string, unknown>) || {};
}

async function loadCurrentBotStep(workspaceId: string, conversationId: string): Promise<string> {
  const { data } = await supabase
    .from('bot_sessions')
    .select('current_step')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return String(data?.current_step || '').trim();
}

function fieldsFromChannelConfig(config: Record<string, unknown>) {
  const profiles = (config.profiles || {}) as { pre_registration_fields?: Record<string, unknown> };
  const fields = profiles.pre_registration_fields?.entregador;
  if (Array.isArray(fields) && fields.length) return fields.map((f) => String(f)).filter(Boolean);
  return ['nome completo', 'CPF/CNPJ', 'telefone', 'cidade de atuação', 'farmácia/unidade pretendida', 'CNH', 'placa'];
}

function demandsFromChannelConfig(config: Record<string, unknown>) {
  const demands = Array.isArray(config.demands) ? (config.demands as Record<string, unknown>[]) : [];
  return demands
    .filter((d) => d.is_active !== false)
    .map((d) => String(d.title || d.name || d.demand_key || d.id || '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

function buildReplyVariants(base: string): CopilotBriefingPayload['reply_variants'] {
  const text = base.trim();
  return [
    { tone: 'Empática', text },
    { tone: 'Direta', text: text.replace(/^Obrigado,?\s*/i, 'Recebemos as informações. ') },
    { tone: 'Formal', text: text.replace(/^Obrigado/i, 'Agradecemos') },
  ];
}

function toneGuidance(tone?: 'Empática' | 'Direta' | 'Formal') {
  if (tone === 'Empática') return 'Use linguagem acolhedora, reconheça o contato e mantenha cordialidade sem excesso.';
  if (tone === 'Direta') return 'Use frases curtas, vá direto ao pedido dos dados faltantes e evite explicações longas.';
  if (tone === 'Formal') return 'Use linguagem profissional, impessoal e objetiva, adequada para comunicação institucional.';
  return '';
}

type RegistrationGapsSnapshot = {
  missing_required?: string[];
  missing_optional?: string[];
  summary_pt?: string;
};

function buildClientDraftFromGaps(args: {
  missingRequired: string[];
  contactName?: string;
  tone?: 'Empática' | 'Direta' | 'Formal';
}): string {
  const missing = args.missingRequired.map((m) => String(m).trim()).filter(Boolean);
  const first = (args.contactName || '').trim().split(/\s+/)[0] || '';
  if (!missing.length) {
    return applyToneFallback(
      'Obrigado pelo retorno. Estamos validando seu cadastro e a equipe segue com a liberação em breve.',
      args.tone,
    );
  }
  const list =
    missing.length === 1
      ? missing[0]!
      : `${missing.slice(0, -1).join(', ')} e ${missing[missing.length - 1]}`;
  const core = `Para finalizarmos seu cadastro de entregador, preciso que você informe: ${list}.`;
  const greet = first ? `Olá, ${first}! ` : 'Olá! ';
  const tail = ' Com essas informações, a equipe valida e conclui o cadastro.';
  return applyToneFallback(`${greet}${core}${tail}`, args.tone);
}

function contactDisplayNameFromContext(conversationContext: Record<string, unknown> | null): string {
  const conv = conversationOf(conversationContext);
  const contact = (conv.contact || {}) as Record<string, unknown>;
  const messages = recentMessagesFromContext(conversationContext);
  const inferred = inferDriverIntake(messages);
  return inferred.name || briefText(contact.display_name || '');
}

function applyToneFallback(text: string, tone?: 'Empática' | 'Direta' | 'Formal') {
  const clean = text.trim();
  if (!tone || !clean) return clean;
  if (tone === 'Direta') {
    return clean
      .replace(/^Obrigado, tudo certo\.\s*/i, 'Recebemos suas informações. ')
      .replace(/por favor envie/i, 'envie')
      .replace(/A equipe operacional vai validar esse vínculo antes de concluir o cadastro\./i, 'Validaremos o vínculo antes de concluir o cadastro.');
  }
  if (tone === 'Formal') {
    return clean
      .replace(/^Obrigado, tudo certo\./i, 'Agradecemos o envio das informações.')
      .replace(/Para finalizarmos/i, 'Para concluirmos')
      .replace(/por favor envie/i, 'solicitamos o envio de');
  }
  return clean.startsWith('Obrigado') ? clean : `Obrigado pelo retorno. ${clean}`;
}

function pharmacyOperationalLines(ctxPharmacy: Record<string, unknown> | null | undefined): string[] {
  if (!ctxPharmacy?.id) return [];
  const enriched = enrichPharmacyApiRow(ctxPharmacy);
  const lines: string[] = [];
  const terms = enriched.commercial_terms;
  if (Array.isArray(terms) && terms.length) lines.push(...(terms as string[]));
  const summary = String(enriched.delivery_schedule_summary || '').trim();
  if (summary) {
    const openNow = enriched.delivery_open_now;
    const statusLabel =
      openNow === true ? 'aberto' : openNow === false ? 'fechado' : 'fora do expediente ou não configurado';
    lines.push(`Horário delivery: ${summary}`);
    lines.push(`Status delivery agora: ${statusLabel}`);
  }
  return lines;
}

async function buildOperationalProfile(
  workspaceId: string,
  conversationId: string,
  conversationContext: Record<string, unknown> | null,
  events: Array<{ date: string; title: string; summary: string; source: string }>,
  toolResults: Record<string, unknown>,
): Promise<OperationalProfile> {
  const conv = conversationOf(conversationContext);
  const contact = (conv.contact || {}) as Record<string, unknown>;
  const sector = (conv.sector || {}) as Record<string, unknown>;
  const config = await loadChannelConfig(workspaceId, conversationContext);
  const currentStep = await loadCurrentBotStep(workspaceId, conversationId);
  const messages = recentMessagesFromContext(conversationContext);
  const inferred = inferDriverIntake(messages);
  const fields = fieldsFromChannelConfig(config);
  const demands = demandsFromChannelConfig(config);
  const lastEvent = events.at(-1);
  const profilePt = profileTypePt(contact.profile_type);
  const name = inferred.name || briefText(contact.display_name || 'Contato não identificado');
  const city = inferred.city || '';
  const contactSheet = await buildContactSheetFromConversation(workspaceId, conversationContext);
  const demandLabel = demandTitleFromKey(
    conv.demand_key,
    Array.isArray(config.demands) ? (config.demands as Array<Record<string, unknown>>) : undefined
  );
  const stepLabel = botStepPt(currentStep);
  const gapsEarly = toolResults.driver_registration_gaps as RegistrationGapsSnapshot | undefined;
  const draftBase = gapsEarly?.missing_required?.length
    ? buildClientDraftFromGaps({ missingRequired: gapsEarly.missing_required, contactName: name })
    : (await buildDriverRegistrationGuidance(workspaceId, conversationContext)).split('Texto sugerido para o cliente:\n')[1] ||
      'Obrigado pelas informações. Vou validar os dados do seu atendimento e te orientar na sequência.';

  const nextSteps: CopilotBriefingPayload['next_steps'] = [];
  if (currentStep === 'ask_if_driver') {
    nextSteps.push({ type: 'Perguntar', text: 'Confirmar o perfil do contato usando a pergunta atual do bot: se é entregador ou não.' });
  } else if (currentStep === 'ask_name') {
    nextSteps.push({ type: 'Perguntar', text: 'Solicitar nome completo do entregador antes de avançar para cidade/farmácia.' });
  } else if (currentStep === 'ask_city') {
    nextSteps.push({ type: 'Perguntar', text: 'Solicitar a cidade de atuação e conferir se existe farmácia ativa vinculada no webhook.' });
  } else if (currentStep === 'ask_pharmacy_link' || currentStep === 'ask_pharmacy') {
    nextSteps.push({ type: 'Verificar', text: 'Ajudar o contato a escolher a farmácia/unidade correta na lista apresentada pelo bot.' });
  } else if (currentStep === 'ask_intent') {
    nextSteps.push({ type: 'Consultar', text: `Selecionar a demanda operacional correta conforme catálogo do webhook${demands.length ? `: ${demands.join(', ')}.` : '.'}` });
  } else if (currentStep === 'ask_demand') {
    nextSteps.push({ type: 'Consultar', text: `O contato já está no setor; selecionar a demanda do webhook para finalizar o roteamento${demands.length ? `: ${demands.join(', ')}.` : '.'}` });
  } else {
    nextSteps.push({ type: 'Verificar', text: 'Conferir em qual etapa do fluxo o contato parou antes de responder manualmente.' });
  }
  if (!conv.demand_key) {
    nextSteps.push({ type: 'Consultar', text: `Definir demanda antes do handoff. Opções configuradas no webhook: ${demands.length ? demands.join(', ') : 'catálogo não encontrado no canal atual'}.` });
  }
  if (!conv.context_driver && profilePt === 'Não identificado') {
    nextSteps.push({ type: 'Perguntar', text: `Para pré-cadastro de entregador, validar: ${fields.join(', ')}.` });
  }
  nextSteps.push({ type: 'Responder', text: 'Responder sem prometer aprovação: informar que a equipe operacional vai validar cadastro e vínculo com farmácia/unidade.' });

  const gaps = gapsEarly;
  if (gaps?.missing_required?.length) {
    nextSteps.unshift({
      type: 'Consultar',
      text: gaps.summary_pt || `Faltam no cadastro: ${gaps.missing_required.join(', ')}.`,
    });
  }

  const insightSignals = buildCopilotInsightSignals({
    conversation: {
      ai_sentiment_last: (conv.ai_sentiment_last as string | null | undefined) ?? null,
      ai_urgency_score: (conv.ai_urgency_score as number | null | undefined) ?? null,
      demand_key: (conv.demand_key as string | null | undefined) ?? null,
      sla: conv.sla as { treatment_deadline?: string | null; first_response_deadline?: string | null } | undefined,
    },
    recentMessages: messages,
    demandTitle: demandLabel,
  });

  const signals: CopilotBriefingPayload['signals'] = [
    ...insightSignals,
    { label: 'Perfil', value: profilePt, tone: profilePt === 'Não identificado' ? 'warning' : 'primary' },
    { label: 'Etapa', value: stepLabel, tone: currentStep ? 'primary' : 'warning' },
    { label: 'Setor', value: briefText(sector.name || 'não definido'), tone: sector.name ? 'primary' : 'warning' },
    { label: 'Demanda', value: demandLabel, tone: conv.demand_key ? 'primary' : 'warning' },
  ];
  const ticket = Array.isArray(toolResults.tickets) ? (toolResults.tickets[0] as Record<string, unknown> | undefined) : undefined;
  if (ticket?.priority) signals.push({ label: 'Prioridade', value: briefText(ticket.priority), tone: toneForPriority(ticket.priority) });

  const ctxPharmacyRow = conv.context_pharmacy as Record<string, unknown> | null | undefined;
  const pharmacyLines =
    profilePt === 'Farmácia' || ctxPharmacyRow?.id ? pharmacyOperationalLines(ctxPharmacyRow) : [];

  return {
    signals,
    contact_sheet: contactSheet,
    operational_context: [
      'Canal: WhatsApp (atendimento messaging).',
      `Fluxo atual: ${stepLabel}.`,
      city ? `Cidade informada: ${city}.` : 'Cidade ainda não confirmada no contexto.',
      demands.length ? `Demandas no webhook: ${demands.join(', ')}.` : 'Sem demandas ativas configuradas neste canal.',
      gaps?.summary_pt ? gaps.summary_pt : '',
      lastEvent?.summary ? `Último evento: ${operationalText(lastEvent.summary, 'registro operacional recente')}.` : '',
      ...pharmacyLines,
    ].filter(Boolean),
    next_steps: nextSteps.slice(0, 5),
    reply_variants: buildReplyVariants(draftBase),
  };
}

function humanizeTicketPayload(payload: unknown): string {
  const p = parseJsonish(payload) || {};
  const classification = p.classification && typeof p.classification === 'object' ? (p.classification as Record<string, unknown>) : {};
  const type = humanizeType(classification.type || p.type || 'atendimento');
  const priority = briefText(classification.priority || p.priority || 'normal');
  const sla = classification.sla_minutes ? ` · SLA ${classification.sla_minutes} min` : '';
  return `Registro operacional classificado como ${type}, prioridade ${priority}${sla}.`;
}

async function loadOperationalEvents(workspaceId: string, conversationId: string, conversationContext: Record<string, unknown> | null, toolResults: Record<string, unknown>) {
  const events: Array<{ date: string; title: string; summary: string; source: string }> = [];
  const conv = conversationContext?.conversation as Record<string, unknown> | undefined;
  const openedAt = typeof conv?.opened_at === 'string' ? conv.opened_at : '';
  const config = await loadChannelConfig(workspaceId, conversationContext);
  const channelDemands = Array.isArray(config.demands) ? (config.demands as Array<Record<string, unknown>>) : undefined;
  const demand = demandTitleFromKey(conv?.demand_key, channelDemands);
  if (openedAt) {
    events.push({
      date: openedAt,
      title: 'Este contato',
      summary: demand ? `Conversa aberta. Demanda: ${demand}.` : 'Conversa aberta no atendimento.',
      source: 'conversation',
    });
  }

  const financial = Array.isArray(toolResults.financial_entries_recent) ? toolResults.financial_entries_recent : [];
  for (const entry of financial.slice(0, 8) as Record<string, unknown>[]) {
    events.push({
      date: String(entry.created_at || entry.start_date || ''),
      title: briefText(entry.type || 'Lançamento financeiro', 80),
      summary: briefText(`${entry.description || 'Lançamento financeiro'}${entry.status ? ` · ${entry.status}` : ''}`),
      source: 'financial_entries',
    });
  }

  const { data: tickets } = await supabase
    .from('tickets')
    .select('id, ticket_code, type, priority, status, created_at, due_at')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(5);

  const ticketIds = (tickets || []).map((t) => t.id).filter(Boolean);
  for (const ticket of tickets || []) {
    events.push({
      date: String(ticket.created_at || ''),
      title: String(ticket.ticket_code || 'Ticket'),
      summary: briefText(`${ticket.type || 'ticket'} · ${ticket.priority || 'prioridade'} · ${ticket.status || 'status'}`),
      source: 'tickets',
    });
  }

  if (ticketIds.length) {
    const { data: ticketEvents } = await supabase
      .from('ticket_events')
      .select('event_type, created_at, payload')
      .eq('workspace_id', workspaceId)
      .in('ticket_id', ticketIds)
      .order('created_at', { ascending: false })
      .limit(12);
    for (const ev of ticketEvents || []) {
      events.push({
        date: String(ev.created_at || ''),
        title: String(ev.event_type || 'Evento do ticket'),
        summary: humanizeTicketPayload(ev.payload),
        source: 'ticket_events',
      });
    }
  }

  return events
    .filter((e) => e.date || e.summary)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-20);
}

function fallbackBriefing(
  conversationContext: Record<string, unknown> | null,
  events: Array<{ date: string; title: string; summary: string; source: string }>,
  operational: OperationalProfile,
): CopilotBriefingPayload {
  const conv = conversationContext?.conversation as Record<string, unknown> | undefined;
  const contact = conv?.contact as Record<string, unknown> | undefined;
  const profile = briefText(contact?.profile_type || 'contato');
  const sector = conv?.sector as { name?: string } | undefined;
  const lastEvent = events.at(-1);
  const inferred = inferDriverIntake(recentMessagesFromContext(conversationContext));
  const contactLabel = inferred.name || briefText(contact?.display_name || profileTypePt(contact?.profile_type));
  const msgCount = recentMessagesFromContext(conversationContext).length;
  return {
    summary: [
      `${contactLabel} está em atendimento via WhatsApp${sector?.name ? ` no setor ${sector.name}` : ''}.`,
      msgCount > 2
        ? `Há ${msgCount} mensagens recentes na thread — revise o tom antes de responder.`
        : 'Conversa ainda com poucas mensagens — confirme dados essenciais com cordialidade.',
      inferred.city ? `Cidade mencionada: ${inferred.city}.` : 'Cidade ainda não confirmada.',
      lastEvent?.summary ? operationalText(lastEvent.summary, 'Há movimentação operacional recente vinculada a este contato.') : '',
    ].filter(Boolean).join(' '),
    signals: operational.signals,
    operational_context: operational.operational_context,
    contact_sheet: operational.contact_sheet,
    timeline: events.slice(-8).map((ev) => ({ ...ev, summary: operationalText(ev.summary, 'Evento operacional registrado.') })),
    next_steps: operational.next_steps,
    draft_reply: operational.reply_variants[0]?.text || 'Obrigado pelas informações. Vou conferir o histórico do atendimento e os registros vinculados antes de te passar a orientação correta.',
    reply_variants: operational.reply_variants,
    warnings: ['Revise dados financeiros e operacionais antes de responder ao cliente.'],
  };
}

function sanitizeBriefingPayload(
  value: CopilotBriefingPayload,
  fallback: CopilotBriefingPayload,
): CopilotBriefingPayload {
  return {
    ...value,
    signals: value.signals.length ? value.signals : fallback.signals,
    operational_context: (value.operational_context.length ? value.operational_context : fallback.operational_context)
      .map((item, idx) => operationalText(item, fallback.operational_context[idx] || 'Contexto operacional disponível.')),
    contact_sheet: value.contact_sheet?.name ? value.contact_sheet : fallback.contact_sheet,
    summary: operationalText(value.summary, fallback.summary),
    timeline: value.timeline.map((ev, idx) => ({
      ...ev,
      title: operationalText(ev.title, fallback.timeline[idx]?.title || 'Evento operacional', 80),
      summary: operationalText(ev.summary, fallback.timeline[idx]?.summary || 'Evento operacional registrado.'),
    })),
    next_steps: value.next_steps.map((step) => ({
      ...step,
      text: operationalText(step.text, 'Verificar dados do cadastro e orientar o cliente com base no histórico operacional.'),
    })),
    draft_reply: operationalText(value.draft_reply, fallback.draft_reply, 1200),
    reply_variants: (value.reply_variants.length ? value.reply_variants : fallback.reply_variants).map((variant, idx) => ({
      tone: variant.tone || fallback.reply_variants[idx]?.tone || 'Operacional',
      text: operationalText(variant.text, fallback.reply_variants[idx]?.text || fallback.draft_reply, 1200),
    })),
    warnings: value.warnings.map((w) => operationalText(w, 'Revise o histórico operacional antes de responder.')),
  };
}

async function generateDraftFromInstruction(args: {
  workspaceId: string;
  conversationContext: Record<string, unknown> | null;
  instruction: string;
  responseTone?: 'Empática' | 'Direta' | 'Formal';
  fallbackDraft: string;
  runtime: Awaited<ReturnType<typeof resolveWorkspaceLlmRuntime>>;
  model: string;
  gaps?: RegistrationGapsSnapshot;
}): Promise<string> {
  const instruction = args.instruction.trim();
  const toneLine = args.responseTone ? `Tom obrigatório: ${args.responseTone}.` : '';
  const contactName = contactDisplayNameFromContext(args.conversationContext);
  if (!instruction && args.gaps?.missing_required?.length) {
    return buildClientDraftFromGaps({
      missingRequired: args.gaps.missing_required,
      contactName,
      tone: args.responseTone,
    });
  }
  if (!instruction && !args.responseTone) return args.fallbackDraft;
  if (/dados|cadastro|entregador|finalizar|solicitar|ficha|faltam|lacuna/i.test(instruction)) {
    if (args.gaps?.missing_required?.length) {
      const fromGaps = buildClientDraftFromGaps({
        missingRequired: args.gaps.missing_required,
        contactName,
        tone: args.responseTone,
      });
      if (!args.runtime.ok || !instruction) return fromGaps;
    }
    const base = (await buildDriverRegistrationGuidance(args.workspaceId, args.conversationContext)).split('Texto sugerido para o cliente:\n')[1] || args.fallbackDraft;
    if (!args.responseTone || !args.runtime.ok) return applyToneFallback(base, args.responseTone);
  }
  if (!args.runtime.ok) return args.fallbackDraft;
  try {
    const out = await staffSuggestReply(
      args.runtime,
      [
        'Voce redige SOMENTE um rascunho de resposta para o cliente final.',
        'Nao retorne JSON, markdown tecnico, explicacao interna ou lista de fontes.',
        'Obedeça literalmente a instrucao do atendente.',
        toneLine,
        toneGuidance(args.responseTone),
        'Use apenas dados do CONTEXTO_JSON; se faltar dado, peça confirmação sem inventar.',
      ].join('\n'),
      [
        'CONTEXTO_JSON:',
        JSON.stringify({ conversation: args.conversationContext, draft_base: args.fallbackDraft }, null, 2),
        '',
        'INSTRUCAO_DO_ATENDENTE:',
        instruction || 'Gere uma resposta operacional curta para o cliente.',
        toneLine,
        toneGuidance(args.responseTone),
      ].join('\n'),
      args.model,
    );
    const generated = operationalText(out.text, args.fallbackDraft, 1400);
    return applyToneFallback(generated, args.responseTone);
  } catch {
    return applyToneFallback(args.fallbackDraft, args.responseTone);
  }
}

export type CopilotToolCallTrace = StaffCopilotToolTrace;

export async function copilotRoutes(app: FastifyInstance) {
  app.post('/briefing', { preHandler: [authenticate] }, async (request, reply) => {
    if (copilotDisabled()) {
      return reply.status(503).send({ error: 'Copiloto desativado (COPILOT_ENABLED).' });
    }

    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const cfg = await loadAiFeaturesConfig(supabase, workspaceId);
    if (!cfg.inbound_assist) {
      return reply.status(503).send({ error: 'Briefing automático do Copiloto desativado nas configurações de IA.' });
    }

    const runtime = await resolveWorkspaceLlmRuntime(workspaceId);
    if (!runtime.ok) {
      return reply.status(503).send({
        error:
          'LLM nao configurado. Cadastre o provedor em Configuracoes > Canais > IA / LLM ou defina fallback (ex.: GOOGLE_API_KEY / GEMINI_API_KEY) no servidor.',
      });
    }

    const parsed = briefingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados invalidos', details: parsed.error.flatten() });
    }

    const jwt = request.user as JwtUser;
    const userId = jwt.sub;
    if (!userId) return reply.status(401).send({ error: 'Nao autorizado' });
    if (await copilotRateLimitHitAsync(userId)) {
      return reply.status(429).send({ error: 'Limite de uso do copiloto por minuto excedido. Tente novamente em instantes.' });
    }

    const conversationContext = await loadConversationCopilotContext(parsed.data.conversation_id, workspaceId);
    if (!conversationContext) {
      return reply.status(404).send({ error: 'Conversa nao encontrada.' });
    }

    const toolResults = await gatherEntityToolResults({
      message: [
        'Gerar briefing operacional do atendimento aberto.',
        JSON.stringify(conversationContext?.conversation || {}),
      ].join('\n'),
      user: jwt,
      conversationContext,
      workspaceId,
    });
    const operationalEvents = await loadOperationalEvents(workspaceId, parsed.data.conversation_id, conversationContext, toolResults);
    const operationalProfile = await buildOperationalProfile(workspaceId, parsed.data.conversation_id, conversationContext, operationalEvents, toolResults);
    const fallback = fallbackBriefing(conversationContext, operationalEvents, operationalProfile);

    const systemInstruction = [
      'Voce e um copiloto interno de atendimento. Responda SOMENTE JSON valido.',
      'Nao fale com o cliente final diretamente fora do campo draft_reply.',
      'Nao invente datas, valores, nomes, SLAs ou eventos. Use somente CONTEXTO_JSON.',
      'Contexto de atendimento e a ficha canonica; aqui voce apenas interpreta e sugere.',
      'Formato obrigatorio: summary string, signals array, operational_context array, contact_sheet object, timeline array, next_steps array, draft_reply string, reply_variants array, warnings array.',
      'timeline[].source deve indicar conversation, messages, financial_entries, tickets, ticket_events ou contexto.',
      'next_steps[].type deve ser Verificar, Perguntar, Consultar, Escalar ou Responder.',
      'Nunca copie JSON bruto, payload, source, message_id ou classification para campos exibidos ao atendente.',
      'Proximos passos devem ser específicos da etapa do bot/fluxo do webhook e nao ações reais no sistema.',
    ].join('\n');
    const userText = [
      'CONTEXTO_JSON:',
      JSON.stringify(
        {
          conversation: conversationContext,
          entity_search: toolResults,
          operational_events: operationalEvents,
          operational_profile: operationalProfile,
          fallback,
        },
        null,
        2,
      ),
      '',
      'TAREFA:',
      'Gere briefing em portugues brasileiro, objetivo e operacional. Timeline condensada, proximos passos concretos e rascunho educado.',
      parsed.data.instruction
        ? `Instrucao especifica para draft_reply: ${parsed.data.instruction}. O campo draft_reply deve obedecer esta instrucao e ser texto pronto para o cliente.`
        : '',
      parsed.data.response_tone ? `Tom obrigatorio do draft_reply: ${parsed.data.response_tone}.` : '',
    ].join('\n');

    let model = runtime.models[0] || 'gpt-4o-mini';
    let result: CopilotBriefingPayload = fallback;
    try {
      const out = await staffSuggestReply(runtime, systemInstruction, userText, model);
      model = out.model;
      const raw = extractJsonObject(out.text);
      const parsedResponse = raw ? briefingResponseSchema.safeParse(raw) : null;
      if (parsedResponse?.success) result = parsedResponse.data;
    } catch (e) {
      request.log.warn({ err: e }, 'copilot.briefing.fallback');
    }
    result = sanitizeBriefingPayload(result, fallback);
    result.signals = operationalProfile.signals;
    result.operational_context = operationalProfile.operational_context;
    result.contact_sheet = operationalProfile.contact_sheet;
    result.next_steps = operationalProfile.next_steps;
    if (!result.timeline.length) result.timeline = fallback.timeline;

    const gapsForDraft = toolResults.driver_registration_gaps as RegistrationGapsSnapshot | undefined;
    let draftInstruction = parsed.data.instruction?.trim() || '';
    if (!draftInstruction && gapsForDraft?.missing_required?.length) {
      draftInstruction = `Peça ao cliente somente estes dados obrigatórios em falta: ${gapsForDraft.missing_required.join(', ')}.`;
    }

    if (parsed.data.instruction || parsed.data.response_tone) {
      result.draft_reply = await generateDraftFromInstruction({
        workspaceId,
        conversationContext,
        instruction: draftInstruction,
        responseTone: parsed.data.response_tone,
        fallbackDraft: result.draft_reply,
        runtime,
        model,
        gaps: gapsForDraft,
      });
      result.reply_variants = parsed.data.response_tone
        ? [{ tone: parsed.data.response_tone, text: result.draft_reply }]
        : buildReplyVariants(result.draft_reply);
    }

    await writeAuditLog({
      actor_id: userId,
      action: 'copilot.briefing',
      entity_type: 'conversation',
      entity_id: parsed.data.conversation_id,
      workspace_id: workspaceId,
      metadata: {
        model,
        provider: runtime.providerId,
        response_tone: parsed.data.response_tone || null,
        event_count: operationalEvents.length,
        entity_keys: Object.keys(toolResults),
      },
    });

    return reply.send({
      ...result,
      model,
      sources: {
        has_conversation_context: true,
        event_count: operationalEvents.length,
        entity_keys: Object.keys(toolResults),
      },
    });
  });

  app.post('/assist', { preHandler: [authenticate] }, async (request, reply) => {
    if (copilotDisabled()) {
      return reply.status(503).send({ error: 'Copiloto desativado (COPILOT_ENABLED).' });
    }

    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const runtime = await resolveWorkspaceLlmRuntime(workspaceId);
    if (!runtime.ok) {
      return reply.status(503).send({
        error:
          'LLM nao configurado. Cadastre o provedor em Configuracoes > Canais > IA / LLM ou defina fallback (ex.: GOOGLE_API_KEY / GEMINI_API_KEY) no servidor.',
      });
    }

    const parsed = assistSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados invalidos', details: parsed.error.flatten() });
    }

    const jwt = request.user as JwtUser;
    const userId = jwt.sub;
    if (!userId) return reply.status(401).send({ error: 'Nao autorizado' });
    if (await copilotRateLimitHitAsync(userId)) {
      return reply.status(429).send({ error: 'Limite de uso do copiloto por minuto excedido. Tente novamente em instantes.' });
    }

    const conversationContext = await loadConversationCopilotContext(parsed.data.conversation_id, workspaceId);
    if (!conversationContext) {
      return reply.status(404).send({ error: 'Conversa nao encontrada.' });
    }

    const toolResults = await gatherEntityToolResults({
      message: parsed.data.message,
      user: jwt,
      conversationContext,
      workspaceId,
    });

    const userText = [
      'CONTEXTO_JSON (use somente estes dados; para fichas, lacunas de cadastro e listagens use as TOOLS):',
      JSON.stringify({ conversation: conversationContext, entity_search: toolResults }, null, 2),
      '',
      'PERGUNTA_DO_ATENDENTE (responda ao ATENDENTE em Markdown, nao ao cliente final):',
      parsed.data.message,
    ].join('\n');

    let lastError: unknown = null;
    let usedModel = runtime.models[0] || 'gpt-4o-mini';

    for (const model of runtime.models) {
      for (let attempt = 1; attempt <= MAX_RETRIES_PER_MODEL; attempt += 1) {
        usedModel = model;
        try {
          const { replyText: rawReply, toolCallsTrace } = await staffCopilotChat({
            runtime,
            jwt,
            workspaceId,
            systemInstruction: COPILOT_SYSTEM_PROMPT,
            userText,
            model,
            maxOutputTokens: 1800,
          });

          await writeAuditLog({
            actor_id: userId,
            action: 'copilot.assist',
            entity_type: 'conversation',
            entity_id: parsed.data.conversation_id,
            workspace_id: workspaceId,
            metadata: {
              model,
              provider: runtime.providerId,
              attempt,
              message_preview: parsed.data.message.slice(0, 200),
              tool_calls: toolCallsTrace,
            },
          });

          return reply.send({
            reply: normalizeCopilotReply(rawReply),
            model,
            sources: {
              has_conversation_context: true,
              entity_keys: Object.keys(toolResults),
              tool_calls: toolCallsTrace,
            },
          });
        } catch (e: unknown) {
          lastError = e;
          const status = typeof e === 'object' && e && 'status' in e ? Number((e as { status?: number }).status) : undefined;
          if (!isStaffLlmRetryable(status)) break;
          if (attempt < MAX_RETRIES_PER_MODEL) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        }
      }
    }

    const msg = lastError instanceof Error ? lastError.message : 'Copiloto indisponivel no momento.';
    return reply.status(503).send({ error: msg, model: usedModel });
  });

  app.post('/chat', { preHandler: [authenticate] }, async (request, reply) => {
    if (copilotDisabled()) {
      return reply.status(503).send({ error: 'Copiloto desativado (COPILOT_ENABLED).' });
    }

    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const runtime = await resolveWorkspaceLlmRuntime(workspaceId);
    if (!runtime.ok) {
      return reply.status(503).send({
        error:
          'LLM nao configurado. Cadastre o provedor em Configuracoes > Canais > IA / LLM ou defina fallback (ex.: GOOGLE_API_KEY / GEMINI_API_KEY) no servidor.',
      });
    }

    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados invalidos', details: parsed.error.flatten() });
    }

    const jwt = request.user as JwtUser;
    const userId = jwt.sub;
    if (!userId) return reply.status(401).send({ error: 'Nao autorizado' });

    if (await copilotRateLimitHitAsync(userId)) {
      return reply.status(429).send({ error: 'Limite de uso do copiloto por minuto excedido. Tente novamente em instantes.' });
    }

    const { message, conversation_id, commercial_lead_id } = parsed.data;

    let conversationContext: Record<string, unknown> | null = null;
    if (conversation_id) {
      conversationContext = await loadConversationCopilotContext(conversation_id, workspaceId);
      if (!conversationContext) {
        return reply.status(404).send({ error: 'Conversa nao encontrada.' });
      }
    }

    let commercialLeadContext: Record<string, unknown> | null = null;
    if (commercial_lead_id) {
      const { data: lead, error: leadErr } = await supabase
        .from('commercial_leads')
        .select('*, stage:commercial_pipeline_stages!stage_id(id, name, probability_pct, is_won, is_lost)')
        .eq('workspace_id', workspaceId)
        .eq('id', commercial_lead_id)
        .maybeSingle();
      if (leadErr) return reply.status(500).send({ error: leadErr.message });
      if (!lead) return reply.status(404).send({ error: 'Lead comercial não encontrado.' });

      let recentMessages: unknown[] = [];
      const convId = lead.primary_conversation_id as string | null;
      if (convId) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('direction, content, created_at, status')
          .eq('workspace_id', workspaceId)
          .eq('conversation_id', convId)
          .order('created_at', { ascending: false })
          .limit(15);
        recentMessages = (msgs || []).reverse();
        if (!conversationContext) {
          conversationContext = await loadConversationCopilotContext(convId, workspaceId);
        }
      }
      commercialLeadContext = { lead, recent_messages: recentMessages };
    }

    const toolResults = await gatherEntityToolResults({
      message,
      user: jwt,
      conversationContext,
      workspaceId,
    });

    const contextPayload = {
      conversation: conversationContext,
      commercial_lead: commercialLeadContext,
      entity_search: toolResults,
    };

    const userText = [
      'CONTEXTO_JSON (use somente estes dados para contexto da conversa; para contagens/listas agregadas use as TOOLS):',
      JSON.stringify(contextPayload, null, 2),
      '',
      'PERGUNTA_DO_ATENDENTE:',
      message,
    ].join('\n');

    let lastError: unknown = null;
    let usedModel = runtime.models[0] || 'gpt-4o-mini';
    const commercialMode = Boolean(commercial_lead_id);
    const systemInstruction = commercialMode
      ? buildCommercialCopilotSystemPrompt(await resolveCommercialMotorConfig(workspaceId))
      : COPILOT_SYSTEM_PROMPT;

    for (const model of runtime.models) {
      for (let attempt = 1; attempt <= MAX_RETRIES_PER_MODEL; attempt += 1) {
        usedModel = model;
        try {
          const { replyText: rawReply, toolCallsTrace } = await staffCopilotChat({
            runtime,
            jwt,
            workspaceId,
            systemInstruction,
            userText,
            model,
            commercialMode,
          });

          const replyText = normalizeCopilotReply(rawReply);
          const composerText = extractCopilotComposerText(replyText);

          await writeAuditLog({
            actor_id: userId,
            action: 'copilot.query',
            entity_type: commercial_lead_id ? 'commercial_leads' : conversation_id ? 'conversation' : null,
            entity_id: commercial_lead_id ?? conversation_id ?? null,
            workspace_id: workspaceId,
            metadata: {
              model,
              provider: runtime.providerId,
              attempt,
              message_preview: message.slice(0, 200),
              has_conversation: Boolean(conversation_id),
              commercial_lead_id: commercial_lead_id ?? null,
              tool_calls: toolCallsTrace,
              turns: toolCallsTrace.length,
            },
          });

          return reply.send({
            reply: replyText,
            composer_text: composerText || replyText,
            model,
            sources: {
              has_conversation_context: Boolean(conversationContext),
              entity_keys: Object.keys(toolResults),
              tool_calls: toolCallsTrace,
            },
          });
        } catch (e: unknown) {
          lastError = e;
          const status = typeof e === 'object' && e && 'status' in e ? Number((e as { status?: number }).status) : undefined;
          const retryable = isStaffLlmRetryable(status);
          request.log.warn({ err: e, model, attempt }, 'copilot.chat.retry');

          if (!retryable) {
            break;
          }

          if (attempt < MAX_RETRIES_PER_MODEL) {
            const backoff = RETRY_BASE_MS * 2 ** (attempt - 1);
            await sleep(backoff);
            continue;
          }
        }
      }
    }

    const status =
      typeof lastError === 'object' && lastError && 'status' in lastError ? Number((lastError as { status?: number }).status) : 503;

    const msg =
      lastError instanceof Error
        ? lastError.message
        : 'Copiloto indisponivel no momento. Tente novamente em instantes.';

    return reply.status(status >= 400 && status < 600 ? status : 503).send({
      error: msg,
      model: usedModel,
      fallback_models: runtime.models,
    });
  });
}
