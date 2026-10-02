import type { LucideIcon } from 'lucide-react';

export function LeaderDetailField({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value?: string | null;
}) {
  const shown = value && String(value).trim() ? String(value) : '—';
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        {label}
      </div>
      <div className="mt-1 text-sm">{shown}</div>
    </div>
  );
}
