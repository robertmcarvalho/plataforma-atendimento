import {
  isManualDiscountLine,
  MANUAL_DISCOUNT_SOURCE,
  PHARMACY_GROUP_SCOPE,
  type SettlementDiscountLine,
} from './billingSettlementDiscountClassification';

export type ManualDiscountSnapshot = {
  pharmacy_id: string;
  driver_id?: string;
  scope: 'pharmacy_group' | 'driver';
  kind: string;
  description: string | null;
  pharmacy_amount_cents: number;
  driver_amount_cents: number;
  metadata: Record<string, unknown>;
};

type SettlementLineRow = SettlementDiscountLine & {
  id: string;
  description: string | null;
  pharmacy_amount_cents: number;
};

type SettlementAnchorRow = {
  id: string;
  status: string;
  driver_id: string;
  drivers?: { name?: string } | { name?: string }[] | null;
};

function driverNameFromRow(row: SettlementAnchorRow): string {
  const raw = row.drivers;
  const driver = Array.isArray(raw) ? raw[0] : raw;
  return String(driver?.name || row.driver_id || '');
}

export function snapshotFromManualDiscountLine(
  settlement: { driver_id: string; pharmacy_id: string },
  line: SettlementLineRow
): ManualDiscountSnapshot {
  const meta = line.metadata && typeof line.metadata === 'object' ? line.metadata : {};
  const scope =
    meta.scope === PHARMACY_GROUP_SCOPE || meta.target === 'pharmacy' ? 'pharmacy_group' : 'driver';
  return {
    pharmacy_id: String(settlement.pharmacy_id),
    driver_id: scope === 'driver' ? String(settlement.driver_id) : undefined,
    scope,
    kind: String(line.kind),
    description: line.description,
    pharmacy_amount_cents: Number(line.pharmacy_amount_cents || 0),
    driver_amount_cents: Number(line.driver_amount_cents || 0),
    metadata: meta,
  };
}

export function pickAnchorSettlement<T extends SettlementAnchorRow>(settlements: T[]): T | null {
  if (!settlements.length) return null;
  return [...settlements].sort((a, b) =>
    driverNameFromRow(a).localeCompare(driverNameFromRow(b), 'pt-BR')
  )[0]!;
}

export function isPharmacyGroupSnapshot(snapshot: ManualDiscountSnapshot): boolean {
  return snapshot.scope === 'pharmacy_group';
}

export function isManualDiscountSnapshotLine(line: SettlementDiscountLine): boolean {
  return isManualDiscountLine(line);
}
