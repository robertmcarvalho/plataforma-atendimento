import { supabase } from './supabase';
import { buildInssAccountingReport } from './billingReportsEngine';
import {
  accountForEntity,
  BILLING_DRE_CUTOVER_MONTH,
  ensureDreAccounts,
  ensureDreTaxRules,
  type DreAccountRow,
  type DreEntityType,
} from './billingDreSeed';
import { isBillingCapitalSeparationEnabled } from './billingCapitalSeparation';

export { BILLING_DRE_CUTOVER_MONTH };

const SETTLEMENT_STATUSES = ['approved', 'paid'];
const EXPENSE_STATUSES = ['approved', 'paid'];
const PAYABLE_STATUSES = ['approved', 'paid'];

export type DrePharmacyRow = {
  pharmacy_id: string;
  pharmacy_name: string;
  cost_center_id: string | null;
  cost_center_name: string | null;
  revenue_cents: number;
  variable_cost_cents: number;
  fixed_cost_cents: number;
  tax_cents: number;
  operational_cost_cents?: number;
  administrative_expense_cents?: number;
  commercial_expense_cents?: number;
  financial_expense_cents?: number;
  result_cents: number;
};

export type DreConsolidatedLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  line_kind: string;
  display_order: number;
  amount_cents: number;
};

export type DreCostCenterRow = {
  cost_center_id: string;
  cost_center_name: string;
  pharmacy_count: number;
  revenue_cents: number;
  variable_cost_cents: number;
  fixed_cost_cents: number;
  tax_cents: number;
  operational_cost_cents?: number;
  administrative_expense_cents?: number;
  commercial_expense_cents?: number;
  financial_expense_cents?: number;
  result_cents: number;
};

export type DreReport = {
  entity_type: DreEntityType;
  competence_month: string;
  cutover_month: string;
  before_cutover: boolean;
  period_status: 'open' | 'closed';
  revenue_cents: number;
  variable_cost_cents: number;
  fixed_cost_cents: number;
  tax_cents: number;
  operational_cost_cents: number;
  administrative_expense_cents: number;
  commercial_expense_cents: number;
  financial_expense_cents: number;
  management_summary: {
    operational_cost_cents: number;
    administrative_expense_cents: number;
    commercial_expense_cents: number;
    financial_expense_cents: number;
    tax_cents: number;
    result_operational_cents: number;
    result_net_cents: number;
  };
  result_cents: number;
  consolidated: DreConsolidatedLine[];
  pharmacies: DrePharmacyRow[];
  cost_centers: DreCostCenterRow[];
  warnings: string[];
};

type PharmacyBucket = {
  pharmacy_id: string;
  pharmacy_name: string;
  cost_center_id: string | null;
  cost_center_name: string | null;
  revenue: number;
  variable: number;
  fixed: number;
  tax: number;
  operational: number;
  administrative: number;
  commercial: number;
  financial: number;
};

type CostCenterMeta = {
  id: string;
  name: string;
  corporate_entity_type: DreEntityType | null;
};

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function isBeforeCutover(month: string): boolean {
  return month < BILLING_DRE_CUTOVER_MONTH;
}

function entityExpenseShare(
  expenseEntity: string,
  target: DreEntityType,
  coopPct: number | null,
  fluxPct: number | null
): number {
  if (expenseEntity === target) return 1;
  if (expenseEntity !== 'both') return 0;
  const coop = coopPct ?? 50;
  const flux = fluxPct ?? 50;
  return target === 'coop' ? coop / 100 : flux / 100;
}

function getBucket(
  map: Map<string, PharmacyBucket>,
  pharmacyId: string,
  meta: { name: string; ccId: string | null; ccName: string | null }
): PharmacyBucket {
  let b = map.get(pharmacyId);
  if (!b) {
    b = {
      pharmacy_id: pharmacyId,
      pharmacy_name: meta.name,
      cost_center_id: meta.ccId,
      cost_center_name: meta.ccName,
      revenue: 0,
      variable: 0,
      fixed: 0,
      tax: 0,
      operational: 0,
      administrative: 0,
      commercial: 0,
      financial: 0,
    };
    map.set(pharmacyId, b);
  }
  return b;
}

function getCostCenterBucket(
  map: Map<string, PharmacyBucket>,
  costCenter: CostCenterMeta
): PharmacyBucket {
  const syntheticId = `cc:${costCenter.id}`;
  let b = map.get(syntheticId);
  if (!b) {
    b = {
      pharmacy_id: syntheticId,
      pharmacy_name: costCenter.name,
      cost_center_id: costCenter.id,
      cost_center_name: costCenter.name,
      revenue: 0,
      variable: 0,
      fixed: 0,
      tax: 0,
      operational: 0,
      administrative: 0,
      commercial: 0,
      financial: 0,
    };
    map.set(syntheticId, b);
  }
  return b;
}

