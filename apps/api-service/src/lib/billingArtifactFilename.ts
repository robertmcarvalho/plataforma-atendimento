/**
 * Nomes amigáveis para Content-Disposition (download / futuros anexos de e-mail).
 * Paths internos do storage permanecem opacos ({workspaceId}/{id}/…).
 *
 * Padrão: {entity}_{pharmacySlug}_{cnpj8}_{cycleStart}-{cycleEnd}_{tipo}_{docRef}.{ext}
 * @see reports/billing-boleto-nfse-pdf-naming-plan-2026-09-08.md §B
 */

export type BillingArtifactEntity = 'flux' | 'coop';

export type BillingArtifactTipo =
  | 'nfse-xml'
  | 'nfse-dps'
  | 'danfse'
  | 'danfse_aux'
  | 'boleto'
  | 'boleto-linha'
  | 'nfse-evento-cancel';

const TIPO_EXT: Record<BillingArtifactTipo, string> = {
  'nfse-xml': 'xml',
  'nfse-dps': 'xml',
  danfse: 'pdf',
  danfse_aux: 'pdf',
  boleto: 'pdf',
  'boleto-linha': 'txt',
  'nfse-evento-cancel': 'xml',
};

const MAX_SLUG = 24;
const MAX_DOCREF = 48;
const MAX_FILENAME = 180;

/** Sanitiza um segmento: ASCII, lower, só [a-z0-9._-], sem path traversal. */
export function sanitizeFilenameSegment(raw: string, maxLen = MAX_SLUG): string {
  const nfd = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  let out = nfd
    .toLowerCase()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (out.includes('..')) out = out.replace(/\.\./g, '');
  if (!out) out = 'x';
  if (out.length > maxLen) out = out.slice(0, maxLen).replace(/[-.]+$/g, '') || 'x';
  return out;
}

/** 8 primeiros dígitos do CNPJ (raiz); se incompleto, preenche com 0 à esquerda até 8. */
export function cnpjRoot8(cnpj: string | null | undefined): string {
  const digits = String(cnpj || '').replace(/\D/g, '');
  if (digits.length >= 8) return digits.slice(0, 8);
  return digits.padStart(8, '0');
}

/** YYYY-MM-DD ou Date-like → YYYYMMDD; vazio → 00000000. */
export function cycleDateToken(isoDate: string | null | undefined): string {
  const s = String(isoDate || '').trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '00000000';
  return `${m[1]}${m[2]}${m[3]}`;
}

export type BillingArtifactFilenameInput = {
  entity: BillingArtifactEntity;
  pharmacyName?: string | null;
  cnpj?: string | null;
  cycleStart?: string | null;
  cycleEnd?: string | null;
  tipo: BillingArtifactTipo;
  docRef: string;
};

/**
 * Monta filename seguro para Content-Disposition (sem aspas/path).
 * Ex.: flux_delta_12345678_20260817-20260823_boleto_inv_yOgInV7r.pdf
 */
export function buildBillingArtifactFilename(input: BillingArtifactFilenameInput): string {
  const entity = input.entity === 'coop' ? 'coop' : 'flux';
  const slug = sanitizeFilenameSegment(input.pharmacyName || 'farmacia', MAX_SLUG);
  const cnpj8 = cnpjRoot8(input.cnpj);
  const start = cycleDateToken(input.cycleStart);
  const end = cycleDateToken(input.cycleEnd);
  const tipo = input.tipo;
  const docRef = sanitizeFilenameSegment(input.docRef || 'doc', MAX_DOCREF);
  const ext = TIPO_EXT[tipo];

  let name = `${entity}_${slug}_${cnpj8}_${start}-${end}_${tipo}_${docRef}.${ext}`;
  if (name.length > MAX_FILENAME) {
    const overflow = name.length - MAX_FILENAME;
    const trimmedRef = sanitizeFilenameSegment(
      docRef.slice(0, Math.max(8, docRef.length - overflow)),
      MAX_DOCREF
    );
    name = `${entity}_${slug}_${cnpj8}_${start}-${end}_${tipo}_${trimmedRef}.${ext}`;
  }
  return name;
}

/** Header Content-Disposition attachment; `filename` deve vir de `buildBillingArtifactFilename`. */
export function billingArtifactContentDisposition(filename: string): string {
  const safe = String(filename || 'download.bin')
    .replace(/["\\\r\n]/g, '')
    .slice(0, MAX_FILENAME);
  return `attachment; filename="${safe || 'download.bin'}"`;
}
