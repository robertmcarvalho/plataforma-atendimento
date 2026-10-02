/** Não enviar encerramento automático se o atendente respondeu há pouco (evita duplicar despedida). */
export const RECENT_ATTENDANT_REPLY_SKIP_CLOSING_MS = 5 * 60 * 1000;

const DEFAULT_CLOSING_TEXT = 'Atendimento encerrado. Obrigado pelo contato!';

/** Textos legados de fila/comercial que não servem como encerramento pós-atendimento. */
const MISLEADING_CLOSING_PATTERN = /em breve retornamos/i;

export function resolveClosingTextForPostResolve(rawClosing: string): string {
  const trimmed = String(rawClosing || '').trim();
  if (!trimmed) return '';
  if (MISLEADING_CLOSING_PATTERN.test(trimmed)) return DEFAULT_CLOSING_TEXT;
  return trimmed;
}

export function shouldSkipClosingAfterAttendantReply(args: {
  attendantId: string | null | undefined;
  lastOutboundAt: string | null | undefined;
  nowMs?: number;
  windowMs?: number;
}): boolean {
  const attendantId = String(args.attendantId || '').trim();
  if (!attendantId) return false;
  const lastOutboundAt = String(args.lastOutboundAt || '').trim();
  if (!lastOutboundAt) return false;
  const now = args.nowMs ?? Date.now();
  const window = args.windowMs ?? RECENT_ATTENDANT_REPLY_SKIP_CLOSING_MS;
  return now - new Date(lastOutboundAt).getTime() < window;
}
