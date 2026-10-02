/**
 * Tipos e constantes Cora Integração Direta (boletos v2).
 */

export type BillingCoraEntityType = 'coop' | 'flux';
export type BillingCoraEnvironment = 'stage' | 'production';
export type BillingBankSlipStatus = 'pending' | 'open' | 'paid' | 'canceled' | 'error';
/** Multa: none omite; rate → fine.rate (%); amount → fine.amount (centavos). */
export type BillingCoraFineMode = 'none' | 'rate' | 'amount';

export const BILLING_CORA_BASE_URLS: Record<BillingCoraEnvironment, string> = {
  stage: 'https://matls-clients.api.stage.cora.com.br',
  production: 'https://matls-clients.api.cora.com.br',
};

export const BILLING_CORA_DEFAULTS = {
  environment: 'stage' as BillingCoraEnvironment,
  mtls_secret_ref_flux: 'cora-flux-mtls',
  mtls_secret_ref_coop: 'cora-coop-mtls',
  min_amount_cents: 500,
  cert_filename: 'certificate.pem',
  key_filename: 'private-key.key',
  /** Multa percentual → payment_terms.fine.rate (0–100). */
  fine_mode: 'rate' as BillingCoraFineMode,
  fine_rate: 2,
  /**
   * Juros → payment_terms.interest.rate (0–100, 2 casas).
   * Docs Cora não explicitam se é a.m.; produto trata como % ao mês (boleto BR).
   */
  interest_rate: 1,
  pix_qr_enabled: true,
  service_name_template: 'Faturamento Flux Farma — {{cycle}}',
  service_description_template: 'Fatura {{invoice_id}} — ciclo {{cycle}}',
  service_name_max: 60,
  service_description_max: 100,
};

export type BillingCoraBoletoTerms = {
  fine_mode: BillingCoraFineMode;
  fine_rate: number | null;
  fine_amount_cents: number | null;
  /** % — ver BILLING_CORA_DEFAULTS.interest_rate (tratado como a.m.). */
  interest_rate: number | null;
  pix_qr_enabled: boolean;
  service_name_template: string;
  service_description_template: string;
};

export type BillingCoraConfig = {
  id: string;
  workspace_id: string;
  entity_type: BillingCoraEntityType;
  environment: BillingCoraEnvironment;
  /** Presente só em respostas de manage (edição). Nunca logar. */
  client_id: string | null;
  client_id_masked: string | null;
  has_client_id: boolean;
  mtls_secret_ref: string | null;
  has_mtls_material: boolean;
  enabled: boolean;
} & BillingCoraBoletoTerms;

export type BillingBankSlip = {
  id: string;
  workspace_id: string;
  invoice_id: string;
  entity_type: BillingCoraEntityType;
  provider: 'cora';
  config_id: string | null;
  external_id: string | null;
  status: BillingBankSlipStatus;
  digitable_line: string | null;
  barcode: string | null;
  our_number: string | null;
  pdf_url: string | null;
  /** Path no bucket billing-bank-slips (espelho Aethera do PDF Cora). */
  pdf_storage_path: string | null;
  amount_cents: number;
  due_date: string | null;
  idempotency_key: string;
  last_error: string | null;
  paid_at: string | null;
  created_at?: string;
  updated_at?: string;
};

/**
 * Payload POST /v2/invoices (Cora).
 * Campos comerciais: payment_terms.fine / interest; payment_forms para QR Pix.
 * @see https://developers.cora.com.br/reference/emissão-de-boleto-registrado-v2
 */
export type CoraInvoiceCreatePayload = {
  code: string;
  customer: {
    name: string;
    email?: string;
    document: { identity: string; type: 'CNPJ' | 'CPF' };
    address: {
      street: string;
      number: string;
      district: string;
      city: string;
      state: string;
      complement?: string;
      country?: string;
      zip_code: string;
    };
  };
  services: Array<{
    name: string;
    /** Máx. 100 caracteres (Cora). */
    description: string;
    amount: number;
  }>;
  payment_terms: {
    due_date: string;
    /**
     * Multa: amount (centavos) tem precedência sobre rate (% 0–100).
     * date opcional — default vencimento+1 na Cora.
     */
    fine?: { rate?: number; amount?: number; date?: string };
    /**
     * Juros: rate obrigatório no objeto (0–100, 2 casas).
     * Unidade temporal não documentada pela Cora; enviamos o valor configurado como % a.m.
     */
    interest?: { rate: number };
  };
  /** Com QR Pix: ["BANK_SLIP","PIX"]. Sem o nó = só boleto. */
  payment_forms?: Array<'BANK_SLIP' | 'PIX'>;
};

export type CoraTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type?: string;
};

export type CoraBankSlipOption = {
  barcode?: string;
  digitable?: string;
  our_number?: string;
  url?: string;
};

export type CoraInvoiceCreateResponse = {
  id: string;
  status?: string;
  code?: string;
  total_amount?: number;
  payment_options?: {
    bank_slip?: CoraBankSlipOption;
  };
  [key: string]: unknown;
};

/** GET /third-party/account/balance */
export type CoraAccountBalanceResponse = {
  balance: number;
};

/** GET /bank-statement/statement (página). */
export type CoraBankStatementQuery = {
  start: string;
  end: string;
  page?: number;
  perPage?: number;
  type?: 'CREDIT' | 'DEBIT';
  transaction_type?: string;
  aggr?: boolean;
};
