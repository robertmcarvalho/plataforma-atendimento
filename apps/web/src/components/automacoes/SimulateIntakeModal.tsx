'use client';



import { useMemo, useState } from 'react';

import { useMutation } from '@tanstack/react-query';

import { Play, X } from 'lucide-react';

import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { FormSelect } from '@/components/form/FormSelect';

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

      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-border bg-card shadow-elevated">

        <div className="flex items-center justify-between border-b border-border px-5 py-4">

          <h2 className="text-sm font-semibold">Simular conversa (intake)</h2>

          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-sidebar-accent/60">

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

            <FormSearchCombobox

              value={channelId}

              onChange={(v) => {

                setChannelId(v);

                setSectorKey('');

                setDemandKey('');

              }}

              className="mt-1"

              placeholder="Buscar canal…"

              options={[

                { value: '', label: 'Primeiro canal configurado' },

                ...(webhookQuery.data?.channels || []).map((ch) => ({

                  value: ch.channel_id,

                  label: ch.channel_label,

                })),

              ]}

            />

          </label>

          <label className="block text-xs text-muted-foreground">

            Perfil

            <FormSelect

              value={profile}

              onChange={(v) => {

                setProfile(v);

                setSectorKey('');

                setDemandKey('');

              }}

              className="mt-1"

              options={profiles.map((p) => ({ value: p.code, label: p.label }))}

            />

          </label>

          <label className="block text-xs text-muted-foreground">

            Setor

            <FormSearchCombobox

              value={sectorKey}

              onChange={(v) => {

                setSectorKey(v);

                setDemandKey('');

              }}

              className="mt-1"

              placeholder="Buscar setor…"

              options={[

                { value: '', label: 'Selecione…' },

                ...sectors.map((s) => ({ value: s.id, label: s.name })),

              ]}

            />

          </label>

          <label className="block text-xs text-muted-foreground">

            Demanda

            <FormSearchCombobox

              value={demandKey}

              onChange={setDemandKey}

              className="mt-1"

              placeholder="Buscar demanda…"

              options={[

                { value: '', label: 'Selecione…' },

                ...demands.map((d) => ({ value: d.id, label: d.title })),

              ]}

            />

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

            <div className="rounded-lg border border-border bg-background/40 p-3 text-xs">

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

