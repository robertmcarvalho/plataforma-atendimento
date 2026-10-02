/**
 * Gate de cadastro fiscal do tomador (farmácia) antes de aprovar fatura / emitir NFS-e.
 * Sprint 0: checklist puro — sem I/O Sefin.
 */

import {
  BILLING_NFSE_TOMADOR_GAP_CODES,
  type BillingNfseTomadorGap,
  type BillingNfseTomadorGapCode,
} from './billingNfseTypes';

export type PharmacyFiscalCadastro = {
  cnpj?: string | null;
  legal_name?: string | null;
  /** Fallback legado se address_* vazio. */
  city?: string | null;
  state?: string | null;
  address_cep?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  ibge_city_code?: string | null;
  municipal_registration?: string | null;
};

export type TomadorGateOptions = {
  /**
   * Exigir inscrição municipal do tomador.
   * Default false — alinhar ao DPS (omite `toma.IM` quando vazia) e às NFs
   * da plataforma atual, que não trazem IM. Passe `true` se um município/emitente exigir.
   */
  requireMunicipalRegistration?: boolean;
};

const LABELS: Record<BillingNfseTomadorGapCode, string> = {
  cnpj: 'CNPJ',
  legal_name: 'Razão social',
  address_cep: 'CEP',
  address_street: 'Logradouro',
  address_number: 'Número',
  address_neighborhood: 'Bairro',
  address_city: 'Município',
  address_state: 'UF',
  ibge_city_code: 'Código IBGE do município',
  municipal_registration: 'Inscrição municipal',
};

function onlyDigits(input: string | null | undefined): string {
  return String(input || '').replace(/\D/g, '');
}

function isBlank(input: string | null | undefined): boolean {
  return !String(input || '').trim();
}

function gap(code: BillingNfseTomadorGapCode): BillingNfseTomadorGap {
  return { code, label: LABELS[code], field: code };
}

/**
 * Resolve município/UF do tomador aceitando address_* ou city/state legado.
 */
export function resolveTomadorCityState(pharmacy: PharmacyFiscalCadastro): {
  city: string;
  state: string;
} {
  const city = String(pharmacy.address_city || pharmacy.city || '').trim();
  const state = String(pharmacy.address_state || pharmacy.state || '')
    .trim()
    .toUpperCase();
  return { city, state };
}

export function evaluateNfseTomadorGate(
  pharmacy: PharmacyFiscalCadastro | null | undefined,
  options: TomadorGateOptions = {}
): { ok: true; gaps: [] } | { ok: false; gaps: BillingNfseTomadorGap[] } {
  const requireIm = options.requireMunicipalRegistration === true;
  const gaps: BillingNfseTomadorGap[] = [];

  if (!pharmacy) {
    return {
      ok: false,
      gaps: BILLING_NFSE_TOMADOR_GAP_CODES.filter((c) => requireIm || c !== 'municipal_registration').map(
        gap
      ),
    };
  }

  const cnpj = onlyDigits(pharmacy.cnpj);
  if (cnpj.length !== 14) gaps.push(gap('cnpj'));

  if (isBlank(pharmacy.legal_name)) gaps.push(gap('legal_name'));

  if (onlyDigits(pharmacy.address_cep).length !== 8) gaps.push(gap('address_cep'));
  if (isBlank(pharmacy.address_street)) gaps.push(gap('address_street'));
  if (isBlank(pharmacy.address_number)) gaps.push(gap('address_number'));
  if (isBlank(pharmacy.address_neighborhood)) gaps.push(gap('address_neighborhood'));

  const { city, state } = resolveTomadorCityState(pharmacy);
  if (!city) gaps.push(gap('address_city'));
  if (!/^[A-Z]{2}$/.test(state)) gaps.push(gap('address_state'));

  const ibge = onlyDigits(pharmacy.ibge_city_code);
  if (ibge.length !== 7) gaps.push(gap('ibge_city_code'));

  if (requireIm && isBlank(pharmacy.municipal_registration)) {
    gaps.push(gap('municipal_registration'));
  }

  if (gaps.length) return { ok: false, gaps };
  return { ok: true, gaps: [] };
}

export function isNfseTomadorReady(
  pharmacy: PharmacyFiscalCadastro | null | undefined,
  options?: TomadorGateOptions
): boolean {
  return evaluateNfseTomadorGate(pharmacy, options).ok;
}
