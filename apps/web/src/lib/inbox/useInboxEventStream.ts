import { useEffect, useRef } from 'react';
import { resolveApiBaseUrl } from '@/lib/api';

export type InboxStreamEvent = {
  table?: string;
  eventType?: string;
  record?: Record<string, unknown> & { conversation_id?: string; id?: string };
  old?: Record<string, unknown>;
};

type UseInboxEventStreamOpts = {
  onEvent: (event: InboxStreamEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
};

/**
 * SSE /api/inbox/stream — canal único de live updates da inbox (substitui Realtime direto no browser).
 */
export function useInboxEventStream(enabled: boolean, opts: UseInboxEventStreamOpts) {
  const onEventRef = useRef(opts.onEvent);
  const onConnectionChangeRef = useRef(opts.onConnectionChange);
  onEventRef.current = opts.onEvent;
  onConnectionChangeRef.current = opts.onConnectionChange;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      onConnectionChangeRef.current?.(false);
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      onConnectionChangeRef.current?.(false);
      return;
    }

    const workspaceRaw = localStorage.getItem('user');
    let workspaceId = '';
    try {
      workspaceId = String((JSON.parse(workspaceRaw || '{}') as { workspace_id?: string }).workspace_id || '');
    } catch {
      workspaceId = '';
    }

    const controller = new AbortController();
    let closed = false;

    const connect = async () => {
      try {
        const res = await fetch(`${resolveApiBaseUrl()}/api/inbox/stream`, {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          onConnectionChangeRef.current?.(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const chunk of parts) {
            const lines = chunk.split('\n');
            const eventLine = lines.find((l) => l.startsWith('event: '));
            const dataLine = lines.find((l) => l.startsWith('data: '));
            const eventName = eventLine?.slice(7).trim() || 'message';
            if (eventName === 'ping') continue;
            if (eventName === 'connected') {
              onConnectionChangeRef.current?.(true);
              continue;
            }
            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine.slice(6)) as InboxStreamEvent;
              if (
                payload.table === 'messages' ||
                payload.table === 'conversations' ||
                payload.table === 'internal_notes'
              ) {
                onEventRef.current(payload);
              }
            } catch {
              /* ignore malformed payload */
            }
          }
        }
      } catch {
        onConnectionChangeRef.current?.(false);
        if (!closed) {
          window.setTimeout(() => {
            if (!closed) void connect();
          }, 5000);
        }
      }
    };

    void connect();

    return () => {
      closed = true;
      onConnectionChangeRef.current?.(false);
      controller.abort();
    };
  }, [enabled]);
}
