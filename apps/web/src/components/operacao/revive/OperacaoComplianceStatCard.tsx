import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function OperacaoComplianceStatCard({
  label,
  icon: Icon,
  ok,
  total,
  pct,
}: {
  label: string;
  icon: LucideIcon;
  ok: number;
  total: number;
  pct: number;
}) {
  return (
    <Card className="border-border py-0">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <div>
              <div className="text-[11px] text-muted-foreground">{label}</div>
              <div className="font-mono text-lg font-semibold tracking-tight">
                {ok}
                <span className="text-muted-foreground">/{total}</span>
              </div>
            </div>
          </div>
          <div
            className={cn(
              'rounded-md px-2 py-0.5 font-mono text-xs font-semibold',
              pct >= 90 ? 'bg-success/15 text-success' : pct >= 70 ? 'bg-warning/15 text-warning' : 'bg-destructive/15 text-destructive'
            )}
          >
            {pct}%
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full transition-all',
              pct >= 90 ? 'bg-success' : pct >= 70 ? 'bg-warning' : 'bg-destructive'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
