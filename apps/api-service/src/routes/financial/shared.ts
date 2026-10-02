import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { mergeDiscountRulesFromJson, type DiscountRule } from '../../lib/financialDiscountRules';

export const entrySchema = z.object({
  driver_id: z.string().uuid(),
  pharmacy_id: z.string().uuid().optional(),
  type: z.string().min(1).regex(/^[a-z][a-z0-9_]{0,30}$/),
  description: z.string().optional(),
  total_amount: z.number().positive(),
  installments_count: z.number().int().min(1).default(1),
  frequency: z.enum(['weekly', 'monthly']).default('weekly'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
});

export const recalculateSchema = z.object({
  dry_run: z.boolean().optional(),
  types: z.array(z.string()).optional(),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});

export const entryPatchSchema = z.object({
  driver_id: z.string().uuid().optional(),
  pharmacy_id: z.string().uuid().optional(),
  total_amount: z.number().positive().optional(),
  installments_count: z.number().int().min(1).optional(),
  notes: z.string().nullable().optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const discountRulesPutSchema = z.object({
  rules: z.record(z.any()),
});

export const entryTypeCreateSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
  label: z.string().min(1).max(40),
  affects_net: z.enum(['discount', 'daily', 'ignore']).optional(),
});

export const entryTypePatchSchema = z.object({
  label: z.string().min(1).max(40).optional(),
  active: z.boolean().optional(),
  affects_net: z.enum(['discount', 'daily', 'ignore']).optional(),
});

export const exportFilterSchema = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  pharmacy_id: z.string().uuid().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  driver_id: z.string().uuid().optional(),
});

export const dailyExportFilterSchema = z.object({
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pharmacy_id: z.string().uuid().optional(),
  leader_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
  status: z.string().optional(),
  installment_status: z.enum(['all', 'pending', 'paid', 'discounted']).optional(),
});

export const financialSummaryQuerySchema = z.object({
  driver_id: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

export const financialWeeklySummaryQuerySchema = z.object({
  driver_id: z.string().uuid(),
  reference_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const FINANCIAL_ENTRY_COVERAGE_SELECT = `
        coverage_of_entry:financial_entries!coverage_of_entry_id(
          id, type, occurrence_kind, event_date, status, notes,
          absence_disposition, proposed_discount_amount,
          drivers(id, name)
        )`;

const FINANCIAL_BILLING_PHARMACY_FIELDS =
  process.env.FINANCIAL_INCLUDE_BILLING_IN_ENTRY_SELECT === 'true'
    ? ', daily_billing_enabled, daily_billing_rule, daily_billing_quantity, daily_billing_pharmacy_amount_cents, daily_billing_driver_payout_cents'
    : '';

/** Select de farmácia compatível com produção (migrations 100+ ainda não aplicadas). */
export const FINANCIAL_PHARMACY_LIST_SELECT = `pharmacies(id, trade_name, leader_id${FINANCIAL_BILLING_PHARMACY_FIELDS})`;
export const FINANCIAL_PHARMACY_DETAIL_SELECT = `pharmacies(id, trade_name, leader_id, cnpj, city${FINANCIAL_BILLING_PHARMACY_FIELDS})`;

export async function loadMergedDiscountRules(workspaceId: string): Promise<Record<string, DiscountRule>> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('key', 'financial_discount_rules')
    .maybeSingle();
  return mergeDiscountRulesFromJson(data?.value ?? null);
}

export async function persistDiscountRules(
  workspaceId: string,
  rules: Record<string, DiscountRule>
): Promise<void> {
  await supabase
    .from('app_settings')
    .upsert(
      {
        workspace_id: workspaceId,
        key: 'financial_discount_rules',
        value: { rules },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,key' }
    );
}
