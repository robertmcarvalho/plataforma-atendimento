/** Chaves ou prefixos permitidos em `PUT /api/settings` (admin). Evita escrita arbitrária em `app_settings`. */

const EXACT = new Set([
  'chat_signature_enabled',
  'user_presence',
  'financial_discount_rules',
  'auto_reply_out_of_hours',
  'alert_emails',
]);

const PREFIXES = ['workspace_', 'chat_', 'financial_', 'auto_reply_', 'bot_', 'campaign_', 'sla_', 'template_', 'presence_', 'mcp_', 'ai_'];

export function isAllowedAppSettingsKey(key: string): boolean {
  if (!/^[a-z][a-z0-9_]{0,80}$/.test(key)) return false;
  if (key.startsWith('__')) return false;
  if (EXACT.has(key)) return true;
  return PREFIXES.some((p) => key.startsWith(p));
}
