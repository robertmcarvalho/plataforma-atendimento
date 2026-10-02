export const BRAZIL_STATES = [
  { code: 'AC', name: 'Acre' },
  { code: 'AL', name: 'Alagoas' },
  { code: 'AP', name: 'Amapá' },
  { code: 'AM', name: 'Amazonas' },
  { code: 'BA', name: 'Bahia' },
  { code: 'CE', name: 'Ceará' },
  { code: 'DF', name: 'Distrito Federal' },
  { code: 'ES', name: 'Espírito Santo' },
  { code: 'GO', name: 'Goiás' },
  { code: 'MA', name: 'Maranhão' },
  { code: 'MT', name: 'Mato Grosso' },
  { code: 'MS', name: 'Mato Grosso do Sul' },
  { code: 'MG', name: 'Minas Gerais' },
  { code: 'PA', name: 'Pará' },
  { code: 'PB', name: 'Paraíba' },
  { code: 'PR', name: 'Paraná' },
  { code: 'PE', name: 'Pernambuco' },
  { code: 'PI', name: 'Piauí' },
  { code: 'RJ', name: 'Rio de Janeiro' },
  { code: 'RN', name: 'Rio Grande do Norte' },
  { code: 'RS', name: 'Rio Grande do Sul' },
  { code: 'RO', name: 'Rondônia' },
  { code: 'RR', name: 'Roraima' },
  { code: 'SC', name: 'Santa Catarina' },
  { code: 'SP', name: 'São Paulo' },
  { code: 'SE', name: 'Sergipe' },
  { code: 'TO', name: 'Tocantins' },
] as const;

/** Município IBGE: `id` = código IBGE 7 dígitos. */
export type GeoCity = { id: string; name: string };

export function onlyDigitsGeo(input: string) {
  return String(input || '').replace(/\D/g, '');
}

/** Normaliza código IBGE municipal (7 dígitos) ou null. */
export function normalizeIbgeCityCode(input: string | number | null | undefined): string | null {
  const digits = onlyDigitsGeo(String(input ?? ''));
  return digits.length === 7 ? digits : null;
}

export function mapIbgeMunicipiosPayload(
  json: Array<{ id?: number | string; nome?: string }> | null | undefined
): GeoCity[] {
  return (json || [])
    .map((x) => {
      const id = normalizeIbgeCityCode(x?.id);
      const name = String(x?.nome || '').trim();
      if (!id || !name) return null;
      return { id, name };
    })
    .filter((x): x is GeoCity => Boolean(x));
}

export async function fetchIbgeCities(uf: string): Promise<GeoCity[]> {
  const code = String(uf || '').toUpperCase().trim();
  if (!code || code.length !== 2) return [];

  const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(code)}/municipios`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as Array<{ id?: number | string; nome?: string }>;
  return mapIbgeMunicipiosPayload(json);
}

export async function fetchViaCep(cep: string) {
  const c = onlyDigitsGeo(cep).slice(0, 8);
  if (c.length !== 8) return { not_found: true as const };
  const url = `https://viacep.com.br/ws/${encodeURIComponent(c)}/json/`;
  const res = await fetch(url);
  if (!res.ok) return { not_found: true as const };
  const json = (await res.json()) as Record<string, unknown>;
  if (json?.erro) return { not_found: true as const };
  const ibge = normalizeIbgeCityCode(json?.ibge as string | number | undefined);
  return {
    cep: onlyDigitsGeo(String(json?.cep || c)),
    street: String(json?.logradouro || '').trim() || undefined,
    neighborhood: String(json?.bairro || '').trim() || undefined,
    city: String(json?.localidade || '').trim() || undefined,
    state: String(json?.uf || '').trim() || undefined,
    complement: String(json?.complemento || '').trim() || undefined,
    ...(ibge ? { ibge } : {}),
  };
}
