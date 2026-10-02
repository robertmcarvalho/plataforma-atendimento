/**
 * Pedido de registro de evento Sefin Nacional — cancelamento e101101.
 * Layout alinhado ao Anexo II SEFIN_ADN v1.00-20251226 (namespace DPS).
 *
 * POST {sefin}/SefinNacional/nfse/{chaveAcesso}/eventos
 * body: { pedidoRegistroEventoXmlGZipB64 }
 *
 * Id = PRE + chNFSe(50) + 101101 (sem nPedReg — removido no schema 2025-12).
 * Sem I/O Sefin; sem assinatura (ver billingNfseSigner.signPedRegEventoXml).
 */

import {
  BILLING_NFSE_DPS_NS,
  BILLING_NFSE_VER_APLIC,
  BillingNfseDpsBuilderError,
  escapeXml,
  formatNfseDhBrt,
  onlyDigits,
  tpAmbForEnvironment,
} from './billingNfseDpsBuilder';
import type { BillingNfseEnvironment } from './billingNfseTypes';

/** Código oficial do evento de cancelamento de NFS-e (catálogo Nacional). */
export const BILLING_NFSE_CANCEL_EVENT_CODE = 'e101101' as const;
/** Dígitos do tipo de evento (6) usados no Id PRE+chave+tipo. */
export const BILLING_NFSE_CANCEL_EVENT_CODE_DIGITS = '101101' as const;
export const BILLING_NFSE_CANCEL_EVENT_DESC = 'Cancelamento de NFS-e';
export const BILLING_NFSE_PED_REG_EVENTO_VERSAO = '1.00';

/** xMotivo (TSDesc) — XSD minLength=15 maxLength=255. */
export const BILLING_NFSE_XMOTIVO_MIN = 15;
export const BILLING_NFSE_XMOTIVO_MAX = 255;

/** cMotivo: 1=Erro na emissão, 2=Serviço não prestado, 3=Outros. */
export const BILLING_NFSE_CANCEL_MOTIVOS = ['1', '2', '3'] as const;
export type BillingNfseCancelMotivo = (typeof BILLING_NFSE_CANCEL_MOTIVOS)[number];

export class BillingNfseEventBuilderError extends BillingNfseDpsBuilderError {
  constructor(message: string) {
    super(message);
    this.name = 'BillingNfseEventBuilderError';
  }
}

export type NfseCancelEventBuildInput = {
  environment: BillingNfseEnvironment;
  /** CNPJ do autor do evento (prestador / emitente). */
  autor_cnpj: string;
  /** Chave de acesso da NFS-e autorizada (50 dígitos). */
  access_key: string;
  justificativa: string;
  codigo_motivo?: BillingNfseCancelMotivo | number | string;
  /**
   * @deprecated Removido do XSD 2025-12 (não entra no Id nem no corpo).
   * Mantido só para compatibilidade da API; ignorado na montagem do XML.
   */
  n_ped_reg?: number;
  dh_evento?: string | Date;
};

export type NfseCancelEventBuildResult = {
  xml: string;
  ped_reg_id: string;
  tp_amb: '1' | '2';
  ch_nfse: string;
  c_motivo: BillingNfseCancelMotivo;
  n_ped_reg: string;
  event_code: typeof BILLING_NFSE_CANCEL_EVENT_CODE;
};

function el(name: string, text: string): string {
  return `<${name}>${escapeXml(text)}</${name}>`;
}

export function normalizeNfseAccessKey(accessKey: string | null | undefined): string {
  const chave = onlyDigits(accessKey);
  if (chave.length !== 50) {
    throw new BillingNfseEventBuilderError(
      `Chave de acesso NFS-e inválida (espere 50 dígitos, veio ${chave.length}).`
    );
  }
  return chave;
}

export function normalizeCancelMotivo(
  raw?: BillingNfseCancelMotivo | number | string | null
): BillingNfseCancelMotivo {
  const v = String(raw ?? '1').trim();
  if ((BILLING_NFSE_CANCEL_MOTIVOS as readonly string[]).includes(v)) {
    return v as BillingNfseCancelMotivo;
  }
  throw new BillingNfseEventBuilderError('codigo_motivo deve ser 1, 2 ou 3.');
}

