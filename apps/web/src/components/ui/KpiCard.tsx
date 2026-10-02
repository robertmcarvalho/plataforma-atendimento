import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { IconTile, type IconTileTone } from './IconTile';
import { Sparkline } from './Sparkline';
import { cn } from '@/lib/utils';

export function KpiCard({
  title,
  value,
  deltaLabel,
  deltaTone = 'muted',
  values,
  icon,
  iconTone = 'muted',
  id,
  alert,
  alertLevel = 'destructive',
}: {
  id?: string;
  title: string;
  value: string | number;
  deltaLabel?: string | null;
  deltaTone?: 'muted' | 'success' | 'warning' | 'destructive' | 'primary' | 'up' | 'down' | 'neutral';
  values?: number[];
  icon?: LucideIcon | React.ReactNode;
  iconTone?: IconTileTone;
  alert?: boolean;
  alertLevel?: 'success' | 'destructive' | 'neutral';
}) {
  const resolvedTone =
    deltaTone === 'up' ? 'success' : deltaTone === 'down' ? 'destructive' : deltaTone === 'neutral' ? 'muted' : deltaTone;

  const toneClass =
    resolvedTone === 'success'
      ? 'text-success'
      : resolvedTone === 'warning'
        ? 'text-warning'
        : resolvedTone === 'destructive'
          ? 'text-destructive'
          : resolvedTone === 'primary'
            ? 'text-primary'
            : 'text-muted-foreground';

  const isLucide = icon && typeof icon === 'function';

  const alertBorder =
    alert && alertLevel === 'success'
      ? 'border-success/40'
      : alert && alertLevel === 'destructive'
        ? 'border-destructive/40'
        : '';

  return (
    <Card id={id} className={cn(alert ? alertBorder : 'border-border')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {icon ? (
                  isLucide ? (
                    <IconTile icon={icon as LucideIcon} tone={iconTone} size="sm" />
                  ) : (
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
                      {icon}
                    </span>
                  )
                ) : null}
                <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
              </div>
              {alert ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" strokeWidth={1.75} /> : null}
            </div>
            <div className="mt-2 font-mono text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{value}</div>
          </div>
          {values && values.length ? (
            <Sparkline values={values} className="shrink-0 opacity-90" width={80} height={24} />
          ) : null}
        </div>
        {deltaLabel ? (
          <div className={cn('mt-2 flex items-center gap-1 text-[11px]', toneClass)}>
            {deltaTone === 'up' ? <ArrowUpRight className="h-3 w-3" /> : null}
            {deltaTone === 'down' ? <ArrowDownRight className="h-3 w-3" /> : null}
            {deltaLabel}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
