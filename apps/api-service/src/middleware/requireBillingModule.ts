import type { FastifyReply, FastifyRequest } from 'fastify';
import { isBillingModuleEnabled } from '../lib/billingModule';

export async function requireBillingModule(_request: FastifyRequest, reply: FastifyReply) {
  if (!isBillingModuleEnabled()) {
    return reply.status(404).send({ error: 'Módulo de faturamento indisponível' });
  }
}
