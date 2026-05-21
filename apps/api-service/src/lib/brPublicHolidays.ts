/** Feriados nacionais fixos (mês/dia no calendário civil, fuso local). */
const FIXED: Array<[number, number]> = [
  [1, 1],
  [4, 21],
  [5, 1],
  [9, 7],
  [10, 12],
  [11, 2],
  [11, 15],
  [12, 25],
];

function easterSundayYear(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mobileHolidaysForYear(year: number): string[] {
  const easter = easterSundayYear(year);
  return [
    ymd(addDays(easter, -48)),
    ymd(addDays(easter, -47)),
    ymd(addDays(easter, -2)),
    ymd(easter),
    ymd(addDays(easter, 60)),
  ];
}

const cache = new Map<number, Set<string>>();

function holidaysForYear(year: number): Set<string> {
  let set = cache.get(year);
  if (set) return set;
  set = new Set<string>();
  for (const [mo, da] of FIXED) {
    set.add(`${year}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`);
  }
  for (const d of mobileHolidaysForYear(year)) set.add(d);
  cache.set(year, set);
  return set;
}

/** true se ymd (YYYY-MM-DD) for feriado nacional brasileiro. */
export function isBrazilianPublicHoliday(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return false;
  const year = Number(m[1]);
  return holidaysForYear(year).has(`${m[1]}-${m[2]}-${m[3]}`);
}
