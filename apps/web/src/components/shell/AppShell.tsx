'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SidebarInner } from './Sidebar';
import { MobileNavBar } from './MobileNavBar';
import { cn } from '@/lib/utils';
import { useIsLgUp } from '@/hooks/useMediaQuery';
import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat';

const SIDEBAR_WIDTH_KEY = 'app-shell-sidebar-width';
const DEFAULT_SIDEBAR_WIDTH = 240;
const MIN_SIDEBAR_WIDTH = 208;
const MAX_SIDEBAR_WIDTH = 420;
const MOBILE_SIDEBAR_WIDTH = 'min(85vw, 320px)';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLgUp = useIsLgUp();
  usePresenceHeartbeat();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH;
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const parsed = Number(raw);
    if (!raw || !Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH;
    return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed));
  });
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (mobileNavOpen) setMobileNavOpen(false);
  }

  const drawerOpen = mobileNavOpen && !isLgUp;

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const firstLink = document.getElementById('app-shell-sidebar')?.querySelector<HTMLElement>('nav a');
    firstLink?.focus();
  }, [drawerOpen]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isLgUp) return;
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth, isLgUp]);

  useEffect(() => {
    if (!isLgUp) return;
    const onMouseMove = (event: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const next = drag.startWidth + (event.clientX - drag.startX);
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, next)));
    };
    const stopDrag = () => {
      dragStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDrag);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopDrag);
    };
  }, [isLgUp]);

  const mobileTitle =
    pathname?.startsWith('/lider') ? 'Portal do líder' : pathname?.startsWith('/inbox') ? 'Caixa de entrada' : 'Aethera';

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      {drawerOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 cursor-default border-0 bg-black/50 p-0 lg:hidden"
          aria-label="Fechar menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <div
        className={
          isLgUp
            ? 'group/shell-sidebar relative hidden shrink-0 overflow-hidden transition-[width] duration-200 ease-out lg:block w-14 hover:w-[240px]'
            : cn(
                'fixed inset-y-0 left-0 z-50 shrink-0 transition-transform duration-200 ease-out',
                drawerOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'
              )
        }
        style={!isLgUp ? { width: MOBILE_SIDEBAR_WIDTH } : undefined}
      >
        <SidebarInner
          width={isLgUp ? 240 : 320}
          mobile={!isLgUp}
          rail={isLgUp}
          onNavigate={() => setMobileNavOpen(false)}
        />
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!isLgUp ? <MobileNavBar onOpenMenu={() => setMobileNavOpen(true)} title={mobileTitle} /> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </main>
    </div>
  );
}
