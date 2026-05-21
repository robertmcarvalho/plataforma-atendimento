export type LogSeverity = 'debug' | 'info' | 'warn' | 'error';

export type ErrorCode =
  | 'AUTH_ERROR'
  | 'WORKSPACE_SCOPE_ERROR'
  | 'META_API_ERROR'
  | 'AI_PROVIDER_ERROR'
  | 'PUBSUB_TIMEOUT'
  | 'RATE_LIMIT'
  | 'VALIDATION_ERROR'
  | 'DATABASE_ERROR'
  | 'WORKER_ERROR'
  | 'FLOW_RUNTIME_ERROR'
  | 'AUTOMATION_CONFLICT'
  | 'WEBHOOK_ERROR';

export type LogContext = {
  request_id?: string | null;
  correlation_id?: string | null;
  workspace_id?: string | null;
  conversation_id?: string | null;
  ticket_id?: string | null;
  user_id?: string | null;
  service_name?: string;
  environment?: string;
  event_type?: string | null;
  execution_time?: number | null;
  retry_count?: number | null;
  queue_name?: string | null;
  error_code?: ErrorCode | string | null;
  [key: string]: unknown;
};

const SENSITIVE_KEY_RE =
  /(authorization|token|secret|password|access_token|refresh_token|api_key|apikey|cpf|cnpj|phone|telefone|whatsapp|wa_phone|email|payload|content|message|body|text|raw)/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LONG_DIGIT_RE = /\b(?:\+?55)?\d{10,14}\b/g;
const CPF_CNPJ_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

function maskScalar(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value) return value;
  const masked = value.replace(EMAIL_RE, '[REDACTED_EMAIL]').replace(CPF_CNPJ_RE, '[REDACTED_DOC]').replace(LONG_DIGIT_RE, '[REDACTED_PHONE]');
  if (masked !== value) return masked;
  if (value.length <= 4) return '***';
  return `***${value.slice(-4)}`;
}

export function redact(value: unknown): unknown {
  if (value instanceof PlatformError) {
    return {
      name: value.name,
      code: value.code,
      severity: value.severity,
      message: maskScalar(value.message),
      context: redact(value.context),
      stack: value.stack?.split('\n').slice(0, 8).join('\n'),
    };
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: maskScalar(value.message),
      stack: value.stack?.split('\n').slice(0, 8).join('\n'),
    };
  }
  if (typeof value === 'string') return maskScalar(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? maskScalar(String(raw ?? '')) : redact(raw);
  }
  return out;
}

function normalizeArgs(args: unknown[]) {
  if (args.length === 0) return {};
  const [first, ...rest] = args;
  if (typeof first === 'string') {
    return {
      message: first,
      data: rest.length === 1 ? redact(rest[0]) : rest.map((item) => redact(item)),
    };
  }
  return {
    data: args.length === 1 ? redact(first) : args.map((item) => redact(item)),
  };
}

function redactContext(context: LogContext): LogContext {
  return redact(context) as LogContext;
}

function requiredFields(): Required<Pick<LogContext, 'request_id' | 'correlation_id' | 'workspace_id' | 'conversation_id' | 'ticket_id' | 'user_id' | 'queue_name' | 'retry_count' | 'execution_time' | 'error_code' | 'event_type'>> {
  return {
    request_id: null,
    correlation_id: null,
    workspace_id: null,
    conversation_id: null,
    ticket_id: null,
    user_id: null,
    queue_name: null,
    retry_count: null,
    execution_time: null,
    error_code: null,
    event_type: null,
  };
}

export function createLogger(serviceName: string, base: LogContext = {}) {
  const service_name = base.service_name || serviceName;
  const environment = base.environment || process.env.NODE_ENV || 'development';

  function write(severity: LogSeverity, message: string, context: LogContext = {}) {
    const event = {
      ts: new Date().toISOString(),
      severity,
      service_name,
      environment,
      ...requiredFields(),
      message: String(maskScalar(message) || ''),
      ...redactContext(base),
      ...redactContext(context),
    };
    const line = `${JSON.stringify(event)}\n`;
    if (severity === 'error') process.stderr.write(line);
    else process.stdout.write(line);
  }

  return {
    debug: (message: string, context?: LogContext) => write('debug', message, context),
    info: (message: string, context?: LogContext) => write('info', message, context),
    warn: (message: string, context?: LogContext) => write('warn', message, context),
    error: (message: string, context?: LogContext) => write('error', message, context),
    child: (context: LogContext) => createLogger(serviceName, { ...base, ...context }),
    console: {
      log: (...args: unknown[]) => {
        const normalized = normalizeArgs(args);
        write('info', String(normalized.message || 'log'), normalized as LogContext);
      },
      info: (...args: unknown[]) => {
        const normalized = normalizeArgs(args);
        write('info', String(normalized.message || 'info'), normalized as LogContext);
      },
      warn: (...args: unknown[]) => {
        const normalized = normalizeArgs(args);
        write('warn', String(normalized.message || 'warn'), normalized as LogContext);
      },
      error: (...args: unknown[]) => {
        const normalized = normalizeArgs(args);
        write('error', String(normalized.message || 'error'), normalized as LogContext);
      },
    },
  };
}

export class PlatformError extends Error {
  readonly code: ErrorCode;
  readonly severity: LogSeverity;
  readonly context: LogContext;

  constructor(code: ErrorCode, message: string, context: LogContext = {}, severity: LogSeverity = 'error') {
    super(message);
    this.name = 'PlatformError';
    this.code = code;
    this.severity = severity;
    this.context = context;
  }
}

export function normalizeError(error: unknown, fallbackCode: ErrorCode = 'WORKER_ERROR'): LogContext {
  if (error instanceof PlatformError) {
    return {
      ...error.context,
      error_code: error.code,
      error: redact(error),
    };
  }
  return {
    error_code: fallbackCode,
    error: redact(error),
  };
}

export function getCorrelationId(input?: string | null) {
  const value = String(input || '').trim();
  if (value) return value;
  return `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export { buildPubSubEnvelope, contextFromPubSubEnvelope } from './pubsub';
