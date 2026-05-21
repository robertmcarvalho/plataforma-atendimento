'use client';

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChannelAssignmentRow } from '@/lib/users/usersApi';

type Sector = { id: string; name: string };

export function FilasSetoresPicker({
  channels,
  sectors,
  value,
  onChange,
  perfil,
}: {
  channels: ChannelAssignmentRow[];
  sectors: Sector[];
  value: ChannelAssignmentRow[];
  onChange: (next: ChannelAssignmentRow[]) => void;
  perfil: 'attendant' | 'supervisor';
}) {
  const [local, setLocal] = useState<ChannelAssignmentRow[]>(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const waChannels = local.filter((c) => c.channel_type === 'whatsapp');

  const patch = (next: ChannelAssignmentRow[]) => {
    setLocal(next);
    onChange(next);
  };

  const toggleChannel = (channelId: string) => {
    patch(
      local.map((c) => {
        if (c.workspace_channel_id !== channelId) return c;
        const enabled = !c.enabled;
        return { ...c, enabled, sector_ids: enabled ? c.sector_ids : [] };
      })
    );
  };

  const toggleSector = (channelId: string, sectorId: string) => {
    patch(
      local.map((c) => {
        if (c.workspace_channel_id !== channelId) return c;
        const has = c.sector_ids.includes(sectorId);
        const sector_ids = has ? c.sector_ids.filter((id) => id !== sectorId) : [...c.sector_ids, sectorId];
        return { ...c, enabled: true, sector_ids };
      })
    );
  };

  if (!waChannels.length) {
    return <p className="text-xs text-muted-foreground">Nenhum canal WhatsApp configurado no workspace.</p>;
  }

  return (
    <div>
      <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
        Filas de WhatsApp e setores
      </label>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {perfil === 'supervisor'
          ? 'Filas que este gestor supervisiona e setores em cada fila.'
          : 'Filas e setores em que este atendente atuará.'}
      </p>
      <div className="mt-2 space-y-2">
        {waChannels.map((w) => {
          const label = w.display_name || w.workspace_channel_id.slice(0, 8);
          return (
            <div
              key={w.workspace_channel_id}
              className={cn(
                'rounded-md border transition-colors',
                w.enabled ? 'border-primary/40 bg-primary/5' : 'border-border bg-background/40'
              )}
            >
              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={w.enabled}
                  onChange={() => toggleChannel(w.workspace_channel_id)}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                <span className="font-medium">{label}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{sectors.length} setores</span>
              </label>
              {w.enabled ? (
                <div className="border-t border-border/60 px-3 py-2">
                  <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Info className="h-2.5 w-2.5" /> Setores nesta fila (vazio = todos)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sectors.map((s) => {
                      const on = w.sector_ids.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleSector(w.workspace_channel_id, s.id)}
                          className={cn(
                            'rounded-md border px-2 py-1 text-[10px] transition-colors',
                            on ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-surface-hover'
                          )}
                        >
                          {on ? '✓ ' : ''}
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
