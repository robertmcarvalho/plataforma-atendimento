import type { FastifyInstance } from 'fastify';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { corsHeadersForRequest } from '../lib/corsOrigin';
import { authenticate } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';

function sseWrite(raw: NodeJS.WritableStream, event: string, data: unknown) {
  raw.write(`event: ${event}\n`);
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function inboxEventsRoutes(app: FastifyInstance) {
  /**
   * SSE — eventos de messages/conversations do workspace (fallback/complemento ao Realtime direto).
   * GET /api/inbox/stream
   */
  app.get('/stream', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) {
      return reply.status(503).send({ error: 'Realtime indisponível (Supabase não configurado).' });
    }

    reply.hijack();
    const raw = reply.raw;
    const originHeader = Array.isArray(request.headers.origin)
      ? request.headers.origin[0]
      : request.headers.origin;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...corsHeadersForRequest(typeof originHeader === 'string' ? originHeader : undefined),
    });

    sseWrite(raw, 'connected', { workspace_id: workspaceId, ts: new Date().toISOString() });

    const db = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let channel: RealtimeChannel | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (channel) void db.removeChannel(channel);
      try {
        raw.end();
      } catch {
        /* ignore */
      }
    };

    request.raw.on('close', cleanup);

    heartbeat = setInterval(() => {
      if (closed) return;
      sseWrite(raw, 'ping', { ts: new Date().toISOString() });
    }, 25_000);

    channel = db
      .channel(`inbox-sse-${workspaceId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          sseWrite(raw, 'message', {
            table: 'messages',
            eventType: payload.eventType,
            record: payload.new,
            old: payload.old,
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          sseWrite(raw, 'conversation', {
            table: 'conversations',
            eventType: payload.eventType,
            record: payload.new,
            old: payload.old,
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'internal_notes', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          sseWrite(raw, 'internal_note', {
            table: 'internal_notes',
            eventType: payload.eventType,
            record: payload.new,
            old: payload.old,
          });
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          sseWrite(raw, 'error', { status });
        }
      });
  });
}
