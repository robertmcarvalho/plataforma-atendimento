// WIP � feature paused. Flag: ticketingPanel in lib/features.ts
// Do not delete. Context: codebase audit Phase A (ticketing panel soft-pause)

'use client';



import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import api from '@/lib/api';

import { SectionTitle } from '@/components/ui/SectionTitle';

import type { FinancialWeeklySummary } from '@/lib/inbox/financialSummary';



function formatBrl(n: number) {

  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

}



function formatDateBr(iso: string | null | undefined) {

  if (!iso) return '';

  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR');

}



function MonthCardShell({ children }: { children: React.ReactNode }) {

  return (

    <div className="rounded-lg border border-border bg-transparent p-3">

      {children}

    </div>

  );

}



export function FinancialMonthCard({ driverId }: { driverId: string | null }) {

  const referenceDate = useMemo(() => new Date().toISOString().slice(0, 10), []);



  const q = useQuery({

    queryKey: ['financial-weekly-summary', driverId, referenceDate],

    enabled: Boolean(driverId),

    queryFn: async () => {

      const r = await api.get<FinancialWeeklySummary>('/api/financial/weekly-summary', {

        params: { driver_id: driverId, reference_date: referenceDate },

      });

      return r.data;

    },

  });



  if (!driverId) {

    return (

      <MonthCardShell>

        <SectionTitle>Financeiro - Período (semana referência)</SectionTitle>

        <p className="mt-1 text-xs text-muted-foreground">Associado a um entregador para ver o resumo semanal.</p>

      </MonthCardShell>

    );

  }



  if (q.isLoading) {

    return (

      <MonthCardShell>

        <SectionTitle>Financeiro - Período (semana referência)</SectionTitle>

        <p className="mt-1 text-xs text-muted-foreground">Carregando…</p>

      </MonthCardShell>

    );

  }



  if (q.isError) {

    return (

      <MonthCardShell>

        <SectionTitle>Financeiro - Período (semana referência)</SectionTitle>

        <p className="mt-1 text-xs text-destructive">Sem permissão ou falha ao carregar resumo.</p>

      </MonthCardShell>

    );

  }



  const s = q.data;

  if (!s) return null;



  const breakdownEntries = Object.entries(s.cycle.discounts_breakdown)

    .filter(([, b]) => (b?.amount ?? 0) > 0)

    .sort(([, a], [, b]) => b.amount - a.amount);



  return (

    <MonthCardShell>

      <SectionTitle>Financeiro - Período (semana referência)</SectionTitle>



      <div className="mt-1 grid gap-0.5 text-[10px] text-muted-foreground">

        <div>

          Ciclo apuração:{' '}

          <span className="font-mono text-foreground">

            {formatDateBr(s.cycle.start)} - {formatDateBr(s.cycle.end)}

          </span>

        </div>

        <div>

          Diárias semana atual:{' '}

          <span className="font-mono text-foreground">

            {formatDateBr(s.current_week.start)} - {formatDateBr(s.current_week.end)}

          </span>

        </div>

      </div>



      <div className="mt-2 space-y-1.5 text-xs">

        <div className="flex justify-between gap-2">

          <span className="text-muted-foreground">Receita semanal</span>

          <span className="font-mono font-medium text-foreground">{formatBrl(s.cycle.weekly_revenue)}</span>

        </div>

        <div className="flex justify-between gap-2">

          <span className="text-muted-foreground">

            Diárias pagas

            {s.current_week.daily_entries.length > 0

              ? ` (${s.current_week.daily_entries.length}x)`

              : ''}

          </span>

          <span className="font-mono font-medium text-foreground">{formatBrl(s.current_week.daily_total)}</span>

        </div>



        {breakdownEntries.length === 0 ? (

          <div className="text-[11px] italic text-muted-foreground">Sem descontos verificados no ciclo.</div>

        ) : (

          breakdownEntries.map(([slug, bucket]) => (

            <div key={slug} className="flex justify-between gap-2">

              <span className="text-muted-foreground">

                {bucket.label}

                {bucket.count > 1 ? ` (${bucket.count}x)` : ''}

                {bucket.last_date ? ` · ${formatDateBr(bucket.last_date)}` : ''}

              </span>

              <span className="font-mono font-medium text-warning">-{formatBrl(bucket.amount)}</span>

            </div>

          ))

        )}



        <div className="flex justify-between gap-2 border-t border-border/40 pt-1.5">

          <span className="text-muted-foreground">Total descontos</span>

          <span className="font-mono font-medium text-warning">-{formatBrl(s.cycle.discounts_total)}</span>

        </div>



        <div className="flex justify-between gap-2 border-t border-border/60 pt-2">

          <span className="text-foreground">Líquido estimado</span>

          <span className="font-mono text-sm font-semibold text-success">{formatBrl(s.net_estimated)}</span>

        </div>

      </div>

    </MonthCardShell>

  );

}

