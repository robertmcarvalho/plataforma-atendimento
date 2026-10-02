'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatDateTimeBr } from '@/lib/datetimeBr';

type AuditItem = {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export function SettingsAuditPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: async () => (await api.get<{ items: AuditItem[] }>('/api/audit-logs?limit=50')).data,
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando auditoria…</p>;
  }
  if (isError) {
    return <p className="text-sm text-destructive">Não foi possível carregar os registos.</p>;
  }

  const items = data?.items || [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Últimos eventos registados no servidor (admin).</p>
      <div className="overflow-x-auto rounded-lg border border-border/60 bg-background/30">
        <table className="workspace-table min-w-[640px]">
          <thead>
            <tr>
              <th>Data</th>
              <th>Ação</th>
              <th>Entidade</th>
              <th>Metadados</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-2 align-middle text-sm text-muted-foreground">
                  Sem registos. Eventos passam a aparecer após ações administrativas.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id} className="border-b border-border hover:bg-sidebar-accent/60">
                  <td className="px-3 py-2 align-middle whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTimeBr(row.created_at)}
                  </td>
                  <td className="px-3 py-2 align-middle text-sm font-medium text-foreground">{row.action}</td>
                  <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
                    {row.entity_type || '—'}
                    {row.entity_id ? ` · ${row.entity_id.slice(0, 8)}…` : ''}
                  </td>
                  <td className="px-3 py-2 align-middle max-w-[280px] truncate font-mono text-[10px] text-subtle-foreground">
                    {JSON.stringify(row.metadata || {})}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
