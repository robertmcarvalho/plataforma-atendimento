/**
 * Monta payload POST /v2/invoices a partir da fatura Aethera + farmácia (tomador)
 * + condições comerciais da config Cora (multa / juros / PIX / templates).
 *
 * API Cora (confirmado na doc v2):
 * - fine.rate = % (0–100); fine.amount = centavos (amount prevalece)
 * - interest.rate = 0–100, 2 casas — período não explícito na doc; produto = % a.m.
 * - payment_forms: ["BANK_SLIP","PIX"] para QR Pix no boleto
 * - services[].description máx. 100 chars
 */

import {
  evaluateNfseTomadorGate,
  resolveTomadorCityState,
  type PharmacyFiscalCadastro,
} from './billingNfseTomadorGate';
import {
  BILLING_CORA_DEFAULTS,
  type BillingCoraBoletoTerms,
  type BillingCoraFineMode,
  type CoraInvoiceCreatePayload,
} from './billingCoraTypes';

export class BillingCoraBuilderError extends Error {
  status: number;
  gaps?: Array<{ code: string; label: string }>;
  constructor(message: string, status = 400, gaps?: Array<{ code: string; label: string }>) {
    super(message);
    this.name = 'BillingCoraBuilderError';
    this.status = status;
    this.gaps = gaps;
  }
}

function onlyDigits(input: string | null | undefined): string {
  return String(input || '').replace(/\D/g, '');
}

function truncate(s: string, max: number): string {
  const t = String(s || '').trim();
  return t.length <= max ? t : t.slice(0, max);
}

function roundRate2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CoraTemplateVars = {
  cycle?: string | null;
  invoice_id?: string | null;
  pharmacy?: string | null;
  cnpj?: string | null;
};

/** Substitui {{cycle}}, {{invoice_id}}, {{pharmacy}}, {{cnpj}} e trunca. */
export function renderCoraServiceTemplate(
  template: string | null | undefined,
  vars: CoraTemplateVars,
  maxLen: number,
  fallback: string
): string {
  const raw = String(template || '').trim() || fallback;
  const replaced = raw
    .replace(/\{\{\s*cycle\s*\}\}/gi, String(vars.cycle || '').trim())
    .replace(/\{\{\s*invoice_id\s*\}\}/gi, String(vars.invoice_id || '').trim())
    .replace(/\{\{\s*pharmacy\s*\}\}/gi, String(vars.pharmacy || '').trim())
    .replace(/\{\{\s*cnpj\s*\}\}/gi, String(vars.cnpj || '').trim())
    .replace(/\s{2,}/g, ' ')
    .replace(/\s—\s*$/g, '')
    .replace(/\s-\s*$/g, '')
    .trim();
  return truncate(replaced || fallback, maxLen);
}

export function defaultCoraBoletoTerms(): BillingCoraBoletoTerms {
  return {
    fine_mode: BILLING_CORA_DEFAULTS.fine_mode,
    fine_rate: BILLING_CORA_DEFAULTS.fine_rate,
    fine_amount_cents: null,
    interest_rate: BILLING_CORA_DEFAULTS.interest_rate,
    pix_qr_enabled: BILLING_CORA_DEFAULTS.pix_qr_enabled,
    service_name_template: BILLING_CORA_DEFAULTS.service_name_template,
    service_description_template: BILLING_CORA_DEFAULTS.service_description_template,
  };
}

export function applyCoraPaymentTermsFromConfig(
  paymentTerms: CoraInvoiceCreatePayload['payment_terms'],
  terms: BillingCoraBoletoTerms
): void {
  const mode: BillingCoraFineMode = terms.fine_mode || 'none';
  if (mode === 'rate' && terms.fine_rate != null && Number.isFinite(Number(terms.fine_rate))) {
    const rate = roundRate2(Number(terms.fine_rate));
    if (rate > 0) paymentTerms.fine = { rate };
  } else if (
    mode === 'amount' &&
    terms.fine_amount_cents != null &&
    Number.isFinite(Number(terms.fine_amount_cents))
  ) {
    const amount = Math.round(Number(terms.fine_amount_cents));
    if (amount > 0) paymentTerms.fine = { amount };
  }

  if (terms.interest_rate != null && Number.isFinite(Number(terms.interest_rate))) {
    const rate = roundRate2(Number(terms.interest_rate));
    if (rate > 0) paymentTerms.interest = { rate };
  }
}

