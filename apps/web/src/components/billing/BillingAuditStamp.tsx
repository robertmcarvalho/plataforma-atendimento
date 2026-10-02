'use client';

/** Nome · dd/mm/aaaa HH:mm (America/Sao_Paulo) */
export function formatBillingAuditDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function billingActorName(
  user: { name?: string | null } | null | undefined,
  fallback = 'Sistema'
): string {
  const name = String(user?.name || '').trim();
  return name || fallback;
}

type AuditStampProps = {
  actorName?: string | null;
  at?: string | null;
  prefix?: string;
  className?: string;
};

export function BillingAuditStamp({ actorName, at, prefix, className }: AuditStampProps) {
  const name = billingActorName(actorName ? { name: actorName } : null);
  const when = formatBillingAuditDateTime(at);
  const text = prefix ? `${prefix} ${name} em ${when}` : `${name} · ${when}`;
  return <span className={className ?? 'text-[11px] text-muted-foreground'}>{text}</span>;
}
