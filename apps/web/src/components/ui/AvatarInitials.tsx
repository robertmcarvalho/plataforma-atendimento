import { initialsFromName } from '@/lib/operacao/operacaoTaskMeta';
import { cn } from '@/lib/utils';

export function AvatarInitials({
  initials,
  name,
  size = 'md',
  className,
}: {
  initials?: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const label = (initials || (name ? initialsFromName(name) : '??')).slice(0, 2).toUpperCase();
  const sizeCls =
    size === 'sm' ? 'h-6 w-6 text-[10px]' : size === 'lg' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-[11px]';
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-gradient-primary font-semibold text-primary-foreground',
        sizeCls,
        className
      )}
    >
      {label}
    </div>
  );
}
