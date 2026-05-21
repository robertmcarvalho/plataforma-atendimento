'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, X } from 'lucide-react';
import api from '@/lib/api';
import {
  fetchChannelOperationalCatalog,
  type ChannelOperationalCatalog,
} from '@/lib/integrations/useSectorsFromMessagingWebhooks';

type SimulateResult = {
  trace: string[];
  messages: Array<{ message_key: string; content: string }>;
  sla: {
    first_response_deadline: string;
    treatment_deadline: string;
    resolution_deadline: string;
  } | null;
};

export function SimulateIntakeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [channelId, setChannelId] = useState('');
  const [profile, setProfile] = useState('entregador');
  const [sectorKey, setSectorKey] = useState('');
  const [demandKey, setDemandKey] = useState('');

  const webhookQuery = useMutation({
    mutationFn: async (): Promise<ChannelOperationalCatalog> => fetchChannelOperationalCatalog(),
  });

  const simulateMut = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<SimulateResult>('/api/workspace-catalogs/simulate-intake', {
        channel_id: channelId,
        profile_code: profile,
        sector_key: sectorKey,
        demand_key: demandKey,
      });
      return data;
    },
  });

  const sectors = useMemo(() => {
    const data = webhookQuery.data;
    if (!data) return [];
    const channel = data.channels.find((ch) => ch.channel_id === channelId) || data.channels[0];
    return (channel?.config.sectors || []).filter((s) => s.is_active && channel.config.demands.some((d) => d.is_active !== false && d.sector_ids.includes(s.id)));
  }, [channelId, webhookQuery.data]);

  const demands = useMemo(() => {
    if (!webhookQuery.data || !sectorKey) return [];
    return webhookQuery.data.demands.filter((d) => (!channelId || d.channel_id === channelId) && d.sector_ids.includes(sectorKey));
  }, [channelId, webhookQuery.data, sectorKey]);

  const profiles = useMemo(() => {
    const channel = webhookQuery.data?.channels.find((ch) => ch.channel_id === channelId) || webhookQuery.data?.channels[0];
    const accepted = channel?.config.profiles.accepted.length ? channel.config.profiles.accepted : ['entregador', 'farmacia', 'lider'];
    return accepted.map((code) => ({
      code,
      label: code === 'entregador' ? 'Entregador' : code === 'farmacia' ? 'Farmácia' : 'Líder',
    }));
  }, [channelId, webhookQuery.data]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-border bg-surface-elevated shadow-glow">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Simular conversa (intake)</h2>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-surface-hover">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <button
            type="button"
            className="text-xs text-primary underline"
            onClick={() => {
              void webhookQuery.mutate();
            }}
          >
            Carregar dados do webhook
          </button>
          <label className="block text-xs text-muted-foreground">
            Canal
            <select
              value={channelId}
              onChange={(e) => {
                setChannelId(e.target.value);
                setSectorKey('');
                setDemandKey('');
              }}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Primeiro canal configurado</option>
              {(webhookQuery.data?.channels || []).map((ch) => (
                <option key={ch.channel_id} value={ch.channel_id}>
                  {ch.channel_label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted-foreground">
            Perfil
            <select
              value={profile}
              onChange={(e) => {
                setProfile(e.target.value);
                setSectorKey('');
                setDemandKey('');
              }}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {profiles.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted-foreground">
            Setor
            <select
              value={sectorKey}
              onChange={(e) => {
                setSectorKey(e.target.value);
                setDemandKey('');
              }}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Selecione…</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted-foreground">
            Demanda
            <select
              value={demandKey}
              onChange={(e) => setDemandKey(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Selecione…</option>
              {demands.map((d) => (
                <option key={`${d.channel_id}:${d.id}`} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!sectorKey || !demandKey || simulateMut.isPending}
            onClick={() => void simulateMut.mutate()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> Executar simulação
          </button>
          {simulateMut.data ? (
            <div className="rounded-lg border border-border bg-background p-3 text-xs">
              <p className="font-semibold text-foreground">Trace</p>
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {simulateMut.data.trace.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              {simulateMut.data.sla ? (
                <dl className="mt-3 space-y-1">
                  <div>
                    <dt className="text-muted-foreground">1ª resposta</dt>
                    <dd>{new Date(simulateMut.data.sla.first_response_deadline).toLocaleString('pt-BR')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Tratamento</dt>
                    <dd>{new Date(simulateMut.data.sla.treatment_deadline).toLocaleString('pt-BR')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Resolução</dt>
                    <dd>{new Date(simulateMut.data.sla.resolution_deadline).toLocaleString('pt-BR')}</dd>
                  </div>
                </dl>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
