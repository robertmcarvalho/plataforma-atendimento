import { cn } from '@/lib/utils';

export type Presence = 'online' | 'idle' | 'offline' | 'busy';
export type CadastroDotStatus = 'active' | 'inactive';
export type StatusDotKind = Presence | CadastroDotStatus;

const colors: Record<StatusDotKind, string> = {
  online: 'bg-success',
  active: 'bg-success',
  idle: 'bg-warning',
  busy: 'bg-destructive',
  offline: 'bg-muted-foreground/40',
  inactive: 'bg-muted-foreground/40',
};

export function StatusDot({
  // new API (prototype)
  status,
  pulse = false,
  // backward-compat (older pages)
  presence,
  className,
}: {
  status?: StatusDotKind;
  pulse?: boolean;
  presence?: Presence;
  className?: string;
}) {
  const value = status || presence || 'offline';
  const shouldPulse = pulse && (value === 'online' || value === 'active');
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full ring-2 ring-background',
        colors[value],
        shouldPulse && 'animate-pulse-dot',
        className
      )}
    />
  );
}