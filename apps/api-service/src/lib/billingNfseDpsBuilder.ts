/**
 * Monta XML da DPS (Declaração de Prestação de Serviço) — Portal Nacional NFS-e.
 * Layout alinhado ao XSD v1.01 (namespace http://www.sped.fazenda.gov.br/nfse).
 * Sem I/O Sefin; sem assinatura (ver billingNfseSigner).
 *
 * Gaps vs XSD oficial completo no repo: XSD zip não versionado aqui — campos IBSCBS /
 * RTC omitidos nesta fase (delivery clássico ISS). Validação XSD completa fica para
 * quando o pacote NFSe-ESQUEMAS_XSD for adicionado a assets/.
 */

import {
  BILLING_NFSE_DEFAULTS,
  type BillingNfseEnvironment,
  type BillingNfseEntityType,
  type BillingNfseRevenueLine,
} from './billingNfseTypes';

export const BILLING_NFSE_DPS_NS = 'http://www.sped.fazenda.gov.br/nfse';
export const BILLING_NFSE_DPS_VERSAO = '1.01';
/** TSVerAplic (tiposSimples XSD) maxLength=20 — valores longos geram E1235 na Sefin. */
export const BILLING_NFSE_VER_APLIC = 'plat-nfse/0.2';
export const BILLING_NFSE_VER_APLIC_MAX_LEN = 20;

if (BILLING_NFSE_VER_APLIC.length < 1 || BILLING_NFSE_VER_APLIC.length > BILLING_NFSE_VER_APLIC_MAX_LEN) {
  throw new Error(
    `BILLING_NFSE_VER_APLIC inválido (len=${BILLING_NFSE_VER_APLIC.length}; max ${BILLING_NFSE_VER_APLIC_MAX_LEN})`
  );
}

export type NfseDpsPartyAddress = {
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  ibge_city_code: string;
  cep: string;
  /** Informativo; não vai no endNac do schema atual. */
  city?: string | null;
  state?: string | null;
};

export type NfseDpsPrestador = {
  cnpj: string;
  municipal_registration?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Endereço do prestador (cLocEmi / locPrest usam ibge do emitente). */
  ibge_city_code: string;
};

export type NfseDpsTomador = {
  cnpj: string;
  legal_name: string;
  municipal_registration?: string | null;
  address: NfseDpsPartyAddress;
};

export type NfseDpsService = {
  ctn: string;
  nbs?: string | null;
  description: string;
  /** Código tributação municipal opcional. */
  ctn_municipal?: string | null;
  /**
   * Local da prestação (IBGE 7 dígitos).
   * Em emissão real deve ser o município da farmácia (tomador), não do emitente.
   * Default no XML: município do emitente (`cLocEmi`) se omitido.
   */
  ibge_prestacao?: string | null;
};

export type NfseDpsValues = {
  service_amount: number;
  iss_retained?: boolean;
  /** Alíquota ISS % (não-SN). Informativa no builder; totTrib usa pTotTrib*. */
  iss_rate_pct?: number | null;
  /** % total tributos estimados no SN (pTotTribSN). */
  tot_trib_sn_pct?: number | null;
};

export type NfseDpsBuildInput = {
  environment: BillingNfseEnvironment;
  entity_type: BillingNfseEntityType;
  revenue_line?: BillingNfseRevenueLine;
  /** Série DPS (até 5 dígitos no Id; texto livre no elemento serie). */
  dps_series: string;
  dps_number: number;
  /** Competência YYYY-MM-DD. */
  competence_date: string;
  /** Emissão ISO ou Date; default now (BRT -03:00). */
  issued_at?: string | Date;
  simples_nacional: boolean;
  /**
   * Regime especial: cooperativa | none | mei | …
   * Mapeado para regEspTrib (0=nenhum, 1=cooperativa, …).
   */
  special_tax_regime?: string | null;
  /**
   * opSimpNac override: 1=não optante, 2=MEI, 3=ME/EPP.
   * Default: SN → 3, senão 1.
   */
  op_simp_nac?: '1' | '2' | '3';
  /** Obrigatório quando opSimpNac=3. Default "1". */
  reg_ap_trib_sn?: string;
  prestador: NfseDpsPrestador;
  tomador: NfseDpsTomador;
  servico: NfseDpsService;
  valores: NfseDpsValues;
};

export type NfseDpsBuildResult = {
  xml: string;
  dps_id: string;
  tp_amb: '1' | '2';
  serie: string;
  n_dps: string;
  c_loc_emi: string;
};

export class BillingNfseDpsBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingNfseDpsBuilderError';
  }
}

export function onlyDigits(input: string | null | undefined): string {
  return String(input || '').replace(/\D/g, '');
}

