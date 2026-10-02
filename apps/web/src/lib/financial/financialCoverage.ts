import type { ApiEntry, CoverageEntryRef } from '@/lib/financial/types';
import { coverageRoleLabel, occurrenceKindLabel } from '@/lib/financial/financialLabels';

export function buildCoverageMaps(entries: ApiEntry[]) {
  const byId = new Map<string, ApiEntry>();
  const dailiesByAbsenceId = new Map<string, ApiEntry[]>();
  for (const e of entries) {
    byId.set(e.id, e);
    if (e.coverage_of_entry_id) {
      const list = dailiesByAbsenceId.get(e.coverage_of_entry_id) || [];
      list.push(e);
      dailiesByAbsenceId.set(e.coverage_of_entry_id, list);
    }
  }
  return { byId, dailiesByAbsenceId };
}

export type CoverageMaps = ReturnType<typeof buildCoverageMaps>;

/** PostgREST pode devolver objeto ou array; garante id via fallback FK. */
export function normalizeCoverageRef(
  raw: unknown,
  fallbackId?: string | null
): CoverageEntryRef | null {
  let ref: CoverageEntryRef | null = null;
  if (Array.isArray(raw)) {
    ref = (raw.find((r) => r && typeof r === 'object' && 'id' in r) as CoverageEntryRef) ?? null;
  } else if (raw && typeof raw === 'object') {
    ref = raw as CoverageEntryRef;
  }
  const id = ref?.id ?? fallbackId ?? null;
  if (!id) return null;
  return { ...(ref || {}), id };
}

export function resolveCoverageAbsence(
  entry: ApiEntry,
  maps: CoverageMaps
): CoverageEntryRef | ApiEntry | null {
  const fromJoin = normalizeCoverageRef(entry.coverage_of_entry, entry.coverage_of_entry_id);
  if (entry.coverage_of_entry_id) {
    const cached = maps.byId.get(entry.coverage_of_entry_id);
    if (cached && (!fromJoin?.event_date && !fromJoin?.occurrence_kind && !fromJoin?.notes)) return cached;
    if (fromJoin) return fromJoin;
    return cached || { id: entry.coverage_of_entry_id };
  }
  if (fromJoin) return fromJoin;
  return null;
}

export function resolveLinkedEntryId(
  entry: ApiEntry,
  linked: CoverageEntryRef | ApiEntry | null | undefined
): string | null {
  if (linked && 'id' in linked && linked.id) return linked.id;
  if (entry.coverage_of_entry_id) return entry.coverage_of_entry_id;
  return null;
}

export function resolveCoverageDailies(entry: ApiEntry, maps: CoverageMaps): CoverageEntryRef[] {
  if (entry.coverage_dailies?.length) {
    return entry.coverage_dailies
      .map((d) => normalizeCoverageRef(d, d.id))
      .filter((d): d is CoverageEntryRef => Boolean(d?.id));
  }
  return maps.dailiesByAbsenceId.get(entry.id) || [];
}

export function coverageListHint(entry: ApiEntry, maps: CoverageMaps): string | null {
  const absence = resolveCoverageAbsence(entry, maps);
  if (entry.coverage_of_entry_id && entry.type === 'daily') {
    const kind = occurrenceKindLabel(absence?.occurrence_kind);
    const role = coverageRoleLabel(absence?.occurrence_kind);
    const name = absence?.drivers?.name || 'titular';
    return kind === 'Folga'
      ? `Diária ${role} · folga de ${name}`
      : `Diária ${role} · falta de ${name}`;
  }
  const dailies = resolveCoverageDailies(entry, maps);
  const kind = occurrenceKindLabel(entry.occurrence_kind);
  if (entry.type === 'absence' && kind === 'Folga') {
    if (dailies.length) {
      const names = dailies.map((d) => d.drivers?.name || '—').join(', ');
      return `Folga · folguista: ${names}`;
    }
    return 'Folga informativa';
  }
  if (entry.type === 'absence' && (kind === 'Falta' || entry.status === 'pending_approval')) {
    if (dailies.length) {
      const names = dailies.map((d) => d.drivers?.name || '—').join(', ');
      return `Falta · diarista: ${names}`;
    }
    return 'Falta aguard. financeiro';
  }
  return null;
}
