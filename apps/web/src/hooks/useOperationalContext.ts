'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listChannels, type WorkspaceChannel } from '@/lib/integrations/channelsApi';
import { useAuth } from '@/store/auth';

const STORAGE_PREFIX = 'operational-context-channel';

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

  const [selectedByWorkspace, setSelectedByWorkspace] = useState<Record<string, string | null>>({});

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

  const selectedChannelId =
    selectedByWorkspace[workspaceId] ??
    (typeof window !== 'undefined' ? window.localStorage.getItem(`${STORAGE_PREFIX}:${workspaceId}`) : null);

  useEffect(() => {
    if (!selectedChannelId) return;
    if (channels.length === 0) return;
    if (!channels.some((ch) => ch.id === selectedChannelId)) {
      if (typeof window !== 'undefined') window.localStorage.removeItem(`${STORAGE_PREFIX}:${workspaceId}`);
    }
  }, [channels, selectedChannelId, workspaceId]);

  const setSelectedChannelId = (next: string | null) => {
    setSelectedByWorkspace((current) => ({ ...current, [workspaceId]: next }));
    if (typeof window === 'undefined') return;
    const key = `${STORAGE_PREFIX}:${workspaceId}`;
    if (next) window.localStorage.setItem(key, next);
    else window.localStorage.removeItem(key);
  };

  const selectedChannel = channels.find((ch) => ch.id === selectedChannelId) || null;

  return {
    workspaceName,
    channels,
    selectedChannel,
    selectedChannelId: selectedChannel?.id || null,
    setSelectedChannelId,
    isLoading: channelsQuery.isLoading,
  };
}
