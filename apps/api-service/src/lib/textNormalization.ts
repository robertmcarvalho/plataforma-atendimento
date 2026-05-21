/** Normaliza nomes de pessoas e entidades (name, trade_name, legal_name) para UPPERCASE consistente no banco. */
export function normalizeNameLike(input: string | null | undefined): string | null | undefined {
  if (input == null) return input;
  const base = String(input).replace(/\s+/g, ' ').trim();
  if (!base) return '';
  return base.toLocaleUpperCase('pt-BR');
}

