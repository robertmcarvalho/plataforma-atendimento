export type ApiCity = { name: string };

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

export type CepLookupResult = {
  not_found?: boolean;
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  complement?: string;
};
