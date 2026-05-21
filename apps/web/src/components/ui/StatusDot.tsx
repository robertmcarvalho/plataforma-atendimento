import { cn } from '@/lib/utils';

export type Presence = 'online' | 'idle' | 'offline' | 'busy';

const colors: Record<Presence, string> = {
  online: 'bg-success',
  idle: 'bg-warning',
  busy: 'bg-destructive',
  offline: 'bg-muted-foreground/40',
};

export function StatusDot({
  // new API (prototype)
  status,
  pulse = false,
  // backward-compat (older pages)
  presence,
  className,
}: {
  status?: Presence;
  pulse?: boolean;
  presence?: Presence;
  className?: string;
}) {
  const value = status || presence || 'offline';
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full ring-2 ring-background',
        colors[value],
        pulse && value === 'online' && 'animate-pulse-dot',
        className
      )}
    />
  );
}