export function escapeXml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** CTN LC116 → cTribNac (6 dígitos). */
export function normalizeCtn(ctn: string): string {
  const digits = onlyDigits(ctn);
  if (digits.length < 4 || digits.length > 6) {
    throw new BillingNfseDpsBuilderError(`CTN inválido (espere 4–6 dígitos): ${ctn}`);
  }
  return digits.padStart(6, '0');
}

/** NBS com pontos → só dígitos (ex.: 1.0702.00.00 → 107020000). */
export function normalizeNbs(nbs: string | null | undefined): string | null {
  if (nbs == null || !String(nbs).trim()) return null;
  const digits = onlyDigits(nbs);
  if (!digits) return null;
  return digits;
}

/** IM numérica → 15 dígitos (CNC); alfanumérica preservada. */
export function normalizeMunicipalRegistration(im: string | null | undefined): string | null {
  if (im == null) return null;
  const trimmed = String(im).trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(15, '0');
  return trimmed;
}

export function formatMoney(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new BillingNfseDpsBuilderError(`Valor de serviço inválido: ${amount}`);
  }
  return amount.toFixed(2);
}

export function formatPct(pct: number): string {
  if (!Number.isFinite(pct) || pct < 0) {
    throw new BillingNfseDpsBuilderError(`Percentual inválido: ${pct}`);
  }
  return pct.toFixed(2);
}

/** tpAmb: 1=produção, 2=produção restrita / homologação Sefin. */
export function tpAmbForEnvironment(environment: BillingNfseEnvironment): '1' | '2' {
  return environment === 'producao' ? '1' : '2';
}

export function mapRegEspTrib(
  entityType: BillingNfseEntityType,
  specialTaxRegime?: string | null
): string {
  const raw = String(specialTaxRegime || '').trim().toLowerCase();
  const mapping: Record<string, string> = {
    none: '0',
    nenhum: '0',
    cooperativa: '1',
    coop: '1',
    estimativa: '2',
    sociedade_profissionais: '3',
    mei: '4',
    microempresario_individual: '4',
    microempresa_epp: '5',
  };
  if (raw && mapping[raw] !== undefined) return mapping[raw];
  if (entityType === 'coop') return '1';
  return '0';
}

/**
 * Id da DPS: DPS + cLocEmi(7) + tpInsc(1) + CNPJ(14) + serie(5) + nDPS(15)
 */
export function buildDpsId(params: {
  cLocEmi: string;
  cnpj: string;
  serie: string;
  nDps: number | string;
}): string {
  const cLoc = onlyDigits(params.cLocEmi);
  if (cLoc.length !== 7) {
    throw new BillingNfseDpsBuilderError(`cLocEmi deve ter 7 dígitos: ${params.cLocEmi}`);
  }
  const cnpj = onlyDigits(params.cnpj);
  if (cnpj.length !== 14) {
    throw new BillingNfseDpsBuilderError(`CNPJ prestador deve ter 14 dígitos: ${params.cnpj}`);
  }
  const serieDigits = onlyDigits(params.serie) || '1';
  const serie = serieDigits.slice(-5).padStart(5, '0');
  const n = Number(params.nDps);
  if (!Number.isInteger(n) || n < 1) {
    throw new BillingNfseDpsBuilderError(`nDPS inválido: ${params.nDps}`);
  }
  const nDps = String(n).padStart(15, '0');
  return `DPS${cLoc}2${cnpj}${serie}${nDps}`;
}

function assertCompetenceDate(isoDate: string): string {
  const d = String(isoDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new BillingNfseDpsBuilderError(`dCompet deve ser YYYY-MM-DD: ${isoDate}`);
  }
  return d;
}

