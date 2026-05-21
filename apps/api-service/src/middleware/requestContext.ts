import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createLogger, getCorrelationId, normalizeError } from '@plataforma/logger';
import { getWorkspaceIdFromRequest } from '../lib/workspaceContext';

const logger = createLogger('api-service');

export type RequestContext = {
  request_id: string;
  correlation_id: string;
  workspace_id: string | null;
  user_id: string | null;
  started_at: number;
};

declare module 'fastify' {
  interface FastifyRequest {
    requestContext?: RequestContext;
  }
}

export function registerRequestContext(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = headerValue(request.headers['x-request-id']) || randomUUID();
    const correlationId = getCorrelationId(headerValue(request.headers['x-correlation-id']) || requestId);
    request.requestContext = {
      request_id: requestId,
      correlation_id: correlationId,
      workspace_id: null,
      user_id: null,
      started_at: Date.now(),
    };
    reply.header('x-request-id', requestId);
    reply.header('x-correlation-id', correlationId);
  });

  app.addHook('preHandler', async (request) => {
    if (!request.requestContext) return;
    request.requestContext.workspace_id = getWorkspaceIdFromRequest(request);
    request.requestContext.user_id = typeof (request.user as { sub?: string } | undefined)?.sub === 'string' ? (request.user as { sub: string }).sub : null;
  });

  app.addHook('onResponse', async (request, reply) => {
    const ctx = request.requestContext;
    logger.info('http_request_completed', {
      request_id: ctx?.request_id || null,
      correlation_id: ctx?.correlation_id || null,
      workspace_id: ctx?.workspace_id || null,
      user_id: ctx?.user_id || null,
      event_type: 'http.request',
      method: request.method,
      path: request.routerPath || request.url,
      status_code: reply.statusCode,
      execution_time: ctx?.started_at ? Date.now() - ctx.started_at : null,
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const ctx = request.requestContext;
    logger.error('http_request_failed', {
      request_id: ctx?.request_id || null,
      correlation_id: ctx?.correlation_id || null,
      workspace_id: ctx?.workspace_id || null,
      user_id: ctx?.user_id || null,
      event_type: 'http.error',
      method: request.method,
      path: request.routerPath || request.url,
      status_code: error.statusCode || 500,
      execution_time: ctx?.started_at ? Date.now() - ctx.started_at : null,
      ...normalizeError(error, 'WORKER_ERROR'),
    });
    reply.status(error.statusCode || 500).send({
      error: error.message || 'Erro interno',
      correlation_id: ctx?.correlation_id || null,
    });
  });
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
