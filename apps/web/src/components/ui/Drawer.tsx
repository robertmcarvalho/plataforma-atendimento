'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';

function DrawerChrome({
  title,
  subtitle,
  eyebrow,
  headerActions,
  belowHeader,
  onClose,
  children,
  footer,
  closeIconOnly,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  headerActions?: React.ReactNode;
  belowHeader?: ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeIconOnly?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow ? (
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</div>
            ) : null}
            <h2
              className={cn(
                'truncate font-semibold text-foreground',
                eyebrow ? 'text-base' : 'text-xl'
              )}
            >
              {title}
            </h2>
            {subtitle && !eyebrow ? <p className="mt-1 truncate text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {headerActions ? headerActions : null}
            <Button
              type="button"
              variant={closeIconOnly ? 'ghost' : 'secondary'}
              size={closeIconOnly ? 'icon-sm' : 'sm'}
              aria-label="Fechar"
              onClick={onClose}
            >
              {closeIconOnly ? <X className="h-4 w-4" /> : 'X'}
            </Button>
          </div>
        </div>
      </header>

      {belowHeader ? <div className="shrink-0 border-b border-border bg-background/30">{belowHeader}</div> : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

      {footer ? (
        <footer className="shrink-0 border-t border-border px-5 py-4">{footer}</footer>
      ) : null}
    </div>
  );
}

export function Drawer({
  open,
  title,
  subtitle,
  eyebrow,
  headerActions,
  belowHeader,
  onClose,
  children,
  footer,
  widthClassName = 'max-w-[40rem]',
  placement = 'right',
  closeIconOnly = false,
  shellClassName,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  headerActions?: React.ReactNode;
  belowHeader?: ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  widthClassName?: string;
  placement?: 'right' | 'center';
  closeIconOnly?: boolean;
  shellClassName?: string;
}) {
  const openedAtRef = useRef<number>(0);
  const isCenter = placement === 'center';

  useEffect(() => {
    if (!open) return;
    openedAtRef.current = Date.now();
    if (typeof window !== 'undefined' && window.location.search.includes('debug_drawer=1')) {
      console.log('[drawer] open', title);
    }
  }, [open, title]);

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (Date.now() - openedAtRef.current < 250) return;
    onClose();
  };

  const chrome = (
    <DrawerChrome
      title={title}
      subtitle={subtitle}
      eyebrow={eyebrow}
      headerActions={headerActions}
      belowHeader={belowHeader}
      onClose={onClose}
      footer={footer}
      closeIconOnly={closeIconOnly}
    >
      {children}
    </DrawerChrome>
  );

  if (isCenter) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className={cn('flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-none', widthClassName, shellClassName)}
        >
          {chrome}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn('flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-none', widthClassName, shellClassName)}
      >
        {chrome}
      </SheetContent>
    </Sheet>
  );
}
