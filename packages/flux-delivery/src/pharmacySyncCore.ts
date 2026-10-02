import type { SupabaseClient } from '@supabase/supabase-js';
import type { FluxDeliveryClient } from './client';
import {
  fluxPharmacyKey,
  onlyDigits,
  parseFluxCnpj,
  parseFluxCodLoc,
  parseFluxCodPes,
  pickField,
} from './fluxFieldParsers';
import { resolveFluxPharmacyException } from './pharmacyFluxExceptions';

export type FluxPharmacySyncResult = {
  workspace_id: string;
  flux_total: number;
  matched: number;
  updated: number;
  already_linked: number;
  unmatched_flux: number;
  unmatched_local: number;
  warnings: Array<{ type: string; message: string }>;
};

type PharmacyRow = {
  id: string;
  cnpj?: string | null;
  flux_codpes?: number | null;
  flux_codloc?: number | null;
};

export async function runFluxPharmacySyncForWorkspace(
  db: SupabaseClient,
  opts: {
    workspaceId: string;
    fluxClient: FluxDeliveryClient;
    forceOverwrite?: boolean;
    dryRun?: boolean;
    pageSize?: number;
  }
): Promise<FluxPharmacySyncResult> {
  const result: FluxPharmacySyncResult = {
    workspace_id: opts.workspaceId,
    flux_total: 0,
    matched: 0,
    updated: 0,
    already_linked: 0,
    unmatched_flux: 0,
    unmatched_local: 0,
    warnings: [],
  };

  const { data: pharmacies, error: phErr } = await db
    .from('pharmacies')
    .select('id, cnpj, flux_codpes, flux_codloc')
    .eq('workspace_id', opts.workspaceId);
  if (phErr) {
    result.warnings.push({ type: 'load_pharmacies_failed', message: phErr.message });
    return result;
  }

  const byCnpj = new Map<string, PharmacyRow>();
  const byFluxKey = new Map<string, PharmacyRow>();
  for (const raw of pharmacies || []) {
    const p = raw as PharmacyRow;
    if (p.cnpj) byCnpj.set(onlyDigits(String(p.cnpj)), p);
    if (p.flux_codpes != null && p.flux_codloc != null) {
      byFluxKey.set(fluxPharmacyKey(Number(p.flux_codpes), Number(p.flux_codloc)), p);
    }
  }

  const fluxRows = await opts.fluxClient.fetchAllFarmacias({ pageSize: opts.pageSize ?? 50 });
  result.flux_total = fluxRows.length;
  const linkedFluxKeys = new Set<string>();

  for (const row of fluxRows) {
    const rawCodpes = parseFluxCodPes(row);
    const codloc = parseFluxCodLoc(row);
    if (codloc == null) {
      result.unmatched_flux += 1;
      continue;
    }
    const codpes = rawCodpes ?? 0;

    const key = fluxPharmacyKey(codpes, codloc);
    const cnpj = parseFluxCnpj(row);
    // TEMP: Indiana LJ 06/19 — prefer CodPes/CodLoc allowlist even when CNPJ diverges.
    const exceptionPharmacyId = resolveFluxPharmacyException(opts.workspaceId, codpes, codloc);
    let match: PharmacyRow | undefined = exceptionPharmacyId
      ? (pharmacies || []).find((p) => (p as PharmacyRow).id === exceptionPharmacyId) as PharmacyRow | undefined
      : undefined;
    if (!match) match = byFluxKey.get(key);
    if (!match && cnpj) match = byCnpj.get(cnpj) ?? undefined;

    if (!match) {
      result.unmatched_flux += 1;
      const name = String(pickField(row, ['nomeFarmacia', 'razaoSocial', 'nome', 'trade_name']) || key);
      result.warnings.push({ type: 'flux_pharmacy_unmatched', message: `${name} (${key})` });
      continue;
    }

    result.matched += 1;
    linkedFluxKeys.add(key);

    const hasLink =
      match.flux_codpes === codpes &&
      match.flux_codloc === codloc;
    if (hasLink) {
      result.already_linked += 1;
      continue;
    }

    // TEMP exception: keep MySQL CodPes/CodLoc (e.g. 7/19) when API returns idLoja (0/6).
    if (exceptionPharmacyId && match.flux_codpes != null && match.flux_codloc != null) {
      result.already_linked += 1;
      continue;
    }

    if (
      !opts.forceOverwrite &&
      match.flux_codpes != null &&
      match.flux_codloc != null &&
      (match.flux_codpes !== codpes || match.flux_codloc !== codloc)
    ) {
      result.warnings.push({
        type: 'flux_ids_conflict',
        message: `Farmácia ${match.id} já tem ${match.flux_codpes}/${match.flux_codloc}, Flux retornou ${codpes}/${codloc}`,
      });
      continue;
    }

    if (!opts.dryRun) {
      const { error } = await db
        .from('pharmacies')
        .update({
          flux_codpes: codpes,
          flux_codloc: codloc,
          updated_at: new Date().toISOString(),
        })
        .eq('id', match.id)
        .eq('workspace_id', opts.workspaceId);
      if (error) {
        result.warnings.push({ type: 'update_failed', message: error.message });
        continue;
      }
      match.flux_codpes = codpes;
      match.flux_codloc = codloc;
      byFluxKey.set(key, match);
    }
    result.updated += 1;
  }

  for (const p of pharmacies || []) {
    const row = p as PharmacyRow;
    if (row.flux_codpes != null && row.flux_codloc != null) {
      const key = fluxPharmacyKey(Number(row.flux_codpes), Number(row.flux_codloc));
      if (!linkedFluxKeys.has(key)) result.unmatched_local += 1;
    }
  }

  return result;
}
