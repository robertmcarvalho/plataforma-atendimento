'use client';

import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function MobileNavBar({ onOpenMenu, title }: { onOpenMenu: () => void; title?: string }) {
  return (
    <header className="safe-area-top flex h-12 shrink-0 items-center gap-3 border-b border-border bg-sidebar/95 px-3 backdrop-blur lg:hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onOpenMenu}
        className="shrink-0"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </Button>
      {title ? <span className="min-w-0 truncate text-sm font-semibold tracking-tight">{title}</span> : null}
    </header>
  );
}
