'use client';

import Link from 'next/link';
import { AlertTriangle, Bell, Clock, Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { OpsAlertRevive } from '@/lib/ops/opsAnalyticsApi';
import { cn } from '@/lib/utils';

const nivelIcon = {
  destructive: AlertTriangle,
  warning: AlertTriangle,
  success: Bell,
  info: Info,
} as const;

const nivelCls = {
  destructive: 'border-destructive/30 bg-destructive/5 text-destructive',
  warning: 'border-warning/30 bg-warning/5 text-warning',
  success: 'border-success/30 bg-success/5 text-success',
  info: 'border-border bg-muted/30 text-muted-foreground',
} as const;

export function OperacaoAlertReviveCard({ alert }: { alert: OpsAlertRevive }) {
  const Icon = nivelIcon[alert.nivel] || Info;
  const content = (
    <Card className={cn('border-border py-0 transition-colors', nivelCls[alert.nivel], alert.href && 'hover:border-primary/40')}>
      <CardContent className="p-5 text-left">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-background/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
                {alert.tipo}
              </span>
              <span className="flex items-center gap-1 font-mono text-[10px] opacity-80">
                <Clock className="h-3 w-3" />
                {alert.timestamp}
              </span>
            </div>
            <p className="text-xs font-medium leading-snug">{alert.descricao}</p>
            <p className="mt-1 text-[10px] opacity-80">{alert.farmacia}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (alert.href) {
    return <Link href={alert.href}>{content}</Link>;
  }
  return content;
}
