import type { LogContext } from './index';

function correlationId(input?: string | null) {
  const value = String(input || '').trim();
  if (value) return value;
  return `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildPubSubEnvelope<T extends Record<string, unknown>>(payload: T, context: LogContext = {}) {
  const currentCorrelationId = correlationId(context.correlation_id);
  return {
    ...payload,
    tracing: {
      request_id: context.request_id || null,
      correlation_id: currentCorrelationId,
      workspace_id: context.workspace_id || null,
      conversation_id: context.conversation_id || null,
      ticket_id: context.ticket_id || null,
      user_id: context.user_id || null,
    },
  };
}

export function contextFromPubSubEnvelope(payload: Record<string, unknown>): LogContext {
  const tracing = payload.tracing && typeof payload.tracing === 'object' ? (payload.tracing as Record<string, unknown>) : {};
  return {
    request_id: typeof tracing.request_id === 'string' ? tracing.request_id : null,
    correlation_id: correlationId(typeof tracing.correlation_id === 'string' ? tracing.correlation_id : null),
    workspace_id: typeof tracing.workspace_id === 'string' ? tracing.workspace_id : typeof payload.workspace_id === 'string' ? payload.workspace_id : null,
    conversation_id: typeof tracing.conversation_id === 'string' ? tracing.conversation_id : null,
    ticket_id: typeof tracing.ticket_id === 'string' ? tracing.ticket_id : null,
    user_id: typeof tracing.user_id === 'string' ? tracing.user_id : null,
  };
}