function allocateCents(
  amountCents: number,
  weights: Map<string, number>,
  buckets: Map<string, PharmacyBucket>,
  metaByPharmacy: Map<string, { name: string; ccId: string | null; ccName: string | null }>,
  apply: (bucket: PharmacyBucket, cents: number) => void
): void {
  if (amountCents === 0) return;
  const entries = [...weights.entries()].filter(([, w]) => w > 0);
  if (!entries.length) return;

  const totalWeight = entries.reduce((s, [, w]) => s + w, 0);
  if (totalWeight <= 0) return;

  let allocated = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const [pharmacyId, weight] = entries[i]!;
    const meta = metaByPharmacy.get(pharmacyId) || { name: pharmacyId, ccId: null, ccName: null };
    const bucket = getBucket(buckets, pharmacyId, meta);
    const cents =
      i === entries.length - 1
        ? amountCents - allocated
        : Math.round((amountCents * weight) / totalWeight);
    allocated += cents;
    apply(bucket, cents);
  }
}

async function loadPeriodStatus(
  workspaceId: string,
  entity: DreEntityType,
  month: string
): Promise<'open' | 'closed'> {
  const { data } = await supabase
    .from('billing_dre_periods')
    .select('status')
    .eq('workspace_id', workspaceId)
    .eq('entity_type', entity)
    .eq('competence_month', month)
    .maybeSingle();
  return data?.status === 'closed' ? 'closed' : 'open';
}

async function loadPharmacyMeta(workspaceId: string): Promise<
  Map<string, { name: string; ccId: string | null; ccName: string | null }>
> {
  const { data, error } = await supabase
    .from('pharmacies')
    .select('id, trade_name, legal_name, billing_cost_center_id, billing_cost_centers(name)')
    .eq('workspace_id', workspaceId);
  if (error) throw new Error(error.message);

  const map = new Map<string, { name: string; ccId: string | null; ccName: string | null }>();
  for (const p of data || []) {
    const ccRaw = p.billing_cost_centers as { name: string } | { name: string }[] | null;
    const cc = Array.isArray(ccRaw) ? ccRaw[0] : ccRaw;
    map.set(String(p.id), {
      name: String(p.trade_name || p.legal_name || p.id),
      ccId: p.billing_cost_center_id ? String(p.billing_cost_center_id) : null,
      ccName: cc?.name ? String(cc.name) : null,
    });
  }
  return map;
}

async function loadCostCenterMeta(workspaceId: string): Promise<Map<string, CostCenterMeta>> {
  const { data, error } = await supabase
    .from('billing_cost_centers')
    .select('id, name, corporate_entity_type')
    .eq('workspace_id', workspaceId);
  if (error) throw new Error(error.message);

  const map = new Map<string, CostCenterMeta>();
  for (const cc of data || []) {
    map.set(String(cc.id), {
      id: String(cc.id),
      name: String(cc.name || cc.id),
      corporate_entity_type:
        cc.corporate_entity_type === 'coop' || cc.corporate_entity_type === 'flux'
          ? cc.corporate_entity_type
          : null,
    });
  }
  return map;
}

async function loadSettlements(
  workspaceId: string,
  month: string
): Promise<
  {
    pharmacy_id: string;
    coop_cents: number;
    flux_cents: number;
    net_driver_payout_cents: number;
    operational_net_driver_payout_cents: number;
  }[]
> {
  const { start, end } = monthBounds(month);
  const { data: cycles, error: cycleErr } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('workspace_id', workspaceId)
    .gte('apuracao_end', start)
    .lte('apuracao_end', end);
  if (cycleErr) throw new Error(cycleErr.message);

  const cycleIds = (cycles || []).map((c) => String(c.id));
  if (!cycleIds.length) return [];

  const { data, error } = await supabase
    .from('billing_settlements')
    .select(
      'pharmacy_id, coop_cents, flux_cents, net_driver_payout_cents, operational_net_driver_payout_cents'
    )
    .eq('workspace_id', workspaceId)
    .in('billing_cycle_id', cycleIds)
    .in('status', SETTLEMENT_STATUSES);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    pharmacy_id: String(r.pharmacy_id),
    coop_cents: Number(r.coop_cents) || 0,
    flux_cents: Number(r.flux_cents) || 0,
    net_driver_payout_cents: Number(r.net_driver_payout_cents) || 0,
    operational_net_driver_payout_cents:
      Number(r.operational_net_driver_payout_cents) ||
      Number(r.net_driver_payout_cents) ||
      0,
  }));
}

