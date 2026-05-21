'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  parseChannelOperationalConfig,
  type ChannelDemand,
  type ChannelMessages,
  type ChannelOperationalConfig,
  type ChannelProfilesConfig,
  type ChannelSlaSettings,
  type WorkspaceChannel,
} from '@/lib/integrations/channelsApi';

const MESSAGING_CHANNEL_TYPES = new Set<WorkspaceChannel['channel_type']>(['whatsapp', 'instagram', 'email']);

export type WebhookSectorOption = { id: string; nome: string };

export type WebhookSectorRow = { id: string; name: string; is_active: boolean };

export type WebhookDemandRow = {
  id: string;
  title: string;
  sector_ids: string[];
  channel_id: string;
  channel_label: string;
  is_active: boolean;
  requires_pharmacy?: boolean;
  sla_override?: ChannelDemand['sla_override'];
};

export type ChannelOperationalCatalogItem = {
  channel_id: string;
  channel_type: WorkspaceChannel['channel_type'];
  channel_label: string;
  config: ChannelOperationalConfig;
};

export type ChannelOperationalCatalog = {
  channels: ChannelOperationalCatalogItem[];
  sectors: Array<WebhookSectorRow & { channel_ids: string[] }>;
  demands: WebhookDemandRow[];
  sla: Array<ChannelSlaSettings & { channel_id: string; channel_label: string }>;
  messages: Array<ChannelMessages & { channel_id: string; channel_label: string }>;
  profiles: Array<ChannelProfilesConfig & { channel_id: string; channel_label: string }>;
};

export async function fetchChannelOperationalCatalog(): Promise<ChannelOperationalCatalog> {
  const { data } = await api.get<{ items: WorkspaceChannel[] }>('/api/integrations/channels');
  const items = data?.items || [];
  const channels: ChannelOperationalCatalogItem[] = [];
  const sectorMap = new Map<string, WebhookSectorRow & { channel_ids: string[] }>();
  const demands: WebhookDemandRow[] = [];
  const sla: ChannelOperationalCatalog['sla'] = [];
  const messages: ChannelOperationalCatalog['messages'] = [];
  const profiles: ChannelOperationalCatalog['profiles'] = [];

  for (const ch of items) {
    if (!MESSAGING_CHANNEL_TYPES.has(ch.channel_type)) continue;
    const channelLabel = ch.display_name || ch.channel_type;
    const config = parseChannelOperationalConfig(ch.config);
    channels.push({ channel_id: ch.id, channel_type: ch.channel_type, channel_label: channelLabel, config });

    for (const sector of config.sectors) {
      if (!sector.id || sector.is_active === false) continue;
      const current = sectorMap.get(sector.id) || { id: sector.id, name: sector.name, is_active: true, channel_ids: [] };
      current.name = sector.name || current.name;
      if (!current.channel_ids.includes(ch.id)) current.channel_ids.push(ch.id);
      sectorMap.set(sector.id, current);
    }

    for (const demand of config.demands) {
      if (demand.is_active === false) continue;
      demands.push({
        id: demand.id,
        title: demand.title,
        sector_ids: demand.sector_ids,
        channel_id: ch.id,
        channel_label: channelLabel,
        is_active: true,
        requires_pharmacy: demand.requires_pharmacy,
        sla_override: demand.sla_override,
      });
    }

    sla.push({ ...config.sla, channel_id: ch.id, channel_label: channelLabel });
    messages.push({ ...config.messages, channel_id: ch.id, channel_label: channelLabel });
    profiles.push({ ...config.profiles, channel_id: ch.id, channel_label: channelLabel });
  }

  return {
    channels,
    sectors: Array.from(sectorMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    demands: demands.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')),
    sla,
    messages,
    profiles,
  };
}

/** Mesma origem que o hook, para `useQuery` com chave compartilhada ou chamadas fora de React. */
export async function fetchMessagingWebhookSectors(): Promise<WebhookSectorRow[]> {
  const catalog = await fetchChannelOperationalCatalog();
  return catalog.sectors.map(({ id, name, is_active }) => ({ id, name, is_active }));
}

export async function fetchMessagingWebhookDemands(): Promise<WebhookDemandRow[]> {
  const catalog = await fetchChannelOperationalCatalog();
  return catalog.demands;
}

/** Setores que aparecem em alguma fila de canais WhatsApp, Instagram ou e-mail (workspace_channels). */
export function useSectorsFromMessagingWebhooks(enabled = true) {
  return useQuery({
    queryKey: ['sectors-from-messaging-webhooks'],
    queryFn: async (): Promise<WebhookSectorOption[]> => {
      const rows = await fetchMessagingWebhookSectors();
      return rows.map((r) => ({ id: r.id, nome: r.name }));
    },
    enabled,
    staleTime: 30_000,
  });
}

/** Demandas ativas configuradas nos webhooks/canais do workspace. */
export function useDemandsFromMessagingWebhooks(enabled = true) {
  return useQuery({
    queryKey: ['demands-from-messaging-webhooks'],
    queryFn: fetchMessagingWebhookDemands,
    enabled,
    staleTime: 30_000,
  });
}

export function useChannelOperationalCatalog(enabled = true) {
  return useQuery({
    queryKey: ['channel-operational-catalog'],
    queryFn: fetchChannelOperationalCatalog,
    enabled,
    staleTime: 30_000,
  });
}
