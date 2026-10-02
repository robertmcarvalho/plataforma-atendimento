'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { Switch } from '@/components/ui/Switch';

function savedRelativeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return formatDistanceToNow(d, { addSuffix: true, locale: ptBR });
}

export function SettingsServicePanel() {
  const queryClient = useQueryClient();
  const [signatureOn, setSignatureOn] = useState(true);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: enabled = true, isLoading } = useQuery({
    queryKey: ['settings', 'chat_signature_enabled'],
    queryFn: async () => {
      const { data } = await api.get<boolean>('/api/settings/chat_signature_enabled');
      return Boolean(data);
    },
  });

  useEffect(() => {
    setSignatureOn(enabled);
  }, [enabled]);

  const saveMut = useMutation({
    mutationFn: async (value: boolean) => {
      await api.put('/api/settings', { key: 'chat_signature_enabled', value });
      return value;
    },
    onSuccess: async () => {
      setError(null);
      setLastSavedAt(new Date().toISOString());
      await queryClient.invalidateQueries({ queryKey: ['settings', 'chat_signature_enabled'] });
      await queryClient.invalidateQueries({ queryKey: ['global-settings'] });
    },
    onError: (e: unknown) => {
      setSignatureOn(enabled);
      setError(apiErrorMessage(e, 'Falha ao salvar configuração.'));
    },
  });

  const handleToggle = (next: boolean) => {
    setSignatureOn(next);
    setError(null);
    saveMut.mutate(next);
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando preferências…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-background p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Assinatura de atendente</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Default global da assinatura no composer. Aplica-se a todas as conversas, podendo ser desativada por
              atendente.
            </p>
          </div>
          <Switch
            checked={signatureOn}
            disabled={saveMut.isPending}
            onCheckedChange={handleToggle}
            aria-label="Assinatura de atendente"
          />
        </div>
        {error ? <p className="mt-3 text-[11px] text-destructive">{error}</p> : null}
      </div>

      {lastSavedAt ? (
        <div className="rounded-xl border border-border bg-background p-6">
          <h3 className="text-sm font-semibold tracking-tight">Última alteração</h3>
          <div className="mt-3 flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
            <div>
              <div className="text-xs font-medium">
                Assinatura (default) · {signatureOn ? 'Ativa' : 'Desativada'}
              </div>
              <div className="text-[10px] text-subtle-foreground">{savedRelativeLabel(lastSavedAt)}</div>
            </div>
            <span className="rounded bg-success/15 px-1.5 py-0.5 text-[9px] font-medium text-success">aplicada</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
