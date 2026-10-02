import type { SupabaseClient } from '@supabase/supabase-js';

type Db = SupabaseClient;

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

export type CapitalCooperativoLine = {
  id: string;
  driver_id: string;
  driver_name: string | null;
  movement_date: string;
  source: 'quota_account' | 'financial_ledger';
  entry_type: string;
  amount_cents: number;
  description: string | null;
  billing_cycle_id: string | null;
  settlement_id: string | null;
  offboarding_preview_id: string | null;
};

export type CapitalCooperativoReport = {
  month: string;
  summary: {
    integralization_cents: number;
    compensation_cents: number;
    refund_cents: number;
    adjustment_cents: number;
    advance_recovery_cents: number;
    uniform_recovery_cents: number;
    bag_recovery_cents: number;
    digital_cert_recovery_cents: number;
    other_financial_recovery_cents: number;
    net_movement_cents: number;
  };
  by_driver: Array<{
    driver_id: string;
    driver_name: string | null;
    integralization_cents: number;
    compensation_cents: number;
    refund_cents: number;
    financial_recovery_cents: number;
    net_movement_cents: number;
    quota_balance_cents: number;
  }>;
  lines: CapitalCooperativoLine[];
};

function absCents(value: number): number {
  return Math.abs(Math.round(Number(value || 0)));
}

