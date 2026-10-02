// WIP � feature paused. Flag: ticketingPanel in lib/features.ts
// Do not delete. Context: codebase audit Phase A (ticketing panel soft-pause)

'use client';



import Link from 'next/link';

import { useQuery } from '@tanstack/react-query';

import api from '@/lib/api';

import { SectionTitle } from '@/components/ui/SectionTitle';



export type AttendantFinancialDisplay = {

  driver_name: string;

  open_advance_count: number;

  open_advances: Array<{ date_label: string; amount_label: string }>;

  month_summary_line: string | null;

  recent_advances: Array<{ line: string }>;

  recent_occurrences: Array<{ line: string }>;

  alerts: string[];

  flow_hint: string;

};



type InboxReviewResponse = {

  driver?: { id: string; name?: string | null };

  attendant_display?: AttendantFinancialDisplay;

};



function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {

  return (

    <div className="min-w-0 rounded-lg border border-border bg-transparent p-3">

      <SectionTitle>{title}</SectionTitle>

      <div className="mt-2 min-w-0 space-y-1.5 break-words text-xs">{children}</div>

    </div>

  );

}



export function DriverFinancialReviewPanel({ driverId }: { driverId: string | null }) {

  const { data, isLoading, isError } = useQuery({

    queryKey: ['inbox', 'driver-financial-review', driverId],

    enabled: Boolean(driverId),

    staleTime: 30_000,

    queryFn: async () =>

      (await api.get<InboxReviewResponse>(`/api/financial/drivers/${driverId}/inbox-review`)).data,

  });



  const title = 'Situação financeira do entregador';



  if (!driverId) {

    return (

      <PanelShell title={title}>

        <p className="text-muted-foreground">

          Vincule um entregador à conversa para ver adiantamentos e lançamentos recentes.

        </p>

      </PanelShell>

    );

  }



  if (isLoading) {

    return (

      <PanelShell title={title}>

        <p className="text-muted-foreground">Carregando resumo…</p>

      </PanelShell>

    );

  }



  if (isError || !data?.attendant_display) {

    return (

      <PanelShell title={title}>

        <p className="text-destructive">Não foi possível carregar o resumo financeiro.</p>

      </PanelShell>

    );

  }



  const d = data.attendant_display;



  return (

    <PanelShell title={title}>

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">

        <p className="min-w-0 font-medium text-foreground">{d.driver_name}</p>

        <Link

          href={`/financial?driver_id=${encodeURIComponent(driverId)}`}

          className="shrink-0 text-[11px] font-medium text-primary hover:underline"

        >

          Ver lançamentos

        </Link>

      </div>



      {d.open_advance_count === 0 ? (

        <p className="text-muted-foreground">Nenhum adiantamento em aberto.</p>

      ) : (

        <>

          <p className="text-muted-foreground">

            {d.open_advance_count === 1

              ? '1 adiantamento em aberto:'

              : `${d.open_advance_count} adiantamentos em aberto:`}

          </p>

          <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">

            {d.open_advances.map((a, i) => (

              <li key={i}>

                {a.date_label} — {a.amount_label}

              </li>

            ))}

          </ul>

        </>

      )}



      {d.month_summary_line ? <p className="text-muted-foreground">{d.month_summary_line}</p> : null}



      {d.recent_advances.length ? (

        <div className="min-w-0">

          <p className="font-medium text-foreground">Adiantamentos recentes</p>

          <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">

            {d.recent_advances.map((r, i) => (

              <li key={i}>{r.line}</li>

            ))}

          </ul>

        </div>

      ) : null}



      {d.recent_occurrences.length ? (

        <div className="min-w-0">

          <p className="font-medium text-foreground">Descontos e ocorrências recentes</p>

          <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">

            {d.recent_occurrences.map((r, i) => (

              <li key={i}>{r.line}</li>

            ))}

          </ul>

        </div>

      ) : (

        <p className="text-muted-foreground">Sem outros descontos ou ocorrências recentes.</p>

      )}



      {d.alerts.map((msg, i) => (

        <p key={i} className="text-destructive">

          {msg}

        </p>

      ))}

    </PanelShell>

  );

}

