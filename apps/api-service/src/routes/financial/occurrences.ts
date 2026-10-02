import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import { requireFinancialManage } from '../../lib/financialAuth';
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

export async function registerFinancialOccurrenceRoutes(app: FastifyInstance) {
  app.post('/occurrences', { preHandler: [authenticate, requireFinancialManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const occurrenceSchema = z.object({
      driver_id: z.string().uuid(),
      pharmacy_ids: z.array(z.string().uuid()).min(1),
      event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      shift: z.enum(['full', 'morning', 'afternoon', 'night']).optional(),
      occurrence_kind: z.enum([
        OccurrenceKind.UNEXCUSED,
        OccurrenceKind.DAY_OFF,
        OccurrenceKind.CONTRACTED_DAILY,
      ]),
      has_coverage: z.boolean(),
      coverage: z
        .object({
          covering_driver_id: z.string().uuid(),
          amount: z.number().positive(),
          notes: z.string().optional(),
        })
        .optional(),
      contracted_daily: z
        .object({
          amount: z.number().positive(),
          notes: z.string().optional(),
        })
        .optional(),
      reason: z.string().optional(),
    });

    const parsed = occurrenceSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const user = request.user as { sub: string };
    const payload = parsed.data;

    const driverIds = [
      payload.driver_id,
      ...(payload.has_coverage && payload.coverage ? [payload.coverage.covering_driver_id] : []),
    ];
    const uniqueDriverIds = [...new Set(driverIds)];

    const { data: driverRows, error: driverErr } = await supabase
      .from('drivers')
      .select('id')
      .eq('workspace_id', workspaceId)
      .in('id', uniqueDriverIds);
    if (driverErr) return reply.status(500).send({ error: driverErr.message });
    if ((driverRows || []).length !== uniqueDriverIds.length) {
      return reply.status(400).send({ error: 'Entregador inválido ou fora do workspace.' });
    }

    const { data: pharmacyRows, error: pharmacyErr } = await supabase
      .from('pharmacies')
      .select('id')
      .eq('workspace_id', workspaceId)
      .in('id', payload.pharmacy_ids);
    if (pharmacyErr) return reply.status(500).send({ error: pharmacyErr.message });
    if ((pharmacyRows || []).length !== payload.pharmacy_ids.length) {
      return reply.status(400).send({ error: 'Farmácia inválida ou fora do workspace.' });
    }

    try {
      const { insertOccurrence, occurrencePrimaryEntryId } = await import('../../lib/leaderOccurrences.js');
      const result = await insertOccurrence(supabase, {
        workspace_id: workspaceId,
        created_by: user.sub,
        driver_id: payload.driver_id,
        pharmacy_ids: payload.pharmacy_ids,
        event_date: payload.event_date,
        shift: payload.shift,
        occurrence_kind: payload.occurrence_kind,
        has_coverage: payload.has_coverage,
        coverage: payload.coverage,
        contracted_daily: payload.contracted_daily,
        reason: payload.reason,
        source: 'financial',
      });

      await writeAuditLog({
        actor_id: user.sub,
        action: 'financial.occurrence.create',
        entity_type: 'financial_entry',
        entity_id: occurrencePrimaryEntryId(result),
        workspace_id: workspaceId,
        metadata: {
          driver_id: payload.driver_id,
          pharmacy_ids: payload.pharmacy_ids,
          occurrence_kind: payload.occurrence_kind,
          has_coverage: payload.has_coverage,
        },
      });

      return reply.status(201).send({
        absence_entries: result.absence_entries,
        coverage_daily_entries: result.coverage_daily_entries,
        count: result.absence_entries.length + result.coverage_daily_entries.length,
        installments_created: result.installments_created,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao registrar ocorrência';
      const status =
        msg.includes('Ciclo') ||
        msg.includes('futuro') ||
        msg.includes('cobridor') ||
        msg.includes('Valor') ||
        msg.includes('Diária contratada')
          ? 400
          : 500;
      return reply.status(status).send({ error: msg });
    }
  });


}
