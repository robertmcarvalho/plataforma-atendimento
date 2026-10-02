import type { SupabaseClient } from '@supabase/supabase-js';
import type { FluxDeliveryClient } from './client';
import {
  matchUniqueDriverByNameSimilarity,
  normalizeDriverName,
  type NamedDriver,
} from './driverNameMatch';
import {
  onlyDigits,
  parseFluxCnpj,
  parseFluxCodLoc,
  parseFluxCodPes,
  parseFluxDeliveryAt,
  parseFluxDeliveryExternalKey,
  parseFluxDocumentNumber,
  parseFluxDriverCpf,
  parseFluxDriverId,
  parseFluxRouteId,
  pickField,
} from './fluxFieldParsers';
import {
  buildPharmacyCnpjIndex,
  resolveFluxApiDeliveryPharmacyId,
} from './resolveDeliveryPharmacy';

export type FluxDeliverySyncResult = {
  workspace_id: string;
  period_start: string;
  period_end: string;
  flux_total: number;
  imported: number;
  skipped_duplicate: number;
  skipped_unmapped_pharmacy: number;
  skipped_unmapped_driver: number;
  skipped_invalid: number;
  matched_by_cpf: number;
  matched_by_catalog_id: number;
  matched_by_name_similarity: number;
  linked_flux_driver_id: number;
  skipped_ambiguous_cpf: number;
  /** Deliveries with null billing_cycle_id linked to overlapping open cycles after sync. */
  assigned_to_cycle: number;
  warnings: Array<{ type: string; message: string }>;
};

function toDateOnly(value: unknown): string {
  return String(value ?? '').slice(0, 10);
}

/**
 * Attach unlinked (billing_cycle_id IS NULL) deliveries to open cycles whose
 * apuracao range overlaps [periodStart, periodEnd]. Safe to call after import:
 * does not move rows already linked to a cycle; cancelled rows are skipped.
 */
