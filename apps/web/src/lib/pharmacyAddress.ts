export type ApiCity = { id?: string; name: string };

export function normCityName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

export function cityMatchesIbge(city: string, cities: ApiCity[]): boolean {
  const needle = normCityName(city);
  if (!needle) return false;
  return cities.some((c) => normCityName(c.name) === needle);
}

/** Resolve código IBGE 7 dígitos pela cidade dentro da lista já filtrada por UF. */
export function resolveCityIbgeCode(city: string, cities: ApiCity[]): string | null {
  const needle = normCityName(city);
  if (!needle) return null;
  const match = cities.find((c) => normCityName(c.name) === needle);
  const digits = String(match?.id || '').replace(/\D/g, '');
  return digits.length === 7 ? digits : null;
}

export type CepLookupResult = {
  not_found?: boolean;
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  complement?: string;
  /** Código IBGE do município (ViaCEP). */
  ibge?: string;
};