/** dhEmi / dhEvento: offset BRT fixo (-03:00) como nos exemplos oficiais / DANFSe. */
export function formatNfseDhBrt(issuedAt?: string | Date): string {
  const date = issuedAt instanceof Date ? issuedAt : issuedAt ? new Date(issuedAt) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new BillingNfseDpsBuilderError(`dhEmi/dhEvento inválida: ${String(issuedAt)}`);
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}-03:00`;
}

function el(name: string, text: string | null | undefined, attrs?: Record<string, string>): string {
  if (text == null) return '';
  const attr =
    attrs && Object.keys(attrs).length
      ? ' ' + Object.entries(attrs).map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ')
      : '';
  return `<${name}${attr}>${escapeXml(text)}</${name}>`;
}

/**
 * Renderiza descrição a partir do template do perfil.
 */
export function renderNfseDescriptionTemplate(
  template: string,
  vars: { cycle_start?: string; cycle_end?: string; pharmacy?: string; [k: string]: string | undefined }
): string {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v != null ? String(v) : '';
  });
}

export function buildDpsXml(input: NfseDpsBuildInput): NfseDpsBuildResult {
  const cLocEmi = onlyDigits(input.prestador.ibge_city_code);
  if (cLocEmi.length !== 7) {
    throw new BillingNfseDpsBuilderError('ibge_city_code do prestador inválido (7 dígitos).');
  }
  const prestCnpj = onlyDigits(input.prestador.cnpj);
  if (prestCnpj.length !== 14) {
    throw new BillingNfseDpsBuilderError('CNPJ do prestador inválido.');
  }
  const tomaCnpj = onlyDigits(input.tomador.cnpj);
  if (tomaCnpj.length !== 14) {
    throw new BillingNfseDpsBuilderError('CNPJ do tomador inválido.');
  }
  if (!String(input.tomador.legal_name || '').trim()) {
    throw new BillingNfseDpsBuilderError('Razão social do tomador é obrigatória.');
  }

  const serieRaw = String(input.dps_series || '').trim() || '1';
  const nDps = Number(input.dps_number);
  if (!Number.isInteger(nDps) || nDps < 1) {
    throw new BillingNfseDpsBuilderError('dps_number deve ser inteiro ≥ 1.');
  }

  const dpsId = buildDpsId({
    cLocEmi,
    cnpj: prestCnpj,
    serie: serieRaw,
    nDps,
  });

  const tpAmb = tpAmbForEnvironment(input.environment);
  const dCompet = assertCompetenceDate(input.competence_date);
  const dhEmi = formatNfseDhBrt(input.issued_at);
  const ctn = normalizeCtn(input.servico.ctn);
  const nbs = normalizeNbs(input.servico.nbs);
  const cLocPrest = onlyDigits(input.servico.ibge_prestacao || cLocEmi);
  if (cLocPrest.length !== 7) {
    throw new BillingNfseDpsBuilderError('IBGE do local de prestação inválido.');
  }

  const tomaEnd = input.tomador.address;
  const tomaCep = onlyDigits(tomaEnd.cep);
  const tomaMun = onlyDigits(tomaEnd.ibge_city_code);
  if (tomaCep.length !== 8) throw new BillingNfseDpsBuilderError('CEP do tomador inválido.');
  if (tomaMun.length !== 7) throw new BillingNfseDpsBuilderError('IBGE do tomador inválido.');

  const opSimp =
    input.op_simp_nac || (input.simples_nacional ? '3' : '1');
  const regEsp = mapRegEspTrib(input.entity_type, input.special_tax_regime);
  const prestIm = normalizeMunicipalRegistration(input.prestador.municipal_registration);
  const vServ = formatMoney(input.valores.service_amount);
  const issRetido = Boolean(input.valores.iss_retained);

  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<DPS xmlns="${BILLING_NFSE_DPS_NS}" versao="${BILLING_NFSE_DPS_VERSAO}">`
  );
  parts.push(`<infDPS Id="${escapeXml(dpsId)}">`);
  parts.push(el('tpAmb', tpAmb));
  parts.push(el('dhEmi', dhEmi));
  parts.push(el('verAplic', BILLING_NFSE_VER_APLIC));
  parts.push(el('serie', serieRaw));
  parts.push(el('nDPS', String(nDps)));
  parts.push(el('dCompet', dCompet));
  parts.push(el('tpEmit', '1'));
  parts.push(el('cLocEmi', cLocEmi));

  parts.push('<prest>');
  parts.push(el('CNPJ', prestCnpj));
  if (prestIm) parts.push(el('IM', prestIm));
  if (input.prestador.phone) parts.push(el('fone', onlyDigits(input.prestador.phone)));
  if (input.prestador.email) parts.push(el('email', String(input.prestador.email).trim()));
  parts.push('<regTrib>');
  parts.push(el('opSimpNac', opSimp));
  if (opSimp === '3') {
    parts.push(el('regApTribSN', String(input.reg_ap_trib_sn || '1')));
  }
  parts.push(el('regEspTrib', regEsp));
  parts.push('</regTrib>');
  parts.push('</prest>');

  parts.push('<toma>');
  parts.push(el('CNPJ', tomaCnpj));
  const tomaIm = normalizeMunicipalRegistration(input.tomador.municipal_registration);
  if (tomaIm) parts.push(el('IM', tomaIm));
  parts.push(el('xNome', String(input.tomador.legal_name).trim()));
  parts.push('<end>');
  parts.push('<endNac>');
  parts.push(el('cMun', tomaMun));
  parts.push(el('CEP', tomaCep));
  parts.push('</endNac>');
  parts.push(el('xLgr', String(tomaEnd.street).trim()));
  parts.push(el('nro', String(tomaEnd.number).trim()));
  if (tomaEnd.complement) parts.push(el('xCpl', String(tomaEnd.complement).trim()));
  parts.push(el('xBairro', String(tomaEnd.neighborhood).trim()));
  parts.push('</end>');
  parts.push('</toma>');

  parts.push('<serv>');
  parts.push('<locPrest>');
  parts.push(el('cLocPrestacao', cLocPrest));
  parts.push('</locPrest>');
  parts.push('<cServ>');
  parts.push(el('cTribNac', ctn));
  if (input.servico.ctn_municipal) {
    parts.push(el('cTribMun', String(input.servico.ctn_municipal).trim()));
  }
  parts.push(el('xDescServ', String(input.servico.description).trim()));
  if (nbs) parts.push(el('cNBS', nbs));
  parts.push('</cServ>');
  parts.push('</serv>');

  parts.push('<valores>');
  parts.push('<vServPrest>');
  parts.push(el('vServ', vServ));
  parts.push('</vServPrest>');
  parts.push('<trib>');
  parts.push('<tribMun>');
  parts.push(el('tribISSQN', '1'));
  parts.push(el('tpRetISSQN', issRetido ? '2' : '1'));
  parts.push('</tribMun>');
  parts.push('<totTrib>');
  if (opSimp === '3') {
    const snPct =
      input.valores.tot_trib_sn_pct != null
        ? Number(input.valores.tot_trib_sn_pct)
        : 18.83;
    parts.push(el('pTotTribSN', formatPct(snPct)));
  } else {
    parts.push('<pTotTrib>');
    parts.push(el('pTotTribFed', '0.00'));
    parts.push(el('pTotTribEst', '0.00'));
    const munPct =
      input.valores.iss_rate_pct != null ? Number(input.valores.iss_rate_pct) : 0;
    parts.push(el('pTotTribMun', formatPct(munPct)));
    parts.push('</pTotTrib>');
  }
  parts.push('</totTrib>');
  parts.push('</trib>');
  parts.push('</valores>');

  parts.push('</infDPS>');
  parts.push('</DPS>');

  return {
    xml: parts.join(''),
    dps_id: dpsId,
    tp_amb: tpAmb,
    serie: serieRaw,
    n_dps: String(nDps),
    c_loc_emi: cLocEmi,
  };
}

