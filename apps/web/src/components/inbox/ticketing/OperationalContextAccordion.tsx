'use client';

import { useMemo, useState } from 'react';
import { useMcpExecute } from '@/lib/mcp/useMcpExecute';
import type { EntityIds } from '@/lib/ticketing/deriveEntityIds';
import type { OperationalTicket } from '@/lib/ticketing/types';

type ActionKey = 'driver' | 'pharmacy' | 'leader';

const ACTION_MAP: Record<ActionKey, { label: string; action: string; inputKey: string }> = {
  driver: { label: 'Entregador', action: 'get_driver_context', inputKey: 'driver_id' },
  pharmacy: { label: 'Farmácia', action: 'get_pharmacy_context', inputKey: 'pharmacy_id' },
  leader: { label: 'Líder', action: 'get_leader_context', inputKey: 'leader_id' },
};

export function OperationalContextAccordion({
  ticket,
  entityIds,
  conversationId,
}: {
  ticket: OperationalTicket | null;
  entityIds: EntityIds;
  conversationId: string | null;
}) {
  const [selected, setSelected] = useState<ActionKey>('driver');
  const [manualId, setManualId] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const executeMcp = useMcpExecute();

  const mergedSnap = useMemo(() => {
    const base =
      ticket?.context_snap && typeof ticket.context_snap === 'object' ? { ...ticket.context_snap } : {};
    if (entityIds.driver_id) base.driver_id = entityIds.driver_id;
    if (entityIds.pharmacy_id) base.pharmacy_id = entityIds.pharmacy_id;
    if (entityIds.leader_id) base.leader_id = entityIds.leader_id;
    return base as Record<string, unknown>;
  }, [ticket, entityIds]);

  const inferredId = useMemo(() => {
    const key = ACTION_MAP[selected].inputKey;
    const raw = mergedSnap[key];
    if (!raw) return '';
    return String(raw);
  }, [selected, mergedSnap]);

  return (
    <details className="inbox-context-accordion">
      <summary className="inbox-context-accordion-summary">
        <span className="inbox-context-title" style={{ marginBottom: 0 }}>
          Consultar dados operacionais
        </span>
        <span className="inbox-context-chevron">+</span>
      </summary>
      <div className="inbox-context-grid">
        <div className="col-span-full grid grid-cols-3 gap-2">
          {(Object.keys(ACTION_MAP) as ActionKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSelected(k)}
              className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                selected === k ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background/40 text-muted-foreground'
              }`}
            >
              {ACTION_MAP[k].label}
            </button>
          ))}
        </div>
        <label className="col-span-full">
          <div className="inbox-context-field-label">ID manual (opcional)</div>
          <input
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder={inferredId ? `Inferido: ${inferredId}` : 'Informe UUID'}
            className="control-input mt-1 w-full text-xs"
          />
        </label>
        <div className="col-span-full">
          <button
            type="button"
            onClick={() => {
              setResult(null);
              const map = ACTION_MAP[selected];
              const idValue = manualId.trim() || inferredId;
              executeMcp.mutate(
                {
                  tool: 'mcp-operacao',
                  action: map.action,
                  input: idValue ? { [map.inputKey]: idValue } : {},
                  context: {
                    ticket_id: ticket?.id || null,
                    conversation_id: conversationId,
                    source: 'inbox',
                  },
                },
                {
                  onSuccess: (data) => setResult(data),
                }
              );
            }}
            disabled={executeMcp.isPending || (!conversationId && !ticket?.id && !inferredId && !manualId.trim())}
            className="button-secondary rounded-md px-3 py-1.5 text-[11px] font-medium disabled:opacity-50"
          >
            {executeMcp.isPending ? 'Consultando…' : 'Consultar contexto'}
          </button>
        </div>
        {executeMcp.isError ? (
          <p className="col-span-full text-[11px] text-destructive">Falha ao executar MCP operacional.</p>
        ) : null}
        {result ? (
          <pre className="col-span-full max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background/40 p-2 font-mono text-[10px] text-muted-foreground">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : null}
      </div>
    </details>
  );
}
