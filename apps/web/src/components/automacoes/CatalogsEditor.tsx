'use client';

import Link from 'next/link';
import { RefreshCcw } from 'lucide-react';
import { useChannelOperationalCatalog } from '@/lib/integrations/useSectorsFromMessagingWebhooks';

export function CatalogsEditor() {
  const catalogQuery = useChannelOperationalCatalog(true);
  const catalog = catalogQuery.data;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <p className="text-sm font-semibold text-primary">Catálogo operacional centralizado nos webhooks</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Demandas, SLA, mensagens, perfis, tags, filas e horário agora são editados em Configurações &gt; Canais, dentro do webhook
          WhatsApp, Instagram ou E-mail. Esta tela fica apenas como leitura para conferência durante a migração.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/settings?section=channels" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            Abrir canais
          </Link>
          <button type="button" onClick={() => void catalogQuery.refetch()} className="rounded-md border border-border px-3 py-1.5 text-xs">
            <RefreshCcw className="mr-1 inline h-3.5 w-3.5" /> Atualizar
          </button>
        </div>
      </div>

      {catalogQuery.isLoading ? <p className="text-sm text-muted-foreground">Carregando webhooks...</p> : null}
      {catalogQuery.isError ? <p className="text-sm text-destructive">Não foi possível carregar o catálogo dos webhooks.</p> : null}

      {catalog ? (
        <div className="grid gap-3 md:grid-cols-2">
          {catalog.channels.map((channel) => {
            const activeDemands = channel.config.demands.filter((d) => d.is_active !== false);
            const activeSectors = channel.config.sectors.filter((s) => s.is_active !== false);
            return (
              <div key={channel.channel_id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{channel.channel_label}</p>
                    <p className="text-[11px] text-muted-foreground">{channel.channel_type}</p>
                  </div>
                  <span className="rounded bg-primary/10 px-2 py-1 text-[10px] text-primary">Webhook</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <Metric label="Setores" value={activeSectors.length} />
                  <Metric label="Filas" value={channel.config.queues.length} />
                  <Metric label="Demandas" value={activeDemands.length} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {activeSectors.slice(0, 8).map((s) => (
                    <span key={s.id} className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-background/50 p-2">
      <div className="font-mono text-base font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