export type BuildCoraInvoiceInput = {
  invoiceId: string;
  totalCents: number;
  dueDate: string | null | undefined;
  pharmacy: PharmacyFiscalCadastro & {
    trade_name?: string | null;
    billing_email?: string | null;
  };
  cycleLabel?: string | null;
  /** Condições comerciais (config Flux). Ausente → defaults produto. */
  boletoTerms?: Partial<BillingCoraBoletoTerms> | null;
};

export function buildCoraInvoicePayload(input: BuildCoraInvoiceInput): CoraInvoiceCreatePayload {
  const amount = Math.round(Number(input.totalCents) || 0);
  if (!Number.isFinite(amount) || amount < BILLING_CORA_DEFAULTS.min_amount_cents) {
    throw new BillingCoraBuilderError(
      `Valor mínimo do boleto Cora é R$ ${(BILLING_CORA_DEFAULTS.min_amount_cents / 100).toFixed(2)}.`
    );
  }

  const due = String(input.dueDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    throw new BillingCoraBuilderError('Fatura sem due_date válido (AAAA-MM-DD) para boleto.');
  }

  const gate = evaluateNfseTomadorGate(input.pharmacy, { requireMunicipalRegistration: false });
  // Cora não exige IBGE; removemos gap de ibge para emissão de boleto.
  const gaps = gate.ok
    ? []
    : gate.gaps.filter((g) => g.code !== 'ibge_city_code' && g.code !== 'municipal_registration');
  if (gaps.length) {
    throw new BillingCoraBuilderError(
      `Cadastro da farmácia incompleto para boleto: ${gaps.map((g) => g.label).join(', ')}.`,
      400,
      gaps
    );
  }

  const terms: BillingCoraBoletoTerms = {
    ...defaultCoraBoletoTerms(),
    ...(input.boletoTerms || {}),
  };

  const cnpj = onlyDigits(input.pharmacy.cnpj);
  const { city, state } = resolveTomadorCityState(input.pharmacy);
  const pharmacyName = truncate(
    String(input.pharmacy.legal_name || input.pharmacy.trade_name || '').trim(),
    60
  );
  const email = String(input.pharmacy.billing_email || '').trim();
  const zip = onlyDigits(input.pharmacy.address_cep).slice(0, 8);

  const templateVars: CoraTemplateVars = {
    cycle: input.cycleLabel || '',
    invoice_id: input.invoiceId,
    pharmacy: pharmacyName,
    cnpj,
  };

  const serviceName = renderCoraServiceTemplate(
    terms.service_name_template,
    templateVars,
    BILLING_CORA_DEFAULTS.service_name_max,
    BILLING_CORA_DEFAULTS.service_name_template
  );
  const serviceDescription = renderCoraServiceTemplate(
    terms.service_description_template,
    templateVars,
    BILLING_CORA_DEFAULTS.service_description_max,
    BILLING_CORA_DEFAULTS.service_description_template
  );

  const payment_terms: CoraInvoiceCreatePayload['payment_terms'] = { due_date: due };
  applyCoraPaymentTermsFromConfig(payment_terms, terms);

  const payload: CoraInvoiceCreatePayload = {
    code: String(input.invoiceId),
    customer: {
      name: pharmacyName,
      document: { identity: cnpj, type: 'CNPJ' },
      address: {
        street: truncate(String(input.pharmacy.address_street || ''), 100),
        number: truncate(String(input.pharmacy.address_number || 'S/N'), 20),
        district: truncate(String(input.pharmacy.address_neighborhood || ''), 60),
        city: truncate(city, 60),
        state,
        zip_code: zip,
        country: 'BR',
      },
    },
    services: [
      {
        name: serviceName,
        description: serviceDescription,
        amount,
      },
    ],
    payment_terms,
  };

  if (terms.pix_qr_enabled) {
    payload.payment_forms = ['BANK_SLIP', 'PIX'];
  }

  if (email && email.includes('@') && email.length <= 60) {
    payload.customer.email = email;
  }

  return payload;
}
