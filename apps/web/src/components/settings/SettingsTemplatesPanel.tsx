'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { FormControl } from '@/components/form/FormControl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type TemplateRecord = {
  id: string;
  name: string;
  category: string;
  meta_template_status: string;
  meta_template_language?: string;
  updated_at?: string;
};

type TemplateStatus = 'Aprovado' | 'Pendente' | 'Rejeitado';

const statusStyles: Record<TemplateStatus, string> = {
  Aprovado: 'bg-success/15 text-success ring-1 ring-success/30',
  Pendente: 'bg-warning/15 text-warning ring-1 ring-warning/30',
  Rejeitado: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30',
};

function mapTemplateStatus(status: string): TemplateStatus {
  if (status === 'approved') return 'Aprovado';
  if (status === 'rejected') return 'Rejeitado';
  return 'Pendente';
}

/** Formato curto alinhado ao mock Revive: "há 2d", "há 5h". */
function templateUpdatedShort(updatedAt?: string): string {
  if (!updatedAt) return '—';
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days >= 1) return `há ${days}d`;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours >= 1) return `há ${hours}h`;
  const minutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));
  return `há ${minutes}min`;
}

export function SettingsTemplatesPanel() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [syncing, setSyncing] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['templates-all'],
    queryFn: async () => (await api.get<TemplateRecord[]>('/api/templates')).data,
  });

  const syncMut = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{
        fetched: number;
        created: number;
        updated: number;
        skipped: number;
      }>('/api/templates/sync-meta');
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['templates-all'] });
      await queryClient.invalidateQueries({ queryKey: ['approved-templates-for-inbox'] });
      setSyncError(null);
      setSyncing('ok');
      window.setTimeout(() => setSyncing('idle'), 1800);
    },
    onError: (e: unknown) => {
      setSyncError(apiErrorMessage(e, 'Falha ao sincronizar templates da Meta.'));
      setSyncing('err');
      window.setTimeout(() => setSyncing('idle'), 2400);
    },
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const aprovados = rows.filter((r) => r.meta_template_status === 'approved').length;

  const handleSync = () => {
    setSyncError(null);
    setSyncing('loading');
    syncMut.mutate();
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando templates…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-background p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Templates de mensagem</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Modelos aprovados na Meta (WABA) usados em automações e envios oficiais.
            </p>
          </div>
          <span className="rounded bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
            {aprovados}/{rows.length} aprovados
          </span>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
          <FormControl
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar template…"
            inputSize="sm"
            className="pl-8 pr-3 text-xs"
          />
        </div>

        <div className="mt-4 space-y-2">
          {filtered.map((r) => {
            const status = mapTemplateStatus(r.meta_template_status);
            const language = (r.meta_template_language || 'pt_BR').replace('-', '_');
            return (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{r.name}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      {r.category}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-subtle-foreground">
                    {language} · atualizado {templateUpdatedShort(r.updated_at)}
                  </div>
                </div>
                <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-medium', statusStyles[status])}>
                  {status}
                </span>
              </div>
            );
          })}
          {filtered.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
              Nenhum template encontrado.
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-6">
        <h3 className="text-sm font-semibold tracking-tight">Sincronizar com a Meta</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Importa templates da conta WhatsApp (WABA). Requer canal configurado em Canais com token e Phone Number ID.
        </p>
        <Button type="button" size="xs" className="mt-4" onClick={handleSync} disabled={syncing === 'loading'}>
          <RefreshCw className={cn('h-3.5 w-3.5', syncing === 'loading' && 'animate-spin')} />
          {syncing === 'loading' ? 'Sincronizando…' : syncing === 'ok' ? 'Sincronizado' : 'Sincronizar agora'}
        </Button>
        {syncError ? (
          <p className="mt-3 text-[11px] text-destructive">{syncError}</p>
        ) : null}
      </div>
    </div>
  );
}
