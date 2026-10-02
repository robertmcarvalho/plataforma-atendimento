/** Validação de intervalo HH:MM (espelha regra da API). */

function parseHM(s: string): number {
  const [h, m] = s.split(':').map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

export function isValidBusinessInterval(start: string, end: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return false;
  const sm = parseHM(start);
  const em = parseHM(end);
  if (end === '00:00' && sm > 0) return true;
  if (em > sm) return true;
  if (em < sm) return true;
  return false;
}
