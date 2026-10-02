export type AutentiqueDocTipo = 'MATRICULA' | 'DESLIGAMENTO';

export type SignatureStatus =
  | 'awaiting_document'
  | 'pending'
  | 'awaiting_signature'
  | 'awaiting_view'
  | 'waiting'
  | 'signed'
  | 'rejected'
  | 'document_finished';

export const SIGNATURE_TRACKED_TASK_TYPES = [
  'driver_enrollment_prep',
  'driver_termination_prep',
  'driver_termination_request',
] as const;

export type SignatureTrackedTaskType = (typeof SIGNATURE_TRACKED_TASK_TYPES)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DOCUMENT_NAME_RE =
  /^AETHERA_(MATRICULA|DESLIGAMENTO)_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_(.+)$/i;

export const SIGNATURE_PENDING_STATUSES: SignatureStatus[] = [
  'awaiting_document',
  'pending',
  'awaiting_signature',
  'awaiting_view',
  'waiting',
];

export function slugDriverName(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
}

export function buildAutentiqueDocumentName(
  tipo: AutentiqueDocTipo,
  driverId: string,
  driverName: string
): string {
  const id = String(driverId || '').trim();
  if (!UUID_RE.test(id)) throw new Error('driverId inválido para nome Autentique');
  return `AETHERA_${tipo}_${id}_${slugDriverName(driverName)}`;
}

export function parseAutentiqueDocumentName(
  name: string
): { tipo: AutentiqueDocTipo; driverId: string; nameSlug: string } | null {
  const m = String(name || '').trim().match(DOCUMENT_NAME_RE);
  if (!m) return null;
  return {
    tipo: m[1].toUpperCase() as AutentiqueDocTipo,
    driverId: m[2],
    nameSlug: m[3],
  };
}

export function docTypeForTaskType(taskType: string): AutentiqueDocTipo | null {
  if (taskType === 'driver_enrollment_prep') return 'MATRICULA';
  if (taskType === 'driver_termination_prep' || taskType === 'driver_termination_request') {
    return 'DESLIGAMENTO';
  }
  return null;
}

export function isSignaturePendingStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase().trim();
  return SIGNATURE_PENDING_STATUSES.some((p) => p === s);
}

/** Documento ainda em fluxo de assinatura (entregador e/ou cooperativa/contador). */
export function isSignatureWorkflowPending(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const driver = String(metadata.signature_status || '').toLowerCase().trim();
  const coop = String(metadata.coop_signature_status || '').toLowerCase().trim();
  if (driver === 'document_finished') return false;
  if (driver === 'rejected' || coop === 'rejected') return false;
  if (isSignaturePendingStatus(driver)) return true;
  if ((driver === 'signed' || driver === 'document_finished') && coop && isSignaturePendingStatus(coop)) {
    return true;
  }
  return false;
}

export function signatureWorkflowStatusLabel(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '—';
  const driver = String(metadata.signature_status || '').toLowerCase().trim();
  const coop = String(metadata.coop_signature_status || '').toLowerCase().trim();
  if (driver === 'document_finished') return signatureStatusLabel('document_finished');
  if (isSignaturePendingStatus(driver)) return signatureStatusLabel(driver);
  if (driver === 'signed' && coop && isSignaturePendingStatus(coop)) {
    return `Entregador assinou · ${signatureStatusLabel(coop)} (cooperativa)`;
  }
  if (driver === 'signed') return signatureStatusLabel('signed');
  return signatureStatusLabel(driver || coop || null);
}

export function isSignatureSignedStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase().trim();
  return s === 'signed' || s === 'document_finished';
}

export function signatureStatusLabel(status: string | null | undefined): string {
  const s = String(status || '').toLowerCase().trim();
  switch (s) {
    case 'awaiting_document':
      return 'Aguardando envio';
    case 'awaiting_view':
      return 'Não visualizou';
    case 'awaiting_signature':
    case 'pending':
    case 'waiting':
      return 'Aguardando assinatura';
    case 'signed':
      return 'Assinado';
    case 'rejected':
      return 'Recusado';
    case 'document_finished':
      return 'Concluído';
    default:
      return status ? String(status) : '—';
  }
}

export type AutentiqueWebhookEvent =
  | 'signature.viewed'
  | 'signature.accepted'
  | 'signature.rejected'
  | 'document.created'
  | 'document.finished'
  | string;

export function mapAutentiqueEventToDriverStatus(event: AutentiqueWebhookEvent): SignatureStatus | null {
  const e = String(event || '').toLowerCase();
  if (e === 'signature.viewed') return 'awaiting_signature';
  if (e === 'signature.accepted') return 'signed';
  if (e === 'signature.rejected') return 'rejected';
  if (e === 'document.created') return 'pending';
  if (e === 'document.finished') return 'document_finished';
  return null;
}

export function buildSignatureMetadataForTask(
  taskType: string,
  driverId: string,
  driverName: string
): Record<string, unknown> {
  const docType = docTypeForTaskType(taskType);
  if (!docType) return {};
  const expected = buildAutentiqueDocumentName(docType, driverId, driverName);
  return {
    autentique_document_name_expected: expected,
    signature_doc_type: docType.toLowerCase(),
    signature_status: 'awaiting_document' satisfies SignatureStatus,
  };
}
