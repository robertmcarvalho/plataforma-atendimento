export const EXCLUDABLE_LINE_KINDS = ['deliveries', 'minimum_guarantee', 'daily'] as const;
export type ExcludableLineKind = (typeof EXCLUDABLE_LINE_KINDS)[number];
export type SettlementExclusionScope = 'driver' | 'line';

export type SettlementExclusion = {
  id?: string;
  driverId: string;
  pharmacyId: string;
  scope: SettlementExclusionScope;
  lineKind: string | null;
  lineFingerprint: string | null;
  justification: string;
  pharmacyAmountCentsBefore: number;
  driverAmountCentsBefore: number;
};

export type ExcludableSettlementLine = {
  kind: string;
  description: string | null;
  pharmacy_amount_cents: number;
  driver_amount_cents: number;
  metadata?: Record<string, unknown>;
};

export function isExcludableLineKind(kind: string): kind is ExcludableLineKind {
  return (EXCLUDABLE_LINE_KINDS as readonly string[]).includes(kind);
}

export function settlementLineFingerprint(line: {
  kind: string;
  metadata?: Record<string, unknown> | null;
}): string {
  const meta = line.metadata && typeof line.metadata === 'object' ? line.metadata : {};
  const rule = String(meta.allocation_rule || meta.contracted_rule || '');
  return `${line.kind}:${rule}`;
}

export function exclusionMatchesLine(
  exclusion: SettlementExclusion,
  driverId: string,
  line: ExcludableSettlementLine
): boolean {
  if (exclusion.driverId !== driverId) return false;
  if (exclusion.scope === 'driver') return isExcludableLineKind(line.kind);
  if (exclusion.scope !== 'line') return false;
  if (exclusion.lineKind && exclusion.lineKind !== line.kind) return false;
  if (exclusion.lineFingerprint && exclusion.lineFingerprint !== settlementLineFingerprint(line)) return false;
  return isExcludableLineKind(line.kind);
}

export function driverIsFullyExcluded(
  exclusions: SettlementExclusion[],
  driverId: string,
  pharmacyId: string
): boolean {
  return exclusions.some(
    (row) => row.driverId === driverId && row.pharmacyId === pharmacyId && row.scope === 'driver'
  );
}

export function applySettlementExclusionOverlay(input: {
  driverId: string;
  pharmacyId: string;
  lines: ExcludableSettlementLine[];
  exclusions: SettlementExclusion[];
}): { lines: ExcludableSettlementLine[]; excluded: boolean } {
  const relevant = input.exclusions.filter(
    (row) => row.driverId === input.driverId && row.pharmacyId === input.pharmacyId
  );
  // Sempre devolve cópia: o motor esvazia o array original ao aplicar o overlay.
  if (!relevant.length) return { lines: [...input.lines], excluded: false };

  const fullDriver = relevant.some((row) => row.scope === 'driver');
  const out: ExcludableSettlementLine[] = [];
  let excluded = false;
  for (const line of input.lines) {
    const match = relevant.find((row) => exclusionMatchesLine(row, input.driverId, line));
    if (!match && !fullDriver) {
      out.push(line);
      continue;
    }
    if (!isExcludableLineKind(line.kind) && !fullDriver) {
      out.push(line);
      continue;
    }
    excluded = true;
    out.push({
      ...line,
      pharmacy_amount_cents: 0,
      driver_amount_cents: 0,
      metadata: {
        ...(line.metadata || {}),
        billing_exclusion: true,
        billing_exclusion_scope: match?.scope || 'driver',
        billing_exclusion_justification: match?.justification || relevant[0]?.justification,
        pharmacy_amount_cents_before: line.pharmacy_amount_cents,
        driver_amount_cents_before: line.driver_amount_cents,
      },
    });
  }
  return { lines: out, excluded };
}
