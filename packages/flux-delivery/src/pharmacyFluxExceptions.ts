import { fluxPharmacyKey } from './fluxFieldParsers';

/**
 * TEMPORARY workaround (remove when CNPJs Flux/Aethera are aligned and API idLoja
 * vs MySQL CodLoc are unified on pharmacies.flux_codpes/codloc).
 *
 * Indiana LJ 06 / LJ 19: Flux API uses idLoja (often stored as codpes=0:idLoja) while
 * MySQL arqrotas uses CodPes=7 + CodLoc=loja. Aethera CNPJ may also diverge from Flux.
 * These allowlist entries force delivery/pharmacy resolve to the correct Aethera pharmacy.
 *
 * Workspace: produção Flux Farma (f8d5146d-…).
 */
export const PROD_FLUX_FARMA_WORKSPACE_ID = 'f8d5146d-fd15-4f04-a068-35a47848c7da';

/** Aethera FARMACIA E DRUGSTORE INDIANA LJ 06 */
export const INDIANA_LJ06_PHARMACY_ID = '60aa74f6-e09e-450e-bcf4-72d011342c9f';

/** Aethera FARMACIA E DROGARIA INDIANA 19 */
export const INDIANA_LJ19_PHARMACY_ID = '42f9e03c-7bf2-4ccd-974f-76fc9e6d3aab';

/** LJ 139 — sem cadastro no Aethera; nunca importar entregas deste CNPJ. */
export const EXCLUDED_BILLING_INGEST_CNPJ_DIGITS = new Set(['25102146014714']);

export type FluxPharmacyKeyException = {
  workspaceId: string;
  pharmacyId: string;
  /** Human note for operators / future cleanup */
  note: string;
};

/**
 * Map Flux CodPes:CodLoc → Aethera pharmacy_id (overrides CNPJ / stale flux columns).
 * Keys cover both MySQL (7:N) and API idLoja (0:idLoja) for the same loja.
 */
export const FLUX_PHARMACY_KEY_EXCEPTIONS: Readonly<Record<string, FluxPharmacyKeyException>> = {
  // Indiana LJ 06 — MySQL CodPes/CodLoc
  '7:6': {
    workspaceId: PROD_FLUX_FARMA_WORKSPACE_ID,
    pharmacyId: INDIANA_LJ06_PHARMACY_ID,
    note: 'TEMP Indiana LJ 06 MySQL 7/6 → Aethera LJ 06 (CNPJ may diverge)',
  },
  // Indiana LJ 06 — Flux API idLoja=4
  '0:4': {
    workspaceId: PROD_FLUX_FARMA_WORKSPACE_ID,
    pharmacyId: INDIANA_LJ06_PHARMACY_ID,
    note: 'TEMP Indiana LJ 06 API idLoja=4 → Aethera LJ 06 (CNPJ may diverge)',
  },
  // Indiana LJ 19 — MySQL CodPes/CodLoc
  '7:19': {
    workspaceId: PROD_FLUX_FARMA_WORKSPACE_ID,
    pharmacyId: INDIANA_LJ19_PHARMACY_ID,
    note: 'TEMP Indiana LJ 19 MySQL 7/19 → Aethera LJ 19 (CNPJ may diverge)',
  },
  // Indiana LJ 19 — Flux API idLoja=6 (do not confuse with MySQL CodLoc=6 = LJ 06)
  '0:6': {
    workspaceId: PROD_FLUX_FARMA_WORKSPACE_ID,
    pharmacyId: INDIANA_LJ19_PHARMACY_ID,
    note: 'TEMP Indiana LJ 19 API idLoja=6 → Aethera LJ 19 (CNPJ may diverge)',
  },
};

export function resolveFluxPharmacyException(
  workspaceId: string,
  codpes: number | null | undefined,
  codloc: number | null | undefined
): string | null {
  if (codloc == null || !Number.isFinite(Number(codloc))) return null;
  const pes = codpes != null && Number.isFinite(Number(codpes)) ? Number(codpes) : 0;
  const key = fluxPharmacyKey(pes, Number(codloc));
  const hit = FLUX_PHARMACY_KEY_EXCEPTIONS[key];
  if (!hit || hit.workspaceId !== workspaceId) return null;
  return hit.pharmacyId;
}
