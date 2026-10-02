/** Normalização E.164 Brasil para WhatsApp (55 + DDD + número). */

export function onlyDigits(input: string): string {
  return String(input || '').replace(/\D/g, '');
}

/**
 * Formato canônico para armazenamento e lookup.
 * Corrige números móveis legados sem o 9 (ex.: 553496710044 → 5534996710044).
 */
export function canonicalBrazilWaPhone(input: string): string {
  let d = onlyDigits(input);
  if (!d) return '';

  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) {
    d = `55${d}`;
  }

  if (d.startsWith('55') && d.length === 12) {
    const ddd = d.slice(2, 4);
    const local = d.slice(4);
    if (local.length === 8) {
      return `55${ddd}9${local}`;
    }
  }

  return d;
}

/** Variantes para busca (com e sem 9 móvel). */
export function waPhoneLookupVariants(input: string): string[] {
  const canonical = canonicalBrazilWaPhone(input);
  if (!canonical) return [];
  const out = new Set<string>([canonical, onlyDigits(input)]);
  if (canonical.startsWith('55') && canonical.length === 13 && canonical.charAt(4) === '9') {
    out.add(`55${canonical.slice(2, 4)}${canonical.slice(5)}`);
  }
  return [...out].filter(Boolean);
}
