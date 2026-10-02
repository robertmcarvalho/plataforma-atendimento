/** Chaves de mensagens do intake WhatsApp (fonte única para web, API e orchestrator). */

export const CHANNEL_OPERATIONAL_MESSAGE_KEYS = [
  'greeting',
  'out_of_hours',
  'queue_full',
  'closing',
  'csat',
] as const;

export type ChannelOperationalMessageKey = (typeof CHANNEL_OPERATIONAL_MESSAGE_KEYS)[number];

export const CHANNEL_INTAKE_MESSAGE_KEYS = [
  'unknown_ask_driver',
  'unknown_not_driver',
  'ask_driver_name',
  'ask_driver_name_retry',
  'ask_driver_city',
  'ask_driver_city_retry',
  'no_pharmacy_city',
  'driver_greeting_list',
  'pharmacy_greeting_list',
  'leader_greeting_list',
  'partner_greeting_list',
  'ask_intent_invalid',
  'leader_ask_pharmacy_numbered',
  'leader_ask_pharmacy',
  'ask_pharmacy_numbered',
  'ask_pharmacy',
  'ask_pharmacy_before_demand_numbered',
  'ask_pharmacy_before_demand',
  'ask_pharmacy_city_numbered',
  'ask_pharmacy_city_list',
  'ask_pharmacy_invalid',
  'ask_pharmacy_invalid_numbered',
  'leader_greeting_pharmacy',
  'leader_ask_about_driver',
  'leader_ask_driver_list',
  'leader_ask_driver_invalid',
  'leader_ask_driver_invalid_numbered',
  'leader_no_drivers_at_pharmacy',
  'leader_ask_sector',
  'leader_no_pharmacy',
] as const;

export type ChannelIntakeMessageKey = (typeof CHANNEL_INTAKE_MESSAGE_KEYS)[number];

export type ChannelOperationalMessages = Record<ChannelOperationalMessageKey, string>;
export type ChannelIntakeMessages = Record<ChannelIntakeMessageKey, string>;

export type ChannelMessagesConfig = ChannelOperationalMessages & {
  intake: Partial<ChannelIntakeMessages>;
};

export const INTAKE_MESSAGE_LABELS: Record<
  ChannelIntakeMessageKey,
  { label: string; optional?: boolean; section: 'welcome' | 'collect' | 'pharmacy' | 'sector' }
> = {
  unknown_ask_driver: { label: 'Sem cadastro — pergunta se é entregador', section: 'welcome' },
  unknown_not_driver: { label: 'Não é entregador — encaminhamento', optional: true, section: 'welcome' },
  driver_greeting_list: { label: 'Boas-vindas — lista de setores (entregador)', section: 'welcome' },
  pharmacy_greeting_list: { label: 'Boas-vindas — farmácia', section: 'welcome' },
  leader_greeting_list: { label: 'Boas-vindas — líder (legado)', section: 'welcome', optional: true },
  partner_greeting_list: { label: 'Boas-vindas — parceiro', section: 'welcome' },
  leader_greeting_pharmacy: { label: 'Boas-vindas — líder escolhe farmácia', section: 'welcome' },
  ask_intent_invalid: { label: 'Setor inválido', optional: true, section: 'sector' },
  ask_driver_name: { label: 'Pergunta nome completo', section: 'collect' },
  ask_driver_name_retry: { label: 'Retry nome', optional: true, section: 'collect' },
  ask_driver_city: { label: 'Pergunta cidade', section: 'collect' },
  ask_driver_city_retry: { label: 'Retry cidade', optional: true, section: 'collect' },
  no_pharmacy_city: { label: 'Nenhuma farmácia na cidade', optional: true, section: 'collect' },
  ask_pharmacy_numbered: { label: 'Escolha farmácia (numerada)', optional: true, section: 'pharmacy' },
  ask_pharmacy: { label: 'Escolha farmácia (lista)', optional: true, section: 'pharmacy' },
  leader_ask_pharmacy_numbered: { label: 'Líder — farmácia numerada', optional: true, section: 'pharmacy' },
  leader_ask_pharmacy: { label: 'Líder — farmácia (lista)', optional: true, section: 'pharmacy' },
  leader_ask_about_driver: { label: 'Líder — assunto sobre entregador?', section: 'pharmacy' },
  leader_ask_driver_list: { label: 'Líder — escolher entregador', section: 'pharmacy' },
  leader_ask_driver_invalid: { label: 'Líder — entregador inválido (lista)', optional: true, section: 'pharmacy' },
  leader_ask_driver_invalid_numbered: { label: 'Líder — entregador inválido (número)', optional: true, section: 'pharmacy' },
  leader_no_drivers_at_pharmacy: { label: 'Líder — sem entregadores na farmácia', optional: true, section: 'pharmacy' },
  leader_ask_sector: { label: 'Líder — escolher setor', section: 'sector' },
  leader_no_pharmacy: { label: 'Líder — sem farmácias vinculadas', optional: true, section: 'pharmacy' },
  ask_pharmacy_before_demand_numbered: { label: 'Farmácia antes da demanda (número)', optional: true, section: 'pharmacy' },
  ask_pharmacy_before_demand: { label: 'Farmácia antes da demanda (lista)', optional: true, section: 'pharmacy' },
  ask_pharmacy_city_numbered: { label: 'Farmácias na cidade (numerada)', optional: true, section: 'pharmacy' },
  ask_pharmacy_city_list: { label: 'Farmácias na cidade (lista)', optional: true, section: 'pharmacy' },
  ask_pharmacy_invalid: { label: 'Farmácia inválida (lista)', optional: true, section: 'pharmacy' },
  ask_pharmacy_invalid_numbered: { label: 'Farmácia inválida (número)', optional: true, section: 'pharmacy' },
};

