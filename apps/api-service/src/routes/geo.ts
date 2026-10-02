import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { BRAZIL_STATES, fetchIbgeCities, fetchViaCep, onlyDigitsGeo } from '../lib/geo/ibge';

export async function geoRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // GET /api/geo/states
  app.get('/states', auth, async (_request, reply) => {
    return reply.send(BRAZIL_STATES);
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
    const digits = onlyDigitsGeo(cep);
    if (!digits || digits.length !== 8) return reply.status(400).send({ error: 'cep invalido' });
    const data = await fetchViaCep(digits).catch(() => ({ not_found: true }));
    return reply.send(data);
  });
}
