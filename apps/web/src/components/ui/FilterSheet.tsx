'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

type FilterSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: ReactNode;
  onClear?: () => void;
  clearLabel?: string;
  applyLabel?: string;
  className?: string;
};

/** Bottom sheet reutilizável para painéis de filtro em mobile. */
export function FilterSheet({
  open,
  onOpenChange,
  title = 'Filtros',
  children,
  onClear,
  clearLabel = 'Limpar',
  applyLabel = 'Aplicar',
  className,
}: FilterSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton
        className={cn('max-h-[min(90dvh,32rem)] rounded-t-2xl safe-area-bottom', className)}
      >
        <SheetHeader className="border-b border-border pb-3">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        <SheetFooter className="flex-row justify-between gap-2 border-t border-border pt-3">
          {onClear ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClear} className="max-lg:min-h-11">
              {clearLabel}
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" size="sm" onClick={() => onOpenChange(false)} className="max-lg:min-h-11">
            {applyLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
