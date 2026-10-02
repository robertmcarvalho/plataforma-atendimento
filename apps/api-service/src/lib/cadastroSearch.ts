export function digitsOnly(q: string): string {
  return String(q || '').replace(/\D/g, '');
}

function escapeIlikeTerm(q: string): string {
  return q.replace(/[%_,]/g, '');
}

export type CadastroSearchConfig = {
  nameFields: string[];
  digitFields?: string[];
};

/** Gera cláusula `.or(...)` para busca por nome e campos numéricos (telefone/CPF/CNPJ). */
export function buildCadastroSearchOrFilter(q: string, config: CadastroSearchConfig): string | null {
  const trimmed = String(q || '').trim();
  if (!trimmed) return null;

  const safe = escapeIlikeTerm(trimmed);
  const parts = new Set<string>();

  for (const field of config.nameFields) {
    parts.add(`${field}.ilike.%${safe}%`);
  }

  const digits = digitsOnly(trimmed);
  if (digits.length >= 3 && config.digitFields?.length) {
    for (const field of config.digitFields) {
      parts.add(`${field}.ilike.%${digits}%`);
    }
  }

  return parts.size > 0 ? [...parts].join(',') : null;
}

export const DRIVER_SEARCH_CONFIG: CadastroSearchConfig = {
  nameFields: ['name'],
  digitFields: ['cpf', 'phone'],
};

export function normalizeSearchText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Cada token da busca deve aparecer no nome (ordem livre). */
export function nameMatchesSearchTokens(name: string, query: string, minTokenLen = 2): boolean {
  const normalized = normalizeSearchText(name);
  const tokens = normalizeSearchText(query)
    .split(/\s+/)
    .filter((t) => t.length >= minTokenLen);
  if (!tokens.length) return false;
  return tokens.every((t) => normalized.includes(t));
}

export const LEADER_SEARCH_CONFIG: CadastroSearchConfig = {
  nameFields: ['name'],
  digitFields: ['phone'],
};

export const PHARMACY_SEARCH_CONFIG: CadastroSearchConfig = {
  nameFields: ['trade_name', 'legal_name'],
  digitFields: ['cnpj'],
};

export const COMMERCIAL_LEAD_SEARCH_CONFIG: CadastroSearchConfig = {
  nameFields: ['trade_name', 'legal_name', 'contact_name', 'city'],
  digitFields: ['cnpj', 'phone'],
};
