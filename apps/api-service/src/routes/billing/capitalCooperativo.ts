import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { buildCapitalCooperativoReport } from '../../lib/billingCapitalCoopReport';

const preView = [authenticate, requireBillingModule, requireFinancialView] as const;

export async function registerBillingCapitalCooperativoRoutes(app: FastifyInstance) {
  app.get('/capital-cooperativo/report', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const parsed = z
      .object({
        month: z.string().regex(/^\d{4}-\d{2}$/),
        driver_id: z.string().uuid().optional(),
      })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Parâmetros inválidos', details: parsed.error.flatten() });
    }

    try {
      const report = await buildCapitalCooperativoReport(supabase, workspaceId, parsed.data.month, {
        driver_id: parsed.data.driver_id || null,
      });
      return reply.send({ report });
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Falha ao gerar relatório de capital cooperativo',
      });
    }
  });
}
