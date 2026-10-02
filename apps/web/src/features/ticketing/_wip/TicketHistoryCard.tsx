// WIP � feature paused. Flag: ticketingPanel in lib/features.ts
// Do not delete. Context: codebase audit Phase A (ticketing panel soft-pause)

'use client';



import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import { format } from 'date-fns';

import { ptBR } from 'date-fns/locale';

import api from '@/lib/api';

import { cn } from '@/lib/utils';

import { SectionTitle } from '@/components/ui/SectionTitle';

import type { EntityIds } from '@/lib/ticketing/deriveEntityIds';

import type { OperationalTicket } from '@/lib/ticketing/types';



type TicketRow = OperationalTicket;



function HistoryCardShell({ children }: { children: React.ReactNode }) {

  return (

    <div className="rounded-lg border border-border bg-transparent p-3">

      {children}

    </div>

  );

}



function statusClass(status: string) {

  switch (status) {

    case 'resolved':

      return 'text-success';

    case 'open':

      return 'text-primary';

    case 'in_progress':

      return 'text-channel-instagram';

    case 'overdue':

      return 'text-destructive';

    default:

      return 'text-muted-foreground';

  }

}



export function TicketHistoryCard({

  entityIds,

  contactId,

  excludeTicketId,

}: {

  entityIds: EntityIds;

  contactId: string | null;

  excludeTicketId: string | null;

}) {

  const params = useMemo(() => {

    const p: Record<string, string> = { limit: '5' };

    if (excludeTicketId) p.exclude_ticket_id = excludeTicketId;

    if (entityIds.driver_id) p.driver_id = entityIds.driver_id;

    else if (entityIds.pharmacy_id) p.pharmacy_id = entityIds.pharmacy_id;

    else if (entityIds.leader_id) p.leader_id = entityIds.leader_id;

    else if (contactId) p.contact_id = contactId;

    return p;

  }, [entityIds, contactId, excludeTicketId]);



  const hasFilter = Boolean(

    entityIds.driver_id || entityIds.pharmacy_id || entityIds.leader_id || contactId

  );



  const q = useQuery({

    queryKey: ['ticket-history-inbox', params],

    enabled: hasFilter,

    queryFn: async () => {

      const r = await api.get<TicketRow[]>('/api/tickets', { params });

      return r.data;

    },

  });



  if (!hasFilter) {

    return (

      <HistoryCardShell>

        <SectionTitle>Histórico de chamados</SectionTitle>

        <p className="mt-1 text-xs text-muted-foreground">Sem contexto de entidade para listar tickets.</p>

      </HistoryCardShell>

    );

  }



  if (q.isLoading) {

    return (

      <HistoryCardShell>

        <SectionTitle>Histórico de chamados</SectionTitle>

        <p className="mt-1 text-xs text-muted-foreground">Carregando…</p>

      </HistoryCardShell>

    );

  }



  if (q.isError) {

    return (

      <HistoryCardShell>

        <SectionTitle>Histórico de chamados</SectionTitle>

        <p className="mt-1 text-xs text-destructive">Falha ao carregar tickets.</p>

      </HistoryCardShell>

    );

  }



  const rows = q.data || [];

  if (rows.length === 0) {

    return (

      <HistoryCardShell>

        <SectionTitle>Histórico de chamados</SectionTitle>

        <p className="mt-1 text-xs text-muted-foreground">Nenhum ticket anterior encontrado.</p>

      </HistoryCardShell>

    );

  }



  return (

    <HistoryCardShell>

      <SectionTitle>Histórico de chamados</SectionTitle>

      <ul className="mt-2 space-y-2">

        {rows.map((t) => {

          const created = t.created_at ? format(new Date(t.created_at), 'dd MMM', { locale: ptBR }) : '—';

          return (

            <li key={t.id} className="rounded-lg border border-border/80 bg-background/40 px-2 py-1.5">

              <div className="flex items-start justify-between gap-2">

                <span className="font-mono text-[11px] font-semibold text-foreground">{t.ticket_code}</span>

                <span className="shrink-0 font-mono text-[10px] text-subtle-foreground">{created}</span>

              </div>

              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">

                <span className="text-muted-foreground">{t.type}</span>

                <span className={cn('font-medium capitalize', statusClass(t.status))}>{t.status.replace('_', ' ')}</span>

              </div>

            </li>

          );

        })}

      </ul>

    </HistoryCardShell>

  );

}