export async function linkNullDeliveriesToOpenCycles(
  db: SupabaseClient,
  workspaceId: string,
  periodStart: string,
  periodEnd: string
): Promise<number> {
  const start = toDateOnly(periodStart);
  const end = toDateOnly(periodEnd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return 0;

  const { data: cycles, error: cycleErr } = await db
    .from('billing_cycles')
    .select('id, apuracao_start, apuracao_end')
    .eq('workspace_id', workspaceId)
    .eq('status', 'open')
    .lte('apuracao_start', end)
    .gte('apuracao_end', start);
  if (cycleErr) throw new Error(cycleErr.message);
  if (!cycles?.length) return 0;

  let assigned = 0;
  const now = new Date().toISOString();
  for (const cycle of cycles) {
    const apuracaoStart = toDateOnly(cycle.apuracao_start);
    const apuracaoEnd = toDateOnly(cycle.apuracao_end);
    if (!apuracaoStart || !apuracaoEnd) continue;

    // Count first — PostgREST may truncate .select() after large updates.
    const { count: beforeNull, error: countErr } = await db
      .from('billing_delivery_records')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .is('billing_cycle_id', null)
      .eq('cancelled', false)
      .gte('delivered_at', `${apuracaoStart}T00:00:00.000Z`)
      .lte('delivered_at', `${apuracaoEnd}T23:59:59.999Z`);
    if (countErr) throw new Error(countErr.message);
    if (!beforeNull) continue;

    const { error: updErr } = await db
      .from('billing_delivery_records')
      .update({ billing_cycle_id: cycle.id, updated_at: now })
      .eq('workspace_id', workspaceId)
      .is('billing_cycle_id', null)
      .eq('cancelled', false)
      .gte('delivered_at', `${apuracaoStart}T00:00:00.000Z`)
      .lte('delivered_at', `${apuracaoEnd}T23:59:59.999Z`);
    if (updErr) throw new Error(updErr.message);
    assigned += beforeNull;
  }
  return assigned;
}

type PharmacyRow = { id: string; cnpj?: string | null };
type DriverRow = {
  id: string;
  name?: string | null;
  cpf?: string | null;
  flux_delivery_driver_id?: string | null;
};

type CatalogEntry = { id: string | null; cpf: string | null };

async function loadFluxDriverCatalog(
  fluxClient: FluxDeliveryClient
): Promise<{ byName: Map<string, CatalogEntry>; warning?: string }> {
  const byName = new Map<string, CatalogEntry>();
  try {
    const rows = await fluxClient.fetchAllEntregadores({ pageSize: 50 });
    for (const row of rows) {
      const nameKey = normalizeDriverName(pickField(row, ['nomeEntregador', 'entregador', 'nome']));
      if (!nameKey) continue;
      const id = parseFluxDriverId(row);
      const cpf = parseFluxDriverCpf(row);
      // Prefer first occurrence; duplicates with conflicting id/cpf are ignored later via unique maps.
      if (!byName.has(nameKey)) byName.set(nameKey, { id, cpf });
    }
  } catch (err) {
    return {
      byName,
      warning: `flux_entregadores_catalog_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { byName };
}

export async function runFluxDeliverySyncForWorkspace(
  db: SupabaseClient,
  opts: {
    workspaceId: string;
    fluxClient: FluxDeliveryClient;
    dataInicio: string;
    dataFim: string;
    dryRun?: boolean;
    pageSize?: number;
    /** When false, skip Flux entregadores catalog enrichment (CPF/id via nome). Default true. */
    useDriverCatalog?: boolean;
  }
): Promise<FluxDeliverySyncResult> {
  const result: FluxDeliverySyncResult = {
    workspace_id: opts.workspaceId,
    period_start: opts.dataInicio,
    period_end: opts.dataFim,
    flux_total: 0,
    imported: 0,
    skipped_duplicate: 0,
    skipped_unmapped_pharmacy: 0,
    skipped_unmapped_driver: 0,
    skipped_invalid: 0,
    matched_by_cpf: 0,
    matched_by_catalog_id: 0,
    matched_by_name_similarity: 0,
    linked_flux_driver_id: 0,
    skipped_ambiguous_cpf: 0,
    assigned_to_cycle: 0,
    warnings: [],
  };

  const [{ data: pharmacies }, { data: drivers }] = await Promise.all([
    db.from('pharmacies').select('id, cnpj').eq('workspace_id', opts.workspaceId),
    db
      .from('drivers')
      .select('id, name, cpf, flux_delivery_driver_id')
      .eq('workspace_id', opts.workspaceId),
  ]);

  const pharmacyIndex = buildPharmacyCnpjIndex((pharmacies || []) as PharmacyRow[]);

  const driverByFlux = new Map<string, string>();
  const driverByName = new Map<string, string>();
  const driverFluxIdByLocalId = new Map<string, string | null>();
  const namedDriversForSimilarity: NamedDriver[] = [];
  const cpfCounts = new Map<string, number>();
  const driverByCpf = new Map<string, string>();

  for (const raw of drivers || []) {
    const d = raw as DriverRow;
    const fluxId = d.flux_delivery_driver_id ? String(d.flux_delivery_driver_id) : null;
    driverFluxIdByLocalId.set(d.id, fluxId);
    if (fluxId) driverByFlux.set(fluxId, d.id);
    const nameKey = normalizeDriverName(d.name);
    if (nameKey) {
      driverByName.set(nameKey, d.id);
      namedDriversForSimilarity.push({ id: d.id, nameKey });
    }
    const cpf = onlyDigits(d.cpf);
    if (cpf) cpfCounts.set(cpf, (cpfCounts.get(cpf) || 0) + 1);
  }
  for (const raw of drivers || []) {
    const d = raw as DriverRow;
    const cpf = onlyDigits(d.cpf);
    if (!cpf) continue;
    if ((cpfCounts.get(cpf) || 0) === 1) driverByCpf.set(cpf, d.id);
  }

  const useCatalog = opts.useDriverCatalog !== false;
  let catalogByName = new Map<string, CatalogEntry>();
  if (useCatalog) {
    const catalog = await loadFluxDriverCatalog(opts.fluxClient);
    catalogByName = catalog.byName;
    if (catalog.warning) {
      result.warnings.push({ type: 'flux_entregadores_catalog_failed', message: catalog.warning });
    }
  }

  const fluxRows = await opts.fluxClient.fetchEntregasPorPeriodo({
    dataInicio: opts.dataInicio,
    dataFim: opts.dataFim,
    pageSize: opts.pageSize ?? 50,
  });
  result.flux_total = fluxRows.length;

  const inserts: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  const ambiguousCpfsWarned = new Set<string>();
  /** Safe pending links: local driver id → Flux catalog idEntregador (only when unset locally). */
  const pendingFluxIdByDriver = new Map<string, string>();

  for (const row of fluxRows) {
    const codpes = parseFluxCodPes(row);
    const codloc = parseFluxCodLoc(row);
    const driverFluxId = parseFluxDriverId(row);
    const deliveredAt = parseFluxDeliveryAt(row);
    const externalKey = parseFluxDeliveryExternalKey(row);

    if (codloc == null || !deliveredAt || !externalKey) {
      result.skipped_invalid += 1;
      continue;
    }

    const driverName = pickField(row, ['nomeEntregador', 'entregador', 'nome']) as string | null;
    const nameKey = normalizeDriverName(driverName);
    const rowCpf = parseFluxDriverCpf(row);
    const catalog = nameKey ? catalogByName.get(nameKey) : undefined;

    let driverId =
      (driverFluxId ? driverByFlux.get(driverFluxId) : undefined) ||
      (nameKey ? driverByName.get(nameKey) : undefined);

    if (!driverId && catalog?.id) {
      const viaCatalogId = driverByFlux.get(catalog.id);
      if (viaCatalogId) {
        driverId = viaCatalogId;
        result.matched_by_catalog_id += 1;
      }
    }

    if (!driverId) {
      const cpfCandidates = [rowCpf, catalog?.cpf].filter(Boolean) as string[];
      for (const cpf of cpfCandidates) {
        const count = cpfCounts.get(cpf) || 0;
        if (count > 1) {
          result.skipped_ambiguous_cpf += 1;
          if (!ambiguousCpfsWarned.has(cpf)) {
            ambiguousCpfsWarned.add(cpf);
            result.warnings.push({
              type: 'ambiguous_driver_cpf',
              message: `CPF ***${cpf.slice(-4)} matches ${count} local drivers; delivery skipped`,
            });
          }
          break;
        }
        const viaCpf = driverByCpf.get(cpf);
        if (viaCpf) {
          driverId = viaCpf;
          result.matched_by_cpf += 1;
          break;
        }
      }
    }

    if (!driverId && nameKey) {
      const viaSimilarity = matchUniqueDriverByNameSimilarity(nameKey, namedDriversForSimilarity);
      if (viaSimilarity) {
        driverId = viaSimilarity;
        result.matched_by_name_similarity += 1;

        // Optionally link flux_delivery_driver_id when catalog id is known and safe.
        if (catalog?.id) {
          const currentFlux = driverFluxIdByLocalId.get(driverId);
          const takenByOther = driverByFlux.get(catalog.id);
          if (!currentFlux && (!takenByOther || takenByOther === driverId)) {
            pendingFluxIdByDriver.set(driverId, catalog.id);
            driverByFlux.set(catalog.id, driverId);
            driverFluxIdByLocalId.set(driverId, catalog.id);
          }
        }
      }
    }

    if (!driverId) {
      result.skipped_unmapped_driver += 1;
      continue;
    }

    const rowCnpj = parseFluxCnpj(row);
    const resolvedPharmacy = resolveFluxApiDeliveryPharmacyId(
      opts.workspaceId,
      codpes,
      codloc,
      rowCnpj,
      pharmacyIndex
    );
    if (!resolvedPharmacy) {
      result.skipped_unmapped_pharmacy += 1;
      continue;
    }
    const pharmacyId = resolvedPharmacy.pharmacyId;

    inserts.push({
      workspace_id: opts.workspaceId,
      pharmacy_id: pharmacyId,
      driver_id: driverId,
      delivered_at: deliveredAt,
      document_number: parseFluxDocumentNumber(row),
      route_id: parseFluxRouteId(row),
      source: 'flux_api',
      external_id: externalKey,
      flux_codpes: codpes ?? 0,
      flux_codloc: codloc,
      cancelled: false,
      verified: true,
      updated_at: now,
    });
  }

  if (opts.dryRun) {
    result.imported = inserts.length;
    result.linked_flux_driver_id = pendingFluxIdByDriver.size;
    return result;
  }

  if (pendingFluxIdByDriver.size) {
    for (const [driverId, fluxId] of pendingFluxIdByDriver) {
      const { error } = await db
        .from('drivers')
        .update({ flux_delivery_driver_id: fluxId, updated_at: now })
        .eq('id', driverId)
        .eq('workspace_id', opts.workspaceId)
        .is('flux_delivery_driver_id', null);
      if (error) {
        result.warnings.push({
          type: 'flux_driver_id_link_failed',
          message: `driver=${driverId} flux_id=${fluxId}: ${error.message}`,
        });
        continue;
      }
      result.linked_flux_driver_id += 1;
    }
  }

  if (inserts.length) {
    const chunkSize = 200;
    for (let i = 0; i < inserts.length; i += chunkSize) {
      const chunk = inserts.slice(i, i + chunkSize);
      const { data, error } = await db
        .from('billing_delivery_records')
        .upsert(chunk, { onConflict: 'workspace_id,source,external_id', ignoreDuplicates: true })
        .select('id');
      if (error) {
        result.warnings.push({ type: 'upsert_failed', message: error.message });
        break;
      }
      result.imported += (data || []).length;
    }
    result.skipped_duplicate = Math.max(0, inserts.length - result.imported);
  }

  // Always re-link orphans in the sync window (imports after cycle create, or duplicate re-sync).
  try {
    result.assigned_to_cycle = await linkNullDeliveriesToOpenCycles(
      db,
      opts.workspaceId,
      opts.dataInicio,
      opts.dataFim
    );
  } catch (err) {
    result.warnings.push({
      type: 'cycle_assign_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}
