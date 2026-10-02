'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  Edit3,
  Camera,
  MessageSquare,
  Plus,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  createChannel,
  deleteChannel,
  formatLastMessageAt,
  listChannels,
  parseChannelOperationalConfig,
  parseQueues,
  providerForKind,
  type SectorOption,
  type WorkspaceChannel,
  uiStatusFromChannel,
} from '@/lib/integrations/channelsApi';
import { ChannelWebhookModal } from './ChannelWebhookModal';

type Kind = 'whatsapp' | 'instagram';

const STATUS_CLASS: Record<string, string> = {
  ativo: 'bg-success/15 text-success',
  pausado: 'bg-muted text-muted-foreground',
  erro: 'bg-destructive/15 text-destructive',
  rascunho: 'bg-warning/15 text-amber-800 dark:text-amber-200',
};

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'success' | 'destructive' }) {
  return (
    <div className="rounded-md bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 font-mono text-lg font-semibold',
          tone === 'success' && 'text-success',
          tone === 'destructive' && 'text-destructive'
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function SocialChannelManager({
  kind,
  isAdmin,
  sectors,
}: {
  kind: Kind;
  isAdmin?: boolean;
  sectors: SectorOption[];
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<WorkspaceChannel | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: all = [], isLoading } = useQuery({
    queryKey: ['integrations', 'channels'],
    queryFn: listChannels,
  });

  const channels = useMemo(() => all.filter((c) => c.channel_type === kind), [all, kind]);

  const meta =
    kind === 'whatsapp'
      ? {
          title: 'WhatsApp Business API',
          desc: 'Gerencie credenciais e webhooks. Suporta múltiplas conexões para escalar o produto.',
          icon: <MessageSquare className="h-5 w-5 text-channel-whatsapp" />,
          bg: 'bg-channel-whatsapp/15',
          idLabel: 'Phone Number ID',
        }
      : {
          title: 'Instagram Direct API',
          desc: 'Conecte contas do Instagram via Meta Cloud. Cada webhook recebe DMs da conta vinculada.',
          icon: <Camera className="h-5 w-5 text-channel-instagram" />,
          bg: 'bg-channel-instagram/15',
          idLabel: 'Instagram User ID',
        };

  const activeCount = channels.filter((c) => uiStatusFromChannel(c) === 'ativo').length;
  const errorCount = channels.filter((c) => uiStatusFromChannel(c) === 'erro').length;
  const msgs24h = channels.reduce((a, c) => a + (c.messages_24h ?? 0), 0);

  const removeMut = useMutation({
    mutationFn: deleteChannel,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['integrations', 'channels'] }),
  });

  const callbackFor = (ch: WorkspaceChannel) => ch.webhook_callback_url || null;

  return (
    <>
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', meta.bg)}>{meta.icon}</div>
            <div>
              <h3 className="text-sm font-semibold">{meta.title}</h3>
              <p className="text-[11px] text-muted-foreground">{meta.desc}</p>
            </div>
          </div>
          {isAdmin ? (
            <Button type="button" size="xs" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> Novo webhook
            </Button>
          ) : null}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat label="Webhooks ativos" value={isLoading ? '…' : activeCount} tone="success" />
          <Stat label="Mensagens 24h" value={isLoading ? '…' : msgs24h.toLocaleString('pt-BR')} />
          <Stat label="Com problema" value={isLoading ? '…' : errorCount} tone="destructive" />
        </div>
      </div>

      <div className="space-y-2">
        {!isLoading && channels.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-xs text-muted-foreground">
            Nenhum webhook conectado. {isAdmin ? 'Clique em "Novo webhook" para começar.' : 'Peça a um administrador para configurar.'}
          </div>
        )}
        {channels.map((w) => {
          const uiStatus = uiStatusFromChannel(w);
          const operational = parseChannelOperationalConfig(w.config);
          const queues = parseQueues(w.config);
          const activeDemands = operational.demands.filter((d) => d.is_active !== false).length;
          const slaConfigured = Boolean(operational.sla.first_response_sla_minutes && operational.sla.resolution_sla_minutes);
          const displayNumber = String(w.config?.display_number || w.credentials?.display_number || w.external_id || '—');
          const callback = callbackFor(w);

          return (
            <div key={w.id} className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{w.display_name || 'Sem nome'}</span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                        STATUS_CLASS[uiStatus]
                      )}
                    >
                      {uiStatus === 'ativo' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />}
                      {uiStatus}
                    </span>
                    <span className="text-[10px] text-subtle-foreground">
                      · última msg {formatLastMessageAt(w.last_message_at)} · {(w.messages_24h ?? 0).toLocaleString('pt-BR')}{' '}
                      msgs/24h
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {displayNumber} · {meta.idLabel} {w.external_id || '—'}
                  </div>
                  {queues.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-subtle-foreground">Filas:</span>
                      {queues.map((q) => (
                        <span key={q.name} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                          {q.name}
                          {q.sector_ids.length > 0 && (
                            <span className="ml-1 text-primary/60">
                              · {q.sector_ids.length} setor{q.sector_ids.length > 1 ? 'es' : ''}
                            </span>
                          )}
                          {q.notify_email && <span className="ml-1 text-primary/50">· ✉ {q.notify_email}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                    <span className="rounded bg-background px-1.5 py-0.5">
                      {operational.sectors.filter((s) => s.is_active).length} setor{operational.sectors.filter((s) => s.is_active).length !== 1 ? 'es' : ''}
                    </span>
                    <span className="rounded bg-background px-1.5 py-0.5">
                      {activeDemands} demanda{activeDemands !== 1 ? 's' : ''} ativa{activeDemands !== 1 ? 's' : ''}
                    </span>
                    <span className={cn('rounded px-1.5 py-0.5', slaConfigured ? 'bg-success/10 text-success' : 'bg-background')}>
                      SLA {slaConfigured ? 'configurado' : 'pendente'}
                    </span>
                    <span className={cn('rounded px-1.5 py-0.5', operational.operation.csat_enabled ? 'bg-primary/10 text-primary' : 'bg-background')}>
                      CSAT {operational.operation.csat_enabled ? 'ativo' : 'inativo'}
                    </span>
                  </div>
                </div>
                {isAdmin ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(w)}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-sidebar-accent/60"
                    >
                      <Edit3 className="h-3 w-3" /> Editar
                    </button>
                    {callback ? (
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(callback)}
                        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-sidebar-accent/60"
                      >
                        <Copy className="h-3 w-3" /> URL
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('Excluir esta conexão?')) removeMut.mutate(w.id);
                      }}
                      className="rounded-md border border-destructive/30 px-2 py-1 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5 text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" /> <span className="font-medium">Credenciais centralizadas</span>
        </div>
        <p className="mt-1">
          A plataforma consome estas credenciais automaticamente — não é necessário tocar no código.
        </p>
      </div>

      {(editing || creating) && isAdmin ? (
        <ChannelWebhookModal
          kind={kind}
          channel={editing}
          sectors={sectors}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={async () => {
            await qc.invalidateQueries({ queryKey: ['integrations', 'channels'] });
            setEditing(null);
            setCreating(false);
          }}
          onCreate={async (payload) => {
            await createChannel({
              channel_type: kind,
              provider: providerForKind(kind),
              ...payload,
            });
          }}
        />
      ) : null}
    </>
  );
}
