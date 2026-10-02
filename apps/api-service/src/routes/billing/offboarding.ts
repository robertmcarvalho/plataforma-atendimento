import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import {
  createDriverOffboardingPreview,
  generatePayableFromOffboardingPreview,
} from '../../lib/billingDriverOffboardingPreview';
import {
  decideOffboardingPendingQuota,
  loadOffboardingConference,
  syncOffboardingDeliveries,
  updateOffboardingConferenceState,
} from '../../lib/billingOffboardingConference';

export async function registerBillingOffboardingRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/offboarding-previews', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { status, driver_id } = request.query as { status?: string; driver_id?: string };

    let q = supabase
      .from('billing_driver_offboarding_previews')
      .select('*, drivers(id, name, cpf, pix_key), billing_payables(id, status, due_date)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (status) q = q.eq('status', status);
    if (driver_id) q = q.eq('driver_id', driver_id);

    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ previews: data || [] });
  });

  app.get('/offboarding-previews/:id', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
      .from('billing_driver_offboarding_previews')
      .select('*, drivers(id, name, cpf, pix_key, pix_key_type), billing_payables(id, status, due_date)')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Prévia de desligamento não encontrada' });
    return reply.send({ preview: data });
  });

  app.get('/offboarding-previews/:id/conference', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      const conference = await loadOffboardingConference(supabase, workspaceId, id);
      return reply.send({ conference });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Falha ao carregar conferência' });
    }
  });

  app.patch('/offboarding-previews/:id/conference', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const actorId = (request.user as { sub: string }).sub;
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        checked: z.boolean().optional(),
        notes: z.string().max(2000).optional().nullable(),
      })
      .safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    try {
      const conference_state = await updateOffboardingConferenceState(supabase, workspaceId, id, {
        checked: parsed.data.checked,
        notes: parsed.data.notes,
        actorId,
      });
      const conference = await loadOffboardingConference(supabase, workspaceId, id);
      return reply.send({ conference_state, conference });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Falha ao atualizar conferência' });
    }
  });

  app.post('/offboarding-previews/:id/sync-deliveries', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = z.object({ import_mysql: z.boolean().default(false) }).safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos' });

    try {
      const result = await syncOffboardingDeliveries(supabase, workspaceId, id, {
        import_mysql: parsed.data.import_mysql,
      });
      const conference = await loadOffboardingConference(supabase, workspaceId, id);
      return reply.send({ ...result, conference });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Falha ao sincronizar entregas' });
    }
  });

  app.post('/offboarding-previews/:id/pending-quota-decision', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const actorId = (request.user as { sub: string }).sub;
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        installment_id: z.string().uuid(),
        decision: z.enum(['waived', 'kept', 'compensated']),
        notes: z.string().max(500).optional().nullable(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    try {
      const conference_state = await decideOffboardingPendingQuota(supabase, workspaceId, id, {
        installment_id: parsed.data.installment_id,
        decision: parsed.data.decision,
        notes: parsed.data.notes || null,
        actorId,
      });
      const conference = await loadOffboardingConference(supabase, workspaceId, id);
      return reply.send({ conference_state, conference });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Falha ao registrar decisão de cota' });
    }
  });

  app.post('/offboarding-previews/recalculate', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const actorId = (request.user as { sub: string }).sub;
    const parsed = z
      .object({
        driver_id: z.string().uuid(),
        last_worked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        task_id: z.string().uuid().optional().nullable(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    try {
      await supabase
        .from('billing_driver_offboarding_previews')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('driver_id', parsed.data.driver_id)
        .in('status', ['preview', 'payable_generated']);

      const preview = await createDriverOffboardingPreview(supabase, {
        workspaceId,
        driverId: parsed.data.driver_id,
        lastWorkedAt: parsed.data.last_worked_at,
        actorId,
        taskId: parsed.data.task_id || null,
      });
      return reply.status(201).send({ preview });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Falha ao recalcular prévia' });
    }
  });

  app.post('/offboarding-previews/:id/generate-payable', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const actorId = (request.user as { sub: string }).sub;
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      })
      .safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    try {
      const result = await generatePayableFromOffboardingPreview(supabase, {
        workspaceId,
        previewId: id,
        actorId,
        dueDate: parsed.data.due_date || null,
      });
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Falha ao gerar AP do desligamento' });
    }
  });
}