/** Fixture de desenvolvimento (Coop delivery Uberlândia) — sem dados reais sensíveis. */
export function buildFixtureDpsInput(
  overrides: Partial<NfseDpsBuildInput> = {}
): NfseDpsBuildInput {
  const defaults = BILLING_NFSE_DEFAULTS;
  const base: NfseDpsBuildInput = {
    environment: 'producao_restrita',
    entity_type: 'coop',
    revenue_line: 'delivery',
    dps_series: '1',
    dps_number: 1,
    competence_date: '2026-08-01',
    issued_at: '2026-08-12T15:00:00-03:00',
    simples_nacional: false,
    special_tax_regime: 'cooperativa',
    prestador: {
      cnpj: '50749016000170',
      municipal_registration: '123456',
      ibge_city_code: defaults.ibge_city_code,
      email: 'fiscal@example.local',
    },
    tomador: {
      cnpj: '11222333000181',
      legal_name: 'FARMACIA FIXTURE LTDA',
      municipal_registration: '998877',
      address: {
        street: 'Rua Exemplo',
        number: '100',
        neighborhood: 'Centro',
        ibge_city_code: defaults.ibge_city_code,
        cep: '38400000',
        city: 'Uberlandia',
        state: 'MG',
      },
    },
    servico: {
      ctn: defaults.delivery.ctn,
      nbs: defaults.delivery.nbs,
      description: renderNfseDescriptionTemplate(defaults.delivery.description_template, {
        cycle_start: '01/08/2026',
        cycle_end: '15/08/2026',
        pharmacy: 'FARMACIA FIXTURE LTDA',
      }),
    },
    valores: {
      service_amount: 150.5,
      iss_retained: false,
      iss_rate_pct: defaults.coop_iss_rate_pct,
    },
  };

  return {
    ...base,
    ...overrides,
    prestador: { ...base.prestador, ...(overrides.prestador || {}) },
    tomador: {
      ...base.tomador,
      ...(overrides.tomador || {}),
      address: {
        ...base.tomador.address,
        ...(overrides.tomador?.address || {}),
      },
    },
    servico: { ...base.servico, ...(overrides.servico || {}) },
    valores: { ...base.valores, ...(overrides.valores || {}) },
  };
}
