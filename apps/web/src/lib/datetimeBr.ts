/** Datas no padrão brasileiro (dd/MM/aaaa e dd/MM/aaaa HH:mm). */

function onlyDigits(input: string): string {
  return String(input || '').replace(/\D/g, '');
}

/** ISO `yyyy-mm-dd` → `dd/mm/aaaa` (exibição). */
export function formatIsoDateBr(iso: string | null | undefined): string {
  const raw = String(iso || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** `dd/mm/aaaa` → ISO `yyyy-mm-dd` (armazenamento/API). */
export function parseBrDateToIso(br: string): string {
  const raw = String(br || '').trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  const d = Number(dd);
  const mo = Number(mm);
  const y = Number(yyyy);
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 1900) return '';
  return `${yyyy}-${mm}-${dd}`;
}

/** Máscara parcial enquanto digita `dd/mm/aaaa`. */
export function maskBrDateInput(raw: string): string {
  const d = onlyDigits(raw).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** Hora 24h `HH:mm` — normaliza entrada digitada. */
export function normalizeTimeBr(raw: string): string {
  const t = String(raw || '').trim();
  if (/^\d{2}:\d{2}$/.test(t)) return t;
  const d = onlyDigits(t).slice(0, 4);
  if (d.length < 4) return t;
  return `${d.slice(0, 2)}:${d.slice(2, 4)}`;
}

/** Máscara `HH:mm` enquanto digita. */
export function maskBrTimeInput(raw: string): string {
  const d = onlyDigits(raw).slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}:${d.slice(2)}`;
}

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
  const raw = String(iso).trim();
  // Datas só com dia (YYYY-MM-DD) são dias de calendário — não converter via UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return formatIsoDateBr(raw);
  }
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
