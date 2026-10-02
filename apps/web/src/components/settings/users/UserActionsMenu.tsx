'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  Eye,
  Key,
  MoreHorizontal,
  RotateCcw,
  UserCog,
  UserX,
} from 'lucide-react';
import type { UserRecord } from '@/lib/users/usersApi';

export function UserActionsMenu({
  user,
  onResend,
  onToggleActive,
  onEditPassword,
}: {
  user: UserRecord;
  onResend: () => void;
  onToggleActive: () => void;
  onEditPassword: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    updatePosition();
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  const active = user.is_active !== false;

  return (
    <div ref={ref} className="relative text-right">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && menuPosition && typeof document !== 'undefined' ? createPortal(
        <div
          ref={ref}
          style={{ top: menuPosition.top, right: menuPosition.right }}
          className="fixed z-[100] w-48 rounded-md border border-border bg-popover py-1 text-left shadow-lg"
        >
          <Link
            href={`/settings/users/${user.id}`}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-sidebar-accent/60"
            onClick={() => setOpen(false)}
          >
            <Eye className="h-3.5 w-3.5" /> Ver ficha
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onEditPassword();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-sidebar-accent/60"
          >
            <Key className="h-3.5 w-3.5" /> Editar senha
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onResend();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-sidebar-accent/60"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reenviar acesso
          </button>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onToggleActive();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-sidebar-accent/60"
          >
            {active ? <UserX className="h-3.5 w-3.5" /> : <UserCog className="h-3.5 w-3.5" />}
            {active ? 'Desativar' : 'Ativar'}
          </button>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
