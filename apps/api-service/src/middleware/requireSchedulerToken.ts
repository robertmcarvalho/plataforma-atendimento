import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Autentica jobs Cloud Scheduler / chamadas internas via X-Scheduler-Token.
 * Em produção exige SCHEDULER_JOB_TOKEN; fora disso permite se token ausente (dev).
 */
export async function requireSchedulerToken(request: FastifyRequest, reply: FastifyReply) {
  const expected = process.env.SCHEDULER_JOB_TOKEN?.trim();
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      request.log.warn('SCHEDULER_JOB_TOKEN ausente em produção — endpoint de job aberto');
    }
    return;
  }
  const header = request.headers['x-scheduler-token'];
  if (typeof header === 'string' && header === expected) return;
  return reply.status(401).send({ error: 'unauthorized', operator_message: 'X-Scheduler-Token inválido' });
}

export function isSchedulerTokenValid(request: FastifyRequest): boolean {
  const expected = process.env.SCHEDULER_JOB_TOKEN?.trim();
  if (!expected) return process.env.NODE_ENV !== 'production';
  const header = request.headers['x-scheduler-token'];
  return typeof header === 'string' && header === expected;
}
