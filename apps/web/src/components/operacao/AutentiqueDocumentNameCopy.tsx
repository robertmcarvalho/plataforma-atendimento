'use client';

import { useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import {
  buildAutentiqueDocumentName,
  signatureStatusLabel,
  type AutentiqueDocTipo,
} from '@plataforma/operational-notes';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function AutentiqueDocumentNameCopy({
  driverId,
  driverName,
  variant,
  compact,
  signatureStatus,
  className,
  onClickCapture,
}: {
  driverId: string;
  driverName: string;
  variant: AutentiqueDocTipo | 'both';
  compact?: boolean;
  signatureStatus?: string | null;
  className?: string;
  onClickCapture?: (e: React.MouseEvent) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const names = useMemo(() => {
    const out: Array<{ tipo: AutentiqueDocTipo; label: string; value: string }> = [];
    const push = (tipo: AutentiqueDocTipo, label: string) => {
      try {
        out.push({
          tipo,
          label,
          value: buildAutentiqueDocumentName(tipo, driverId, driverName),
        });
      } catch {
        // driverId ainda inválido ou em transição — não quebra o formulário
      }
    };
    if (variant === 'both' || variant === 'MATRICULA') push('MATRICULA', 'Matrícula');
    if (variant === 'both' || variant === 'DESLIGAMENTO') push('DESLIGAMENTO', 'Desligamento');
    return out;
  }, [driverId, driverName, variant]);

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div
      className={cn('rounded-xl border border-border bg-surface p-3', className)}
      onClick={onClickCapture}
    >
      {!compact ? (
        <SectionTitle className="mb-2">Documento Autentique</SectionTitle>
      ) : null}
      {signatureStatus ? (
        <p className="mb-2 text-[11px] text-muted-foreground">
          Status:{' '}
          <span
            className={
              signatureStatus === 'signed' || signatureStatus === 'document_finished'
                ? 'font-medium text-success'
                : 'font-medium text-foreground'
            }
          >
            {signatureStatusLabel(signatureStatus)}
          </span>
        </p>
      ) : null}
      <div className={cn('flex flex-wrap gap-2', compact && 'flex-col')}>
        {names.map((n) => (
          <div key={n.tipo} className={cn('flex min-w-0 flex-col gap-1', !compact && 'flex-1')}>
            {!compact ? (
              <p className="truncate font-mono text-[10px] text-muted-foreground" title={n.value}>
                {n.value}
              </p>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                void copy(n.value, n.tipo);
              }}
            >
              {copied === n.tipo ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              Copiar — {n.label}
            </Button>
          </div>
        ))}
      </div>
      {!compact ? (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Cole este nome ao criar o documento no Autentique.
        </p>
      ) : null}
    </div>
  );
}
