export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Setores do JWT: lista nova ou fallback para sector_id único. */
export function sectorIdsFromJwt(user: {
  sector_id?: string | null;
  sector_ids?: unknown;
}): string[] {
  const raw = user.sector_ids;
  if (Array.isArray(raw)) {
    const ids = raw.filter((x): x is string => typeof x === 'string' && isUuid(x));
    if (ids.length) return ids;
  }
  const sid = user.sector_id;
  return sid && isUuid(sid) ? [sid] : [];
}
