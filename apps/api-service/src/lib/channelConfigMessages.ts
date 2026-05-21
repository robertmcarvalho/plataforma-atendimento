import {
  defaultChannelMessagesConfig,
  mergeChannelMessagesConfig,
  parseChannelMessagesFromRaw,
  serializeChannelMessagesForConfig,
  validateChannelIntakeMessages,
  type ChannelMessagesConfig,
} from '@plataforma/channel-runtime';

/** Garante `config.messages` com pacote operacional + intake completo (defaults onde vazio). */
export function ensureChannelConfigMessages(config: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const next = { ...(config || {}) };
  const parsed = parseChannelMessagesFromRaw(next.messages);
  const merged = mergeChannelMessagesConfig(parsed);
  next.messages = serializeChannelMessagesForConfig(merged);
  return next;
}

export function readChannelMessagesConfig(config: Record<string, unknown> | null | undefined): ChannelMessagesConfig {
  return parseChannelMessagesFromRaw((config || {}).messages);
}

export function validateChannelConfigMessages(config: Record<string, unknown> | null | undefined) {
  const messages = readChannelMessagesConfig(config);
  return validateChannelIntakeMessages(messages.intake);
}

export { defaultChannelMessagesConfig };
