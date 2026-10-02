import { fluxPharmacyKey, normalizeFluxCnpjDigits } from './fluxFieldParsers';
import { EXCLUDED_BILLING_INGEST_CNPJ_DIGITS, resolveFluxPharmacyException } from './pharmacyFluxExceptions';

export type PharmacyFluxIndex = {
  pharmacyByFlux: Map<string, string>;
  pharmacyByLoc: Map<string, string>;
};

export type DriverPharmacyContext = {
  primaryPharmacyId: string | null;
  linkedPharmacyIds: string[];
};

export type ResolvedDeliveryPharmacy = {
  pharmacyId: string;
  disambiguated: boolean;
};

export function buildPharmacyFluxIndex(
  pharmacies: Array<{ id: string; flux_codpes?: number | null; flux_codloc?: number | null }>
): PharmacyFluxIndex {
  const pharmacyByFlux = new Map<string, string>();
  const pharmacyByLoc = new Map<string, string>();
  for (const pharmacy of pharmacies) {
    if (pharmacy.flux_codloc == null) continue;
    const loc = String(Number(pharmacy.flux_codloc));
    if (pharmacy.flux_codpes != null) {
      pharmacyByFlux.set(fluxPharmacyKey(Number(pharmacy.flux_codpes), Number(pharmacy.flux_codloc)), pharmacy.id);
    }
    if (!pharmacyByLoc.has(loc)) pharmacyByLoc.set(loc, pharmacy.id);
  }
  return { pharmacyByFlux, pharmacyByLoc };
}

/**
 * Resolve Flux CodPes/CodLoc to Aethera pharmacy_id.
 * When codpes is a non-zero explicit value, codloc-only fallback is not used — this avoids
 * routing e.g. 70:6 to Indiana LJ 06 just because it owns flux_codloc=6.
 */
export function resolveFluxPharmacyFromKeys(
  workspaceId: string,
  codpes: number | null | undefined,
  codloc: number | null | undefined,
  index: PharmacyFluxIndex
): string | null {
  if (codloc == null || !Number.isFinite(Number(codloc))) return null;

  const exception = resolveFluxPharmacyException(workspaceId, codpes, codloc);
  if (exception) return exception;

  const pes = codpes != null && Number.isFinite(Number(codpes)) ? Number(codpes) : null;
  if (pes != null && pes !== 0) {
    return index.pharmacyByFlux.get(fluxPharmacyKey(pes, Number(codloc))) || null;
  }

  return (
    index.pharmacyByLoc.get(String(Number(codloc))) ||
    index.pharmacyByFlux.get(fluxPharmacyKey(0, Number(codloc))) ||
    null
  );
}

/**
 * When Flux keys are ambiguous (e.g. Indiana 7:6 shared in MySQL), prefer the driver's
 * primary pharmacy if the resolved pharmacy is not among their active links.
 */
export function preferDriverLinkedPharmacy(
  resolvedPharmacyId: string,
  driver: DriverPharmacyContext | null | undefined
): ResolvedDeliveryPharmacy {
  if (!driver) return { pharmacyId: resolvedPharmacyId, disambiguated: false };

  const linked = new Set<string>();
  if (driver.primaryPharmacyId) linked.add(driver.primaryPharmacyId);
  for (const pharmacyId of driver.linkedPharmacyIds) linked.add(pharmacyId);

  if (linked.has(resolvedPharmacyId)) {
    return { pharmacyId: resolvedPharmacyId, disambiguated: false };
  }

  if (driver.primaryPharmacyId) {
    return { pharmacyId: driver.primaryPharmacyId, disambiguated: true };
  }

  return { pharmacyId: resolvedPharmacyId, disambiguated: false };
}

export function resolveDeliveryPharmacyId(
  workspaceId: string,
  codpes: number | null | undefined,
  codloc: number | null | undefined,
  index: PharmacyFluxIndex,
  driver: DriverPharmacyContext | null | undefined
): ResolvedDeliveryPharmacy | null {
  const resolved = resolveFluxPharmacyFromKeys(workspaceId, codpes, codloc, index);
  if (!resolved) return null;
  return preferDriverLinkedPharmacy(resolved, driver);
}

export type PharmacyCnpjIndex = Map<string, string>;

export function buildPharmacyCnpjIndex(
  pharmacies: Array<{ id: string; cnpj?: string | null }>
): PharmacyCnpjIndex {
  const pharmacyByCnpj: PharmacyCnpjIndex = new Map();
  for (const pharmacy of pharmacies) {
    const cnpj = normalizeFluxCnpjDigits(pharmacy.cnpj);
    if (cnpj) pharmacyByCnpj.set(cnpj, pharmacy.id);
  }
  return pharmacyByCnpj;
}

/**
 * Billing ingest (Flux API + MySQL): match pharmacy by CNPJ only. CodPes/CodLoc are ignored
 * except Indiana LJ 06/19 (7:6, 7:19) when Flux CNPJ diverges from Aethera.
 */
export function resolveBillingIngestPharmacyFromKeys(
  workspaceId: string,
  codpes: number | null | undefined,
  codloc: number | null | undefined,
  cnpj: string | null | undefined,
  index: PharmacyCnpjIndex
): string | null {
  const exception = resolveFluxPharmacyException(workspaceId, codpes, codloc);
  if (exception) return exception;

  const digits = normalizeFluxCnpjDigits(cnpj);
  if (!digits || EXCLUDED_BILLING_INGEST_CNPJ_DIGITS.has(digits)) return null;
  return index.get(digits) || null;
}

/** @deprecated Use resolveBillingIngestPharmacyFromKeys */
export const resolveMysqlDeliveryPharmacyFromKeys = resolveBillingIngestPharmacyFromKeys;

/** Flux API delivery sync — CNPJ-only (same rules as MySQL import). */
export const resolveFluxApiDeliveryPharmacyFromKeys = resolveBillingIngestPharmacyFromKeys;

export function resolveFluxApiDeliveryPharmacyId(
  workspaceId: string,
  codpes: number | null | undefined,
  codloc: number | null | undefined,
  cnpj: string | null | undefined,
  index: PharmacyCnpjIndex
): ResolvedDeliveryPharmacy | null {
  const resolved = resolveFluxApiDeliveryPharmacyFromKeys(workspaceId, codpes, codloc, cnpj, index);
  if (!resolved) return null;
  return { pharmacyId: resolved, disambiguated: false };
}

export function resolveMysqlDeliveryPharmacyId(
  workspaceId: string,
  codpes: number | null | undefined,
  codloc: number | null | undefined,
  cnpj: string | null | undefined,
  index: PharmacyCnpjIndex,
  _driver: DriverPharmacyContext | null | undefined
): ResolvedDeliveryPharmacy | null {
  const resolved = resolveMysqlDeliveryPharmacyFromKeys(workspaceId, codpes, codloc, cnpj, index);
  if (!resolved) return null;
  return { pharmacyId: resolved, disambiguated: false };
}
