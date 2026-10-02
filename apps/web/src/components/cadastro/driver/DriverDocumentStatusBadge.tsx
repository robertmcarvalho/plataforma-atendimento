'use client';

import {
  aggregateHeaderDocLabel,
  badgeLabelForState,
  computeDocumentExpiryState,
  evaluateDriverDocuments,
  type ExpiryState,
} from '@plataforma/operational-notes';
import { cn } from '@/lib/utils';

function badgeClass(state: ExpiryState): string {
  if (state === 'expired') return 'bg-destructive/15 text-destructive';
  if (state === 'warning_7' || state === 'warning_30') return 'bg-warning/15 text-warning';
  if (state === 'valid') return 'bg-success/15 text-success';
  return 'bg-muted text-muted-foreground';
}

export function DriverDocumentStatusBadge({
  state,
  expiresAt,
  className,
}: {
  state: ExpiryState;
  expiresAt?: string | null;
  className?: string;
}) {
  return (
    <span className={cn('rounded px-2 py-0.5 text-[10px] font-medium', badgeClass(state), className)}>
      {badgeLabelForState(state, expiresAt)}
    </span>
  );
}

export function DriverDocumentHeaderBadge({
  cnhExpiresAt,
  hasDigitalCertificate,
  digitalCertificateExpiresAt,
  className,
}: {
  cnhExpiresAt?: string | null;
  hasDigitalCertificate?: boolean | null;
  digitalCertificateExpiresAt?: string | null;
  className?: string;
}) {
  const { worst_state } = evaluateDriverDocuments({
    cnh_expires_at: cnhExpiresAt,
    has_digital_certificate: hasDigitalCertificate,
    digital_certificate_expires_at: digitalCertificateExpiresAt,
  });
  const label = aggregateHeaderDocLabel(worst_state);
  return (
    <span className={cn('rounded px-2 py-0.5 text-[10px] font-medium', badgeClass(worst_state), className)}>
      {label}
    </span>
  );
}

export function useDriverDocumentStates(input: {
  cnh_expires_at?: string | null;
  has_digital_certificate?: boolean | null;
  digital_certificate_expires_at?: string | null;
}) {
  const evaluated = evaluateDriverDocuments({
    cnh_expires_at: input.cnh_expires_at,
    has_digital_certificate: input.has_digital_certificate,
    digital_certificate_expires_at: input.digital_certificate_expires_at,
  });
  const cnhState = input.cnh_expires_at ? computeDocumentExpiryState(input.cnh_expires_at) : 'missing';
  const certState =
    input.has_digital_certificate && input.digital_certificate_expires_at
      ? computeDocumentExpiryState(input.digital_certificate_expires_at)
      : input.has_digital_certificate
        ? 'missing'
        : 'missing';
  return { ...evaluated, cnhState, certState };
}
