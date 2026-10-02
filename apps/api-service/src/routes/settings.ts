import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isAllowedAppSettingsKey } from '../lib/allowedAppSettingsKeys';
import { writeAuditLog } from '../lib/auditLog';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';
import { loadOpsTaskPlaybooks, loadOpsTaskSlaConfig } from '../lib/opsTaskConfig';
import { loadOpsTaskCatalog, validateOpsTaskCatalogPayload } from '../lib/opsTaskCatalog';
import { loadOpsTaskAutomationRules } from '../lib/opsTaskAutomation';
import { validateOpsTaskAutomationRulesPayload } from '@plataforma/ops-task-catalog';
import { supabase } from '../lib/supabase';
import { listWorkspaceSettings, readWorkspaceSetting, upsertWorkspaceSetting } from '../lib/workspaceSettings';

const settingSchema = z.object({
  key: z.string(),
  value: z.any(),
});

export async function settingRoutes(app: FastifyInstance) {
  // GET /api/settings — listar todas as configurações
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    try {
      const data = await listWorkspaceSettings(workspaceId);
      const settings = (data || []).reduce((acc: Record<string, unknown>, item) => {
        acc[String(item.key)] = item.value;
        return acc;
      }, {});

      return reply.send(settings);
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Erro ao listar configurações do workspace',
      });
    }
  });

  app.get('/operacao-task-config', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    try {
      const [catalog, playbooks, sla, automation_rules] = await Promise.all([
        loadOpsTaskCatalog(supabase, workspaceId),
        loadOpsTaskPlaybooks(supabase, workspaceId),
        loadOpsTaskSlaConfig(supabase, workspaceId),
        loadOpsTaskAutomationRules(supabase, workspaceId),
      ]);
      return reply.send({ catalog, playbooks, sla, automation_rules });
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Erro ao carregar configuração de tarefas',
      });
    }
  });

  // GET /api/settings/:key — buscar uma configuração específica
  app.get('/:key', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { key } = request.params as { key: string };
    try {
      const value = await readWorkspaceSetting(workspaceId, key);
      if (value == null) {
        if (key === 'chat_signature_enabled') return reply.send(true);
        return reply.status(404).send({ error: 'Configuração não encontrada' });
      }
      return reply.send(value);
    } catch {
      return reply.status(404).send({ error: 'Configuração não encontrada' });
    }
  });

  // PUT /api/settings — atualizar ou criar uma configuração (apenas admin)
  app.put('/', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = settingSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const { key, value } = body.data;
    if (!isAllowedAppSettingsKey(key)) {
      return reply.status(403).send({
        error: 'Chave não permitida',
        hint: 'Use apenas chaves conhecidas (workspace_*, chat_*, financial_*, bot_*, etc.).',
      });
    }

    let valueToStore = value;
    if (key === 'ops_task_catalog') {
      const validated = validateOpsTaskCatalogPayload(value);
      if (validated.ok === false) {
        return reply.status(400).send({ error: validated.error });
      }
      valueToStore = validated.data;
    }
    if (key === 'ops_task_automation_rules') {
      const validated = validateOpsTaskAutomationRulesPayload(value);
      if (validated.ok === false) {
        return reply.status(400).send({ error: validated.error });
      }
      valueToStore = validated.data;
    }

    const actor = (request.user as { sub: string }).sub;
    try {
      await upsertWorkspaceSetting(workspaceId, key, valueToStore);
      const storedValue = await readWorkspaceSetting(workspaceId, key);

      await writeAuditLog({
        actor_id: actor,
        action: 'settings.put',
        entity_type: 'app_setting',
        entity_id: key,
        metadata: { key, workspace_id: workspaceId },
      });

      return reply.send({ workspace_id: workspaceId, key, value: storedValue ?? valueToStore });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Erro ao salvar configuração' });
    }
  });
}
