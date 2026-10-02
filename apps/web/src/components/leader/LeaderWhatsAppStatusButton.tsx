'use client';

import { CheckCircle2, RefreshCw, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBrazilPhone } from '@/lib/brFormat';

export type LeaderWhatsAppStatus = 'unlinked' | 'pending' | 'verified' | 'expired';

export function LeaderWhatsAppStatusButton({
  status,
  phone,
  onClick,
}: {
  status: LeaderWhatsAppStatus;
  phone?: string | null;
  onClick: () => void;
}) {
  const verified = status === 'verified';
  const pending = status === 'pending';
  const label = verified ? 'WhatsApp conectado' : pending ? 'Verificar WhatsApp' : 'Vincular WhatsApp';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px]',
        verified
          ? 'border-success/40 bg-success/10 text-success'
          : pending
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border bg-card text-muted-foreground'
      )}
      title={verified ? 'WhatsApp verificado' : 'Verificar WhatsApp via código'}
    >
      {verified ? <CheckCircle2 className="h-3 w-3" /> : pending ? <RefreshCw className="h-3 w-3" /> : <Smartphone className="h-3 w-3" />}
      {label} {phone ? `· ${formatBrazilPhone(phone) || phone}` : ''}
    </button>
  );
}
