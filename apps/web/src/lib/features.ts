function envFlag(name: string, defaultValue = false) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

export const features = {
  channels: {
    instagram: envFlag('NEXT_PUBLIC_ENABLE_INSTAGRAM', false),
    email: envFlag('NEXT_PUBLIC_ENABLE_EMAIL', false),
  },
  aiSuggestions: envFlag('NEXT_PUBLIC_ENABLE_AI_SUGGESTIONS', false),
  /** Badges de sentimento/urgência na lista e acordeão de insights na coluna detalhes (default: ligado). */
  aiAnalysisBadges: envFlag('NEXT_PUBLIC_AI_ANALYSIS_BADGES', true),
  /** Botão "Sugerir resposta" no composer (API + ai_features_config). Default: ligado. */
  aiSuggestReply: envFlag('NEXT_PUBLIC_AI_SUGGEST_REPLY', true),
  /** Briefing automático no copiloto interno (API + inbound_assist). Default: ligado. */
  aiInboundAssist: envFlag('NEXT_PUBLIC_AI_INBOUND_ASSIST', true),
  /** Painel de ticket/MCP/timeline na coluna Detalhes da Inbox (default: ligado). */
  ticketingPanel: envFlag('NEXT_PUBLIC_ENABLE_TICKETING_PANEL', true),
} as const;

