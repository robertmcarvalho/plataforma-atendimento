/** Datas no padrão brasileiro (dd/MM/aaaa e dd/MM/aaaa HH:mm). */

function dateFmtFor(timeZone?: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  });
}

function dateTimeFmtFor(timeZone?: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}

export function formatDateBr(
  iso: string | null | undefined,
  timeZone?: string
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return dateFmtFor(timeZone).format(d);
}

export function formatDateTimeBr(
  iso: string | null | undefined,
  timeZone?: string
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return dateTimeFmtFor(timeZone).format(d);
}

/** dd/MM sem ano + HH:mm (ex.: listagens de campanha). */
export function formatDayMonthTimeBr(
  iso: string | null | undefined,
  timeZone?: string
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(d);
}
