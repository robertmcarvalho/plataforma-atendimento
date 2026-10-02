'use client';



import { FileSignature, Timer } from 'lucide-react';

import { AvatarInitials } from '@/components/ui/AvatarInitials';

import { Card, CardContent } from '@/components/ui/card';

import type { OpsSignaturePending } from '@/lib/ops/opsAnalyticsApi';

import { cn } from '@/lib/utils';



export function OperacaoSignaturePendingCard({ item }: { item: OpsSignaturePending }) {

  const overdue = item.days_pending >= item.deadline_days;

  const typeLabel = item.type === 'matricula' ? 'Matrícula' : 'Termo de desligamento';

  const statusLabel = item.signature_status_label || 'Aguardando assinatura';

  const pct = Math.min(100, Math.round((item.days_pending / Math.max(1, item.deadline_days)) * 100));



  return (

    <Card className="border-border py-0">

      <CardContent className="p-5">

        <div className="flex items-start gap-2">

          <FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />

          <div className="min-w-0 flex-1">

            <p className="text-xs font-medium">{typeLabel}</p>

            <p className="mt-0.5 text-[10px] text-muted-foreground">{statusLabel}</p>

            <div className="mt-1 flex items-center gap-2">

              <AvatarInitials name={item.driver_name} size="sm" className="bg-primary" />

              <span className="truncate text-xs text-muted-foreground">{item.driver_name}</span>

            </div>

            <p className="mt-1 truncate text-[10px] text-muted-foreground">{item.pharmacy_name}</p>

            <div className="mt-2">

              <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">

                <span className="flex items-center gap-1">

                  <Timer className="h-3 w-3" />

                  Prazo assinatura

                </span>

                <span className={cn('font-mono', overdue ? 'text-destructive' : 'text-warning')}>

                  {item.days_pending}d / {item.deadline_days}d

                </span>

              </div>

              <div className="h-1.5 overflow-hidden rounded-full bg-muted">

                <div

                  className={cn('h-full transition-all', overdue ? 'bg-destructive' : 'bg-warning')}

                  style={{ width: `${pct}%` }}

                />

              </div>

            </div>

          </div>

        </div>

      </CardContent>

    </Card>

  );

}

