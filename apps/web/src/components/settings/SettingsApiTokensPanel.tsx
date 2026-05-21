'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import api from '@/lib/api';
import { formatDateTimeBr } from '@/lib/datetimeBr';

type TokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
};

export function SettingsApiTokensPanel() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['api-tokens'],
    queryFn: async () => (await api.get<TokenRow[]>('/api/api-tokens')).data,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ id: string; token: string; name: string }>('/api/api-tokens', { name: name.trim() });
      return data;
    },
    onSuccess: (data) => {
      setRevealed(data?.token || null);
      setName('');
      void qc.invalidateQueries({ queryKey: ['api-tokens'] });
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/api-tokens/${id}`);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['api-tokens'] }),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando tokens…</p>;
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground">
        Tokens de API para integrações (apenas administradores). Criação e revogação ficam registadas em{' '}
        <span className="font-semibold">Auditoria</span>. Guarde o secret com segurança — não voltará a ser mostrado.
      </p>

      {revealed ? (
        <div className="mt-4 rounded-xl border border-primary/40 bg-primary/10 p-4">
          <p className="text-xs font-semibold text-foreground">Token criado (mostrado uma vez)</p>
          <p className="mt-2 break-all font-mono text-[11px] text-foreground">{revealed}</p>
          <button type="button" className="mt-2 text-xs text-primary underline" onClick={() => setRevealed(null)}>
            Ocultar
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: ERP produção"
            className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60"
          />
        </div>
        <button
          type="button"
          disabled={createMut.isPending || name.trim().length < 2}
          onClick={() => createMut.mutate()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          <Plus size={14} />
          Gerar token
        </button>
      </div>
      {createMut.isError ? (
        <p className="mt-2 text-xs text-destructive">Falha ao criar. A tabela api_tokens existe? (migration 011)</p>
      ) : null}

      <div className="mt-6 space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum token ainda.</p>
        ) : (
          rows.map((t) => (
            <div key={t.id} className="rounded-md border border-border bg-background/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-foreground">{t.name}</div>
                <button
                  type="button"
                  disabled={delMut.isPending}
                  onClick={() => {
                    if (confirm('Revogar este token?')) delMut.mutate(t.id);
                  }}
                  className="text-[11px] text-destructive hover:underline"
                >
                  Revogar
                </button>
              </div>
              <div className="mt-1 font-mono text-[10px] text-subtle-foreground">{t.token_prefix}…</div>
              <div className="mt-1 text-[10px] text-subtle-foreground">
                Criado em {formatDateTimeBr(t.created_at)}
                {t.last_used_at ? ` · Último uso ${formatDateTimeBr(t.last_used_at)}` : ''}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
