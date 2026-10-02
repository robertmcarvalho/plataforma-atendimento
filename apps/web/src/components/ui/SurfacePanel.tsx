import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type SurfacePanelProps = {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'elevated';
  padding?: 'sm' | 'md' | 'lg';
};

const paddingMap = { sm: 'p-4', md: 'p-5', lg: 'p-6' } as const;

/** Painel de superfície — Revive painéis de conteúdo (`bg-surface`). */
export function SurfacePanel({
  title,
  description,
  children,
  className,
  variant = 'default',
  padding = 'md',
}: SurfacePanelProps) {
  return (
    <Card
      className={cn(
        'rounded-xl border-border bg-surface',
        variant === 'elevated' && 'bg-surface-elevated',
        className
      )}
    >
      {title ? (
        <CardHeader className={cn(paddingMap[padding], 'pb-0')}>
          <CardTitle className="text-sm font-semibold tracking-tight">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn(title ? 'pt-4' : '', paddingMap[padding])}>{children}</CardContent>
    </Card>
  );
}
