'use client';



import Link from 'next/link';

import { Building2, MessageCircle, Truck, Wallet } from 'lucide-react';

import { AvatarInitials } from '@/components/ui/AvatarInitials';

import { Card, CardContent } from '@/components/ui/card';

import type { OpsPharmacyCard } from '@/lib/ops/opsAnalyticsApi';

import { cn } from '@/lib/utils';



export function OperacaoPharmacyReviveCard({ pharmacy }: { pharmacy: OpsPharmacyCard }) {

  const slaTone =

    pharmacy.sla_percent >= 90 ? 'text-success' : pharmacy.sla_percent >= 70 ? 'text-warning' : 'text-destructive';



  return (

    <Link href={`/pharmacies/${pharmacy.id}`} className="block">

      <Card className="border-border py-0 transition-colors hover:border-primary/40">

        <CardContent className="p-5">

          <div className="flex items-start justify-between gap-3">

            <div className="flex min-w-0 items-center gap-3">

              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/30 text-muted-foreground">

                <Building2 className="h-5 w-5" strokeWidth={1.75} />

              </div>

              <div className="min-w-0">

                <p className="truncate text-sm font-semibold">{pharmacy.trade_name}</p>

                <p className="truncate text-xs text-muted-foreground">{pharmacy.city || '—'}</p>

              </div>

            </div>

            {pharmacy.leader_name ? (

              <div className="flex shrink-0 items-center gap-1.5">

                <AvatarInitials name={pharmacy.leader_name} size="sm" className="bg-primary" />

                <span className="hidden text-[10px] text-muted-foreground sm:inline">{pharmacy.leader_name}</span>

              </div>

            ) : null}

          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">

            <div className="rounded-lg border border-border bg-background/50 px-2 py-2">

              <Truck className="mx-auto h-3.5 w-3.5 text-muted-foreground" />

              <p className="mt-1 font-mono text-sm font-semibold">{pharmacy.drivers_active}</p>

              <p className="text-[9px] text-muted-foreground">Entregadores</p>

            </div>

            <div className="rounded-lg border border-border bg-background/50 px-2 py-2">

              <MessageCircle className="mx-auto h-3.5 w-3.5 text-muted-foreground" />

              <p className="mt-1 font-mono text-sm font-semibold">{pharmacy.open_conversations}</p>

              <p className="text-[9px] text-muted-foreground">Atendimentos</p>

            </div>

            <div className="rounded-lg border border-border bg-background/50 px-2 py-2">

              <Wallet className="mx-auto h-3.5 w-3.5 text-muted-foreground" />

              <p className="mt-1 font-mono text-sm font-semibold">{pharmacy.pending_financial}</p>

              <p className="text-[9px] text-muted-foreground">Pendências</p>

            </div>

          </div>

          <div className="mt-3 flex items-center justify-between text-[10px]">

            <span className="text-muted-foreground">SLA atendimento</span>

            <span className={cn('font-mono font-semibold', slaTone)}>

              {pharmacy.sla_percent > 0 ? `${pharmacy.sla_percent}%` : '—'}

            </span>

          </div>

        </CardContent>

      </Card>

    </Link>

  );

}

