import { cn } from '@/lib/utils';

type Entity = 'coop' | 'flux' | 'both' | string | null | undefined;

export function BillingEntityBadge({ entity, className }: { entity: Entity; className?: string }) {
  const isCoop = entity === 'coop';
  const isFlux = entity === 'flux';
  if (!isCoop && !isFlux) {
    return (
      <span className={cn('text-[10px] text-muted-foreground capitalize', className)}>
        {entity === 'both' ? 'Ambas' : entity || '—'}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1',
        isCoop ? 'bg-success/15 text-success ring-success/20' : 'bg-channel-instagram/15 text-channel-instagram ring-channel-instagram/20',
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {isCoop ? 'Cooperativa' : 'Flux Farma'}
    </span>
  );
}