/** Chaves legadas do orchestrator → campo operacional em `messages`. */
export const CHANNEL_MESSAGE_KEY_ALIASES: Record<string, ChannelOperationalMessageKey> = {
  auto_reply_out_of_hours: 'out_of_hours',
  out_of_hours: 'out_of_hours',
};

/** Textos legados substituídos pela mensagem padrão atual (migration / backfill). */
export const LEGACY_OUT_OF_HOURS_MESSAGES = [
  'Obrigado pelo contato. No momento estamos fora do horario de atendimento. Voltamos em {{next_open_at}}.',
  'Obrigado pelo contato. No momento estamos fora do horário de atendimento. Voltamos em {{next_open_at}}.',
] as const;

export const DEFAULT_OUT_OF_HOURS_MESSAGE = [
  'Olá! Obrigado pelo contato.',
  '',
  'No momento estamos fora do horário de atendimento.',
  '',
  'Retornamos na {{next_open_at}}.',
  '',
  'Pode deixar sua mensagem aqui — responderemos assim que voltarmos.',
].join('\n');

const REQUIRED_INTAKE_KEYS: ChannelIntakeMessageKey[] = CHANNEL_INTAKE_MESSAGE_KEYS.filter(
  (k) => !INTAKE_MESSAGE_LABELS[k]?.optional
);

export function defaultChannelOperationalMessages(): ChannelOperationalMessages {
  return {
    greeting: 'Olá! Como podemos ajudar hoje?',
    out_of_hours: DEFAULT_OUT_OF_HOURS_MESSAGE,
    queue_full: 'Nossa fila está com alto volume. Você está na lista e retornaremos em instantes.',
    closing: 'Atendimento encerrado. Obrigado pelo contato!',
    csat: 'De 1 a 5, como você avalia nosso atendimento?',
  };
}

