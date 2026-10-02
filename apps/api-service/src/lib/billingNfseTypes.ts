/** Tipos e constantes NFS-e (Sefin Nacional) — Sprint 0 foundation. */

export type BillingNfseEnvironment = 'producao_restrita' | 'producao';

export type BillingNfseRevenueLine = 'delivery' | 'saas_monthly' | 'saas_per_delivery';

export type BillingNfseDocumentStatus = 'pending' | 'authorized' | 'rejected' | 'canceled';

export type BillingNfseEntityType = 'coop' | 'flux';

/** Hosts Sefin — nunca usar produção enquanto ambiente for producao_restrita. */
export const BILLING_NFSE_SEFIN_HOSTS = {
  producao_restrita: {
    sefin: 'sefin.producaorestrita.nfse.gov.br',
    adn: 'adn.producaorestrita.nfse.gov.br',
  },
  producao: {
    sefin: 'sefin.nfse.gov.br',
    adn: 'adn.nfse.gov.br',
  },
} as const;

export const BILLING_NFSE_UBERLANDIA_IBGE = '3170206';

export const BILLING_NFSE_DEFAULTS = {
  environment: 'producao_restrita' as BillingNfseEnvironment,
  ibge_city_code: BILLING_NFSE_UBERLANDIA_IBGE,
  delivery: {
    ctn: '26.01.01',
    nbs: '1.0702.00.00',
    description_template:
      'Prestação de serviços de entrega no período de {{cycle_start}} a {{cycle_end}} — {{pharmacy}}',
  },
  saas: {
    ctn: '010501',
    nbs: '1.1103.22.00',
    monthly_description_template:
      'Disponibilização de tecnologia (SaaS mensal) — {{pharmacy}} — competência {{cycle_start}} a {{cycle_end}}',
    per_delivery_description_template:
      'Disponibilização de tecnologia (SaaS por entrega) — {{pharmacy}} — período {{cycle_start}} a {{cycle_end}}',
  },
  coop_iss_rate_pct: 3,
} as const;

export const BILLING_NFSE_TOMADOR_GAP_CODES = [
  'cnpj',
  'legal_name',
  'address_cep',
  'address_street',
  'address_number',
  'address_neighborhood',
  'address_city',
  'address_state',
  'ibge_city_code',
  'municipal_registration',
] as const;

export type BillingNfseTomadorGapCode = (typeof BILLING_NFSE_TOMADOR_GAP_CODES)[number];

export type BillingNfseTomadorGap = {
  code: BillingNfseTomadorGapCode;
  label: string;
  field: string;
};

export type BillingNfseIssuerConfig = {
  id: string;
  workspace_id: string;
  entity_type: BillingNfseEntityType;
  environment: BillingNfseEnvironment;
  auto_emit_on_approve: boolean;
  municipal_registration: string | null;
  ibge_city_code: string;
  tax_regime: string | null;
  simples_nacional: boolean;
  dps_series: string | null;
  dps_next_number: number | null;
  active: boolean;
};

export type BillingNfseServiceProfile = {
  id: string;
  workspace_id: string;
  issuer_config_id: string;
  revenue_line: BillingNfseRevenueLine;
  ctn: string;
  nbs: string;
  iss_rate_pct: number | null;
  description_template: string;
  active: boolean;
};

/** Metadados públicos de certificado — sem PEM/secret. */
export type BillingNfseCertificatePublic = {
  id: string;
  workspace_id: string;
  issuer_config_id: string;
  thumbprint: string | null;
  subject_cn: string | null;
  valid_from: string | null;
  valid_until: string | null;
  active: boolean;
  uploaded_at: string | null;
  has_secret_ref: boolean;
  has_storage_path: boolean;
};

export type BillingNfseDocument = {
  id: string;
  workspace_id: string;
  invoice_id: string;
  issuer_config_id: string | null;
  entity_type: BillingNfseEntityType;
  revenue_line: BillingNfseRevenueLine;
  status: BillingNfseDocumentStatus;
  attempt_number: number;
  dps_number: string | null;
  nfse_number: string | null;
  access_key: string | null;
  protocol: string | null;
  last_error: string | null;
  dps_xml_storage_path: string | null;
  xml_storage_path: string | null;
  pdf_storage_path: string | null;
  issued_at: string | null;
  authorized_at: string | null;
};

export const NFSE_TOMADOR_INCOMPLETE_CODE = 'NFSE_TOMADOR_INCOMPLETE' as const;

/** Códigos de auditoria / notificação NFS-e (billing_audit_notifications.code). */
export const BILLING_NFSE_AUDIT_CODES = {
  TOMADOR_INCOMPLETE: 'NFSE_TOMADOR_INCOMPLETE',
  PENDING: 'NFSE_PENDING',
  AUTHORIZED: 'NFSE_AUTHORIZED',
  REJECTED: 'NFSE_REJECTED',
  EMIT_FAILED: 'NFSE_EMIT_FAILED',
  CERT_MISSING: 'NFSE_CERT_MISSING',
  REEMIT: 'NFSE_REEMIT',
  CANCELED: 'NFSE_CANCELED',
  CANCEL_FAILED: 'NFSE_CANCEL_FAILED',
} as const;

/** Status que permitem reemissão (nova tentativa / novo documento). */
export const BILLING_NFSE_REEMITTABLE_STATUSES: readonly BillingNfseDocumentStatus[] = [
  'rejected',
  'canceled',
] as const;

/** Status que permitem cancelamento Sefin (evento e101101). */
export const BILLING_NFSE_CANCELABLE_STATUSES: readonly BillingNfseDocumentStatus[] = [
  'authorized',
] as const;

export type BillingNfseAuditCode =
  (typeof BILLING_NFSE_AUDIT_CODES)[keyof typeof BILLING_NFSE_AUDIT_CODES];

export class BillingNfseApproveError extends Error {
  status: number;
  code: string;
  gaps?: BillingNfseTomadorGap[];

  constructor(
    message: string,
    options: { status?: number; code?: string; gaps?: BillingNfseTomadorGap[] } = {}
  ) {
    super(message);
    this.name = 'BillingNfseApproveError';
    this.status = options.status ?? 400;
    this.code = options.code || 'NFSE_APPROVE_ERROR';
    this.gaps = options.gaps;
  }
}
