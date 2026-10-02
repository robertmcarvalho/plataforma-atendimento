/** Parse ISO datetime; evita deslocamento só em YYYY-MM-DD. */
export function parseISO(iso: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  return new Date(iso);
}
