import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import { requireFinancialView } from '../../lib/financialAuth';
import { supabase } from '../../lib/supabase';
import { requireWorkspace } from '../../lib/workspaceContext';
import { OccurrenceKind } from '@plataforma/operational-notes';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { generateInstallments } from '../../lib/financialInstallments';
import {
  buildDefaultRuleForType,
  mergeDiscountRulesFromJson,
  previousClosedCycleMonSun,
} from '../../lib/financialDiscountRules';
import { insertFinancialEntryWithInstallments, computeFinancialEntryFields } from '../../lib/financialEntryFactory';
import { recalculateFinancialEntries } from '../../lib/financialEntryRecalculate';
import {
  isValidSlug,
  loadEntryTypes,
  saveEntryTypes,
} from '../../lib/financialEntryTypes';
import { buildMonthlyDriverSummary, buildWeeklyDriverSummary } from '../../lib/financialSummaries';
import { writeAuditLog } from '../../lib/auditLog';
import {
  entrySchema,
  recalculateSchema,
  entryPatchSchema,
  discountRulesPutSchema,
  entryTypeCreateSchema,
  entryTypePatchSchema,
  exportFilterSchema,
  financialSummaryQuerySchema,
  financialWeeklySummaryQuerySchema,
  FINANCIAL_ENTRY_COVERAGE_SELECT,
  loadMergedDiscountRules,
  persistDiscountRules,
} from './shared';

export async function registerFinancialSummaryRoutes(app: FastifyInstance) {
  app.get('/summary', { preHandler: [authenticate, requireFinancialView] }, async (request, reply) => {
    const parsed = financialSummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Parâmetros inválidos', details: parsed.error.flatten() });
    }
    const { driver_id, month } = parsed.data;
    try {
      const summary = await buildMonthlyDriverSummary(driver_id, month);
      return reply.send(summary);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao montar resumo';
      return reply.status(500).send({ error: msg });
    }
  });

  app.get(
    '/drivers/:driverId/inbox-review',
    { preHandler: [authenticate, requireFinancialView] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { driverId } = request.params as { driverId: string };
      const { data: driver } = await supabase
        .from('drivers')
        .select('id, name')
        .eq('workspace_id', workspaceId)
        .eq('id', driverId)
        .maybeSingle();
      if (!driver) return reply.status(404).send({ error: 'Entregador não encontrado' });

      const { buildDriverFinancialReviewContext, buildAttendantFinancialDisplay } = await import(
        '../../lib/leaderFinancialDemandContext.js'
      );
      const { buildAdvanceEligibility } = await import('../../lib/advanceEligibility.js');
      try {
        const [financial_review_context, advance_context] = await Promise.all([
          buildDriverFinancialReviewContext(supabase, workspaceId, driverId),
          buildAdvanceEligibility(supabase, workspaceId, driverId),
        ]);
        const attendant_display = buildAttendantFinancialDisplay(
          financial_review_context,
          String(driver.name || 'Entregador')
        );
        return reply.send({
          driver: { id: driver.id, name: driver.name },
          financial_review_context,
          advance_context,
          attendant_display,
        });
      } catch (e: unknown) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha ao montar revisão financeira' });
      }
    }
  );

  app.get(
    '/drivers/:driverId/advance-eligibility',
    { preHandler: [authenticate, requireFinancialView] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const { driverId } = request.params as { driverId: string };
      const q = request.query as { requested_amount?: string };
      const requested = q.requested_amount ? Number(q.requested_amount) : undefined;
      const { buildAdvanceEligibility } = await import('../../lib/advanceEligibility.js');
      try {
        const data = await buildAdvanceEligibility(supabase, workspaceId, driverId, requested);
        return reply.send(data);
      } catch (e: unknown) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha na elegibilidade' });
      }
    }
  );

  // GET /api/financial/weekly-summary?driver_id=&reference_date=YYYY-MM-DD
  app.get('/weekly-summary', { preHandler: [authenticate, requireFinancialView] }, async (request, reply) => {
    const parsed = financialWeeklySummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Parâmetros inválidos', details: parsed.error.flatten() });
    }

    const { driver_id, reference_date } = parsed.data;
    try {
      const summary = await buildWeeklyDriverSummary(driver_id, reference_date);
      return reply.send(summary);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao montar resumo semanal';
      return reply.status(500).send({ error: msg });
    }
  });

  // GET /api/financial/entries

}
