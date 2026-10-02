'use client';

import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { IconTile } from '@/components/ui/IconTile';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusDot } from '@/components/ui/StatusDot';
import type { FarmaciaOperacional } from '@/lib/operacao/reviveCopy/operacaoReviveTypes';
import { cn } from '@/lib/utils';

const slaCls = (sla: number) =>
  sla >= 95 ? 'bg-success/15 text-success' : sla >= 88 ? 'bg-warning/15 text-warning' : 'bg-destructive/15 text-destructive';

export function RevivePharmacySection({
  farmacias,
  loading,
}: {
  farmacias: FarmaciaOperacional[];
  loading?: boolean;
}) {
  return (
    <section className="h-fit lg:col-span-2">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <IconTile icon={Building2} tone="primary" size="sm" /> Farmácias sob responsabilidade
        </h2>
        <Link href="/pharmacies" className="text-[11px] text-primary hover:underline">
          Ver todas
        </Link>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {farmacias.map((f) => (
            <div
              key={f.id}
              className="rounded-xl border border-border bg-surface p-5 transition-colors hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <IconTile icon={Building2} tone="primary" size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{f.nome}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{f.cidade}</div>
                  </div>
                </div>
                <span className={cn('rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold', slaCls(f.sla))}>
                  {f.sla.toFixed(1)}%
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-background/40 p-2.5">
                <div className="relative">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-primary text-[11px] font-semibold text-primary-foreground">
                    {f.liderIniciais}
                  </div>
                  <StatusDot status={f.liderStatus} pulse={f.liderStatus === 'online'} className="absolute -bottom-0.5 -right-0.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{f.liderNome}</div>
                  <div className="text-[10px] text-subtle-foreground">Líder responsável</div>
                </div>
                <Link
                  href={`/leaders/${f.liderId}`}
                  className="rounded border border-border bg-background px-2 py-1 text-[10px] hover:bg-sidebar-accent/60"
                >
                  Abrir
                </Link>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3">
                <div>
                  <div className="font-mono text-sm font-semibold">
                    {f.entregadoresAtivos}/{f.entregadoresTotal}
                  </div>
                  <div className="text-[10px] text-subtle-foreground">Entregadores</div>
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold">{f.filaChats}</div>
                  <div className="text-[10px] text-subtle-foreground">Fila chats</div>
                </div>
                <div>
                  <div className={cn('font-mono text-sm font-semibold', f.pedidosPendentes > 15 && 'text-destructive')}>
                    {f.pedidosPendentes}
                  </div>
                  <div className="text-[10px] text-subtle-foreground">Pedidos pend.</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
