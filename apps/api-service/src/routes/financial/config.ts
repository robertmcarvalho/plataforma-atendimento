import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
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
  type AffectsNet,
  type FinancialEntryType,
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

export async function registerFinancialConfigRoutes(app: FastifyInstance) {
  // GET /api/financial/discount-rules
  app.get('/discount-rules', { preHandler: [authenticate, requireFinancialView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const rules = await loadMergedDiscountRules(workspaceId);
    return reply.send({ rules });
  });

  // PUT /api/financial/discount-rules
  app.put('/discount-rules', { preHandler: [authenticate, requireFinancialManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = discountRulesPutSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    const merged = mergeDiscountRulesFromJson({ rules: parsed.data.rules });
    const { data, error } = await supabase
      .from('app_settings')
      .upsert({ workspace_id: workspaceId, key: 'financial_discount_rules', value: { rules: merged }, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,key' })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ rules: merged, updated_at: data?.updated_at });
  });

  // GET /api/financial/entry-types — catálogo dinâmico de tipos de lançamento
  app.get('/entry-types', { preHandler: [authenticate, requireFinancialView] }, async (_request, reply) => {
    const types = await loadEntryTypes();
    return reply.send({ types });
  });

  // POST /api/financial/entry-types — cria novo tipo customizado e injeta regra default
  app.post('/entry-types', { preHandler: [authenticate, requireFinancialManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = entryTypeCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    if (!isValidSlug(parsed.data.slug)) return reply.status(400).send({ error: 'Slug inválido' });

    const current = await loadEntryTypes();
    if (current.some((t) => t.slug === parsed.data.slug)) {
      return reply.status(409).send({ error: 'Já existe um tipo com esse slug' });
    }

    const newType: FinancialEntryType = {
      slug: parsed.data.slug,
      label: parsed.data.label.trim(),
      active: true,
      is_system: false,
      affects_net: (parsed.data.affects_net ?? 'discount') as AffectsNet,
      created_at: new Date().toISOString(),
    };
    const next = await saveEntryTypes([...current, newType]);

    // Injeta uma regra default para o novo tipo, salvando merged em financial_discount_rules.
    const rules = await loadMergedDiscountRules(workspaceId);
    if (!rules[newType.slug]) {
      rules[newType.slug] = buildDefaultRuleForType(newType.slug);
      await persistDiscountRules(workspaceId, rules);
    }

    const created = next.find((t) => t.slug === newType.slug)!;
    return reply.status(201).send({ type: created, types: next });
  });

  // PATCH /api/financial/entry-types/:slug — atualiza label/active/affects_net (não permite slug imutável)
  app.patch('/entry-types/:slug', { preHandler: [authenticate, requireFinancialManage] }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    if (!isValidSlug(slug)) return reply.status(400).send({ error: 'Slug inválido' });
    const parsed = entryTypePatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const current = await loadEntryTypes();
    const idx = current.findIndex((t) => t.slug === slug);
    if (idx < 0) return reply.status(404).send({ error: 'Tipo não encontrado' });

    const target = current[idx];
    // Proteção: não permitir desativar `daily` ou alterar seu affects_net (regra de negócio core).
    if (target.slug === 'daily') {
      if (parsed.data.active === false) return reply.status(400).send({ error: 'O tipo "daily" não pode ser desativado' });
      if (parsed.data.affects_net && parsed.data.affects_net !== 'daily') {
        return reply.status(400).send({ error: 'O tipo "daily" não pode alterar affects_net' });
      }
    }

    const updated: FinancialEntryType = {
      ...target,
      label: parsed.data.label?.trim() ?? target.label,
      active: parsed.data.active ?? target.active,
      affects_net: (parsed.data.affects_net ?? target.affects_net) as AffectsNet,
    };
    const list = [...current];
    list[idx] = updated;
    const next = await saveEntryTypes(list);
    return reply.send({ type: next.find((t) => t.slug === slug), types: next });
  });

  // GET /api/financial/summary?driver_id=&month=YYYY-MM

}
