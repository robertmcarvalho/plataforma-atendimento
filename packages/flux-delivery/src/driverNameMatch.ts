/**
 * Safe fuzzy matching for Flux delivery driver names vs local drivers.
 * Used when exact name / flux id / CPF / catalog id miss (truncated Flux names).
 */

export type NamedDriver = { id: string; nameKey: string };

export function normalizeDriverName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance; short-circuits above `max`. */
function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return false;
  if (la === 0 || lb === 0) return Math.max(la, lb) <= max;

  // Two-row DP, early exit when row min > max
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return false;
    [prev, curr] = [curr, prev];
  }
  return prev[lb] <= max;
}

function tokensMatch(fluxToken: string, localToken: string): boolean {
  if (fluxToken === localToken) return true;
  // Single-letter initial: "H" ↔ "HEINRICK"
  if (fluxToken.length === 1 && localToken.startsWith(fluxToken)) return true;
  // Truncated token (min 3 chars): "FERREIR" ↔ "FERREIRA", "VINICIO" ↔ "VINICIOS"
  if (fluxToken.length >= 3 && localToken.startsWith(fluxToken)) return true;
  // Near-typo on longer tokens: "MARCUS" ↔ "MARCOS" (edit distance 1)
  if (fluxToken.length >= 5 && localToken.length >= 5 && editDistanceAtMost(fluxToken, localToken, 1)) {
    return true;
  }
  return false;
}

function tokensAlign(fluxTokens: string[], localTokens: string[]): boolean {
  if (fluxTokens.length < 2) return false;
  if (localTokens.length < fluxTokens.length) return false;
  return fluxTokens.every((ft, i) => tokensMatch(ft, localTokens[i]!));
}

/**
 * Returns the unique local driver id matching a normalized Flux name, or null
 * when there are 0 or >1 candidates (never auto-link ambiguous names).
 *
 * Prefer string/token prefix rules over loose token overlap.
 */
export function matchUniqueDriverByNameSimilarity(
  fluxNameKey: string,
  localDrivers: NamedDriver[]
): string | null {
  if (!fluxNameKey || fluxNameKey.length < 3) return null;

  // 1) Flux name is a prefix of exactly one local name
  //    - full words: "MARCUS VINICIOS" → "MARCUS VINICIOS DA SILVA"
  //    - truncated last token: "JEFERSON ANDRADE FERREIR" → "JEFERSON ANDRADE FERREIRA"
  const prefixHits = localDrivers.filter((d) => {
    const local = d.nameKey;
    if (!local) return false;
    if (local === fluxNameKey) return true;
    if (local.startsWith(`${fluxNameKey} `)) return true;
    if (local.startsWith(fluxNameKey)) {
      const rest = local.slice(fluxNameKey.length);
      // Continuation of the last token (no space) — truncation mid-word
      return rest.length > 0 && !rest.startsWith(' ');
    }
    return false;
  });
  if (prefixHits.length === 1) return prefixHits[0].id;
  if (prefixHits.length > 1) return null;

  // 2) Leading tokens: Flux tokens align as a prefix of local tokens
  //    (exact, initial, truncated, or edit-distance-1 on long tokens)
  const fluxTokens = fluxNameKey.split(' ').filter(Boolean);
  const tokenHits = localDrivers.filter((d) => {
    if (!d.nameKey) return false;
    return tokensAlign(fluxTokens, d.nameKey.split(' ').filter(Boolean));
  });
  if (tokenHits.length === 1) return tokenHits[0].id;
  return null;
}