export function defaultChannelIntakeMessages(): ChannelIntakeMessages {
  return {
    unknown_ask_driver: 'Olá! Não encontrei seu cadastro neste número. Você é entregador?',
    unknown_not_driver: 'Entendido. Nossa equipe vai te atender em instantes pelo setor geral.',
    ask_driver_name: 'Qual é o seu nome completo?',
    ask_driver_name_retry: 'Não entendi o nome. Digite seu nome completo, por favor.',
    ask_driver_city: 'Em qual cidade você atua? (digite o nome da cidade)',
    ask_driver_city_retry: 'Digite o nome da cidade, por favor.',
    no_pharmacy_city:
      'Não encontrei farmácias ativas em {{city}} no nosso cadastro. Vou encaminhar seu atendimento para a equipe operacional finalizar o pré-cadastro. Para agilizar, informe CPF/CNPJ, telefone, CNH e placa se tiver, e a farmácia/unidade onde pretende atuar.',
    driver_greeting_list:
      'Olá! Como posso te ajudar? Toque em Ver setores e escolha o tipo de atendimento:',
    pharmacy_greeting_list: 'Olá! Escolha o setor macro e depois o tipo de demanda.',
    leader_greeting_list: 'Olá! Escolha o setor para encaminhamento:',
    partner_greeting_list:
      'Olá! Escolha o setor para seu atendimento. Toque em Ver setores e selecione a área:',
    leader_greeting_pharmacy:
      'Olá! Sobre qual farmácia você quer falar? Toque em Ver opções ou responda com o número da opção.',
    leader_ask_about_driver: 'O assunto é sobre algum entregador desta farmácia?',
    leader_ask_driver_list: 'Qual entregador? Toque em Ver opções e escolha na lista.',
    leader_ask_driver_invalid: 'Por favor, abra a lista e selecione um entregador ou "Não está na lista".',
    leader_ask_driver_invalid_numbered:
      'Resposta inválida. Envie o número do entregador, "9" para próxima página ou "0" para voltar.',
    leader_no_drivers_at_pharmacy:
      'Não há entregadores ativos vinculados a esta farmácia. Vamos escolher o setor de atendimento.',
    leader_ask_sector: 'Escolha o setor para encaminhar o atendimento. Toque em Ver setores.',
    leader_no_pharmacy:
      'Não encontramos farmácias vinculadas ao seu cadastro. Escolha o setor para encaminharmos o atendimento.',
    ask_intent_invalid: 'Opção inválida. Toque em Ver setores e escolha um setor da lista.',
    leader_ask_pharmacy_numbered: 'Qual farmácia? Escolha pelo número (vínculos do líder):',
    leader_ask_pharmacy: 'Antes de encaminhar: qual farmácia? Toque em Ver opções.',
    ask_pharmacy_numbered: 'Sobre qual farmácia é o atendimento? Escolha pelo número:',
    ask_pharmacy: 'Sobre qual farmácia é o seu atendimento? Toque em Ver opções e escolha:',
    ask_pharmacy_before_demand_numbered: 'Antes da demanda: qual farmácia? Escolha pelo número:',
    ask_pharmacy_before_demand: 'Antes de escolher a demanda: qual farmácia? Toque em Ver opções e escolha:',
    ask_pharmacy_city_numbered: 'Encontrei farmácias em "{{city}}". Escolha uma opção pelo número:',
    ask_pharmacy_city_list:
      'Encontrei farmácias em "{{city}}". Toque em Ver opções e escolha a sua farmácia:',
    ask_pharmacy_invalid: 'Por favor, abra a lista e selecione uma farmácia.',
    ask_pharmacy_invalid_numbered:
      'Resposta inválida. Envie o número da farmácia, "9" para próxima página ou "0" para voltar.',
  };
}

