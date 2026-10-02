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
  /** Badges de sentimento/urgência na lista e acordeão de insights na coluna detalhes. */
  aiAnalysisBadges: envFlag('NEXT_PUBLIC_AI_ANALYSIS_BADGES', false),
  /** Botão "Sugerir resposta" no composer (API + ai_features_config). */
  aiSuggestReply: envFlag('NEXT_PUBLIC_AI_SUGGEST_REPLY', false),
  /** Briefing automático no copiloto interno (API + inbound_assist). */
  aiInboundAssist: envFlag('NEXT_PUBLIC_AI_INBOUND_ASSIST', false),
  /** Painel de ticket/MCP/timeline na coluna Detalhes da Inbox. */
  ticketingPanel: envFlag('NEXT_PUBLIC_ENABLE_TICKETING_PANEL', false),
} as const;

