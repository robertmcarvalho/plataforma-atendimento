'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

export function Drawer({
  open,
  title,
  subtitle,
  headerActions,
  onClose,
  children,
  footer,
  widthClassName = 'max-w-[40rem]',
  placement = 'right',
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  headerActions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  widthClassName?: string;
  placement?: 'right' | 'center';
}) {
  const openedAtRef = useRef<number>(0);
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );

  const maxWidthMatch = /max-w-\[([^\]]+)\]/.exec(widthClassName || '');
  const maxWidth = maxWidthMatch?.[1] || '40rem';
  const isCenter = placement === 'center';

  useEffect(() => {
    if (!open) return;
    openedAtRef.current = Date.now();
    if (typeof window !== 'undefined' && window.location.search.includes('debug_drawer=1')) {
      console.log('[drawer] open', title);
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, title]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999]"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: isCenter ? 'center' : 'stretch',
        justifyContent: isCenter ? 'center' : 'flex-end',
        padding: isCenter ? '24px' : 0,
      }}
    >
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-[rgba(20,25,30,0.38)]"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(20,25,30,0.38)',
        }}
        onClick={() => {
          // In some hydration/event-replay cases the opener click can be replayed on the backdrop,
          // causing the drawer to close immediately. Ignore clicks right after opening.
          if (Date.now() - openedAtRef.current < 250) return;
          onClose();
        }}
      />

      <aside
        role="dialog"
        aria-modal="true"
        className={`panel w-full ${widthClassName} ${isCenter ? '' : 'rounded-none'} bg-surface`}
        style={{
          position: 'relative',
          height: isCenter ? 'auto' : '100%',
          width: '100%',
          maxWidth,
          maxHeight: isCenter ? 'calc(100vh - 48px)' : '100%',
          border: isCenter ? '1px solid var(--border)' : undefined,
          borderLeft: isCenter ? undefined : '1px solid var(--border)',
          borderRadius: isCenter ? '22px' : 0,
          boxShadow: isCenter ? '0 26px 80px rgba(10, 20, 30, 0.22)' : undefined,
          background: 'var(--surface)',
        }}
      >
        <div className="flex flex-col" style={{ height: isCenter ? 'auto' : '100%', maxHeight: isCenter ? 'calc(100vh - 48px)' : '100%' }}>
          <header className="border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="truncate text-xl font-semibold" style={{ color: 'var(--text)' }}>
                  {title}
                </h3>
                {subtitle ? (
                  <p className="mt-1 truncate text-sm" style={{ color: 'var(--text-muted)' }}>
                    {subtitle}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {headerActions ? headerActions : null}
                <button
                  type="button"
                  aria-label="Fechar"
                  className="button-secondary"
                  onClick={onClose}
                  style={{ padding: '0.45rem 0.6rem' }}
                >
                  X
                </button>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer ? (
            <footer className="border-t px-5 py-4" style={{ borderColor: 'var(--border)' }}>
              {footer}
            </footer>
          ) : null}
        </div>
      </aside>
    </div>,
    document.body
  );
}
