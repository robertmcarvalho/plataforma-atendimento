"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FINANCIAL_ENTRY_COVERAGE_SELECT = exports.FINANCIAL_PHARMACY_DETAIL_SELECT = exports.FINANCIAL_PHARMACY_LIST_SELECT = exports.financialWeeklySummaryQuerySchema = exports.financialSummaryQuerySchema = exports.exportFilterSchema = exports.entryTypePatchSchema = exports.entryTypeCreateSchema = exports.discountRulesPutSchema = exports.entryPatchSchema = exports.recalculateSchema = exports.entrySchema = void 0;
exports.loadMergedDiscountRules = loadMergedDiscountRules;
exports.persistDiscountRules = persistDiscountRules;
const zod_1 = require("zod");
const supabase_1 = require("../../lib/supabase");
const financialDiscountRules_1 = require("../../lib/financialDiscountRules");
exports.entrySchema = zod_1.z.object({
    driver_id: zod_1.z.string().uuid(),
    pharmacy_id: zod_1.z.string().uuid().optional(),
    type: zod_1.z.string().min(1).regex(/^[a-z][a-z0-9_]{0,30}$/),
    description: zod_1.z.string().optional(),
    total_amount: zod_1.z.number().positive(),
    installments_count: zod_1.z.number().int().min(1).default(1),
    frequency: zod_1.z.enum(['weekly', 'monthly']).default('weekly'),
    start_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    event_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: zod_1.z.string().optional(),
});
exports.recalculateSchema = zod_1.z.object({
    dry_run: zod_1.z.boolean().optional(),
    types: zod_1.z.array(zod_1.z.string()).optional(),
    since: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: zod_1.z.number().int().min(1).max(5000).optional(),
});
exports.entryPatchSchema = zod_1.z.object({
    driver_id: zod_1.z.string().uuid().optional(),
    pharmacy_id: zod_1.z.string().uuid().optional(),
    total_amount: zod_1.z.number().positive().optional(),
    installments_count: zod_1.z.number().int().min(1).optional(),
    notes: zod_1.z.string().nullable().optional(),
    event_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
exports.discountRulesPutSchema = zod_1.z.object({
    rules: zod_1.z.record(zod_1.z.any()),
});
exports.entryTypeCreateSchema = zod_1.z.object({
    slug: zod_1.z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
    label: zod_1.z.string().min(1).max(40),
    affects_net: zod_1.z.enum(['discount', 'daily', 'ignore']).optional(),
});
exports.entryTypePatchSchema = zod_1.z.object({
    label: zod_1.z.string().min(1).max(40).optional(),
    active: zod_1.z.boolean().optional(),
    affects_net: zod_1.z.enum(['discount', 'daily', 'ignore']).optional(),
});
exports.exportFilterSchema = zod_1.z.object({
    start_date: zod_1.z.string().optional(),
    end_date: zod_1.z.string().optional(),
    pharmacy_id: zod_1.z.string().uuid().optional(),
    type: zod_1.z.string().optional(),
    status: zod_1.z.string().optional(),
    driver_id: zod_1.z.string().uuid().optional(),
});
exports.financialSummaryQuerySchema = zod_1.z.object({
    driver_id: zod_1.z.string().uuid(),
    month: zod_1.z.string().regex(/^\d{4}-\d{2}$/),
});
exports.financialWeeklySummaryQuerySchema = zod_1.z.object({
    driver_id: zod_1.z.string().uuid(),
    reference_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
exports.FINANCIAL_ENTRY_COVERAGE_SELECT = `
        coverage_of_entry:financial_entries!coverage_of_entry_id(
          id, type, occurrence_kind, event_date, status, notes,
          absence_disposition, proposed_discount_amount,
          drivers(id, name)
        )`;
const FINANCIAL_BILLING_PHARMACY_FIELDS = process.env.FINANCIAL_INCLUDE_BILLING_IN_ENTRY_SELECT === 'true'
    ? ', daily_billing_enabled, daily_billing_rule, daily_billing_quantity, daily_billing_pharmacy_amount_cents, daily_billing_driver_payout_cents'
    : '';
exports.FINANCIAL_PHARMACY_LIST_SELECT = `pharmacies(id, trade_name, leader_id${FINANCIAL_BILLING_PHARMACY_FIELDS})`;
exports.FINANCIAL_PHARMACY_DETAIL_SELECT = `pharmacies(id, trade_name, leader_id, cnpj, city${FINANCIAL_BILLING_PHARMACY_FIELDS})`;
async function loadMergedDiscountRules(workspaceId) {
    const { data } = await supabase_1.supabase
        .from('app_settings')
        .select('value')
        .eq('workspace_id', workspaceId)
        .eq('key', 'financial_discount_rules')
        .maybeSingle();
    return (0, financialDiscountRules_1.mergeDiscountRulesFromJson)(data?.value ?? null);
}
async function persistDiscountRules(workspaceId, rules) {
    await supabase_1.supabase
        .from('app_settings')
        .upsert({
        workspace_id: workspaceId,
        key: 'financial_discount_rules',
        value: { rules },
        updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,key' });
}
