import {
  computeAbsenceMgDiscount,
  computeSharedPoolDeliverySettlement,
  resolveSplitPercentages,
  splitAmountCents,
  DAILY_PAY_TRACK_FINANCIAL_DAILY,
} from '@plataforma/billing-engine';
import {
  mergeDiscountRulesFromJson,
  primarySettlementWeekdayUi,
  uiWeekdayToJsDay,
} from '@plataforma/financial-cycle';
import { supabase } from './supabase';
import { loadEntryTypes } from './financialEntryTypes';
import { addBillingAuditNotification, clearCycleAuditNotifications } from './billingAuditNotifications';
import {
  computeSettlementPayoutBreakdown,
  DRE_SCOPE_OPERATIONAL,
  DRE_SCOPE_OUTSIDE_MARGIN,
  isBillingCapitalSeparationEnabled,
  isFinancialCoopDiscountSlug,
  settlementLineMetadata,
} from './billingCapitalSeparation';
import {
  applyContractedDailyAllocations,
  financialDailyBelongsToCycle,
} from './billingContractedDaily';
import {
  isReopenableSettlementStatus,
  pharmacySettlementsReopenBlocker,
  reopenInvoiceBlocker,
  reopenPayableBlocker,
} from './billingSettlementReopen';
import {
  registerDailySettlementAllocation,
} from './billingDailySettlementAllocation';
import {
  applyManualDiscountSnapshots,
  loadManualDiscountSnapshots,
  type ManualDiscountSnapshot,
} from './billingSettlementManualDiscount';
import { computePairDeliverySettlement, isContractedDailyEligible, isFixedMgEligible } from './billingSettlementMgEligibility';
import {
  applySettlementExclusionOverlay,
  driverIsFullyExcluded,
  type SettlementExclusion,
} from './billingSettlementExclusionOverlay';
import { loadSettlementExclusions } from './billingSettlementExclusions';
import { loadApprovedOffboardingLastWorkedAt } from './billingSettlementLastWorked';
import { dayBaseLinesForPair, loadDayBaseDayOverlays } from './billingSettlementDayBase';
import { applyMgMultiplierToLines, loadMgOverlays } from './billingSettlementMgOverlay';
import {
  computeLinkActiveDays,
  dateOnly,
  daysInclusive,
  findSameDayMgOverlaps,
  overlapDays,
  prorateCents,
} from './billingSettlementOverlap';

export type RecalculateCycleOptions = {
  pharmacyId?: string;
};

export type BillingCycleRow = {
  id: string;
  workspace_id: string;
  label: string | null;
  apuracao_start: string;
  apuracao_end: string;
  payment_date: string | null;
  status: 'open' | 'closed';
};

type PharmacyBillingRow = {
  id: string;
  name: string;
  delivery_fee_cents: number | null;
  delivery_fee_driver_payout_cents: number | null;
  minimum_guaranteed_cents: number | null;
  minimum_guaranteed_driver_payout_cents: number | null;
  mg_enabled: boolean;
  minimum_deliveries_count: number | null;
  contract_scope: 'flux_only' | 'coop_only' | 'both';
  split_coop_pct: number | null;
  split_flux_pct: number | null;
  billing_cost_center_id: string | null;
  billing_cost_centers: { split_coop_pct: number; split_flux_pct: number } | null;
  mg_mode: 'per_driver' | 'shared_pool';
  mg_pool_split_rule: 'equal' | 'by_deliveries';
  status: 'active' | 'inactive';
  daily_billing_enabled: boolean;
  daily_billing_rule: 'per_driver_delivery_day' | 'fixed_per_driver_cycle';
  daily_billing_quantity: number | null;
  daily_billing_pharmacy_amount_cents: number | null;
  daily_billing_driver_payout_cents: number | null;
  driver_day_base_enabled: boolean;
  driver_day_base_cents: number;
};

type SettlementLineInsert = {
  kind: string;
  description: string | null;
  pharmacy_amount_cents: number;
  driver_amount_cents: number;
  metadata?: Record<string, unknown>;
};

const VERIFIED_ENTRY_STATUSES = ['approved', 'active', 'settled'];
const DELIVERY_PAGE_SIZE = 1000;
const LINK_PAGE_SIZE = 1000;
const PHARMACY_BILLING_SELECT =
  'id, trade_name, legal_name, status, delivery_fee_cents, delivery_fee_driver_payout_cents, minimum_guaranteed_cents, minimum_guaranteed_driver_payout_cents, mg_enabled, minimum_deliveries_count, mg_mode, mg_pool_split_rule, contract_scope, split_coop_pct, split_flux_pct, billing_cost_center_id, daily_billing_enabled, daily_billing_rule, daily_billing_quantity, daily_billing_pharmacy_amount_cents, daily_billing_driver_payout_cents, driver_day_base_enabled, driver_day_base_cents, billing_cost_centers!billing_cost_center_id(split_coop_pct, split_flux_pct)';

type SettlementDeliveryRow = {
  driver_id: string;
  pharmacy_id: string;
  delivered_at: string;
};

type FixedMgEligibility = {
  driverId: string;
  pharmacyId: string;
  activeDays: number;
  totalCycleDays: number;
  startedAt: string | null;
  endedAt: string | null;
  lastWorkedAt: string | null;
  endedAtCadastro: string | null;
};

type DriverPharmacyLink = {
  driverId: string;
  pharmacyId: string;
  startedAt: string | null;
  endedAt: string | null;
};

type FinancialDaily = {
  entry_id: string;
  driver_id: string;
  amount_cents: number;
  pharmacy_charge_cents: number;
  pharmacy_id: string | null;
  description: string | null;
  treatment: 'charge_pharmacy' | 'absorb_operation' | 'pending_audit';
  event_date: string | null;
};

type DailyChargeAllocation = {
  pharmacyId: string;
  line: SettlementLineInsert;
};

type DailyAllocationWarning = {
  pharmacyId: string | null;
  driverId: string;
  code: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
};

type DailyShareGroup = {
  id: string;
  name: string;
  billingCostCenterId: string | null;
  billingPharmacyId: string | null;
  dailyPharmacyAmountCents: number;
  dailyDriverPayoutCents: number | null;
  allocationRule: 'equal';
  memberPharmacyIds: string[];
};

export function formatCycleLabel(apuracaoStart: string, apuracaoEnd: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  };
  return `${fmt(apuracaoStart)}–${fmt(apuracaoEnd)}`;
}

