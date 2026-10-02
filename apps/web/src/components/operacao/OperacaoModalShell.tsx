'use client';

import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
import { IconTile, type IconTileTone } from '@/components/ui/IconTile';

export function OperacaoModalShell({
  open,
  onClose,
  title,
  subtitle,
  icon,
  tone = 'primary',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  tone?: IconTileTone;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <IconTile icon={icon} tone={tone} size="md" />
            <div>
              <h3 className="text-sm font-semibold">{title}</h3>
              {subtitle ? <p className="text-[10px] text-muted-foreground">{subtitle}</p> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
      </div>
    </div>
  );
}
