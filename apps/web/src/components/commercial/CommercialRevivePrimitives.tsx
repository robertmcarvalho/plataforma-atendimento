'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';

export const commercialReviveSectionClassName = 'rounded-xl border border-border bg-surface p-5';

export const commercialReviveFieldClassName =
  'rounded-md border border-border bg-background/40 px-3 py-2';

export const commercialRevivePrimaryButtonClassName =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-glow disabled:opacity-50';

export const commercialReviveOutlineButtonClassName = reviveOutlineButtonClassName;

export const commercialReviveSuccessButtonClassName =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/15 disabled:opacity-50';

export const commercialReviveDestructiveButtonClassName =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15 disabled:opacity-50';

export const commercialReviveMetaPillClassName =
  'rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-muted-foreground';

export function CommercialReviveField({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(commercialReviveFieldClassName, className)}>
      <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">{label}</div>
      <div className={cn('mt-0.5 text-xs text-foreground', mono && 'font-mono')}>{value}</div>
    </div>
  );
}

export function CommercialReviveTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b border-border', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            'relative shrink-0 px-3 py-2 text-xs font-medium transition-colors',
            value === t.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
          {value === t.id ? (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-primary" />
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function CommercialReviveIconButton({
  icon: Icon,
  children,
  onClick,
  variant = 'outline',
  className,
  disabled,
  type = 'button',
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'outline' | 'primary' | 'success' | 'destructive';
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const variantClass =
    variant === 'primary'
      ? commercialRevivePrimaryButtonClassName
      : variant === 'success'
        ? commercialReviveSuccessButtonClassName
        : variant === 'destructive'
          ? commercialReviveDestructiveButtonClassName
          : commercialReviveOutlineButtonClassName;

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cn(variantClass, className)}>
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}