async function loadExpenses(workspaceId: string, month: string) {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase
    .from('billing_expenses')
    .select(
      'id, amount_cents, legal_entity_type, allocation, cost_center_id, expense_type_id, management_group, dre_group, allocation_policy, billing_expense_types(entity_split_coop_pct, entity_split_flux_pct, affects_dre, management_group, dre_group, allocation_policy, requires_cost_center)'
    )
    .eq('workspace_id', workspaceId)
    .gte('expense_date', start)
    .lte('expense_date', end)
    .in('status', EXPENSE_STATUSES);
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadPayables(workspaceId: string, month: string) {
  const { data, error } = await supabase
    .from('billing_payables')
    .select('id, amount_cents, legal_entity_type, beneficiary_type, category, cost_center_id, management_group, dre_group, allocation_policy')
    .eq('workspace_id', workspaceId)
    .eq('competence_month', month)
    .in('status', PAYABLE_STATUSES);
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadLeaderCommissions(workspaceId: string, month: string) {
  const { data, error } = await supabase
    .from('billing_leader_commission_accruals')
    .select('pharmacy_id, amount_cents')
    .eq('workspace_id', workspaceId)
    .eq('competence_month', month);
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadCommercialCommissions(workspaceId: string, month: string) {
  const { data, error } = await supabase
    .from('billing_commission_accruals')
    .select('amount_cents, pharmacy_id, partner_id, billing_commercial_partners!partner_id(default_entity)')
    .eq('workspace_id', workspaceId)
    .eq('competence_month', month)
    .neq('status', 'cancelled');
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadTaxRateByCode(
  workspaceId: string,
  entity: DreEntityType,
  month: string,
  taxCode: string
): Promise<number> {
  const { end } = monthBounds(month);
  const { data, error } = await supabase
    .from('billing_dre_tax_rules')
    .select('rate_pct, effective_from, effective_until')
    .eq('workspace_id', workspaceId)
    .eq('entity_type', entity)
    .eq('tax_code', taxCode)
    .eq('active', true)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const defaults: Record<string, number> = {
    simples_nacional: 6,
    iss: 2,
    inss_cooperados: 20,
  };

  if (!data) return defaults[taxCode] ?? 0;

  const at = new Date(`${end}T12:00:00.000Z`);
  if (data.effective_from) {
    const from = new Date(`${data.effective_from}T00:00:00.000Z`);
    if (at < from) return 0;
  }
  if (data.effective_until) {
    const until = new Date(`${data.effective_until}T23:59:59.999Z`);
    if (at > until) return 0;
  }
  return Number(data.rate_pct) || 0;
}

function buildCostCenterRollup(pharmacies: DrePharmacyRow[]): DreCostCenterRow[] {
  const byCc = new Map<string, DreCostCenterRow>();

  for (const p of pharmacies) {
    const ccId = p.cost_center_id || '__none__';
    const ccName = p.cost_center_name || 'Sem centro de custo';
    let row = byCc.get(ccId);
    if (!row) {
      row = {
        cost_center_id: ccId,
        cost_center_name: ccName,
        pharmacy_count: 0,
        revenue_cents: 0,
        variable_cost_cents: 0,
        fixed_cost_cents: 0,
        tax_cents: 0,
        operational_cost_cents: 0,
        administrative_expense_cents: 0,
        commercial_expense_cents: 0,
        financial_expense_cents: 0,
        result_cents: 0,
      };
      byCc.set(ccId, row);
    }
    row.pharmacy_count += 1;
    row.revenue_cents += p.revenue_cents;
    row.variable_cost_cents += p.variable_cost_cents;
    row.fixed_cost_cents += p.fixed_cost_cents;
    row.tax_cents += p.tax_cents;
    row.operational_cost_cents = (row.operational_cost_cents || 0) + (p.operational_cost_cents || 0);
    row.administrative_expense_cents = (row.administrative_expense_cents || 0) + (p.administrative_expense_cents || 0);
    row.commercial_expense_cents = (row.commercial_expense_cents || 0) + (p.commercial_expense_cents || 0);
    row.financial_expense_cents = (row.financial_expense_cents || 0) + (p.financial_expense_cents || 0);
    row.result_cents += p.result_cents;
  }

  return [...byCc.values()].sort((a, b) => b.revenue_cents - a.revenue_cents);
}

function operationalPayoutWeightMap(buckets: Map<string, PharmacyBucket>): Map<string, number> {
  const weights = new Map<string, number>();
  for (const [id, b] of buckets) {
    const payout = b.operational;
    if (payout > 0) weights.set(id, payout);
  }
  return weights;
}

function revenueWeightMap(buckets: Map<string, PharmacyBucket>): Map<string, number> {
  const weights = new Map<string, number>();
  for (const [id, b] of buckets) {
    if (b.revenue > 0) weights.set(id, b.revenue);
  }
  return weights;
}

function ccPharmacyWeights(
  buckets: Map<string, PharmacyBucket>,
  costCenterId: string
): Map<string, number> {
  const weights = new Map<string, number>();
  for (const [id, b] of buckets) {
    if (b.cost_center_id === costCenterId && b.revenue > 0) {
      weights.set(id, b.revenue);
    }
  }
  return weights;
}

export async function buildDreReport(
  workspaceId: string,
  month: string,
  entity: DreEntityType,
  options: { cost_center_id?: string | null } = {}
): Promise<DreReport> {
  const warnings: string[] = [];
  const beforeCutover = isBeforeCutover(month);
  if (beforeCutover) {
    warnings.push(`DRE disponível a partir de ${BILLING_DRE_CUTOVER_MONTH} (cutover).`);
  }

  await ensureDreTaxRules(workspaceId);
  const accounts = await ensureDreAccounts(workspaceId);
  const period_status = await loadPeriodStatus(workspaceId, entity, month);
  const metaByPharmacy = await loadPharmacyMeta(workspaceId);
  const metaByCostCenter = await loadCostCenterMeta(workspaceId);
  const buckets = new Map<string, PharmacyBucket>();

  const revCode = entity === 'coop' ? 'C-REV' : 'F-REV';
  const repCode = entity === 'coop' ? 'C-CV-REP' : 'F-CV-LID';
  const comCode = entity === 'coop' ? 'C-CV-COM' : 'F-CV-COM';
  const admCode = entity === 'coop' ? 'C-CF-ADM' : 'F-CF-ADM';
  const operationalCode = entity === 'coop' ? 'C-CV-OPS' : 'F-CV-OPS';
  const commercialCode = entity === 'coop' ? 'C-DCOM' : 'F-DCOM';
  const financialCode = entity === 'coop' ? 'C-DFIN' : 'F-DFIN';
  const otherTaxCode = entity === 'coop' ? 'C-IMP-OUT' : 'F-IMP-OUT';

  const consolidatedAmounts = new Map<string, number>();

  const addConsolidated = (code: string, cents: number) => {
    consolidatedAmounts.set(code, (consolidatedAmounts.get(code) || 0) + cents);
  };

  const addFixedToCostCenter = (costCenterId: string | null | undefined, cents: number): boolean => {
    if (!costCenterId || cents === 0) return false;
    const cc = metaByCostCenter.get(String(costCenterId));
    if (!cc) return false;
    getCostCenterBucket(buckets, cc).fixed += cents;
    return true;
  };

  const applyManagementAmount = (bucket: PharmacyBucket, cents: number, dreGroup: string) => {
    if (dreGroup === 'operational_cost') {
      bucket.variable += cents;
      bucket.operational += cents;
    } else if (dreGroup === 'commercial_expense') {
      bucket.fixed += cents;
      bucket.commercial += cents;
    } else if (dreGroup === 'financial_expense') {
      bucket.fixed += cents;
      bucket.financial += cents;
    } else if (dreGroup === 'tax') {
      bucket.tax += cents;
    } else {
      bucket.fixed += cents;
      bucket.administrative += cents;
    }
  };

  const codeForDreGroup = (dreGroup: string) => {
    if (dreGroup === 'operational_cost') return operationalCode;
    if (dreGroup === 'commercial_expense') return commercialCode;
    if (dreGroup === 'financial_expense') return financialCode;
    if (dreGroup === 'tax') return otherTaxCode;
    return admCode;
  };

  if (!beforeCutover) {
    const settlements = await loadSettlements(workspaceId, month);
    for (const row of settlements) {
      const meta = metaByPharmacy.get(row.pharmacy_id) || {
        name: row.pharmacy_id,
        ccId: null,
        ccName: null,
      };
      const bucket = getBucket(buckets, row.pharmacy_id, meta);

      if (entity === 'coop') {
        const operationalPayout = isBillingCapitalSeparationEnabled()
          ? row.operational_net_driver_payout_cents
          : row.net_driver_payout_cents;
        bucket.revenue += row.coop_cents;
        bucket.variable += operationalPayout;
        bucket.operational += operationalPayout;
        addConsolidated(revCode, row.coop_cents);
        addConsolidated(repCode, operationalPayout);
      } else {
        bucket.revenue += row.flux_cents;
        addConsolidated(revCode, row.flux_cents);
      }
    }

    const leaderCommissions = entity === 'flux' ? await loadLeaderCommissions(workspaceId, month) : [];
    for (const row of leaderCommissions) {
      const pid = String(row.pharmacy_id);
      const meta = metaByPharmacy.get(pid) || { name: pid, ccId: null, ccName: null };
      const bucket = getBucket(buckets, pid, meta);
      const cents = Number(row.amount_cents) || 0;
      bucket.variable += cents;
      bucket.commercial += cents;
      addConsolidated(repCode, cents);
    }

    const commercial = await loadCommercialCommissions(workspaceId, month);
    for (const row of commercial) {
      const partnerRaw = row.billing_commercial_partners as { default_entity: string } | { default_entity: string }[] | null;
      const partner = Array.isArray(partnerRaw) ? partnerRaw[0] : partnerRaw;
      const partnerEntity = String(partner?.default_entity || 'coop');
      if (partnerEntity !== entity) continue;

      const cents = Number(row.amount_cents) || 0;
      addConsolidated(comCode, cents);

      const pid = row.pharmacy_id ? String(row.pharmacy_id) : null;
      if (pid && buckets.has(pid)) {
        buckets.get(pid)!.variable += cents;
        buckets.get(pid)!.commercial += cents;
      } else {
        allocateCents(cents, revenueWeightMap(buckets), buckets, metaByPharmacy, (b, c) => {
          b.variable += c;
          b.commercial += c;
        });
      }
    }

    const payables = await loadPayables(workspaceId, month);
    for (const p of payables) {
      const cents = Number(p.amount_cents) || 0;
      if (cents <= 0) continue;
      const beneficiary = String(p.beneficiary_type);

      if (entity === 'flux' && beneficiary === 'shareholder' && p.category === 'pro_labore') {
        if (p.legal_entity_type !== 'flux') continue;
        addConsolidated('F-CF-PL', cents);
        if (!addFixedToCostCenter(p.cost_center_id, cents)) {
          allocateCents(cents, revenueWeightMap(buckets), buckets, metaByPharmacy, (b, c) => {
            b.fixed += c;
            b.administrative += c;
          });
        } else if (p.cost_center_id) {
          const cc = metaByCostCenter.get(String(p.cost_center_id));
          if (cc) getCostCenterBucket(buckets, cc).administrative += cents;
        }
        continue;
      }

      if (beneficiary === 'internal_provider') {
        const le = String(p.legal_entity_type || '');
        if (le !== entity && le !== 'both') continue;
        const share = le === 'both' ? 0.5 : 1;
        const part = Math.round(cents * share);
        const code = entity === 'flux' ? 'F-CF-PRV' : 'C-CF-ADM';
        addConsolidated(code, part);
        if (!addFixedToCostCenter(p.cost_center_id, part)) {
          allocateCents(part, revenueWeightMap(buckets), buckets, metaByPharmacy, (b, c) => {
            b.fixed += c;
            b.administrative += c;
          });
        } else if (p.cost_center_id) {
          const cc = metaByCostCenter.get(String(p.cost_center_id));
          if (cc) getCostCenterBucket(buckets, cc).administrative += part;
        }
      }
    }

    const expenses = await loadExpenses(workspaceId, month);
    for (const exp of expenses) {
      const amount = Number(exp.amount_cents) || 0;
      if (amount <= 0) continue;

      const typeRaw = exp.billing_expense_types as
        | {
            entity_split_coop_pct: number | null;
            entity_split_flux_pct: number | null;
            affects_dre?: boolean | null;
            management_group?: string | null;
            dre_group?: string | null;
            allocation_policy?: string | null;
            requires_cost_center?: boolean | null;
          }
        | {
            entity_split_coop_pct: number | null;
            entity_split_flux_pct: number | null;
            affects_dre?: boolean | null;
            management_group?: string | null;
            dre_group?: string | null;
            allocation_policy?: string | null;
            requires_cost_center?: boolean | null;
          }[]
        | null;
      const typeMeta = Array.isArray(typeRaw) ? typeRaw[0] : typeRaw;
      if (typeMeta?.affects_dre === false) continue;
      const dreGroup = String(exp.dre_group || typeMeta?.dre_group || 'administrative_expense');
      if (dreGroup === 'outside_dre') continue;
      if (!exp.dre_group && !typeMeta?.dre_group) {
        warnings.push(`Despesa ${String(exp.id)} sem grupo DRE; classificada como administrativa.`);
      }
      if ((typeMeta?.requires_cost_center || String(exp.allocation_policy || typeMeta?.allocation_policy || '') === 'direct_cost_center') && !exp.cost_center_id) {
        warnings.push(`Despesa ${String(exp.id)} exige centro de custo para fechar o DRE gerencial.`);
      }

      const share = entityExpenseShare(
        String(exp.legal_entity_type),
        entity,
        typeMeta?.entity_split_coop_pct != null ? Number(typeMeta.entity_split_coop_pct) : null,
        typeMeta?.entity_split_flux_pct != null ? Number(typeMeta.entity_split_flux_pct) : null
      );
      if (share <= 0) continue;

      const entityAmount = Math.round(amount * share);
      addConsolidated(codeForDreGroup(dreGroup), entityAmount);

      const allocation = (exp.allocation || {}) as Record<string, number>;
      const allocKeys = Object.keys(allocation).filter((k) => Number(allocation[k]) > 0);

      if (allocKeys.length) {
        for (const ccId of allocKeys) {
          const ccAmount = Math.round((entityAmount * Number(allocation[ccId])) / 100);
          const weights = ccPharmacyWeights(buckets, ccId);
          if (weights.size) {
            allocateCents(ccAmount, weights, buckets, metaByPharmacy, (b, c) => {
              applyManagementAmount(b, c, dreGroup);
            });
          } else {
            const cc = metaByCostCenter.get(String(ccId));
            if (cc) {
              applyManagementAmount(getCostCenterBucket(buckets, cc), ccAmount, dreGroup);
            } else {
              allocateCents(ccAmount, revenueWeightMap(buckets), buckets, metaByPharmacy, (b, c) => {
                applyManagementAmount(b, c, dreGroup);
              });
            }
          }
        }
      } else if (exp.cost_center_id) {
        const weights = ccPharmacyWeights(buckets, String(exp.cost_center_id));
        if (weights.size) {
          allocateCents(entityAmount, weights, buckets, metaByPharmacy, (b, c) => {
            applyManagementAmount(b, c, dreGroup);
          });
        } else {
          const cc = metaByCostCenter.get(String(exp.cost_center_id));
          if (cc) {
            applyManagementAmount(getCostCenterBucket(buckets, cc), entityAmount, dreGroup);
          } else {
            allocateCents(entityAmount, revenueWeightMap(buckets), buckets, metaByPharmacy, (b, c) => {
              applyManagementAmount(b, c, dreGroup);
            });
          }
        }
      } else {
        allocateCents(entityAmount, revenueWeightMap(buckets), buckets, metaByPharmacy, (b, c) => {
          applyManagementAmount(b, c, dreGroup);
        });
      }
    }

    const totalRevenue = [...buckets.values()].reduce((s, b) => s + b.revenue, 0);

    if (entity === 'coop') {
      const issRate = await loadTaxRateByCode(workspaceId, 'coop', month, 'iss');
      const issTotal = Math.round((totalRevenue * issRate) / 100);
      addConsolidated('C-IMP-ISS', issTotal);
      allocateCents(issTotal, revenueWeightMap(buckets), buckets, metaByPharmacy, (b, c) => {
        b.tax += c;
      });

      const inssRate = await loadTaxRateByCode(workspaceId, 'coop', month, 'inss_cooperados');
      if (inssRate > 0) {
        const inssBase = await buildInssAccountingReport(workspaceId, month);
        const inssTotal = Math.round((inssBase.total_cents * inssRate) / 100);
        if (inssTotal > 0) {
          addConsolidated('C-CF-INSS', inssTotal);
          const weights = operationalPayoutWeightMap(buckets);
          allocateCents(
            inssTotal,
            weights.size ? weights : revenueWeightMap(buckets),
            buckets,
            metaByPharmacy,
            (b, c) => {
              b.fixed += c;
            }
          );
        }
      }
    } else {
      const simplesRate = await loadTaxRateByCode(workspaceId, 'flux', month, 'simples_nacional');
      const taxTotal = Math.round((totalRevenue * simplesRate) / 100);
      addConsolidated('F-IMP-SNP', taxTotal);
      allocateCents(taxTotal, revenueWeightMap(buckets), buckets, metaByPharmacy, (b, c) => {
        b.tax += c;
      });
    }
  }

  const pharmacies: DrePharmacyRow[] = [...buckets.values()]
    .filter((b) => !options.cost_center_id || b.cost_center_id === options.cost_center_id)
    .map((b) => ({
      pharmacy_id: b.pharmacy_id,
      pharmacy_name: b.pharmacy_name,
      cost_center_id: b.cost_center_id,
      cost_center_name: b.cost_center_name,
      revenue_cents: b.revenue,
      variable_cost_cents: b.variable,
      fixed_cost_cents: b.fixed,
      tax_cents: b.tax,
      operational_cost_cents: b.operational,
      administrative_expense_cents: b.administrative,
      commercial_expense_cents: b.commercial,
      financial_expense_cents: b.financial,
      result_cents: b.revenue - b.variable - b.fixed - b.tax,
    }))
    .sort((a, b) => b.revenue_cents - a.revenue_cents);

  const revenue_cents = pharmacies.reduce((s, p) => s + p.revenue_cents, 0);
  const variable_cost_cents = pharmacies.reduce((s, p) => s + p.variable_cost_cents, 0);
  const fixed_cost_cents = pharmacies.reduce((s, p) => s + p.fixed_cost_cents, 0);
  const tax_cents = pharmacies.reduce((s, p) => s + p.tax_cents, 0);
  const operational_cost_cents = pharmacies.reduce((s, p) => s + (p.operational_cost_cents || 0), 0);
  const administrative_expense_cents = pharmacies.reduce((s, p) => s + (p.administrative_expense_cents || 0), 0);
  const commercial_expense_cents = pharmacies.reduce((s, p) => s + (p.commercial_expense_cents || 0), 0);
  const financial_expense_cents = pharmacies.reduce((s, p) => s + (p.financial_expense_cents || 0), 0);
  const result_cents = revenue_cents - variable_cost_cents - fixed_cost_cents - tax_cents;

  const resCode = entity === 'coop' ? 'C-RES' : 'F-RES';
  consolidatedAmounts.set(resCode, result_cents);
  if (options.cost_center_id) {
    consolidatedAmounts.clear();
    consolidatedAmounts.set(revCode, revenue_cents);
    consolidatedAmounts.set(repCode, operational_cost_cents);
    consolidatedAmounts.set(admCode, administrative_expense_cents);
    consolidatedAmounts.set(commercialCode, commercial_expense_cents);
    consolidatedAmounts.set(financialCode, financial_expense_cents);
    consolidatedAmounts.set(entity === 'coop' ? 'C-IMP-ISS' : 'F-IMP-SNP', tax_cents);
    consolidatedAmounts.set(resCode, result_cents);
  }

  const consolidated: DreConsolidatedLine[] = [...accounts.entries()]
    .filter(([key]) => key.startsWith(`${entity}:`))
    .map(([, acc]) => acc)
    .sort((a, b) => a.display_order - b.display_order)
    .map((acc) => ({
      account_id: acc.id,
      account_code: acc.code,
      account_name: acc.name,
      line_kind: acc.line_kind,
      display_order: acc.display_order,
      amount_cents: consolidatedAmounts.get(acc.code) || 0,
    }));

  const cost_centers = buildCostCenterRollup(pharmacies);

  if (!beforeCutover && revenue_cents === 0 && fixed_cost_cents === 0) {
    warnings.push('Sem movimentação na competência (acertos aprovados ou despesas).');
  }

  return {
    entity_type: entity,
    competence_month: month,
    cutover_month: BILLING_DRE_CUTOVER_MONTH,
    before_cutover: beforeCutover,
    period_status,
    revenue_cents,
    variable_cost_cents,
    fixed_cost_cents,
    tax_cents,
    operational_cost_cents,
    administrative_expense_cents,
    commercial_expense_cents,
    financial_expense_cents,
    management_summary: {
      operational_cost_cents,
      administrative_expense_cents,
      commercial_expense_cents,
      financial_expense_cents,
      tax_cents,
      result_operational_cents: revenue_cents - operational_cost_cents - administrative_expense_cents - commercial_expense_cents,
      result_net_cents: result_cents,
    },
    result_cents,
    consolidated,
    pharmacies,
    cost_centers,
    warnings,
  };
}

export async function persistDreSnapshot(
  workspaceId: string,
  month: string,
  entity: DreEntityType,
  actorId: string,
  report: DreReport
): Promise<void> {
  const accounts = await ensureDreAccounts(workspaceId);
  const now = new Date().toISOString();

  const { data: snapshot, error: snapErr } = await supabase
    .from('billing_dre_snapshots')
    .upsert(
      {
        workspace_id: workspaceId,
        entity_type: entity,
        competence_month: month,
        calculated_at: now,
        calculated_by: actorId,
        metadata: {
          report,
          engine_version: 'billing-dre-v2-management',
          closed_source: 'snapshot',
          revenue_cents: report.revenue_cents,
          variable_cost_cents: report.variable_cost_cents,
          fixed_cost_cents: report.fixed_cost_cents,
          tax_cents: report.tax_cents,
          result_cents: report.result_cents,
          management_summary: report.management_summary,
          warnings: report.warnings,
        },
      },
      { onConflict: 'workspace_id,entity_type,competence_month' }
    )
    .select('id')
    .single();
  if (snapErr) throw new Error(snapErr.message);

  await supabase.from('billing_dre_snapshot_lines').delete().eq('snapshot_id', snapshot.id);

  const lines: {
    snapshot_id: string;
    dre_account_id: string;
    pharmacy_id: string | null;
    amount_cents: number;
    source_type: string;
    source_meta: Record<string, unknown>;
  }[] = [];

  for (const line of report.consolidated) {
    lines.push({
      snapshot_id: snapshot.id,
      dre_account_id: line.account_id,
      pharmacy_id: null,
      amount_cents: line.amount_cents,
      source_type: 'consolidated',
      source_meta: { account_code: line.account_code },
    });
  }

  for (const ph of report.pharmacies) {
    const entries: { code: string; field: keyof DrePharmacyRow }[] =
      entity === 'coop'
        ? [
            { code: 'C-REV', field: 'revenue_cents' },
            { code: 'C-CV-REP', field: 'variable_cost_cents' },
            { code: 'C-CF-ADM', field: 'fixed_cost_cents' },
            { code: 'C-IMP-ISS', field: 'tax_cents' },
          ]
        : [
            { code: 'F-REV', field: 'revenue_cents' },
            { code: 'F-CV-LID', field: 'variable_cost_cents' },
            { code: 'F-CF-ADM', field: 'fixed_cost_cents' },
            { code: 'F-IMP-SNP', field: 'tax_cents' },
          ];

    for (const e of entries) {
      const cents = Number(ph[e.field]) || 0;
      if (e.field === 'variable_cost_cents' || e.field === 'fixed_cost_cents' || e.field === 'tax_cents') {
        if (cents === 0) continue;
      }
      const acc = accountForEntity(accounts, entity, e.code);
      lines.push({
        snapshot_id: snapshot.id,
        dre_account_id: acc.id,
        pharmacy_id: ph.pharmacy_id,
        amount_cents: cents,
        source_type: 'pharmacy',
        source_meta: { account_code: e.code, pharmacy_name: ph.pharmacy_name },
      });
    }

    const resAcc = accountForEntity(accounts, entity, entity === 'coop' ? 'C-RES' : 'F-RES');
    lines.push({
      snapshot_id: snapshot.id,
      dre_account_id: resAcc.id,
      pharmacy_id: ph.pharmacy_id,
      amount_cents: ph.result_cents,
      source_type: 'pharmacy_result',
      source_meta: { pharmacy_name: ph.pharmacy_name },
    });
  }

  if (lines.length) {
    const { error: lineErr } = await supabase.from('billing_dre_snapshot_lines').insert(lines);
    if (lineErr) throw new Error(lineErr.message);
  }
}

export async function loadClosedDreSnapshotReport(
  workspaceId: string,
  month: string,
  entity: DreEntityType,
  options: { cost_center_id?: string | null } = {}
): Promise<DreReport | null> {
  if (options.cost_center_id) return null;

  const { data: period, error: periodErr } = await supabase
    .from('billing_dre_periods')
    .select('status')
    .eq('workspace_id', workspaceId)
    .eq('entity_type', entity)
    .eq('competence_month', month)
    .maybeSingle();
  if (periodErr) throw new Error(periodErr.message);
  if (period?.status !== 'closed') return null;

  const { data: snapshot, error: snapshotErr } = await supabase
    .from('billing_dre_snapshots')
    .select('metadata')
    .eq('workspace_id', workspaceId)
    .eq('entity_type', entity)
    .eq('competence_month', month)
    .maybeSingle();
  if (snapshotErr) throw new Error(snapshotErr.message);

  const metadata = snapshot?.metadata as { report?: DreReport } | null;
  if (!metadata?.report) return null;
  return {
    ...metadata.report,
    period_status: 'closed',
  };
}

export async function closeDrePeriod(
  workspaceId: string,
  month: string,
  entity: DreEntityType,
  actorId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('billing_dre_periods').upsert(
    {
      workspace_id: workspaceId,
      entity_type: entity,
      competence_month: month,
      status: 'closed',
      closed_at: now,
      closed_by: actorId,
      updated_at: now,
    },
    { onConflict: 'workspace_id,entity_type,competence_month' }
  );
  if (error) throw new Error(error.message);
}

export async function reopenDrePeriod(workspaceId: string, month: string, entity: DreEntityType): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('billing_dre_periods')
    .upsert(
      {
        workspace_id: workspaceId,
        entity_type: entity,
        competence_month: month,
        status: 'open',
        closed_at: null,
        closed_by: null,
        updated_at: now,
      },
      { onConflict: 'workspace_id,entity_type,competence_month' }
    );
  if (error) throw new Error(error.message);
}