export async function buildCapitalCooperativoReport(
  db: Db,
  workspaceId: string,
  month: string,
  options: { driver_id?: string | null } = {}
): Promise<CapitalCooperativoReport> {
  const { start, end } = monthBounds(month);

  let quotaQuery = db
    .from('billing_quota_account_entries')
    .select(
      'id, driver_id, entry_type, amount_cents, description, created_at, offboarding_preview_id, drivers(id, name)'
    )
    .eq('workspace_id', workspaceId)
    .gte('created_at', `${start}T00:00:00.000Z`)
    .lte('created_at', `${end}T23:59:59.999Z`)
    .order('created_at', { ascending: false });
  if (options.driver_id) quotaQuery = quotaQuery.eq('driver_id', options.driver_id);

  let finQuery = db
    .from('billing_driver_financial_ledger_entries')
    .select(
      'id, driver_id, entry_type, amount_cents, description, created_at, billing_cycle_id, settlement_id, drivers(id, name)'
    )
    .eq('workspace_id', workspaceId)
    .gte('created_at', `${start}T00:00:00.000Z`)
    .lte('created_at', `${end}T23:59:59.999Z`)
    .order('created_at', { ascending: false });
  if (options.driver_id) finQuery = finQuery.eq('driver_id', options.driver_id);

  const [{ data: quotaRows, error: quotaErr }, { data: finRows, error: finErr }] = await Promise.all([
    quotaQuery,
    finQuery,
  ]);
  if (quotaErr) throw new Error(quotaErr.message);
  if (finErr) throw new Error(finErr.message);

  const summary = {
    integralization_cents: 0,
    compensation_cents: 0,
    refund_cents: 0,
    adjustment_cents: 0,
    advance_recovery_cents: 0,
    uniform_recovery_cents: 0,
    bag_recovery_cents: 0,
    digital_cert_recovery_cents: 0,
    other_financial_recovery_cents: 0,
    net_movement_cents: 0,
  };

  const lines: CapitalCooperativoLine[] = [];
  const byDriver = new Map<
    string,
    {
      driver_id: string;
      driver_name: string | null;
      integralization_cents: number;
      compensation_cents: number;
      refund_cents: number;
      financial_recovery_cents: number;
      net_movement_cents: number;
    }
  >();

  const touchDriver = (driverId: string, driverName: string | null) => {
    let row = byDriver.get(driverId);
    if (!row) {
      row = {
        driver_id: driverId,
        driver_name: driverName,
        integralization_cents: 0,
        compensation_cents: 0,
        refund_cents: 0,
        financial_recovery_cents: 0,
        net_movement_cents: 0,
      };
      byDriver.set(driverId, row);
    } else if (!row.driver_name && driverName) {
      row.driver_name = driverName;
    }
    return row;
  };

  for (const row of quotaRows || []) {
    const driverId = String(row.driver_id);
    const driverRaw = row.drivers as { id?: string; name?: string } | { id?: string; name?: string }[] | null;
    const driver = Array.isArray(driverRaw) ? driverRaw[0] : driverRaw;
    const driverName = driver?.name ? String(driver.name) : null;
    const entryType = String(row.entry_type || '');
    const amount = Number(row.amount_cents || 0);
    const driverRow = touchDriver(driverId, driverName);

    lines.push({
      id: String(row.id),
      driver_id: driverId,
      driver_name: driverName,
      movement_date: String(row.created_at).slice(0, 10),
      source: 'quota_account',
      entry_type: entryType,
      amount_cents: amount,
      description: row.description ? String(row.description) : null,
      billing_cycle_id: null,
      settlement_id: null,
      offboarding_preview_id: row.offboarding_preview_id ? String(row.offboarding_preview_id) : null,
    });

    if (entryType === 'integralization') {
      summary.integralization_cents += absCents(amount);
      driverRow.integralization_cents += absCents(amount);
      driverRow.net_movement_cents += absCents(amount);
      summary.net_movement_cents += absCents(amount);
    } else if (entryType === 'compensation') {
      summary.compensation_cents += absCents(amount);
      driverRow.compensation_cents += absCents(amount);
      driverRow.net_movement_cents -= absCents(amount);
      summary.net_movement_cents -= absCents(amount);
    } else if (entryType === 'refund') {
      summary.refund_cents += absCents(amount);
      driverRow.refund_cents += absCents(amount);
      driverRow.net_movement_cents -= absCents(amount);
      summary.net_movement_cents -= absCents(amount);
    } else if (entryType === 'adjustment' || entryType === 'reversal') {
      summary.adjustment_cents += amount;
      driverRow.net_movement_cents += amount;
      summary.net_movement_cents += amount;
    }
  }

  for (const row of finRows || []) {
    const driverId = String(row.driver_id);
    const driverRaw = row.drivers as { id?: string; name?: string } | { id?: string; name?: string }[] | null;
    const driver = Array.isArray(driverRaw) ? driverRaw[0] : driverRaw;
    const driverName = driver?.name ? String(driver.name) : null;
    const entryType = String(row.entry_type || '');
    const amount = absCents(row.amount_cents);
    const driverRow = touchDriver(driverId, driverName);

    lines.push({
      id: String(row.id),
      driver_id: driverId,
      driver_name: driverName,
      movement_date: String(row.created_at).slice(0, 10),
      source: 'financial_ledger',
      entry_type: entryType,
      amount_cents: -amount,
      description: row.description ? String(row.description) : null,
      billing_cycle_id: row.billing_cycle_id ? String(row.billing_cycle_id) : null,
      settlement_id: row.settlement_id ? String(row.settlement_id) : null,
      offboarding_preview_id: null,
    });

    if (entryType === 'advance_recovery') summary.advance_recovery_cents += amount;
    else if (entryType === 'uniform_recovery') summary.uniform_recovery_cents += amount;
    else if (entryType === 'bag_recovery') summary.bag_recovery_cents += amount;
    else if (entryType === 'digital_cert_recovery') summary.digital_cert_recovery_cents += amount;
    else summary.other_financial_recovery_cents += amount;

    driverRow.financial_recovery_cents += amount;
    driverRow.net_movement_cents -= amount;
    summary.net_movement_cents -= amount;
  }

  const driverIds = [...byDriver.keys()];
  const balanceByDriver = new Map<string, number>();
  if (driverIds.length) {
    const { data: accounts } = await db
      .from('billing_quota_accounts')
      .select('driver_id, balance_cents')
      .eq('workspace_id', workspaceId)
      .in('driver_id', driverIds);
    for (const account of accounts || []) {
      balanceByDriver.set(String(account.driver_id), Number(account.balance_cents || 0));
    }
  }

  const by_driver = [...byDriver.values()]
    .map((row) => ({
      ...row,
      quota_balance_cents: balanceByDriver.get(row.driver_id) || 0,
    }))
    .sort((a, b) => (b.net_movement_cents || 0) - (a.net_movement_cents || 0));

  return { month, summary, by_driver, lines };
}
