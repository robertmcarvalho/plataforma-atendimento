import { Sparkline } from './Sparkline';

export function KpiCard({
  title,
  value,
  deltaLabel,
  deltaTone = 'muted',
  values,
  icon,
  id,
}: {
  id?: string;
  title: string;
  value: string | number;
  deltaLabel?: string | null;
  deltaTone?: 'muted' | 'success' | 'warning' | 'destructive' | 'primary';
  values?: number[];
  icon?: React.ReactNode;
}) {
  const tone =
    deltaTone === 'success'
      ? 'text-success'
      : deltaTone === 'warning'
        ? 'text-warning'
        : deltaTone === 'destructive'
          ? 'text-destructive'
          : deltaTone === 'primary'
            ? 'text-primary'
            : 'text-muted-foreground';

  return (
    <section id={id} className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon ? (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-surface-elevated text-muted-foreground">
                {icon}
              </span>
            ) : null}
            <h3 className="text-[12px] font-semibold tracking-tight text-subtle-foreground">{title}</h3>
          </div>
          <div className="mt-3 text-[26px] font-semibold tracking-tight-2 text-foreground">{value}</div>
        </div>

        {values && values.length ? <Sparkline values={values} className="opacity-90" /> : null}
      </div>

      {deltaLabel ? (
        <div className={`mono mt-3 text-[11px] ${tone}`}>{deltaLabel}</div>
      ) : (
        <div className="mono mt-3 text-[11px] text-subtle-foreground">—</div>
      )}
    </section>
  );
}

