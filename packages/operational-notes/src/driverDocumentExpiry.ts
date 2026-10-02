export type DocumentKind = 'cnh' | 'certificate';
export type ExpiryState = 'missing' | 'valid' | 'warning_30' | 'warning_7' | 'expired';
export type DriverDocStatus = 'ok' | 'pending' | 'expired';
export type AlertKind =
  | 'cnh_30'
  | 'cnh_7'
  | 'cnh_expired'
  | 'cert_30'
  | 'cert_7'
  | 'cert_expired';

const DEFAULT_TZ = 'America/Sao_Paulo';

export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** YYYY-MM-DD for "today" in America/Sao_Paulo */
export function todayDateOnlyInTz(timeZone = DEFAULT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = parseDateOnly(fromYmd);
  const b = parseDateOnly(toYmd);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function computeDocumentExpiryState(
  expiresAt: string | null | undefined,
  todayYmd = todayDateOnlyInTz()
): ExpiryState {
  const exp = parseDateOnly(expiresAt);
  if (!exp) return 'missing';
  const days = daysBetween(todayYmd, String(expiresAt).slice(0, 10));
  if (days < 0) return 'expired';
  if (days <= 7) return 'warning_7';
  if (days <= 30) return 'warning_30';
  return 'valid';
}

export type DriverDocumentInput = {
  cnh_expires_at?: string | null;
  has_digital_certificate?: boolean | null;
  digital_certificate_expires_at?: string | null;
};

export function evaluateDriverDocuments(
  driver: DriverDocumentInput,
  todayYmd = todayDateOnlyInTz()
): {
  cnh: ExpiryState;
  certificate: ExpiryState;
  doc_status: DriverDocStatus;
  worst_state: ExpiryState;
} {
  const cnh = driver.cnh_expires_at
    ? computeDocumentExpiryState(driver.cnh_expires_at, todayYmd)
    : 'missing';

  let certificate: ExpiryState = 'missing';
  if (driver.has_digital_certificate) {
    certificate = driver.digital_certificate_expires_at
      ? computeDocumentExpiryState(driver.digital_certificate_expires_at, todayYmd)
      : 'missing';
  }

  const monitored = [cnh, ...(driver.has_digital_certificate ? [certificate] : [])].filter(
    (s) => s !== 'missing'
  );

  let worst_state: ExpiryState = 'valid';
  const rank: Record<ExpiryState, number> = {
    valid: 0,
    warning_30: 1,
    warning_7: 2,
    expired: 3,
    missing: -1,
  };
  for (const s of monitored) {
    if (rank[s] > rank[worst_state]) worst_state = s;
  }

  let doc_status: DriverDocStatus = 'ok';
  if (monitored.some((s) => s === 'expired')) {
    doc_status = 'expired';
  } else if (
    (driver.has_digital_certificate && !driver.digital_certificate_expires_at) ||
    monitored.some((s) => s === 'warning_7')
  ) {
    doc_status = 'pending';
  }

  return { cnh, certificate, doc_status, worst_state };
}

export function buildAlertKind(kind: DocumentKind, state: ExpiryState): AlertKind | null {
  if (state === 'warning_30') return kind === 'cnh' ? 'cnh_30' : 'cert_30';
  if (state === 'warning_7') return kind === 'cnh' ? 'cnh_7' : 'cert_7';
  if (state === 'expired') return kind === 'cnh' ? 'cnh_expired' : 'cert_expired';
  return null;
}

export function alertKindsForDriver(driver: DriverDocumentInput, todayYmd = todayDateOnlyInTz()): AlertKind[] {
  const { cnh, certificate } = evaluateDriverDocuments(driver, todayYmd);
  const out: AlertKind[] = [];
  if (driver.cnh_expires_at) {
    const k = buildAlertKind('cnh', cnh);
    if (k) out.push(k);
  }
  if (driver.has_digital_certificate && driver.digital_certificate_expires_at) {
    const k = buildAlertKind('certificate', certificate);
    if (k) out.push(k);
  }
  return out;
}

export function documentKindFromAlertKind(alertKind: AlertKind): DocumentKind {
  return alertKind.startsWith('cnh') ? 'cnh' : 'certificate';
}

export function taskTypeForAlertKind(alertKind: AlertKind): 'driver_doc_expiry_warning' | 'driver_doc_expired' {
  return alertKind.endsWith('_expired') ? 'driver_doc_expired' : 'driver_doc_expiry_warning';
}

export function priorityForAlertKind(alertKind: AlertKind): 'normal' | 'high' {
  if (alertKind.endsWith('_expired') || alertKind.endsWith('_7')) return 'high';
  return 'normal';
}

const DOC_LABEL: Record<DocumentKind, string> = {
  cnh: 'CNH',
  certificate: 'Certificado digital',
};

function formatPtDate(ymd: string | null | undefined): string {
  const d = parseDateOnly(ymd);
  if (!d) return '—';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function buildDocumentAlertTitle(
  driverName: string,
  alertKind: AlertKind,
  expiresAt: string | null | undefined
): string {
  const kind = documentKindFromAlertKind(alertKind);
  const label = DOC_LABEL[kind];
  const dateStr = formatPtDate(expiresAt);
  if (alertKind.endsWith('_expired')) {
    return `${label} de ${driverName} vencida${dateStr !== '—' ? ` (${dateStr})` : ''}`;
  }
  if (alertKind.endsWith('_7')) {
    return `${label} de ${driverName} vence em 7 dias (${dateStr})`;
  }
  return `${label} de ${driverName} vence em 30 dias (${dateStr})`;
}

export function buildDocumentAlertDescription(
  alertKind: AlertKind,
  expiresAt: string | null | undefined
): string {
  const kind = documentKindFromAlertKind(alertKind);
  const label = DOC_LABEL[kind];
  const dateStr = formatPtDate(expiresAt);
  if (alertKind.endsWith('_expired')) {
    return `A validade da ${label} expirou em ${dateStr}. Atualize o cadastro do entregador.`;
  }
  if (alertKind.endsWith('_7')) {
    return `A ${label} vence em até 7 dias (${dateStr}). Providencie a renovação no cadastro.`;
  }
  return `A ${label} vence em até 30 dias (${dateStr}). Acompanhe a renovação no cadastro.`;
}

export function badgeLabelForState(state: ExpiryState, expiresAt?: string | null): string {
  if (state === 'missing') return 'Não informada';
  if (state === 'valid') return 'Válida';
  if (state === 'expired') return 'Vencida';
  if (state === 'warning_7') return 'Vence em breve';
  if (state === 'warning_30' && expiresAt) {
    const days = daysBetween(todayDateOnlyInTz(), String(expiresAt).slice(0, 10));
    return days > 0 ? `Vence em ${days} dias` : 'Vence em breve';
  }
  return 'Vence em breve';
}

export function aggregateHeaderDocLabel(worst: ExpiryState): string {
  if (worst === 'expired') return 'Documento vencido';
  if (worst === 'warning_7' || worst === 'warning_30') return 'Vence em breve';
  return 'Documentação OK';
}

export const DRIVER_DOC_TASK_TYPES = ['driver_doc_expiry_warning', 'driver_doc_expired'] as const;
