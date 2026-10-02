/** Normalização BR compartilhada (telefone, CPF, CNPJ) — fonte única para cadastros e CRM comercial. */

import { canonicalBrazilWaPhone, onlyDigits as digitsOnly } from '@plataforma/channel-runtime';

export function onlyDigits(input: string): string {
  return digitsOnly(input);
}

/** Telefone BR para armazenamento (55 + DDD + número), com 9 móvel canônico. */
export function normalizeBrazilPhone(input: string): string {
  const canonical = canonicalBrazilWaPhone(input);
  if (canonical) return canonical;
  const d = onlyDigits(input);
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export function normalizeCpf(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  return d.length === 11 ? d : '';
}

export function normalizeCnpj(input: string): string {
  const d = onlyDigits(input).slice(0, 14);
  return d.length === 14 ? d : '';
}
