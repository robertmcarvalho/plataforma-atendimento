import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate';

type City = { name: string };
type CepLookup = {
  not_found?: boolean;
  cep?: string;
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  complement?: string;
};

// Minimal, dependency-free dataset for Brazilian states.
const STATES = [
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

async function fetchIbgeCities(uf: string): Promise<City[]> {
  const code = String(uf || '').toUpperCase().trim();
  if (!code || code.length !== 2) return [];

  // IBGE: https://servicodados.ibge.gov.br/api/docs/localidades
  const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(code)}/municipios`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as Array<{ nome?: string }>;
  return (json || []).map((x) => ({ name: String(x?.nome || '').trim() })).filter((x) => x.name);
}

function onlyDigits(input: string) {
  return String(input || '').replace(/\D/g, '');
}

async function fetchViaCep(cep: string): Promise<CepLookup> {
  const c = onlyDigits(cep).slice(0, 8);
  if (c.length !== 8) return { not_found: true };
  const url = `https://viacep.com.br/ws/${encodeURIComponent(c)}/json/`;
  const res = await fetch(url);
  if (!res.ok) return { not_found: true };
  const json = (await res.json()) as any;
  if (json?.erro) return { not_found: true };
  return {
    cep: onlyDigits(json?.cep || c),
    street: String(json?.logradouro || '').trim() || undefined,
    neighborhood: String(json?.bairro || '').trim() || undefined,
    city: String(json?.localidade || '').trim() || undefined,
    state: String(json?.uf || '').trim() || undefined,
    complement: String(json?.complemento || '').trim() || undefined,
  };
}

export async function geoRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // GET /api/geo/states
  app.get('/states', auth, async (_request, reply) => {
    return reply.send(STATES);
  });

  // GET /api/geo/states/:uf/cities
  app.get('/states/:uf/cities', auth, async (request, reply) => {
    const { uf } = request.params as { uf: string };
    const cities = await fetchIbgeCities(uf).catch(() => []);
    return reply.send(cities);
  });

  // GET /api/geo/cep/:cep
  app.get('/cep/:cep', auth, async (request, reply) => {
    const { cep } = request.params as { cep: string };
    const digits = onlyDigits(cep);
    if (!digits || digits.length !== 8) return reply.status(400).send({ error: 'cep invalido' });
    const data = await fetchViaCep(digits).catch(() => ({ not_found: true } as CepLookup));
    return reply.send(data);
  });
}
