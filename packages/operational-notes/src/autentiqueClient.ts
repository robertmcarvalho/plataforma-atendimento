const API_URL = 'https://api.autentique.com.br/v2/graphql';

export type AutentiqueSignature = {
  email: string | null;
  signed: { created_at: string } | null;
  viewed: { created_at: string } | null;
  rejected: { created_at: string } | null;
};

export type AutentiqueDocument = {
  id: string;
  name: string;
  created_at: string;
  signatures: AutentiqueSignature[];
};

function apiKey(): string {
  const key = process.env.AUTENTIQUE_API_KEY?.trim();
  if (!key) throw new Error('AUTENTIQUE_API_KEY não configurada');
  return key;
}

/** Pausa polling/reconcile sem remover secrets (AUTENTIQUE_SYNC_ENABLED=false). */
export function isAutentiqueSyncEnabled(): boolean {
  return process.env.AUTENTIQUE_SYNC_ENABLED !== 'false';
}

export function canCallAutentiqueApi(): boolean {
  return isAutentiqueSyncEnabled() && Boolean(process.env.AUTENTIQUE_API_KEY?.trim());
}

async function graphql<T>(query: string): Promise<T> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  if (!json.data) throw new Error('Resposta vazia da API Autentique');
  return json.data;
}

export async function listAutentiqueDocuments(page = 1, limit = 60): Promise<{
  total: number;
  data: AutentiqueDocument[];
}> {
  const q = `query { documents(limit: ${limit}, page: ${page}) { total data { id name created_at signatures { email signed { created_at } viewed { created_at } rejected { created_at } } } } }`;
  const data = await graphql<{ documents: { total: number; data: AutentiqueDocument[] } }>(q);
  return data.documents;
}

export async function listAllAutentiqueDocuments(maxPages = 12): Promise<AutentiqueDocument[]> {
  const all: AutentiqueDocument[] = [];
  let page = 1;
  let total = 0;
  do {
    const batch = await listAutentiqueDocuments(page, 60);
    total = batch.total;
    all.push(...batch.data);
    page++;
  } while (all.length < total && page <= maxPages);
  return all;
}

/** Representante da cooperativa no Autentique (Gustavo Resende). */
export function defaultCoopEmail(): string {
  return process.env.AUTENTIQUE_COOP_EMAIL?.trim() || 'gustavo.rezende@rezendeas.com.br';
}

/** Contador/advogado adicional, quando houver papel separado no documento. */
export function defaultLawyerEmail(): string {
  return process.env.AUTENTIQUE_LAWYER_EMAIL?.trim() || '';
}

/** E-mails convidados ao documento mas que não bloqueiam o fluxo (ex.: caixa institucional). */
export function defaultIgnoredSignerEmails(): string[] {
  const raw = process.env.AUTENTIQUE_IGNORED_SIGNER_EMAILS?.trim();
  const defaults = ['cooperativacoopmob@gmail.com'];
  if (!raw) return defaults;
  const extra = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...defaults, ...extra])];
}

function isIgnoredSigner(email: string, ignored: string[]): boolean {
  const e = String(email || '').toLowerCase();
  return Boolean(e && ignored.includes(e));
}

export function driverSignatureFromDocument(
  doc: AutentiqueDocument,
  coopEmail = defaultCoopEmail(),
  lawyerEmail = defaultLawyerEmail()
): AutentiqueSignature | null {
  const ignored = defaultIgnoredSignerEmails();
  const coop = coopEmail.toLowerCase();
  const lawyer = lawyerEmail.toLowerCase();
  const sigs = doc.signatures || [];
  return (
    sigs.find((s) => {
      const e = String(s.email || '').toLowerCase();
      if (!e || isIgnoredSigner(e, ignored)) return false;
      if (e === coop) return false;
      if (lawyer && e === lawyer) return false;
      return true;
    }) || null
  );
}

export function signatureStatusFromDocument(
  doc: AutentiqueDocument,
  coopEmail = defaultCoopEmail(),
  lawyerEmail = defaultLawyerEmail()
): {
  driverStatus: string;
  coopStatus: string | null;
  driverEmail: string | null;
} {
  const ignored = defaultIgnoredSignerEmails();
  const driverSig = driverSignatureFromDocument(doc, coopEmail, lawyerEmail);
  const coopSig = (doc.signatures || []).find(
    (s) => String(s.email || '').toLowerCase() === coopEmail.toLowerCase()
  );
  let driverStatus = 'pending';
  if (driverSig?.rejected) driverStatus = 'rejected';
  else if (driverSig?.signed) driverStatus = 'signed';
  else if (driverSig?.viewed) driverStatus = 'awaiting_signature';
  else if (driverSig) driverStatus = 'awaiting_view';

  const requiredSigs = (doc.signatures || []).filter((s) => {
    const e = String(s.email || '').toLowerCase();
    return e && !isIgnoredSigner(e, ignored);
  });
  if (requiredSigs.length > 0 && requiredSigs.every((s) => s.signed)) {
    driverStatus = 'document_finished';
  }

  let coopStatus: string | null = null;
  if (coopSig) {
    if (coopSig.rejected) coopStatus = 'rejected';
    else if (coopSig.signed) coopStatus = 'signed';
    else if (coopSig.viewed) coopStatus = 'awaiting_signature';
    else coopStatus = 'awaiting_view';
  }

  return {
    driverStatus,
    coopStatus,
    driverEmail: driverSig?.email || null,
  };
}
