import { cn } from '@/lib/utils';
import { formatBrlCents } from '@/lib/billing/billingFormat';

export function BillingSaldoCell({
  amountCents,
  amountPaidCents,
  status,
  dueDate,
}: {
  amountCents: number;
  amountPaidCents: number;
  status: string;
  dueDate?: string | null;
}) {
  const balance = Math.max(0, amountCents - amountPaidCents);
  const pct = amountCents > 0 ? Math.min(100, (amountPaidCents / amountCents) * 100) : 0;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = dueDate && dueDate < today && balance > 0;
  const cor =
    balance <= 0 || status === 'paid'
      ? 'bg-success'
      : overdue
        ? 'bg-destructive'
        : amountPaidCents > 0
          ? 'bg-warning'
          : 'bg-primary';

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-background/60">
        <div className={cn('h-full', cor)} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-20 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatBrlCents(balance)}
      </div>
    </div>
  );
}