function paymentDateFromCycle(cycle: BillingCycleRow): string {
  if (cycle.payment_date) return cycle.payment_date.slice(0, 10);
  const end = new Date(`${cycle.apuracao_end}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  return end.toISOString().slice(0, 10);
}

function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function countRows(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count || 0;
}

async function assertCycleCanRecalculate(
  workspaceId: string,
  cycle: BillingCycleRow,
  options?: RecalculateCycleOptions
): Promise<void> {
  const cycleId = cycle.id;
  const pharmacyId = options?.pharmacyId;
  const competenceMonth = String(cycle.apuracao_end).slice(0, 7);
  const blockers: string[] = [];

  let approvedSettlementsQuery = supabase
    .from('billing_settlements')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .in('status', ['approved', 'paid']);
  if (pharmacyId) approvedSettlementsQuery = approvedSettlementsQuery.eq('pharmacy_id', pharmacyId);
  const approvedSettlements = await countRows(approvedSettlementsQuery);
  if (approvedSettlements) {
    blockers.push(
      pharmacyId
        ? `${approvedSettlements} acerto(s) aprovado(s) ou pago(s) nesta farmácia`
        : `${approvedSettlements} acerto(s) aprovado(s) ou pago(s)`
    );
  }

  let lockedInvoicesQuery = supabase
    .from('billing_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .neq('status', 'draft');
  if (pharmacyId) lockedInvoicesQuery = lockedInvoicesQuery.eq('pharmacy_id', pharmacyId);
  const lockedInvoices = await countRows(lockedInvoicesQuery);
  if (lockedInvoices) {
    blockers.push(
      pharmacyId
        ? `${lockedInvoices} fatura(s) não-rascunho desta farmácia`
        : `${lockedInvoices} fatura(s) não-rascunho`
    );
  }

  if (!pharmacyId) {
    const generatedPayables = await countRows(
      supabase
        .from('billing_payables')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('billing_cycle_id', cycleId)
    );
    if (generatedPayables) blockers.push(`${generatedPayables} título(s) em A pagar`);

    const pixExports = await countRows(
      supabase
        .from('billing_payment_batch_exports')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('billing_cycle_id', cycleId)
    );
    if (pixExports) blockers.push(`${pixExports} lote(s) PIX exportado(s)`);
  }

  const closedDrePeriods = await countRows(
    supabase
      .from('billing_dre_periods')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('competence_month', competenceMonth)
      .eq('status', 'closed')
  );
  if (closedDrePeriods) blockers.push(`DRE fechado na competência ${competenceMonth}`);

  if (blockers.length) {
    throw new Error(
      `Recálculo bloqueado para preservar histórico financeiro. Reabra/estorne os marcos antes de recalcular: ${blockers.join('; ')}.`
    );
  }
}

function paymentDatesInWeek(weekStartIso: string, daysOfWeekUi: number[]): string[] {
  const monday = new Date(`${weekStartIso}T12:00:00.000Z`);
  return daysOfWeekUi.map((uiDay) => {
    const js = uiWeekdayToJsDay(uiDay);
    const offset = (js + 7 - 1) % 7;
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  });
}

function cents(n: number | null | undefined): number {
  return Math.max(0, Math.round(Number(n) || 0));
}

function moneyToCents(amount: number): number {
  return Math.round(amount * 100);
}

function divideCents(totalCents: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

async function loadCycleDeliveries(workspaceId: string, cycleId: string): Promise<SettlementDeliveryRow[]> {
  const rows: SettlementDeliveryRow[] = [];
  for (let from = 0; ; from += DELIVERY_PAGE_SIZE) {
    const to = from + DELIVERY_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('billing_delivery_records')
      .select('driver_id, pharmacy_id, delivered_at')
      .eq('workspace_id', workspaceId)
      .eq('billing_cycle_id', cycleId)
      .eq('cancelled', false)
      .range(from, to);
    if (error) throw new Error(error.message);
    rows.push(...((data || []) as SettlementDeliveryRow[]));
    if (!data || data.length < DELIVERY_PAGE_SIZE) break;
  }
  return rows;
}

async function loadFixedLinkOverlaps(
  workspaceId: string,
  apuracaoStart: string,
  apuracaoEnd: string
): Promise<{
  mgEligibilities: FixedMgEligibility[];
  contractedDailyEligibilities: FixedMgEligibility[];
  lastWorkedMismatches: FixedMgEligibility[];
}> {
  const linkRows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += LINK_PAGE_SIZE) {
    const to = from + LINK_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('driver_pharmacy_links')
      .select(
        `
      driver_id,
      pharmacy_id,
      is_active,
      started_at,
      ended_at,
      drivers!inner(id, status, driver_type, inactive_at),
      pharmacies!inner(id, status, mg_enabled)
    `
      )
      .eq('workspace_id', workspaceId)
      .or(`started_at.is.null,started_at.lte.${apuracaoEnd}`)
      .or(`ended_at.is.null,ended_at.gte.${apuracaoStart}`)
      .range(from, to);
    if (error) throw new Error(error.message);
    linkRows.push(...((data || []) as Array<Record<string, unknown>>));
    if (!data || data.length < LINK_PAGE_SIZE) break;
  }

  const lastWorkedByDriver = await loadApprovedOffboardingLastWorkedAt(workspaceId);
  const totalCycleDays = daysInclusive(apuracaoStart, apuracaoEnd);
  const mgEligibilities: FixedMgEligibility[] = [];
  const contractedDailyEligibilities: FixedMgEligibility[] = [];
  const lastWorkedMismatches: FixedMgEligibility[] = [];
  for (const row of linkRows) {
    const driverRaw = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
    const pharmacyRaw = Array.isArray(row.pharmacies) ? row.pharmacies[0] : row.pharmacies;
    const driver = driverRaw as { status?: string | null; driver_type?: string | null; inactive_at?: string | null } | null;
    const pharmacy = pharmacyRaw as { status?: string | null; mg_enabled?: boolean | null } | null;
    if (!driver || !pharmacy) continue;
    const startedAt = dateOnly(row.started_at as string | null);
    const endedAtCadastro = dateOnly(row.ended_at as string | null);
    const lastWorkedAt = lastWorkedByDriver.get(String(row.driver_id)) || null;
    // last_worked_at do desligamento manda mesmo se o vínculo ainda está is_active.
    // Emprego anterior (last_worked_at < started_at) já é ignorado em resolveOperationalLastDay.
    if (row.is_active === false && !endedAtCadastro && !lastWorkedAt) continue;
    const overlap = computeLinkActiveDays({
      cycleStart: apuracaoStart,
      cycleEnd: apuracaoEnd,
      startedAt,
      lastWorkedAt,
      endedAt: endedAtCadastro,
      inactiveAt: driver.inactive_at,
    });
    const eligibility: FixedMgEligibility = {
      driverId: String(row.driver_id),
      pharmacyId: String(row.pharmacy_id),
      activeDays: overlap.activeDays,
      totalCycleDays,
      startedAt,
      endedAt: overlap.lastDay,
      lastWorkedAt,
      endedAtCadastro,
    };
    if (lastWorkedAt && endedAtCadastro && lastWorkedAt !== endedAtCadastro) {
      lastWorkedMismatches.push(eligibility);
    }
    if (overlap.activeDays <= 0) continue;
    const eligibilityInput = {
      driverType: driver.driver_type,
      driverStatus: driver.status,
      inactiveAt: driver.inactive_at,
      linkIsActive: row.is_active === true,
      pharmacyStatus: pharmacy.status,
      pharmacyMgEnabled: pharmacy.mg_enabled,
      activeDays: overlap.activeDays,
      cycleEnd: apuracaoEnd,
    };
    if (isFixedMgEligible(eligibilityInput)) mgEligibilities.push(eligibility);
    if (isContractedDailyEligible(eligibilityInput)) contractedDailyEligibilities.push(eligibility);
  }
  return { mgEligibilities, contractedDailyEligibilities, lastWorkedMismatches };
}

async function loadActiveDriverPharmacyLinks(
  workspaceId: string,
  driverIds: string[],
  apuracaoStart: string,
  apuracaoEnd: string
): Promise<DriverPharmacyLink[]> {
  if (!driverIds.length) return [];
  const { data, error } = await supabase
    .from('driver_pharmacy_links')
    .select('driver_id, pharmacy_id, is_active, started_at, ended_at')
    .eq('workspace_id', workspaceId)
    .in('driver_id', driverIds)
    .or(`started_at.is.null,started_at.lte.${apuracaoEnd}`)
    .or(`ended_at.is.null,ended_at.gte.${apuracaoStart}`);
  if (error) throw new Error(error.message);

  const lastWorkedByDriver = await loadApprovedOffboardingLastWorkedAt(workspaceId, driverIds);
  const out: DriverPharmacyLink[] = [];
  for (const row of data || []) {
    const startedAt = dateOnly(row.started_at);
    const endedAt = dateOnly(row.ended_at);
    const lastWorkedAt = lastWorkedByDriver.get(String(row.driver_id)) || null;
    if (row.is_active === false && !endedAt && !lastWorkedAt) continue;
    const overlap = computeLinkActiveDays({
      cycleStart: apuracaoStart,
      cycleEnd: apuracaoEnd,
      startedAt,
      lastWorkedAt,
      endedAt,
    });
    if (overlap.activeDays <= 0) continue;
    out.push({
      driverId: String(row.driver_id),
      pharmacyId: String(row.pharmacy_id),
      startedAt,
      endedAt: overlap.lastDay,
    });
  }
  return out;
}

async function loadDailyShareGroups(
  workspaceId: string,
  apuracaoStart: string,
  apuracaoEnd: string
): Promise<DailyShareGroup[]> {
  const { data, error } = await supabase
    .from('billing_daily_share_groups')
    .select(
      `
      id, name, billing_cost_center_id, billing_pharmacy_id, daily_pharmacy_amount_cents,
      daily_driver_payout_cents, allocation_rule, active,
      billing_daily_share_group_pharmacies(pharmacy_id, active, started_at, ended_at)
    `
    )
    .eq('workspace_id', workspaceId)
    .eq('active', true);
  if (error) throw new Error(error.message);

  const out: DailyShareGroup[] = [];
  for (const row of data || []) {
    const members = (row.billing_daily_share_group_pharmacies || []) as Array<{
      pharmacy_id?: string | null;
      active?: boolean | null;
      started_at?: string | null;
      ended_at?: string | null;
    }>;
    const memberPharmacyIds = members
      .filter((member) => {
        if (!member.pharmacy_id || member.active === false) return false;
        return overlapDays(apuracaoStart, apuracaoEnd, dateOnly(member.started_at), dateOnly(member.ended_at)) > 0;
      })
      .map((member) => String(member.pharmacy_id));
    out.push({
      id: String(row.id),
      name: String(row.name || row.id),
      billingCostCenterId: row.billing_cost_center_id ? String(row.billing_cost_center_id) : null,
      billingPharmacyId: row.billing_pharmacy_id ? String(row.billing_pharmacy_id) : null,
      dailyPharmacyAmountCents: cents(row.daily_pharmacy_amount_cents),
      dailyDriverPayoutCents: row.daily_driver_payout_cents != null ? cents(row.daily_driver_payout_cents) : null,
      allocationRule: 'equal',
      memberPharmacyIds,
    });
  }
  return out;
}

function pairKey(driverId: string, pharmacyId: string): string {
  return `${driverId}:${pharmacyId}`;
}

function groupLinksByDriver(links: DriverPharmacyLink[]): Map<string, DriverPharmacyLink[]> {
  const byDriver = new Map<string, DriverPharmacyLink[]>();
  for (const link of links) {
    const list = byDriver.get(link.driverId) || [];
    list.push(link);
    byDriver.set(link.driverId, list);
  }
  return byDriver;
}

function mapDiscountKind(type: string): SettlementLineInsert['kind'] {
  if (type === 'quota') return 'quota';
  if (type === 'advance') return 'advance';
  if (type === 'uniform') return 'uniform';
  if (type === 'bag') return 'bag';
  return 'other_discount';
}

function normalizePharmacyBillingRow(p: Record<string, unknown>): PharmacyBillingRow {
  const rawCc = p.billing_cost_centers as { split_coop_pct: number; split_flux_pct: number } | { split_coop_pct: number; split_flux_pct: number }[] | null;
  const cc = Array.isArray(rawCc) ? rawCc[0] ?? null : rawCc;
  return {
    id: String(p.id),
    name: String(p.trade_name || p.legal_name || p.id),
    delivery_fee_cents: p.delivery_fee_cents as number | null,
    delivery_fee_driver_payout_cents: p.delivery_fee_driver_payout_cents as number | null,
    minimum_guaranteed_cents: p.minimum_guaranteed_cents as number | null,
    minimum_guaranteed_driver_payout_cents: p.minimum_guaranteed_driver_payout_cents as number | null,
    mg_enabled: p.mg_enabled !== false,
    minimum_deliveries_count: p.minimum_deliveries_count as number | null,
    contract_scope: (p.contract_scope as PharmacyBillingRow['contract_scope']) || 'both',
    split_coop_pct: p.split_coop_pct as number | null,
    split_flux_pct: p.split_flux_pct as number | null,
    billing_cost_center_id: p.billing_cost_center_id ? String(p.billing_cost_center_id) : null,
    billing_cost_centers: cc,
    mg_mode: (p.mg_mode as PharmacyBillingRow['mg_mode']) || 'per_driver',
    mg_pool_split_rule: (p.mg_pool_split_rule as PharmacyBillingRow['mg_pool_split_rule']) || 'by_deliveries',
    status: (p.status as PharmacyBillingRow['status']) || 'active',
    daily_billing_enabled: p.daily_billing_enabled === true,
    daily_billing_rule:
      (p.daily_billing_rule as PharmacyBillingRow['daily_billing_rule']) || 'per_driver_delivery_day',
    daily_billing_quantity: p.daily_billing_quantity as number | null,
    daily_billing_pharmacy_amount_cents: p.daily_billing_pharmacy_amount_cents as number | null,
    daily_billing_driver_payout_cents: p.daily_billing_driver_payout_cents as number | null,
    driver_day_base_enabled: p.driver_day_base_enabled === true,
    driver_day_base_cents: Math.max(0, Number(p.driver_day_base_cents ?? 7000)),
  };
}

/**
 * Diárias do Financeiro cobram a farmácia no acerto, mas o repasse ao entregador
 * fica na trilha `financial_daily` (PIX terça / pagamento-pix-diarias), não no AP semanal.
 */
function financialDailySettlementLine(line: SettlementLineInsert): SettlementLineInsert {
  const excludedDriverCents = line.driver_amount_cents;
  return {
    ...line,
    driver_amount_cents: 0,
    metadata: {
      ...(line.metadata || {}),
      pay_track: DAILY_PAY_TRACK_FINANCIAL_DAILY,
      driver_payout_track: DAILY_PAY_TRACK_FINANCIAL_DAILY,
      settlement_driver_amount_excluded_cents: excludedDriverCents,
    },
  };
}

function resolveDailyChargeAllocation(input: {
  daily: FinancialDaily;
  pharmacyById: Map<string, PharmacyBillingRow>;
  driverLinksByDriver: Map<string, DriverPharmacyLink[]>;
  dailyShareGroups: DailyShareGroup[];
}): { allocations: DailyChargeAllocation[]; warnings: DailyAllocationWarning[] } {
  const { daily, pharmacyById, driverLinksByDriver, dailyShareGroups } = input;
  const warnings: DailyAllocationWarning[] = [];
  const linkedPharmacies = (driverLinksByDriver.get(daily.driver_id) || [])
    .map((link) => pharmacyById.get(link.pharmacyId))
    .filter((pharmacy): pharmacy is PharmacyBillingRow => Boolean(pharmacy && pharmacy.status === 'active'));
  const directPharmacy = daily.pharmacy_id ? pharmacyById.get(daily.pharmacy_id) || null : null;
  const fallbackPharmacy = directPharmacy || linkedPharmacies[0] || null;
  const candidatePharmacyIds = directPharmacy
    ? [directPharmacy.id]
    : linkedPharmacies.map((pharmacy) => pharmacy.id);
  const candidateGroups = dailyShareGroups.filter((group) =>
    group.memberPharmacyIds.some((pharmacyId) => candidatePharmacyIds.includes(pharmacyId))
  );

  const warningBase = {
    driverId: daily.driver_id,
    metadata: {
      financial_entry_id: daily.entry_id,
      driver_amount_cents: daily.amount_cents,
      pharmacy_id: daily.pharmacy_id,
      billing_treatment: daily.treatment,
    },
  };

  if (daily.treatment === 'absorb_operation') {
    if (!fallbackPharmacy) {
      warnings.push({
        ...warningBase,
        pharmacyId: null,
        code: 'DAILY_WITHOUT_PHARMACY_LINK',
        title: 'Diária sem vínculo de farmácia',
        message: 'Diária absorvida pela operação não encontrou farmácia vinculada para compor o acerto do entregador.',
      });
      return { allocations: [], warnings };
    }
    return {
      warnings,
      allocations: [
        {
          pharmacyId: fallbackPharmacy.id,
          line: financialDailySettlementLine({
            kind: 'daily',
            description: daily.description || 'Diária absorvida pela operação',
            pharmacy_amount_cents: 0,
            driver_amount_cents: daily.amount_cents,
            metadata: {
              ...warningBase.metadata,
              allocation_rule: 'operation_absorbed',
              allocated_pharmacy_ids: [fallbackPharmacy.id],
            },
          }),
        },
      ],
    };
  }

  const buildFallbackAllocation = (pharmacy: PharmacyBillingRow, code: string): DailyChargeAllocation => ({
    pharmacyId: pharmacy.id,
    line: financialDailySettlementLine({
      kind: 'daily',
      description: daily.description || 'Diária pendente de auditoria',
      pharmacy_amount_cents: daily.treatment === 'charge_pharmacy' ? daily.pharmacy_charge_cents : 0,
      driver_amount_cents: daily.amount_cents,
      metadata: {
        ...warningBase.metadata,
        allocation_rule: code,
        allocated_pharmacy_ids: [pharmacy.id],
      },
    }),
  });

  if (daily.treatment === 'charge_pharmacy' && directPharmacy && candidateGroups.length === 0) {
    return { warnings, allocations: [buildFallbackAllocation(directPharmacy, 'direct_pharmacy_without_group')] };
  }

  if (candidateGroups.length === 0) {
    warnings.push({
      ...warningBase,
      pharmacyId: fallbackPharmacy?.id || null,
      code: 'DAILY_WITHOUT_SHARE_GROUP',
      title: 'Diária sem grupo de rateio',
      message:
        'Diária aprovada não encontrou grupo de rateio ativo. Sem grupo, a cobrança não será rateada automaticamente.',
    });
    return {
      warnings,
      allocations: fallbackPharmacy ? [buildFallbackAllocation(fallbackPharmacy, 'fallback_without_share_group')] : [],
    };
  }

  if (candidateGroups.length > 1) {
    warnings.push({
      ...warningBase,
      pharmacyId: fallbackPharmacy?.id || null,
      code: 'DAILY_MULTIPLE_SHARE_GROUPS',
      title: 'Diária com múltiplos grupos possíveis',
      message:
        'Entregador/farmácia possui mais de um grupo de rateio possível. Defina a farmácia do lançamento ou revise os grupos antes de faturar.',
      metadata: {
        ...warningBase.metadata,
        group_ids: candidateGroups.map((group) => group.id),
        candidate_pharmacy_ids: candidatePharmacyIds,
      },
    });
    return {
      warnings,
      allocations: fallbackPharmacy ? [buildFallbackAllocation(fallbackPharmacy, 'fallback_multiple_share_groups')] : [],
    };
  }

  const group = candidateGroups[0]!;
  const memberPharmacies = group.memberPharmacyIds
    .map((pharmacyId) => pharmacyById.get(pharmacyId))
    .filter((pharmacy): pharmacy is PharmacyBillingRow => Boolean(pharmacy && pharmacy.status === 'active'));

  if (!memberPharmacies.length) {
    warnings.push({
      ...warningBase,
      pharmacyId: fallbackPharmacy?.id || null,
      code: 'DAILY_SHARE_GROUP_WITHOUT_MEMBERS',
      title: 'Grupo de rateio sem membros ativos',
      message: 'Grupo de rateio encontrado, mas sem farmácias ativas vigentes no ciclo.',
      metadata: {
        ...warningBase.metadata,
        group_id: group.id,
      },
    });
    return {
      warnings,
      allocations: fallbackPharmacy ? [buildFallbackAllocation(fallbackPharmacy, 'fallback_group_without_members')] : [],
    };
  }

  if (directPharmacy && !group.memberPharmacyIds.includes(directPharmacy.id)) {
    warnings.push({
      ...warningBase,
      pharmacyId: directPharmacy.id,
      code: 'DAILY_PHARMACY_OUTSIDE_SHARE_GROUP',
      title: 'Farmácia fora do grupo de rateio',
      message: 'A farmácia informada no lançamento não pertence ao grupo de rateio resolvido.',
      metadata: {
        ...warningBase.metadata,
        group_id: group.id,
        group_pharmacy_ids: group.memberPharmacyIds,
      },
    });
  }

  const totalChargeCents = daily.treatment === 'charge_pharmacy' ? daily.pharmacy_charge_cents : group.dailyPharmacyAmountCents;
  if (totalChargeCents <= 0) {
    warnings.push({
      ...warningBase,
      pharmacyId: fallbackPharmacy?.id || memberPharmacies[0]?.id || null,
      code: 'DAILY_SHARE_GROUP_WITHOUT_VALUE',
      title: 'Grupo de rateio sem valor de cobrança',
      message: 'Grupo de rateio não possui valor de diária para cobrar da farmácia.',
      metadata: {
        ...warningBase.metadata,
        group_id: group.id,
      },
    });
  }

  const amountParts = divideCents(totalChargeCents, memberPharmacies.length);
  return {
    warnings,
    allocations: memberPharmacies.map((pharmacy, index) => ({
      pharmacyId: pharmacy.id,
      line: financialDailySettlementLine({
        kind: 'daily',
        description: daily.description || `Diária rateada por grupo (${group.name})`,
        pharmacy_amount_cents: amountParts[index] || 0,
        driver_amount_cents: index === 0 ? daily.amount_cents : 0,
        metadata: {
          ...warningBase.metadata,
          group_id: group.id,
          group_name: group.name,
          cost_center_id: group.billingCostCenterId,
          billing_pharmacy_id: group.billingPharmacyId,
          allocation_rule: 'equal_daily_share_group',
          allocated_pharmacy_ids: memberPharmacies.map((item) => item.id),
          daily_total_cents: totalChargeCents,
          allocation_index: index + 1,
          allocation_parts: memberPharmacies.length,
        },
      }),
    })),
  };
}

function manualDiscountPairKey(driverId: string, pharmacyId: string): string {
  return `${driverId}:${pharmacyId}`;
}

function manualDiscountPharmacyKey(pharmacyId: string): string {
  return pharmacyId;
}

async function deleteCycleSettlements(cycleId: string, pharmacyId?: string): Promise<void> {
  let query = supabase.from('billing_settlements').delete().eq('billing_cycle_id', cycleId);
  if (pharmacyId) query = query.eq('pharmacy_id', pharmacyId);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export async function recalculateCycleSettlements(
  workspaceId: string,
  cycleId: string,
  options?: RecalculateCycleOptions
): Promise<{ settlements: number }> {
  const pharmacyId = options?.pharmacyId;
  const { data: cycle, error: cycleErr } = await supabase
    .from('billing_cycles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', cycleId)
    .maybeSingle();
  if (cycleErr) throw new Error(cycleErr.message);
  if (!cycle) throw new Error('Ciclo não encontrado');

  const cycleRow = cycle as BillingCycleRow;
  const apuracaoStart = String(cycleRow.apuracao_start).slice(0, 10);
  const apuracaoEnd = String(cycleRow.apuracao_end).slice(0, 10);
  const paymentDate = paymentDateFromCycle(cycleRow);

  await assertCycleCanRecalculate(workspaceId, cycleRow, options);
  await assignDeliveriesToCycle(workspaceId, cycleId, apuracaoStart, apuracaoEnd);
  await clearCycleAuditNotifications(workspaceId, cycleId, pharmacyId);

  const preservedManualDiscounts = await loadManualDiscountSnapshots(workspaceId, cycleId, pharmacyId);
  const preservedExclusions = await loadSettlementExclusions(workspaceId, cycleId, pharmacyId);
  const dayBaseOverlays = await loadDayBaseDayOverlays(workspaceId, cycleId, pharmacyId);
  const mgOverlays = await loadMgOverlays(workspaceId, cycleId, pharmacyId);
  const mgOverlayByPair = new Map(mgOverlays.map((row) => [`${row.driverId}:${row.pharmacyId}`, row]));
  const exclusionsByPharmacy = new Map<string, SettlementExclusion[]>();
  for (const exclusion of preservedExclusions) {
    const list = exclusionsByPharmacy.get(exclusion.pharmacyId) || [];
    list.push(exclusion);
    exclusionsByPharmacy.set(exclusion.pharmacyId, list);
  }
  const manualDiscountsByPair = new Map<string, ManualDiscountSnapshot[]>();
  const manualDiscountsByPharmacy = new Map<string, ManualDiscountSnapshot[]>();
  for (const snapshot of preservedManualDiscounts) {
    if (snapshot.scope === 'pharmacy_group') {
      const key = manualDiscountPharmacyKey(snapshot.pharmacy_id);
      const list = manualDiscountsByPharmacy.get(key) || [];
      list.push(snapshot);
      manualDiscountsByPharmacy.set(key, list);
      continue;
    }
    const key = manualDiscountPairKey(String(snapshot.driver_id || ''), snapshot.pharmacy_id);
    const list = manualDiscountsByPair.get(key) || [];
    list.push(snapshot);
    manualDiscountsByPair.set(key, list);
  }

  const deliveries = await loadCycleDeliveries(workspaceId, cycleId);
  const {
    mgEligibilities: fixedEligibilities,
    contractedDailyEligibilities,
    lastWorkedMismatches,
  } = await loadFixedLinkOverlaps(
    workspaceId,
    apuracaoStart,
    apuracaoEnd
  );
  const fixedEligibilityByPair = new Map<string, FixedMgEligibility>();
  const dailyWindowStart = shiftIsoDate(apuracaoStart, -7);
  const dailyWindowEnd = shiftIsoDate(apuracaoEnd, 7);
  const { data: allDailyRows, error: allDailyErr } = await supabase
    .from('financial_entries')
    .select('id, driver_id, total_amount, status, start_date, event_date, description, pharmacy_id, daily_billing_treatment, daily_pharmacy_charge_amount')
    .eq('workspace_id', workspaceId)
    .eq('type', 'daily')
    .or(
      [
        `and(start_date.gte.${dailyWindowStart},start_date.lte.${dailyWindowEnd})`,
        `and(event_date.gte.${apuracaoStart},event_date.lte.${apuracaoEnd})`,
      ].join(',')
    );
  if (allDailyErr) throw new Error(allDailyErr.message);

  const pairCounts = new Map<string, number>();
  for (const row of deliveries) {
    const key = pairKey(String(row.driver_id), String(row.pharmacy_id));
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  for (const eligibility of fixedEligibilities) {
    const key = pairKey(eligibility.driverId, eligibility.pharmacyId);
    fixedEligibilityByPair.set(key, eligibility);
    if (!pairCounts.has(key)) pairCounts.set(key, 0);
  }
  const operationalPairs = new Set(pairCounts.keys());
  for (const overlay of dayBaseOverlays) {
    const key = pairKey(overlay.driverId, overlay.pharmacyId);
    if (!pairCounts.has(key)) pairCounts.set(key, 0);
  }
  const financialDailies: FinancialDaily[] = [];
  for (const row of allDailyRows || []) {
    if (!row.driver_id || !VERIFIED_ENTRY_STATUSES.includes(String(row.status))) continue;
    if (
      !financialDailyBelongsToCycle({
        eventDate: row.event_date ? String(row.event_date) : null,
        startDate: row.start_date ? String(row.start_date) : null,
        apuracaoStart,
        apuracaoEnd,
      })
    ) {
      continue;
    }
    const treatment =
      row.daily_billing_treatment === 'charge_pharmacy' ||
      row.daily_billing_treatment === 'absorb_operation' ||
      row.daily_billing_treatment === 'pending_audit'
        ? row.daily_billing_treatment
        : 'pending_audit';
    financialDailies.push({
      entry_id: String(row.id),
      driver_id: String(row.driver_id),
      amount_cents: moneyToCents(Number(row.total_amount)),
      pharmacy_charge_cents: treatment === 'charge_pharmacy' ? moneyToCents(Number(row.daily_pharmacy_charge_amount || 0)) : 0,
      pharmacy_id: row.pharmacy_id ? String(row.pharmacy_id) : null,
      description: row.description ? String(row.description) : null,
      treatment,
      event_date: String(row.event_date || row.start_date || '').slice(0, 10) || null,
    });
  }

  const pharmacyIds = [...new Set(deliveries.map((r) => String(r.pharmacy_id)))];
  if (!pharmacyIds.length) {
    const fixedPharmacyIds = [
      ...new Set([
        ...fixedEligibilities.map((r) => r.pharmacyId),
        ...contractedDailyEligibilities.map((r) => r.pharmacyId),
        ...dayBaseOverlays.map((r) => r.pharmacyId),
      ]),
    ];
    if (!fixedPharmacyIds.length && !financialDailies.length && !dayBaseOverlays.length) {
      await deleteCycleSettlements(cycleId, pharmacyId);
      return { settlements: 0 };
    }
    pharmacyIds.push(...fixedPharmacyIds);
  }
  for (const eligibility of [...fixedEligibilities, ...contractedDailyEligibilities]) {
    if (!pharmacyIds.includes(eligibility.pharmacyId)) pharmacyIds.push(eligibility.pharmacyId);
  }
  for (const daily of financialDailies) {
    if (daily.pharmacy_id && !pharmacyIds.includes(daily.pharmacy_id)) pharmacyIds.push(daily.pharmacy_id);
  }
  for (const overlay of dayBaseOverlays) {
    if (!pharmacyIds.includes(overlay.pharmacyId)) pharmacyIds.push(overlay.pharmacyId);
  }
  const dailyDriverIds = [...new Set(financialDailies.map((daily) => daily.driver_id))];
  const dailyLinks = await loadActiveDriverPharmacyLinks(workspaceId, dailyDriverIds, apuracaoStart, apuracaoEnd);
  const driverLinksByDriver = groupLinksByDriver(dailyLinks);
  const dailyShareGroups = await loadDailyShareGroups(workspaceId, apuracaoStart, apuracaoEnd);
  for (const link of dailyLinks) {
    if (!pharmacyIds.includes(link.pharmacyId)) pharmacyIds.push(link.pharmacyId);
  }
  for (const group of dailyShareGroups) {
    for (const pharmacyId of group.memberPharmacyIds) {
      if (!pharmacyIds.includes(pharmacyId)) pharmacyIds.push(pharmacyId);
    }
  }
  if (!pharmacyIds.length) {
    for (const daily of financialDailies) {
      await addBillingAuditNotification({
        workspaceId,
        billingCycleId: cycleId,
        pharmacyId: null,
        driverId: daily.driver_id,
        severity: 'warning',
        code: 'DAILY_WITHOUT_PHARMACY_LINK',
        title: 'Diária sem vínculo de farmácia',
        message: 'Diária aprovada para o entregador não encontrou farmácia no lançamento nem vínculo ativo no ciclo.',
        metadata: { financial_entry_id: daily.entry_id, driver_amount_cents: daily.amount_cents },
      });
    }
    await deleteCycleSettlements(cycleId, pharmacyId);
    return { settlements: 0 };
  }

  const { data: pharmacies, error: phErr } = await supabase
    .from('pharmacies')
    .select(PHARMACY_BILLING_SELECT)
    .eq('workspace_id', workspaceId)
    .in('id', pharmacyIds);
  if (phErr) throw new Error(phErr.message);

  const pharmacyById = new Map<string, PharmacyBillingRow>();
  for (const p of pharmacies || []) {
    const pharmacy = normalizePharmacyBillingRow(p as Record<string, unknown>);
    pharmacyById.set(pharmacy.id, pharmacy);
  }

  const deliveryCountByPharmacy = new Map<string, number>();
  for (const row of deliveries) {
    const pharmacyId = String(row.pharmacy_id);
    deliveryCountByPharmacy.set(pharmacyId, (deliveryCountByPharmacy.get(pharmacyId) || 0) + 1);
  }
  const fixedCountByPharmacy = new Map<string, number>();
  for (const eligibility of fixedEligibilities) {
    fixedCountByPharmacy.set(eligibility.pharmacyId, (fixedCountByPharmacy.get(eligibility.pharmacyId) || 0) + 1);
  }
  for (const pharmacy of pharmacyById.values()) {
    if (pharmacyId && pharmacy.id !== pharmacyId) continue;
    const deliveryCount = deliveryCountByPharmacy.get(pharmacy.id) || 0;
    if (pharmacy.status !== 'active' && deliveryCount > 0) {
      await addBillingAuditNotification({
        workspaceId,
        billingCycleId: cycleId,
        pharmacyId: pharmacy.id,
        severity: 'warning',
        code: 'INACTIVE_PHARMACY_WITH_DELIVERIES',
        title: 'Farmácia inativa com entregas no ciclo',
        message: `${pharmacy.name} está inativa, mas possui ${deliveryCount} entrega(s) importada(s) no ciclo.`,
        metadata: { delivery_count: deliveryCount },
      });
    }
    if (pharmacy.status === 'active' && pharmacy.mg_enabled !== false && (fixedCountByPharmacy.get(pharmacy.id) || 0) === 0) {
      await addBillingAuditNotification({
        workspaceId,
        billingCycleId: cycleId,
        pharmacyId: pharmacy.id,
        severity: 'warning',
        code: 'MG_ENABLED_WITHOUT_FIXED_DRIVERS',
        title: 'MG habilitado sem fixos vinculados',
        message: `${pharmacy.name} tem mínimo garantido habilitado, mas nenhum entregador fixo vigente foi encontrado no ciclo.`,
        metadata: { delivery_count: deliveryCount },
      });
    }
    const pharmacyMg = fixedEligibilities.filter((row) => row.pharmacyId === pharmacy.id);
    if (pharmacyMg.length >= 2) {
      const sameDay = findSameDayMgOverlaps(
        pharmacyMg.map((row) => ({
          driverId: row.driverId,
          startedAt: row.startedAt,
          lastDay: row.endedAt || apuracaoEnd,
          activeDays: row.activeDays,
        })),
        apuracaoStart
      );
      const totalActiveDays = pharmacyMg.reduce((sum, row) => sum + row.activeDays, 0);
      if (sameDay.length || totalActiveDays > (pharmacyMg[0]?.totalCycleDays || 7)) {
        await addBillingAuditNotification({
          workspaceId,
          billingCycleId: cycleId,
          pharmacyId: pharmacy.id,
          severity: 'warning',
          code: 'MG_SAME_DAY_OVERLAP',
          title: 'Dois fixos com MG no mesmo dia',
          message: `${pharmacy.name}: soma dos dias de MG (${totalActiveDays}) ultrapassa o ciclo ou há overlap no mesmo dia. Conferir substituição.`,
          metadata: {
            active_days_sum: totalActiveDays,
            cycle_days: pharmacyMg[0]?.totalCycleDays || 7,
            overlaps: sameDay,
          },
        });
      }
    }
  }

  for (const eligibility of lastWorkedMismatches) {
    if (pharmacyId && eligibility.pharmacyId !== pharmacyId) continue;
    await addBillingAuditNotification({
      workspaceId,
      billingCycleId: cycleId,
      pharmacyId: eligibility.pharmacyId,
      driverId: eligibility.driverId,
      severity: 'info',
      code: 'LAST_WORKED_DIFFERS_FROM_ENDED_AT',
      title: 'Último dia operacional ≠ desvínculo do cadastro',
      message:
        'O desligamento tem last_worked_at diferente do ended_at do cadastro. O acerto usa a data operacional.',
      metadata: {
        last_worked_at: eligibility.lastWorkedAt,
        ended_at: eligibility.endedAtCadastro,
        active_days: eligibility.activeDays,
      },
    });
  }

  const dailyAllocationsByPair = new Map<string, SettlementLineInsert[]>();
  for (const daily of financialDailies) {
    const { allocations, warnings } = resolveDailyChargeAllocation({
      daily,
      pharmacyById,
      driverLinksByDriver,
      dailyShareGroups,
    });
    for (const warning of warnings) {
      await addBillingAuditNotification({
        workspaceId,
        billingCycleId: cycleId,
        pharmacyId: warning.pharmacyId,
        driverId: warning.driverId,
        severity: 'warning',
        code: warning.code,
        title: warning.title,
        message: warning.message,
        metadata: warning.metadata,
      });
    }
    for (const allocation of allocations) {
      registerDailySettlementAllocation({
        driverId: daily.driver_id,
        pharmacyId: allocation.pharmacyId,
        line: allocation.line,
        dailyAllocationsByPair,
        pairCounts,
      });
    }
  }

  applyContractedDailyAllocations({
    pharmacyById,
    fixedEligibilities: contractedDailyEligibilities.filter(
      (row) => !driverIsFullyExcluded(exclusionsByPharmacy.get(row.pharmacyId) || [], row.driverId, row.pharmacyId)
    ),
    dailyAllocationsByPair,
    pairCounts,
  });

  for (const pharmacy of pharmacyById.values()) {
    if (pharmacyId && pharmacy.id !== pharmacyId) continue;
    if (pharmacy.status !== 'active' || !pharmacy.daily_billing_enabled) continue;
    if (pharmacy.daily_billing_rule !== 'fixed_per_driver_cycle') continue;
    const qty = Math.max(0, Math.round(Number(pharmacy.daily_billing_quantity ?? 0)));
    if (qty <= 0 || cents(pharmacy.daily_billing_pharmacy_amount_cents) <= 0) continue;
    let allocated = 0;
    for (const [key, lines] of dailyAllocationsByPair) {
      if (!key.endsWith(`:${pharmacy.id}`)) continue;
      for (const line of lines) {
        if (line.kind !== 'daily') continue;
        if (cents(line.pharmacy_amount_cents) <= 0) continue;
        const contractedQty = line.metadata?.contracted_quantity;
        allocated += typeof contractedQty === 'number' && Number.isFinite(contractedQty) ? Math.max(0, Math.round(contractedQty)) : 1;
      }
    }
    if (allocated > 0) continue;
    await addBillingAuditNotification({
      workspaceId,
      billingCycleId: cycleId,
      pharmacyId: pharmacy.id,
      severity: 'warning',
      code: 'CONTRACTED_DAILY_WITHOUT_HOST',
      title: 'Diária contratada sem anfitrião',
      message: `${pharmacy.name} tem diária contratada no cadastro, mas nenhum fixo vigente recebeu a cobrança neste ciclo.`,
      metadata: {
        daily_billing_quantity: qty,
        daily_billing_pharmacy_amount_cents: cents(pharmacy.daily_billing_pharmacy_amount_cents),
      },
    });
  }

  const driverIds = [
    ...new Set([
      ...deliveries.map((r) => String(r.driver_id)),
      ...fixedEligibilities.map((r) => r.driverId),
      ...contractedDailyEligibilities.map((r) => r.driverId),
      ...financialDailies.map((r) => r.driver_id),
    ]),
  ];

  const skipQuotaDiscountByDriver = new Set<string>();
  if (driverIds.length) {
    const { data: driverRows } = await supabase
      .from('drivers')
      .select('id, status')
      .eq('workspace_id', workspaceId)
      .in('id', driverIds);
    const inactiveIds = new Set(
      (driverRows || []).filter((row) => String(row.status || '') === 'inactive').map((row) => String(row.id))
    );
    if (inactiveIds.size) {
      const { data: quotaRows } = await supabase
        .from('billing_quota_accounts')
        .select('driver_id, balance_cents, integralized_cents, adjusted_cents, compensated_cents, refunded_cents')
        .eq('workspace_id', workspaceId)
        .in('driver_id', [...inactiveIds]);
      for (const row of quotaRows || []) {
        const balance = Math.max(
          Number(row.balance_cents || 0),
          Number(row.integralized_cents || 0) +
            Number(row.adjusted_cents || 0) -
            Number(row.compensated_cents || 0) -
            Number(row.refunded_cents || 0)
        );
        if (balance > 0) skipQuotaDiscountByDriver.add(String(row.driver_id));
      }
    }
  }

  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('key', 'financial_discount_rules')
    .maybeSingle();
  const rules = mergeDiscountRulesFromJson(setting?.value ?? null);
  const settlementUi = primarySettlementWeekdayUi(rules);
  const payWeekMonday = (() => {
    const ref = new Date(`${paymentDate}T12:00:00.000Z`);
    const day = ref.getUTCDay();
    const offset = (day + 6) % 7;
    const monday = new Date(ref);
    monday.setUTCDate(ref.getUTCDate() - offset);
    return monday.toISOString().slice(0, 10);
  })();
  const installmentDueDates = paymentDatesInWeek(payWeekMonday, [settlementUi]);

  const entryTypes = await loadEntryTypes();
  const discountSlugs = new Set(entryTypes.filter((t) => t.active && t.affects_net === 'discount').map((t) => t.slug));

  const driverFinancial = new Map<
    string,
    {
      absences: { amount_cents: number; pharmacy_id: string | null; description: string | null }[];
      financialCoop: {
        kind: string;
        amount_cents: number;
        description: string | null;
        installment_id: string;
        entry_type_slug: string;
      }[];
      discounts: { kind: string; amount_cents: number; description: string | null }[];
    }
  >();

  const capitalSeparation = isBillingCapitalSeparationEnabled();

  for (const driverId of driverIds) {
    const bucket = {
      absences: [] as { amount_cents: number; pharmacy_id: string | null; description: string | null }[],
      financialCoop: [] as {
        kind: string;
        amount_cents: number;
        description: string | null;
        installment_id: string;
        entry_type_slug: string;
      }[],
      discounts: [] as { kind: string; amount_cents: number; description: string | null }[],
    };

    const dailyDuplicateKeys = new Map<string, string[]>();
    for (const daily of financialDailies.filter((row) => row.driver_id === driverId)) {
      const duplicateKey = `${daily.pharmacy_id || 'sem-farmacia'}:${daily.event_date || daily.entry_id}`;
      const duplicateIds = dailyDuplicateKeys.get(duplicateKey) || [];
      duplicateIds.push(daily.entry_id);
      dailyDuplicateKeys.set(duplicateKey, duplicateIds);
    }
    for (const [duplicateKey, ids] of dailyDuplicateKeys) {
      if (ids.length <= 1) continue;
      const [pharmacyId] = duplicateKey.split(':');
      await addBillingAuditNotification({
        workspaceId,
        billingCycleId: cycleId,
        pharmacyId: pharmacyId && pharmacyId !== 'sem-farmacia' ? pharmacyId : null,
        driverId,
        severity: 'warning',
        code: 'DUPLICATE_DAILY_SAME_DAY',
        title: 'Possível diária duplicada',
        message: 'Há mais de uma diária aprovada para o mesmo entregador, farmácia e data no ciclo.',
        metadata: { financial_entry_ids: ids, duplicate_key: duplicateKey },
      });
    }

    const { data: absenceRows } = await supabase
      .from('financial_entries')
      .select('id, total_amount, status, pharmacy_id, description, minimum_guaranteed_cents')
      .eq('workspace_id', workspaceId)
      .eq('driver_id', driverId)
      .eq('type', 'absence')
      .gte('apuracao_start', apuracaoStart)
      .lte('apuracao_end', apuracaoEnd);
    for (const row of absenceRows || []) {
      if (!VERIFIED_ENTRY_STATUSES.includes(String(row.status))) continue;
      const pharmacy = row.pharmacy_id ? pharmacyById.get(String(row.pharmacy_id)) : null;
      let driverDiscount = moneyToCents(Number(row.total_amount));
      if (pharmacy) {
        const mg = computeAbsenceMgDiscount({
          minimumGuaranteedCents: cents(pharmacy.minimum_guaranteed_cents),
          minimumGuaranteedDriverPayoutCents: cents(pharmacy.minimum_guaranteed_driver_payout_cents),
        });
        driverDiscount = mg.driverDiscountCents;
      }
      bucket.absences.push({
        amount_cents: driverDiscount,
        pharmacy_id: row.pharmacy_id ? String(row.pharmacy_id) : null,
        description: row.description ? String(row.description) : null,
      });
    }

    if (installmentDueDates.length) {
      const { data: instRows } = await supabase
        .from('financial_installments')
        .select('id, amount, due_date, financial_entries!inner(id, type, status, driver_id, description)')
        .eq('financial_entries.driver_id', driverId)
        .in('due_date', installmentDueDates);
      for (const row of instRows || []) {
        const entry = row.financial_entries as { type?: string; status?: string; description?: string };
        if (!entry || !VERIFIED_ENTRY_STATUSES.includes(String(entry.status))) continue;
        const slug = String(entry.type || '');
        if (!discountSlugs.has(slug)) continue;
        if (slug === 'quota' && skipQuotaDiscountByDriver.has(driverId)) continue;
        const disc = {
          kind: mapDiscountKind(slug),
          amount_cents: moneyToCents(Number(row.amount)),
          description: entry.description ? String(entry.description) : slug,
          installment_id: String(row.id),
          entry_type_slug: slug,
        };
        if (capitalSeparation && isFinancialCoopDiscountSlug(slug)) {
          bucket.financialCoop.push(disc);
        } else {
          bucket.discounts.push({
            kind: disc.kind,
            amount_cents: disc.amount_cents,
            description: disc.description,
          });
        }
      }
    }

    driverFinancial.set(driverId, bucket);
  }

  const driverDiscountAssigned = new Map<string, boolean>();
  const anchorSettlementByPharmacy = new Map<string, string>();
  const now = new Date().toISOString();
  let count = 0;

  await deleteCycleSettlements(cycleId, pharmacyId);

  type BaseAmounts = {
    pharmacyChargeCents: number;
    driverPayoutCents: number;
    appliedMg: boolean;
    minimumDeliveryThreshold: number;
    deliveryCount: number;
    poolShared: boolean;
    poolActiveDays?: number | null;
  };

  const baseByPair = new Map<string, BaseAmounts>();
  const byPharmacy = new Map<string, Map<string, number>>();
  for (const row of deliveries) {
    const key = pairKey(String(row.driver_id), String(row.pharmacy_id));
    if (!pairCounts.has(key)) pairCounts.set(key, 0);
  }
  for (const [key, count] of pairCounts) {
    const [driverId, pharmacyId] = key.split(':');
    if (!byPharmacy.has(pharmacyId)) byPharmacy.set(pharmacyId, new Map());
    byPharmacy.get(pharmacyId)!.set(driverId, count);
  }

  for (const [pharmacyId, driverMap] of byPharmacy) {
    const pharmacy = pharmacyById.get(pharmacyId);
    if (!pharmacy) continue;

    const feeCents = cents(pharmacy.delivery_fee_cents);
    const feeDriverCents = cents(pharmacy.delivery_fee_driver_payout_cents);
    const mgCents = cents(pharmacy.minimum_guaranteed_cents);
    const mgDriverCents = cents(pharmacy.minimum_guaranteed_driver_payout_cents);
    const settlementInput = {
      mgEnabled: pharmacy.mg_enabled !== false,
      minimumDeliveriesCount: pharmacy.minimum_deliveries_count,
      minimumGuaranteedCents: mgCents,
      minimumGuaranteedDriverPayoutCents: mgDriverCents,
      deliveryFeeCents: feeCents,
      deliveryFeeDriverPayoutCents: feeDriverCents,
    };

    if (pharmacy.mg_mode === 'shared_pool' && pharmacy.mg_enabled !== false) {
      const poolParticipants = [...driverMap.entries()]
        .map(([driverId, deliveryCount]) => ({
          driverId,
          deliveryCount,
          eligibility: fixedEligibilityByPair.get(pairKey(driverId, pharmacyId)),
        }))
        .filter(
          (row): row is { driverId: string; deliveryCount: number; eligibility: FixedMgEligibility } =>
            Boolean(row.eligibility)
        );
      if (poolParticipants.length) {
        const poolCycleDays = poolParticipants.reduce(
          (max, row) => Math.max(max, row.eligibility.totalCycleDays),
          0
        );
        const pool = computeSharedPoolDeliverySettlement({
          ...settlementInput,
          deliveryCount: 0,
          driverCounts: poolParticipants.map((row) => ({
            driverId: row.driverId,
            deliveryCount: row.deliveryCount,
            activeDays: row.eligibility.activeDays,
          })),
          splitRule: pharmacy.mg_pool_split_rule,
          totalCycleDays: poolCycleDays,
        });
        for (const row of pool.perDriver) {
          if (row.deliveryCount <= 0) continue;
          const key = pairKey(row.driverId, pharmacyId);
          baseByPair.set(key, {
            pharmacyChargeCents: row.pharmacyChargeCents,
            driverPayoutCents: row.driverPayoutCents,
            appliedMg: pool.appliedMinimumGuarantee,
            minimumDeliveryThreshold: pool.minimumDeliveryThreshold,
            deliveryCount: row.deliveryCount,
            poolShared: pool.appliedMinimumGuarantee,
            poolActiveDays: pool.appliedMinimumGuarantee ? pool.poolActiveDays : null,
          });
        }
      }
      for (const [driverId, deliveryCount] of driverMap) {
        const key = pairKey(driverId, pharmacyId);
        if (baseByPair.has(key)) continue;
        if (!operationalPairs.has(key) || fixedEligibilityByPair.has(key)) {
          if (!operationalPairs.has(key)) {
            baseByPair.set(key, {
              pharmacyChargeCents: 0,
              driverPayoutCents: 0,
              appliedMg: false,
              minimumDeliveryThreshold: 0,
              deliveryCount,
              poolShared: false,
            });
          }
          continue;
        }
        const base = computePairDeliverySettlement({
          ...settlementInput,
          pairEligible: false,
          deliveryCount,
        });
        baseByPair.set(key, {
          pharmacyChargeCents: base.pharmacyChargeCents,
          driverPayoutCents: base.driverPayoutCents,
          appliedMg: false,
          minimumDeliveryThreshold: base.minimumDeliveryThreshold,
          deliveryCount,
          poolShared: false,
        });
      }
    } else {
      for (const [driverId, deliveryCount] of driverMap) {
        const key = pairKey(driverId, pharmacyId);
        if (!operationalPairs.has(key)) {
          baseByPair.set(key, {
            pharmacyChargeCents: 0,
            driverPayoutCents: 0,
            appliedMg: false,
            minimumDeliveryThreshold: 0,
            deliveryCount,
            poolShared: false,
          });
          continue;
        }
        const eligibility = fixedEligibilityByPair.get(key);
        const base = computePairDeliverySettlement({
          ...settlementInput,
          pairEligible: Boolean(eligibility),
          deliveryCount,
        });
        const shouldProrateMg = base.appliedMinimumGuarantee && eligibility && eligibility.activeDays < eligibility.totalCycleDays;
        baseByPair.set(key, {
          pharmacyChargeCents: shouldProrateMg
            ? prorateCents(base.pharmacyChargeCents, eligibility.activeDays, eligibility.totalCycleDays)
            : base.pharmacyChargeCents,
          driverPayoutCents: shouldProrateMg
            ? prorateCents(base.driverPayoutCents, eligibility.activeDays, eligibility.totalCycleDays)
            : base.driverPayoutCents,
          appliedMg: base.appliedMinimumGuarantee,
          minimumDeliveryThreshold: base.minimumDeliveryThreshold,
          deliveryCount,
          poolShared: false,
        });
      }
    }
  }

  const sortedPairs = [...pairCounts.entries()]
    .filter(([key]) => {
      if (!pharmacyId) return true;
      return key.split(':')[1] === pharmacyId;
    })
    .sort((a, b) => {
    const phA = pharmacyById.get(a[0].split(':')[1]!)?.name || '';
    const phB = pharmacyById.get(b[0].split(':')[1]!)?.name || '';
    return phA.localeCompare(phB, 'pt-BR');
  });

  const settlementDriverIds = [...new Set(sortedPairs.map(([key]) => key.split(':')[0]!))];
  const driverPrimaryById = new Map<string, string | null>();
  const driverLinkedPharmacies = new Map<string, Set<string>>();
  if (settlementDriverIds.length) {
    const { data: settlementDrivers, error: settlementDriversErr } = await supabase
      .from('drivers')
      .select('id, primary_pharmacy_id')
      .eq('workspace_id', workspaceId)
      .in('id', settlementDriverIds);
    if (settlementDriversErr) throw new Error(settlementDriversErr.message);
    for (const row of settlementDrivers || []) {
      driverPrimaryById.set(String(row.id), row.primary_pharmacy_id ? String(row.primary_pharmacy_id) : null);
      driverLinkedPharmacies.set(String(row.id), new Set());
    }
    const { data: settlementLinks, error: settlementLinksErr } = await supabase
      .from('driver_pharmacy_links')
      .select('driver_id, pharmacy_id, is_active')
      .eq('workspace_id', workspaceId)
      .in('driver_id', settlementDriverIds)
      .eq('is_active', true);
    if (settlementLinksErr) throw new Error(settlementLinksErr.message);
    for (const row of settlementLinks || []) {
      const linked = driverLinkedPharmacies.get(String(row.driver_id));
      if (!linked || !row.pharmacy_id) continue;
      linked.add(String(row.pharmacy_id));
    }
  }

  for (const [key, deliveryCount] of sortedPairs) {
    const [driverId, pharmacyId] = key.split(':');
    const pharmacy = pharmacyById.get(pharmacyId);
    if (!pharmacy) continue;

    const pharmacyExclusions = exclusionsByPharmacy.get(pharmacyId) || [];
    if (driverIsFullyExcluded(pharmacyExclusions, driverId, pharmacyId)) continue;

    const base = baseByPair.get(key);
    if (!base) continue;

    const split = resolveSplitPercentages({
      contractScope: pharmacy.contract_scope || 'both',
      pharmacySplitCoopPct: pharmacy.split_coop_pct != null ? Number(pharmacy.split_coop_pct) : null,
      pharmacySplitFluxPct: pharmacy.split_flux_pct != null ? Number(pharmacy.split_flux_pct) : null,
      costCenterSplitCoopPct: pharmacy.billing_cost_centers?.split_coop_pct != null ? Number(pharmacy.billing_cost_centers.split_coop_pct) : null,
      costCenterSplitFluxPct: pharmacy.billing_cost_centers?.split_flux_pct != null ? Number(pharmacy.billing_cost_centers.split_flux_pct) : null,
    });
    const eligibility = fixedEligibilityByPair.get(key);
    const mgLabel = base.poolShared
      ? eligibility && eligibility.activeDays < eligibility.totalCycleDays
        ? `MG compartilhado proporcional (${eligibility.activeDays}/${eligibility.totalCycleDays} dias, ${deliveryCount} entregas, pool)`
        : `MG compartilhado (${deliveryCount} entregas, pool)`
      : base.appliedMg
        ? eligibility && eligibility.activeDays < eligibility.totalCycleDays
          ? `MG proporcional (${eligibility.activeDays}/${eligibility.totalCycleDays} dias, ${deliveryCount} entregas ≤ ${base.minimumDeliveryThreshold})`
          : `MG (${deliveryCount} entregas ≤ ${base.minimumDeliveryThreshold})`
        : `${deliveryCount} entregas`;

    const lines: SettlementLineInsert[] = [
      {
        kind: base.appliedMg ? 'minimum_guarantee' : 'deliveries',
        description: mgLabel,
        pharmacy_amount_cents: base.pharmacyChargeCents,
        driver_amount_cents: base.driverPayoutCents,
        metadata: {
          delivery_count: deliveryCount,
          applied_mg: base.appliedMg,
          mg_mode: pharmacy.mg_mode,
          pool_shared: base.poolShared,
          pool_active_days: base.poolActiveDays ?? null,
          fixed_link_active_days: eligibility?.activeDays ?? null,
          fixed_link_total_days: eligibility?.totalCycleDays ?? null,
          last_worked_at: eligibility?.lastWorkedAt ?? null,
          ended_at: eligibility?.endedAtCadastro ?? null,
        },
      },
    ];

    const fin = driverFinancial.get(driverId);
    let operationalDiscountsCents = 0;
    let financialDeductionCents = 0;
    let driverExtras = 0;
    let pharmacyExtras = 0;

    for (const dailyLine of dailyAllocationsByPair.get(key) || []) {
      lines.push(dailyLine);
    }

    for (const dayBaseLine of dayBaseLinesForPair(
      dayBaseOverlays,
      driverId,
      pharmacyId,
      pharmacy.driver_day_base_cents
    )) {
      lines.push(dayBaseLine);
    }

    if (fin) {
      for (const absence of fin.absences) {
        if (absence.pharmacy_id && absence.pharmacy_id !== pharmacyId) continue;
        lines.push({
          kind: 'absence',
          description: absence.description || 'Falta (MG÷6)',
          pharmacy_amount_cents: 0,
          driver_amount_cents: -absence.amount_cents,
          metadata: settlementLineMetadata(DRE_SCOPE_OPERATIONAL),
        });
        operationalDiscountsCents += absence.amount_cents;
      }

      if (!driverDiscountAssigned.get(driverId)) {
        for (const disc of fin.financialCoop) {
          lines.push({
            kind: disc.kind,
            description: disc.description || disc.kind,
            pharmacy_amount_cents: 0,
            driver_amount_cents: -disc.amount_cents,
            metadata: settlementLineMetadata(DRE_SCOPE_OUTSIDE_MARGIN, {
              financial_installment_id: disc.installment_id,
              financial_entry_type: disc.entry_type_slug,
            }),
          });
          financialDeductionCents += disc.amount_cents;
        }
        for (const disc of fin.discounts) {
          lines.push({
            kind: disc.kind,
            description: disc.description || disc.kind,
            pharmacy_amount_cents: 0,
            driver_amount_cents: -disc.amount_cents,
            metadata: settlementLineMetadata(
              capitalSeparation ? DRE_SCOPE_OUTSIDE_MARGIN : DRE_SCOPE_OPERATIONAL
            ),
          });
          if (capitalSeparation) financialDeductionCents += disc.amount_cents;
          else operationalDiscountsCents += disc.amount_cents;
        }
        driverDiscountAssigned.set(driverId, true);
      }
    }

    const overlaid = applySettlementExclusionOverlay({
      driverId,
      pharmacyId,
      lines,
      exclusions: pharmacyExclusions,
    });
    lines.length = 0;
    const mgOverlay = mgOverlayByPair.get(key);
    const afterMg = applyMgMultiplierToLines(overlaid.lines, mgOverlay?.multiplier ?? 1);
    lines.push(...afterMg);
    const mgOrDelivery = lines.find((line) => line.kind === 'minimum_guarantee' || line.kind === 'deliveries');
    const appliedMg =
      mgOrDelivery?.kind === 'minimum_guarantee' && cents(mgOrDelivery.pharmacy_amount_cents) > 0;
    const pharmacyChargeBase = cents(mgOrDelivery?.pharmacy_amount_cents);
    const driverPayoutBase = Math.max(0, Number(mgOrDelivery?.driver_amount_cents || 0));
    pharmacyExtras = 0;
    driverExtras = 0;
    for (const dailyLine of lines.filter((line) => line.kind === 'daily')) {
      pharmacyExtras += dailyLine.pharmacy_amount_cents;
      driverExtras += dailyLine.driver_amount_cents;
    }

    const coverageDailyWithMg = lines.some(
      (line) =>
        line.kind === 'daily' &&
        cents(line.pharmacy_amount_cents) > 0 &&
        line.metadata?.allocation_rule !== 'pharmacy_contracted_daily'
    );
    if (appliedMg && coverageDailyWithMg) {
      await addBillingAuditNotification({
        workspaceId,
        billingCycleId: cycleId,
        pharmacyId,
        driverId,
        severity: 'warning',
        code: 'DAILY_AND_MG_SAME_PHARMACY',
        title: 'Diária e MG na mesma loja',
        message:
          'O entregador tem diária e mínimo garantido na mesma farmácia neste ciclo. Cobertura pontual não deveria gerar MG.',
        metadata: {
          active_days: eligibility?.activeDays ?? null,
        },
      });
    }

    if (appliedMg && deliveryCount === 0 && eligibility && (!fin || fin.absences.length === 0)) {
      await addBillingAuditNotification({
        workspaceId,
        billingCycleId: cycleId,
        pharmacyId,
        driverId,
        severity: 'warning',
        code: 'FIXED_MG_ZERO_DELIVERIES_NO_OCCURRENCE',
        title: 'Fixo com MG e zero entregas',
        message:
          'Entregador fixo gerou mínimo garantido sem entregas no ciclo e sem falta/folga registrada. Conferir operação antes de aprovar.',
        metadata: {
          active_days: eligibility.activeDays,
          total_cycle_days: eligibility.totalCycleDays,
          started_at: eligibility.startedAt,
          ended_at: eligibility.endedAt,
        },
      });
    }

    if (deliveryCount > 0) {
      const primaryPharmacyId = driverPrimaryById.get(driverId) || null;
      const linkedPharmacies = driverLinkedPharmacies.get(driverId) || new Set<string>();
      const linkedToPharmacy =
        primaryPharmacyId === pharmacyId || linkedPharmacies.has(pharmacyId);
      if (!linkedToPharmacy) {
        await addBillingAuditNotification({
          workspaceId,
          billingCycleId: cycleId,
          pharmacyId,
          driverId,
          severity: 'warning',
          code: 'DRIVER_NOT_LINKED_TO_PHARMACY',
          title: 'Entregador sem vínculo na farmácia',
          message:
            'Há entregas neste ciclo para uma farmácia onde o entregador não tem vínculo ativo. Conferir se a farmácia da entrega está correta ou atualizar vínculos.',
          metadata: {
            delivery_count: deliveryCount,
            primary_pharmacy_id: primaryPharmacyId,
          },
        });
      }
    }

    const pharmacyChargeTotal = pharmacyChargeBase + pharmacyExtras;
    const payout = computeSettlementPayoutBreakdown({
      driverPayoutCents: driverPayoutBase,
      driverExtras,
      operationalDiscountsCents,
      financialDeductionCents,
      capitalSeparationEnabled: capitalSeparation,
    });
    const splitAmountsWithExtras = splitAmountCents(pharmacyChargeTotal, split);

    const { data: settlement, error: insErr } = await supabase
      .from('billing_settlements')
      .insert({
        workspace_id: workspaceId,
        billing_cycle_id: cycleId,
        driver_id: driverId,
        pharmacy_id: pharmacyId,
        delivery_count: deliveryCount,
        pharmacy_charge_cents: pharmacyChargeTotal,
        driver_payout_cents: driverPayoutBase + driverExtras,
        coop_cents: splitAmountsWithExtras.coopCents,
        flux_cents: splitAmountsWithExtras.fluxCents,
        discounts_cents: payout.discounts_cents,
        operational_net_driver_payout_cents: payout.operational_net_driver_payout_cents,
        financial_deduction_cents: payout.financial_deduction_cents,
        net_driver_payout_cents: payout.net_driver_payout_cents,
        applied_mg: appliedMg,
        status: 'open',
        updated_at: now,
      })
      .select('id')
      .single();
    if (insErr) throw new Error(insErr.message);

    if (lines.length) {
      const { error: lineErr } = await supabase.from('billing_settlement_lines').insert(
        lines.map((line) => ({
          settlement_id: settlement.id,
          kind: line.kind,
          description: line.description,
          pharmacy_amount_cents: line.pharmacy_amount_cents,
          driver_amount_cents: line.driver_amount_cents,
          metadata: line.metadata || {},
        }))
      );
      if (lineErr) throw new Error(lineErr.message);
    }

    const settlementId = String(settlement.id);
    if (!anchorSettlementByPharmacy.has(pharmacyId)) {
      anchorSettlementByPharmacy.set(pharmacyId, settlementId);
    }

    const preservedPair = manualDiscountsByPair.get(key) || [];
    if (preservedPair.length) {
      await applyManualDiscountSnapshots(workspaceId, settlementId, preservedPair);
    }
    count += 1;
  }

  for (const [pharmacyKey, snapshots] of manualDiscountsByPharmacy) {
    const anchorId = anchorSettlementByPharmacy.get(pharmacyKey);
    if (!anchorId || !snapshots.length) continue;
    await applyManualDiscountSnapshots(workspaceId, anchorId, snapshots);
  }

  return { settlements: count };
}

export type SettlementReversalRow = {
  id: string;
  billing_cycle_id: string;
  pharmacy_id: string;
  driver_id: string;
};

export type PharmacySettlementReopenResult = {
  updated: number;
  invoices_removed: number;
  payables_resynced: number;
  ledger_entries_removed: number;
  settlements_recalculated: number;
  recalc_warning?: string;
};

async function loadPharmacyReopenArtifacts(
  workspaceId: string,
  cycleId: string,
  pharmacyId: string,
  driverIds: string[]
): Promise<{ invoices: Array<{ id: string; status: string; amount_paid_cents: number | null }> }> {
  const { data: invoices, error: invErr } = await supabase
    .from('billing_invoices')
    .select('id, status, amount_paid_cents')
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .eq('pharmacy_id', pharmacyId);
  if (invErr) throw new Error(invErr.message);

  const invoiceBlocker = reopenInvoiceBlocker(invoices || []);
  if (invoiceBlocker) throw new Error(invoiceBlocker);

  if (driverIds.length) {
    const { data: payables, error: payErr } = await supabase
      .from('billing_payables')
      .select('id, amount_paid_cents, status, origin_type, beneficiary_id')
      .eq('workspace_id', workspaceId)
      .eq('billing_cycle_id', cycleId)
      .eq('beneficiary_type', 'driver')
      .eq('origin_type', 'cycle_settlement')
      .in('beneficiary_id', driverIds);
    if (payErr) throw new Error(payErr.message);
    const payableBlocker = reopenPayableBlocker(payables || [], driverIds);
    if (payableBlocker) throw new Error(payableBlocker);
  }

  return { invoices: invoices || [] };
}

async function applyPharmacyReopenArtifacts(
  workspaceId: string,
  cycleId: string,
  pharmacyId: string,
  settlementIds: string[]
): Promise<{ invoices_removed: number; payables_resynced: number; ledger_entries_removed: number }> {
  const { deleteRegenerablePharmacyInvoices } = await import('./billingInvoiceEngine');
  const invoicesRemoved = await deleteRegenerablePharmacyInvoices(workspaceId, cycleId, pharmacyId);

  let ledgerEntriesRemoved = 0;
  if (settlementIds.length) {
    const { data: ledgerRows, error: ledgerLoadErr } = await supabase
      .from('billing_driver_financial_ledger_entries')
      .select('id')
      .eq('workspace_id', workspaceId)
      .in('settlement_id', settlementIds);
    if (ledgerLoadErr) throw new Error(ledgerLoadErr.message);
    ledgerEntriesRemoved = ledgerRows?.length || 0;
    if (ledgerRows?.length) {
      const { error: delLedgerErr } = await supabase
        .from('billing_driver_financial_ledger_entries')
        .delete()
        .eq('workspace_id', workspaceId)
        .in('settlement_id', settlementIds);
      if (delLedgerErr) throw new Error(delLedgerErr.message);
    }
  }

  const { generateDriverPayablesFromCycle } = await import('./billingPayablesEngine');
  const payablesResync = await generateDriverPayablesFromCycle(workspaceId, cycleId);

  return {
    invoices_removed: invoicesRemoved,
    payables_resynced: payablesResync.payables,
    ledger_entries_removed: ledgerEntriesRemoved,
  };
}

async function pharmacyDriverIdsForReopen(
  workspaceId: string,
  cycleId: string,
  pharmacyId: string,
  fallbackDriverId?: string
): Promise<string[]> {
  const { data: siblings, error: siblingErr } = await supabase
    .from('billing_settlements')
    .select('id, driver_id')
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .eq('pharmacy_id', pharmacyId);
  if (siblingErr) throw new Error(siblingErr.message);
  const driverIds = [...new Set((siblings || []).map((row) => String(row.driver_id)).filter(Boolean))];
  if (fallbackDriverId && !driverIds.includes(fallbackDriverId)) driverIds.push(fallbackDriverId);
  return driverIds;
}

/** Confere faturas/APs da farmácia antes de mudar o status do acerto. */
export async function assertSettlementReopenClear(
  workspaceId: string,
  settlement: SettlementReversalRow
): Promise<void> {
  const cycleId = String(settlement.billing_cycle_id);
  const pharmacyId = String(settlement.pharmacy_id);
  const driverIds = await pharmacyDriverIdsForReopen(
    workspaceId,
    cycleId,
    pharmacyId,
    String(settlement.driver_id)
  );
  await loadPharmacyReopenArtifacts(workspaceId, cycleId, pharmacyId, driverIds);
}

/** Remove faturas/APs gerados na aprovação para permitir reabrir o acerto e recalcular o ciclo. */
export async function reverseSettlementArtifacts(
  workspaceId: string,
  settlement: SettlementReversalRow
): Promise<{ invoices_removed: number; payables_resynced: number; ledger_entries_removed: number }> {
  await assertSettlementReopenClear(workspaceId, settlement);
  return applyPharmacyReopenArtifacts(
    workspaceId,
    String(settlement.billing_cycle_id),
    String(settlement.pharmacy_id),
    [String(settlement.id)]
  );
}

/** Reabre todos os acertos aprovados/em revisão da farmácia no ciclo (estorno operacional). */
export async function reopenPharmacyCycleSettlements(input: {
  workspaceId: string;
  cycleId: string;
  pharmacyId: string;
}): Promise<PharmacySettlementReopenResult> {
  const { data: settlements, error: loadErr } = await supabase
    .from('billing_settlements')
    .select('id, driver_id, status')
    .eq('workspace_id', input.workspaceId)
    .eq('billing_cycle_id', input.cycleId)
    .eq('pharmacy_id', input.pharmacyId);
  if (loadErr) throw new Error(loadErr.message);

  const rows = settlements || [];
  const statusBlocker = pharmacySettlementsReopenBlocker(rows);
  if (statusBlocker) throw new Error(statusBlocker);

  const reopenable = rows.filter((row) => isReopenableSettlementStatus(String(row.status)));
  const driverIds = [...new Set(rows.map((row) => String(row.driver_id)).filter(Boolean))];
  const settlementIds = reopenable.map((row) => String(row.id));

  await loadPharmacyReopenArtifacts(input.workspaceId, input.cycleId, input.pharmacyId, driverIds);

  const now = new Date().toISOString();
  const { data: updatedRows, error: updateErr } = await supabase
    .from('billing_settlements')
    .update({
      status: 'open',
      submitted_at: null,
      submitted_by: null,
      approved_at: null,
      approved_by: null,
      updated_at: now,
    })
    .eq('workspace_id', input.workspaceId)
    .eq('billing_cycle_id', input.cycleId)
    .eq('pharmacy_id', input.pharmacyId)
    .in('status', ['in_review', 'approved'])
    .select('id');
  if (updateErr) throw new Error(updateErr.message);

  const artifacts = await applyPharmacyReopenArtifacts(
    input.workspaceId,
    input.cycleId,
    input.pharmacyId,
    settlementIds
  );

  let settlementsRecalculated = 0;
  let recalcWarning: string | undefined;
  try {
    const recalc = await recalculateCycleSettlements(input.workspaceId, input.cycleId, {
      pharmacyId: input.pharmacyId,
    });
    settlementsRecalculated = recalc.settlements;
  } catch (err) {
    recalcWarning =
      err instanceof Error
        ? `Acertos reabertos, mas o recálculo automático falhou: ${err.message}`
        : 'Acertos reabertos, mas o recálculo automático falhou.';
  }

  return {
    updated: (updatedRows || []).length,
    ...artifacts,
    settlements_recalculated: settlementsRecalculated,
    recalc_warning: recalcWarning,
  };
}

export async function assignDeliveriesToCycle(
  workspaceId: string,
  cycleId: string,
  apuracaoStart: string,
  apuracaoEnd: string
): Promise<number> {
  const startDate = String(apuracaoStart).slice(0, 10);
  const endDate = String(apuracaoEnd).slice(0, 10);
  const startIso = `${startDate}T00:00:00.000Z`;
  const endIso = `${endDate}T23:59:59.999Z`;

  const { count: pending, error: countErr } = await supabase
    .from('billing_delivery_records')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .is('billing_cycle_id', null)
    .eq('cancelled', false)
    .gte('delivered_at', startIso)
    .lte('delivered_at', endIso);
  if (countErr) throw new Error(countErr.message);
  if (!pending) return 0;

  const { error } = await supabase
    .from('billing_delivery_records')
    .update({ billing_cycle_id: cycleId, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .is('billing_cycle_id', null)
    .eq('cancelled', false)
    .gte('delivered_at', startIso)
    .lte('delivered_at', endIso);
  if (error) throw new Error(error.message);
  return pending;
}