export function normalizeCancelJustificativa(raw: string | null | undefined): string {
  const text = String(raw || '').trim().replace(/\s+/g, ' ');
  if (text.length < BILLING_NFSE_XMOTIVO_MIN) {
    throw new BillingNfseEventBuilderError(
      `Justificativa deve ter no mínimo ${BILLING_NFSE_XMOTIVO_MIN} caracteres.`
    );
  }
  if (text.length > BILLING_NFSE_XMOTIVO_MAX) {
    throw new BillingNfseEventBuilderError(
      `Justificativa deve ter no máximo ${BILLING_NFSE_XMOTIVO_MAX} caracteres.`
    );
  }
  return text;
}

/**
 * Id do pedido (Anexo II SEFIN_ADN v1.00-20251226):
 * PRE + chNFSe(50) + código do evento(6) = 59 chars. Pattern PRE[0-9]{56}.
 *
 * Breaking vs layout antigo (RTC): nPedReg(3) foi removido do Id e do corpo
 * de infPedReg. Manter PRE+chave+nPed causa E1235 (falha de esquema XML).
 */
export function buildPedRegEventoId(
  accessKey: string,
  eventCode: string = BILLING_NFSE_CANCEL_EVENT_CODE_DIGITS
): string {
  const chave = normalizeNfseAccessKey(accessKey);
  const code = onlyDigits(eventCode);
  if (code.length !== 6) {
    throw new BillingNfseEventBuilderError(
      `Código do evento inválido (espere 6 dígitos, veio ${code.length}).`
    );
  }
  return `PRE${chave}${code}`;
}

export function buildCancelEventXml(input: NfseCancelEventBuildInput): NfseCancelEventBuildResult {
  const cnpj = onlyDigits(input.autor_cnpj);
  if (cnpj.length !== 14) {
    throw new BillingNfseEventBuilderError('CNPJ do autor do evento inválido (14 dígitos).');
  }
  const chNfse = normalizeNfseAccessKey(input.access_key);
  const cMotivo = normalizeCancelMotivo(input.codigo_motivo);
  const xMotivo = normalizeCancelJustificativa(input.justificativa);
  const pedRegId = buildPedRegEventoId(chNfse, BILLING_NFSE_CANCEL_EVENT_CODE_DIGITS);
  const tpAmb = tpAmbForEnvironment(input.environment);
  const dhEvento = formatNfseDhBrt(input.dh_evento);
  // Campo legado na resposta — schema atual não usa nPedReg no XML.
  void input.n_ped_reg;
  const nPedReg = BILLING_NFSE_CANCEL_EVENT_CODE_DIGITS.slice(-3);

  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<pedRegEvento xmlns="${BILLING_NFSE_DPS_NS}" versao="${BILLING_NFSE_PED_REG_EVENTO_VERSAO}">`
  );
  parts.push(`<infPedReg Id="${escapeXml(pedRegId)}">`);
  parts.push(el('tpAmb', tpAmb));
  parts.push(el('verAplic', BILLING_NFSE_VER_APLIC));
  parts.push(el('dhEvento', dhEvento));
  parts.push(el('CNPJAutor', cnpj));
  parts.push(el('chNFSe', chNfse));
  parts.push(`<${BILLING_NFSE_CANCEL_EVENT_CODE}>`);
  parts.push(el('xDesc', BILLING_NFSE_CANCEL_EVENT_DESC));
  parts.push(el('cMotivo', cMotivo));
  parts.push(el('xMotivo', xMotivo));
  parts.push(`</${BILLING_NFSE_CANCEL_EVENT_CODE}>`);
  parts.push('</infPedReg>');
  parts.push('</pedRegEvento>');

  return {
    xml: parts.join(''),
    ped_reg_id: pedRegId,
    tp_amb: tpAmb,
    ch_nfse: chNfse,
    c_motivo: cMotivo,
    n_ped_reg: nPedReg,
    event_code: BILLING_NFSE_CANCEL_EVENT_CODE,
  };
}
