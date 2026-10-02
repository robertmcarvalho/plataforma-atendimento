/** Constantes e flags de ambiente do orquestrador. */

export const BOT_SESSION_TTL_HOURS = Number(process.env.BOT_SESSION_TTL_HOURS) || 24;

/** WhatsApp Cloud API: botão até 20 chars; linha de lista até 24 chars; máx. 10 linhas por mensagem. */
export const WA_BTN_TITLE_MAX = 20;
export const WA_LIST_ROW_TITLE_MAX = 24;
export const WA_LIST_MAX_ROWS = 10;
export const NUMBERED_MENU_PAGE_SIZE = 8;

/** Listas interativas WhatsApp — botão ≤20 chars, seção ≤24 (`sendListMessage` trunca). */
export const WA_LIST_BTN_SECTORS = 'Ver setores';
export const WA_LIST_SECTION_SECTORS = 'Setores';
export const WA_LIST_BTN_DEMANDS = 'Ver demandas';
export const WA_LIST_SECTION_DEMANDS = 'Demandas';
export const WA_LIST_BTN_PHARMACIES = 'Ver opções';
export const WA_LIST_SECTION_PHARMACIES = 'Farmácias';
export const WA_LIST_BTN_DRIVERS = 'Ver entregadores';
export const WA_LIST_SECTION_DRIVERS = 'Entregadores';
export const WA_LIST_BTN_PROFILES = 'Ver perfis';
export const WA_LIST_SECTION_PROFILES = 'Perfil';

/** Linhas do menu numerado: nomes muito longos quebram leitura no celular. */
export const NUMBERED_MENU_TITLE_MAX = 56;

/** Quando `true`, a triagem guiada (identify → setor → demanda) roda antes do funil legado por keywords. */
export const GUIDED_INTAKE_FIRST =
  String(process.env.ORCHESTRATOR_GUIDED_INTAKE_FIRST || '').toLowerCase() === 'true';

/** Quando `false`, o funil legado (`identify`, farmácia etc.) deixa de rodar após a triagem guiada. */
export const LEGACY_BOT_SESSION_ENABLED =
  String(process.env.ORCHESTRATOR_LEGACY_BOT_SESSION_ENABLED || 'true').toLowerCase() !== 'false';

export const LATENCY_TARGETS_MS = {
  inbound_ack: Number(process.env.ORCHESTRATOR_TARGET_INBOUND_ACK_MS || 1000),
  message_persisted: Number(process.env.ORCHESTRATOR_TARGET_MESSAGE_PERSISTED_MS || 3000),
  bot_reply_sent: Number(process.env.ORCHESTRATOR_TARGET_BOT_REPLY_SENT_MS || 5000),
  total_processing: Number(process.env.ORCHESTRATOR_TARGET_TOTAL_PROCESSING_MS || 10000),
};

/** Idempotência contra reentrega PubSub / race: último `meta_message_id` da WhatsApp já tratado no bot. */
export const BOT_INBOUND_META_DEDUP_KEY = 'bot_last_inbound_meta_message_id';

export const LEGACY_INTENT_TO_SECTOR: Record<string, string> = {
  financial: 'Financeiro',
  documentation: 'Operacional',
  delivery: 'Operacional',
  general: 'Atendimento Geral',
  direct: 'Atendimento Geral',
};
