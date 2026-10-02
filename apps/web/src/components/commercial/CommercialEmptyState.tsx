import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
};

export function CommercialEmptyState({ icon: Icon, title, description, actionLabel, actionHref, onAction }: Props) {
  return (
    <EmptyState>
      <Icon className="mx-auto h-10 w-10 text-muted-foreground/60" aria-hidden />
      <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {actionLabel && actionHref ? (
        <Link href={actionHref} className={cn('mt-4 inline-flex', buttonVariants({ size: 'sm' }))}>
          {actionLabel}
        </Link>
      ) : null}
      {actionLabel && onAction && !actionHref ? (
        <Button type="button" size="sm" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </EmptyState>
  );
}
