/** Normalização e máscaras padrão BR (CPF, CNPJ, telefone, moeda). */

export function onlyDigits(input: string): string {
  return String(input || '').replace(/\D/g, '');
}

export function formatCep(input: string): string {
  const d = onlyDigits(input).slice(0, 8);
  if (!d) return '';
  const a = d.slice(0, 5);
  const b = d.slice(5, 8);
  if (!b) return a;
  return `${a}-${b}`;
}

export function formatCnpj(input: string): string {
  const d = onlyDigits(input).slice(0, 14);
  if (!d) return '';
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);
  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `/${p4}`;
  if (p5) out += `-${p5}`;
  return out;
}

export function formatCpf(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  if (!d) return '';
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `-${p4}`;
  return out;
}

/** Armazenamento / API: 55 + DDD + número (10 ou 11 dígitos após DDD). */
export function normalizeBrazilPhone(input: string): string {
  const d = onlyDigits(input);
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export function formatBrazilPhone(input: string): string {
  const d0 = onlyDigits(input);
  if (!d0) return '';
  const d = d0.startsWith('55') && d0.length >= 12 ? d0.slice(2) : d0;
  const ddd = d.slice(0, 2);
  const num = d.slice(2);
  const isMobile = num.length >= 9;
  const a = isMobile ? num.slice(0, 5) : num.slice(0, 4);
  const b = isMobile ? num.slice(5, 9) : num.slice(4, 8);
  if (d.length < 2) return d;
  if (!a) return `(${ddd})`;
  if (!b) return `(${ddd}) ${a}`;
  return `(${ddd}) ${a}-${b}`;
}

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatBRL(value: number): string {
  return brlFmt.format(Number.isFinite(value) ? value : 0);
}

/** Converte texto digitado (ex: "1.234,56") em número. */
export function parseBRLInputToNumber(raw: string): number | null {
  const t = String(raw || '').trim();
  if (!t) return null;
  const normalized = t.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Exibe número como campo monetário BR (sem símbolo R$ opcional). */
export function formatBRLInputMask(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return brlFmt.format(value).replace('R$', '').trim();
}
