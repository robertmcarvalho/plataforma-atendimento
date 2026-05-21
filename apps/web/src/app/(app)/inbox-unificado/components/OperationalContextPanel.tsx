'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';

type TicketLite = {
  id: string;
  context_snap?: Record<string, unknown> | null;
};

type ActionKey = 'driver' | 'pharmacy' | 'leader';

const ACTION_MAP: Record<ActionKey, { label: string; action: string; inputKey: string }> = {
  driver: { label: 'Entregador', action: 'get_driver_context', inputKey: 'driver_id' },
  pharmacy: { label: 'Farmácia', action: 'get_pharmacy_context', inputKey: 'pharmacy_id' },
  leader: { label: 'Líder', action: 'get_leader_context', inputKey: 'leader_id' },
};

export function OperationalContextPanel({ ticket }: { ticket: TicketLite | null }) {
  const [selected, setSelected] = useState<ActionKey>('driver');
  const [manualId, setManualId] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const inferredId = useMemo(() => {
    const key = ACTION_MAP[selected].inputKey;
    const raw = ticket?.context_snap?.[key];
    if (!raw) return '';
    return String(raw);
  }, [selected, ticket]);

  const executeMcp = useMutation({
    mutationFn: async () => {
      const map = ACTION_MAP[selected];
      const idValue = manualId.trim() || inferredId;
      const payload = {
        tool: 'mcp-operacao',
        action: map.action,
        input: idValue ? { [map.inputKey]: idValue } : {},
        context: { ticket_id: ticket?.id || null, source: 'inbox_unificado' },
      };
      const res = await api.post('/api/mcp/execute', payload);
      return (res.data || {}) as Record<string, unknown>;
    },
    onSuccess: (data) => setResult(data),
  });

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <p className="mb-2 text-xs text-[var(--text-muted)]">Contexto operacional (MCP)</p>
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(ACTION_MAP) as ActionKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setSelected(k)}
            className={`rounded-lg border px-2 py-1 text-xs ${selected === k ? 'border-primary' : 'border-[var(--border)]'}`}
          >
            {ACTION_MAP[k].label}
          </button>
        ))}
      </div>
      <div className="mt-2 space-y-2">
        <input
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          placeholder={inferredId ? `ID inferido: ${inferredId}` : 'Informe ID (opcional)'}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs outline-none"
        />
        <button
          onClick={() => executeMcp.mutate()}
          disabled={executeMcp.isPending || !ticket?.id}
          className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-60"
        >
          {executeMcp.isPending ? 'Consultando...' : 'Consultar contexto'}
        </button>
      </div>
      {executeMcp.isError ? <p className="mt-2 text-xs text-red-300">Falha ao executar MCP operacional.</p> : null}
      {result ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-[10px] text-[var(--text-muted)]">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
