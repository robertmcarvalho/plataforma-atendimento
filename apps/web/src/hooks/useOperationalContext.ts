'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listChannels, type WorkspaceChannel } from '@/lib/integrations/channelsApi';
import { useAuth } from '@/store/auth';
import { readSelectedChannelId, useOperationalContextStore } from '@/store/operationalContext';

export type OperationalChannel = WorkspaceChannel & {
  operation_label: string;
};

function channelLabel(ch: WorkspaceChannel): string {
  const displayNumber = ch.config?.display_number;
  return (
    ch.display_name ||
    (typeof displayNumber === 'string' || typeof displayNumber === 'number' ? String(displayNumber) : '') ||
    ch.external_id ||
    ch.channel_type
  );
}

function realWorkspaceName(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && text.toLowerCase() !== 'workspace') return text;
  }
  return 'Workspace';
}

function isCommercialChannel(ch: WorkspaceChannel): boolean {
  return String(ch.config?.purpose || '').toLowerCase() === 'commercial';
}

export function useOperationalContext(options: { enabled?: boolean; channelTypes?: WorkspaceChannel['channel_type'][] } = {}) {
  const enabled = options.enabled ?? true;
  const user = useAuth((s) => s.user);
  const workspaceId = user?.workspace_id || 'default';
  const memberships = user?.workspace_memberships || [];
  const activeMembership = memberships.find((m) => m.workspace_id === user?.workspace_id);
  const workspaceName = realWorkspaceName(
    activeMembership?.workspace_name,
    (user as { workspace_name?: string | null } | null)?.workspace_name
  );

  const selectedChannelId = useOperationalContextStore((state) => state.selectedByWorkspace[workspaceId] ?? null);
  const setSelectedChannelIdForWorkspace = useOperationalContextStore((state) => state.setSelectedChannelId);

  useEffect(() => {
    if (selectedChannelId) return;
    const legacy = readSelectedChannelId(workspaceId);
    if (legacy) setSelectedChannelIdForWorkspace(workspaceId, legacy);
  }, [selectedChannelId, setSelectedChannelIdForWorkspace, workspaceId]);

  const channelsQuery = useQuery({
    queryKey: ['operational-context', 'channels'],
    enabled,
    queryFn: listChannels,
    staleTime: 60_000,
  });

  const channels = useMemo<OperationalChannel[]>(() => {
    const allowed = options.channelTypes ? new Set(options.channelTypes) : null;
    return (channelsQuery.data || [])
      .filter((ch) => ch.channel_type !== 'llm')
      .filter((ch) => (allowed ? allowed.has(ch.channel_type) : true))
      .map((ch) => ({ ...ch, operation_label: channelLabel(ch) }));
  }, [channelsQuery.data, options.channelTypes]);

  useEffect(() => {
    if (!selectedChannelId) return;
    if (channels.length === 0) return;
    if (!channels.some((ch) => ch.id === selectedChannelId)) {
      setSelectedChannelIdForWorkspace(workspaceId, null);
    }
  }, [channels, selectedChannelId, setSelectedChannelIdForWorkspace, workspaceId]);

  useEffect(() => {
    if (channels.length === 0 || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get('commercial_lead_id')) return;
    const commercial = channels.find(isCommercialChannel);
    if (commercial && selectedChannelId !== commercial.id) {
      setSelectedChannelIdForWorkspace(workspaceId, commercial.id);
    }
  }, [channels, selectedChannelId, setSelectedChannelIdForWorkspace, workspaceId]);

  const setSelectedChannelId = (next: string | null) => {
    setSelectedChannelIdForWorkspace(workspaceId, next);
  };

  const selectedChannel = channels.find((ch) => ch.id === selectedChannelId) || null;

  return {
    workspaceName,
    channels,
    selectedChannel,
    selectedChannelId,
    setSelectedChannelId,
    isLoading: channelsQuery.isLoading,
  };
}
