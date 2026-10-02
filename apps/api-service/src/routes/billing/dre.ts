import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { writeAuditLog } from '../../lib/auditLog';
import {
  BILLING_DRE_CUTOVER_MONTH,
  buildDreReport,
  closeDrePeriod,
  loadClosedDreSnapshotReport,
  persistDreSnapshot,
  reopenDrePeriod,
} from '../../lib/billingDreEngine';
import { dreReportToCsv } from '../../lib/billingDreExport';
import { listDreTaxRules, updateDreTaxRule } from '../../lib/billingDreTaxRules';

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);
const entitySchema = z.enum(['coop', 'flux']);

export async function registerBillingDreRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/dre/config', { preHandler: [...preView] }, async (_request, reply) => {
    return reply.send({ cutover_month: BILLING_DRE_CUTOVER_MONTH });
  });

  app.get('/dre/tax-rules', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    try {
      const rules = await listDreTaxRules(workspaceId);
      return reply.send({ tax_rules: rules });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.patch('/dre/tax-rules/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const actorId = (request.user as { sub: string }).sub;
    const { id } = request.params as { id: string };
    const body = z
      .object({
        rate_pct: z.number().min(0).max(100).optional(),
        name: z.string().min(1).max(120).optional(),
        effective_from: z.string().nullable().optional(),
        effective_until: z.string().nullable().optional(),
        active: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos' });

    try {
      const rule = await updateDreTaxRule(workspaceId, id, body.data);
      await writeAuditLog({
        workspace_id: workspaceId,
        actor_id: actorId,
        action: 'billing.dre.tax_rule.update',
        entity_type: 'billing_dre_tax_rules',
        entity_id: id,
        metadata: body.data,
      });
      return reply.send({ tax_rule: rule });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/dre/:entity/export', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const entityParsed = entitySchema.safeParse((request.params as { entity: string }).entity);
    if (!entityParsed.success) return reply.status(400).send({ error: 'Entidade inválida (coop|flux)' });

    const q = request.query as { month?: string; cost_center_id?: string };
    const month = String(q.month || '');
    if (!monthSchema.safeParse(month).success) {
      return reply.status(400).send({ error: 'month obrigatório (YYYY-MM)' });
    }

    try {
      const report = await buildDreReport(workspaceId, month, entityParsed.data, { cost_center_id: q.cost_center_id || null });
      const csv = dreReportToCsv(report);
      const filename = `dre-${entityParsed.data}-${month}.csv`;
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csv);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/dre/:entity', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const entityParsed = entitySchema.safeParse((request.params as { entity: string }).entity);
    if (!entityParsed.success) return reply.status(400).send({ error: 'Entidade inválida (coop|flux)' });

    const q = request.query as { month?: string; cost_center_id?: string };
    const month = String(q.month || '');
    if (!monthSchema.safeParse(month).success) {
      return reply.status(400).send({ error: 'month obrigatório (YYYY-MM)' });
    }

    try {
      const snapshotReport = await loadClosedDreSnapshotReport(workspaceId, month, entityParsed.data, {
        cost_center_id: q.cost_center_id || null,
      });
      const report =
        snapshotReport ||
        (await buildDreReport(workspaceId, month, entityParsed.data, { cost_center_id: q.cost_center_id || null }));
      return reply.send({ report });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.post('/dre/:entity/recalculate', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const actorId = (request.user as { sub: string }).sub;

    const entityParsed = entitySchema.safeParse((request.params as { entity: string }).entity);
    if (!entityParsed.success) return reply.status(400).send({ error: 'Entidade inválida' });

    const body = z.object({ month: monthSchema }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'month inválido' });

    try {
      const report = await buildDreReport(workspaceId, body.data.month, entityParsed.data);
      if (report.period_status === 'closed') {
        return reply.status(409).send({ error: 'Período fechado. Reabra antes de recalcular.' });
      }
      if (report.before_cutover) {
        return reply.status(400).send({ error: `DRE disponível a partir de ${BILLING_DRE_CUTOVER_MONTH}` });
      }

      await persistDreSnapshot(workspaceId, body.data.month, entityParsed.data, actorId, report);
      await writeAuditLog({
        workspace_id: workspaceId,
        actor_id: actorId,
        action: 'billing.dre.recalculate',
        entity_type: 'billing_dre_snapshot',
        metadata: { month: body.data.month, entity: entityParsed.data },
      });

      return reply.send({ ok: true, report });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.post('/dre/:entity/close', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const actorId = (request.user as { sub: string }).sub;

    const entityParsed = entitySchema.safeParse((request.params as { entity: string }).entity);
    if (!entityParsed.success) return reply.status(400).send({ error: 'Entidade inválida' });

    const body = z.object({ month: monthSchema }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'month inválido' });

    try {
      const report = await buildDreReport(workspaceId, body.data.month, entityParsed.data);
      if (report.before_cutover) {
        return reply.status(400).send({ error: `DRE disponível a partir de ${BILLING_DRE_CUTOVER_MONTH}` });
      }
      const criticalWarnings = report.warnings.filter((warning) =>
        /sem grupo|exige centro|sem classificação|ambígu/i.test(warning)
      );
      if (criticalWarnings.length) {
        return reply.status(409).send({
          error: 'DRE possui pendências críticas de classificação. Corrija as pendências antes do fechamento.',
          warnings: criticalWarnings,
        });
      }
      await persistDreSnapshot(workspaceId, body.data.month, entityParsed.data, actorId, report);
      await closeDrePeriod(workspaceId, body.data.month, entityParsed.data, actorId);
      await writeAuditLog({
        workspace_id: workspaceId,
        actor_id: actorId,
        action: 'billing.dre.close',
        entity_type: 'billing_dre_period',
        metadata: { month: body.data.month, entity: entityParsed.data },
      });
      const closed = await buildDreReport(workspaceId, body.data.month, entityParsed.data);
      return reply.send({ ok: true, report: closed });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.post('/dre/:entity/reopen', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const actorId = (request.user as { sub: string }).sub;

    const entityParsed = entitySchema.safeParse((request.params as { entity: string }).entity);
    if (!entityParsed.success) return reply.status(400).send({ error: 'Entidade inválida' });

    const body = z.object({ month: monthSchema }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'month inválido' });

    try {
      await reopenDrePeriod(workspaceId, body.data.month, entityParsed.data);
      await writeAuditLog({
        workspace_id: workspaceId,
        actor_id: actorId,
        action: 'billing.dre.reopen',
        entity_type: 'billing_dre_period',
        metadata: { month: body.data.month, entity: entityParsed.data },
      });
      const report = await buildDreReport(workspaceId, body.data.month, entityParsed.data);
      return reply.send({ ok: true, report });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });
}