export function defaultChannelMessagesConfig(): ChannelMessagesConfig {
  return {
    ...defaultChannelOperationalMessages(),
    intake: { ...defaultChannelIntakeMessages() },
  };
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function parseChannelMessagesFromRaw(raw: unknown): ChannelMessagesConfig {
  const defaults = defaultChannelMessagesConfig();
  const r = asRecord(raw);
  const intakeRaw = asRecord(r.intake);

  const intake: Partial<ChannelIntakeMessages> = { ...defaults.intake };
  for (const key of CHANNEL_INTAKE_MESSAGE_KEYS) {
    const v = intakeRaw[key] ?? r[key];
    if (typeof v === 'string' && v.trim()) intake[key] = v.trim();
  }

  return {
    greeting: String(r.greeting || r.saudacao || defaults.greeting),
    out_of_hours: String(r.out_of_hours || r.foraHorario || defaults.out_of_hours),
    queue_full: String(r.queue_full || r.filaCheia || defaults.queue_full),
    closing: String(r.closing || r.encerramento || defaults.closing),
    csat: String(r.csat || defaults.csat),
    intake,
  };
}

export function mergeChannelMessagesConfig(
  partial: Partial<ChannelMessagesConfig> & { intake?: Partial<ChannelIntakeMessages> }
): ChannelMessagesConfig {
  const base = defaultChannelMessagesConfig();
  return {
    greeting: partial.greeting?.trim() || base.greeting,
    out_of_hours: partial.out_of_hours?.trim() || base.out_of_hours,
    queue_full: partial.queue_full?.trim() || base.queue_full,
    closing: partial.closing?.trim() || base.closing,
    csat: partial.csat?.trim() || base.csat,
    intake: {
      ...base.intake,
      ...(partial.intake || {}),
    },
  };
}

export function serializeChannelMessagesForConfig(messages: ChannelMessagesConfig): Record<string, unknown> {
  return {
    greeting: messages.greeting,
    out_of_hours: messages.out_of_hours,
    queue_full: messages.queue_full,
    closing: messages.closing,
    csat: messages.csat,
    intake: { ...messages.intake },
  };
}

export function applyMessageReplacements(text: string, replacements: Record<string, string> = {}): string {
  let out = text;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

/**
 * Resolve texto por chave (operacional, intake ou alias).
 * `legacyByKey` — ex.: linhas de workspace_flow_messages durante migração.
 */
export function resolveChannelMessageText(
  messages: ChannelMessagesConfig | null | undefined,
  messageKey: string,
  options?: {
    fallback?: string;
    replacements?: Record<string, string>;
    legacyByKey?: Record<string, string>;
  }
): string {
  const key = messageKey.trim();
  const cfg = messages || defaultChannelMessagesConfig();
  const replacements = options?.replacements || {};
  const fallback = options?.fallback ?? '';

  const aliasTarget = CHANNEL_MESSAGE_KEY_ALIASES[key];
  if (aliasTarget) {
    const text = cfg[aliasTarget];
    if (text?.trim()) return applyMessageReplacements(text, replacements);
  }

  if (CHANNEL_OPERATIONAL_MESSAGE_KEYS.includes(key as ChannelOperationalMessageKey)) {
    const text = cfg[key as ChannelOperationalMessageKey];
    if (text?.trim()) return applyMessageReplacements(text, replacements);
  }

  if (key === 'driver_greeting_list') {
    const fromIntake = cfg.intake.driver_greeting_list?.trim();
    if (fromIntake) return applyMessageReplacements(fromIntake, replacements);
    if (cfg.greeting?.trim()) return applyMessageReplacements(cfg.greeting, replacements);
  }

  const intakeKey = key as ChannelIntakeMessageKey;
  if (CHANNEL_INTAKE_MESSAGE_KEYS.includes(intakeKey)) {
    const fromIntake = cfg.intake[intakeKey]?.trim();
    if (fromIntake) return applyMessageReplacements(fromIntake, replacements);
  }

  const legacy = options?.legacyByKey?.[key]?.trim();
  if (legacy) return applyMessageReplacements(legacy, replacements);

  const defaultIntake = defaultChannelIntakeMessages()[intakeKey as ChannelIntakeMessageKey];
  if (defaultIntake) return applyMessageReplacements(defaultIntake, replacements);

  if (fallback.trim()) return applyMessageReplacements(fallback, replacements);
  return applyMessageReplacements(key, replacements);
}

export function validateChannelIntakeMessages(intake: Partial<ChannelIntakeMessages>): {
  ok: boolean;
  missing: ChannelIntakeMessageKey[];
  filled: ChannelIntakeMessageKey[];
} {
  const missing: ChannelIntakeMessageKey[] = [];
  const filled: ChannelIntakeMessageKey[] = [];
  for (const key of CHANNEL_INTAKE_MESSAGE_KEYS) {
    const text = intake[key]?.trim();
    if (text) filled.push(key);
    else if (REQUIRED_INTAKE_KEYS.includes(key)) missing.push(key);
  }
  return { ok: missing.length === 0, missing, filled };
}

/** Mapa message_key → content para backfill a partir de workspace_flow_messages. */
export function intakePatchFromLegacyFlowMessages(
  rows: Array<{ message_key: string; content: string }>
): Partial<ChannelIntakeMessages> {
  const patch: Partial<ChannelIntakeMessages> = {};
  for (const row of rows) {
    const k = row.message_key.trim() as ChannelIntakeMessageKey;
    if (CHANNEL_INTAKE_MESSAGE_KEYS.includes(k) && row.content?.trim()) {
      patch[k] = row.content.trim();
    }
  }
  return patch;
}
