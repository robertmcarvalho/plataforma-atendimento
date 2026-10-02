import type { SelectOption } from '@/components/form/ToolbarSelect';

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Mínimo de caracteres para exibir/filtrar (evita listar os primeiros N ao focar o campo). */
export function effectiveSearchMinChars(minChars = 0): number {
  return Math.max(minChars, 1);
}

/** Listas estáticas pequenas (ex.: líderes da carteira) podem abrir sem digitar; listas grandes exigem busca. */
export function shouldRequireSearchQuery(optionCount: number, maxResults = 50): boolean {
  return optionCount > maxResults;
}

export function filterSelectOptions(
  options: SelectOption[],
  query: string,
  minChars = 0,
  maxResults = 50
): SelectOption[] {
  const usable = options.filter((o) => !o.disabled);
  const q = normalizeSearchText(query);
  const requireQuery = shouldRequireSearchQuery(usable.length, maxResults);

  const matches = (label: string) => {
    const normalized = normalizeSearchText(label);
    const tokens = q.split(/\s+/).filter((t) => t.length >= 1);
    if (!tokens.length) return true;
    return tokens.every((t) => normalized.includes(t));
  };

  if (!requireQuery) {
    if (!q) return usable.slice(0, maxResults);
    return usable.filter((o) => matches(o.label)).slice(0, maxResults);
  }

  const minLen = effectiveSearchMinChars(minChars);
  if (!q || q.length < minLen) {
    return [];
  }
  return usable.filter((o) => matches(o.label)).slice(0, maxResults);
}
