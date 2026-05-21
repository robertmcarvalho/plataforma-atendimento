'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { ChannelsPanel } from './channels/ChannelsPanel';

export function SettingsChannelsPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const { data: sectors = [] } = useQuery({
    queryKey: ['sectors', 'channels'],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; name: string }>>('/api/sectors');
      return (data || []).map((s) => ({ id: String(s.id), name: String(s.name) }));
    },
  });

  return <ChannelsPanel isAdmin={isAdmin} sectors={sectors} />;
}
