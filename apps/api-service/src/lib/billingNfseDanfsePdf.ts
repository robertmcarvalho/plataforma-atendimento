/**
 * Geração local de PDF auxiliar a partir do XML autorizado da NFS-e.
 *
 * A API ADN GET /danfse/{chave} foi desativada (NT 008 / 2026). Este PDF
 * NÃO é o DANFSe oficial pixel-perfect da SEFIN — é um documento auxiliar
 * operacional com os campos principais do XML.
 */

import PDFDocument from 'pdfkit';
import { DOMParser } from '@xmldom/xmldom';

export type NfseDanfseFields = {
  accessKey: string | null;
  nNfse: string | null;
  nDfse: string | null;
  cStat: string | null;
  dhProc: string | null;
  verAplic: string | null;
  xLocEmi: string | null;
  xLocPrestacao: string | null;
  xLocIncid: string | null;
  xTribNac: string | null;
  xNbs: string | null;
  emitCnpj: string | null;
  emitNome: string | null;
  emitEndereco: string | null;
  tomaCnpj: string | null;
  tomaNome: string | null;
  tomaEndereco: string | null;
  descServ: string | null;
  cTribNac: string | null;
  cNbs: string | null;
  dCompet: string | null;
  nDps: string | null;
  serie: string | null;
  vServ: string | null;
  vLiq: string | null;
  pTotTribSn: string | null;
};

const NFSE_NS = 'http://www.sped.fazenda.gov.br/nfse';

type XmlNode = {
  textContent?: string | null;
  getAttribute?: (name: string) => string | null;
  getElementsByTagNameNS: (ns: string, localName: string) => { length: number; [index: number]: XmlNode };
  getElementsByTagName: (name: string) => { length: number; [index: number]: XmlNode };
};

function firstEl(parent: XmlNode, localName: string): XmlNode | null {
  const byNs = parent.getElementsByTagNameNS(NFSE_NS, localName);
  if (byNs?.length) return byNs[0];
  const byAny = parent.getElementsByTagNameNS('*', localName);
  if (byAny?.length) return byAny[0];
  const plain = parent.getElementsByTagName(localName);
  return plain?.length ? plain[0] : null;
}

function text(parent: XmlNode | null | undefined, localName: string): string | null {
  if (!parent) return null;
  const el = firstEl(parent, localName);
  const raw = el?.textContent?.trim();
  return raw || null;
}

function formatCnpj(digits: string | null): string | null {
  if (!digits) return null;
  const d = digits.replace(/\D/g, '');
  if (d.length !== 14) return digits;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function formatMoney(raw: string | null): string | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatCep(digits: string | null): string | null {
  if (!digits) return null;
  const d = digits.replace(/\D/g, '');
  if (d.length !== 8) return digits;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function buildEndereco(block: XmlNode | null): string | null {
  if (!block) return null;
  const end = firstEl(block, 'end') || block;
  const endNac = firstEl(block, 'enderNac') || firstEl(end, 'enderNac') || firstEl(end, 'endNac');
  const streetRoot = endNac && text(endNac, 'xLgr') ? endNac : end;
  const parts = [
    text(streetRoot, 'xLgr') || text(block, 'xLgr'),
    (() => {
      const nro = text(streetRoot, 'nro') || text(end, 'nro');
      return nro ? `nº ${nro}` : null;
    })(),
    text(streetRoot, 'xBairro') || text(end, 'xBairro'),
    text(endNac, 'UF') || text(end, 'UF') || text(block, 'UF'),
    formatCep(text(endNac, 'CEP') || text(end, 'CEP') || text(block, 'CEP')),
  ].filter(Boolean);
  return parts.length ? parts.join(' — ') : null;
}

/** Extrai chave de acesso do atributo Id (NFS…) ou do parâmetro. */
export function extractAccessKeyFromNfseXml(xml: string, fallback?: string | null): string | null {
  const m = String(xml || '').match(/\bId\s*=\s*["']NFS([0-9]{44,})["']/i);
  if (m?.[1]) return m[1];
  const fb = String(fallback || '').replace(/\D/g, '');
  return fb.length >= 44 ? fb : fallback?.trim() || null;
}

/** Parseia campos principais do XML NFS-e autorizado (v1.01). */
export function parseNfseAuthorizedXml(xml: string | Buffer, accessKeyHint?: string | null): NfseDanfseFields {
  const xmlStr = Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml || '');
  const doc = new DOMParser().parseFromString(xmlStr, 'text/xml') as unknown as XmlNode & {
    documentElement: XmlNode;
  };
  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new Error(`XML NFS-e inválido: ${parseError.textContent || 'parse error'}`);
  }

  const inf = firstEl(doc, 'infNFSe') || doc.documentElement;
  const emit = firstEl(inf, 'emit');
  const dps = firstEl(inf, 'DPS') || firstEl(doc, 'DPS');
  const infDps = dps ? firstEl(dps, 'infDPS') : firstEl(inf, 'infDPS');
  const toma = infDps ? firstEl(infDps, 'toma') : null;
  const serv = infDps ? firstEl(infDps, 'serv') : null;
  const cServ = serv ? firstEl(serv, 'cServ') : null;
  const valoresInf = firstEl(inf, 'valores');
  const valoresDps = infDps ? firstEl(infDps, 'valores') : null;
  const vServPrest = valoresDps ? firstEl(valoresDps, 'vServPrest') : null;
  const trib = valoresDps ? firstEl(valoresDps, 'trib') : null;
  const totTrib = trib
    ? firstEl(trib, 'totTrib')
    : valoresDps
      ? firstEl(valoresDps, 'totTrib')
      : null;

  const idAttr = inf.getAttribute?.('Id') || '';
  const fromId = idAttr.startsWith('NFS') ? idAttr.slice(3) : null;

  return {
    accessKey: fromId || extractAccessKeyFromNfseXml(xmlStr, accessKeyHint),
    nNfse: text(inf, 'nNFSe'),
    nDfse: text(inf, 'nDFSe'),
    cStat: text(inf, 'cStat'),
    dhProc: text(inf, 'dhProc'),
    verAplic: text(inf, 'verAplic'),
    xLocEmi: text(inf, 'xLocEmi'),
    xLocPrestacao: text(inf, 'xLocPrestacao'),
    xLocIncid: text(inf, 'xLocIncid'),
    xTribNac: text(inf, 'xTribNac'),
    xNbs: text(inf, 'xNBS'),
    emitCnpj: text(emit, 'CNPJ'),
    emitNome: text(emit, 'xNome'),
    emitEndereco: buildEndereco(emit),
    tomaCnpj: text(toma, 'CNPJ'),
    tomaNome: text(toma, 'xNome'),
    tomaEndereco: buildEndereco(toma),
    descServ: text(cServ, 'xDescServ'),
    cTribNac: text(cServ, 'cTribNac'),
    cNbs: text(cServ, 'cNBS'),
    dCompet: text(infDps, 'dCompet'),
    nDps: text(infDps, 'nDPS'),
    serie: text(infDps, 'serie'),
    vServ: text(vServPrest, 'vServ'),
    vLiq: text(valoresInf, 'vLiq') || text(vServPrest, 'vServ'),
    pTotTribSn: totTrib ? text(totTrib, 'pTotTribSN') : text(valoresDps, 'pTotTribSN'),
  };
}

function line(doc: InstanceType<typeof PDFDocument>, label: string, value: string | null | undefined) {
  if (!value) return;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text(`${label}: `, { continued: true });
  doc.font('Helvetica').fillColor('#111').text(value);
}

function section(doc: InstanceType<typeof PDFDocument>, title: string) {
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(title);
  doc.moveDown(0.25);
}

/**
 * Gera PDF auxiliar (DANFSe-like) a partir do XML autorizado.
 * Rodapé deixa explícito que não é o layout oficial SEFIN.
 */
export function generateDanfsePdfFromXml(
  xml: string | Buffer,
  opts?: { accessKey?: string | null }
): Promise<Buffer> {
  const fields = parseNfseAuthorizedXml(xml, opts?.accessKey);
  return renderDanfseAuxiliaryPdf(fields);
}

export function renderDanfseAuxiliaryPdf(fields: NfseDanfseFields): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4', info: { Title: 'Documento auxiliar NFS-e', Author: 'Flux Farma' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111').text('Documento auxiliar da NFS-e');
    doc.font('Helvetica').fontSize(8).fillColor('#666').text(
      'Gerado localmente a partir do XML autorizado — não é o DANFSe oficial da SEFIN Nacional.'
    );
    doc.moveDown(0.8);

    section(doc, 'Identificação');
    line(doc, 'Nº NFS-e', fields.nNfse);
    line(doc, 'Nº DFSe', fields.nDfse);
    line(doc, 'Chave de acesso', fields.accessKey);
    line(doc, 'Status (cStat)', fields.cStat);
    line(doc, 'Processamento', fields.dhProc);
    line(doc, 'Competência', fields.dCompet);
    line(doc, 'Série / DPS', [fields.serie, fields.nDps].filter(Boolean).join(' / ') || null);
    line(doc, 'Local emissão', fields.xLocEmi);
    line(doc, 'Local prestação', fields.xLocPrestacao);
    line(doc, 'Local incidência', fields.xLocIncid);
    line(doc, 'Aplicação', fields.verAplic);

    section(doc, 'Prestador');
    line(doc, 'Razão social', fields.emitNome);
    line(doc, 'CNPJ', formatCnpj(fields.emitCnpj));
    line(doc, 'Endereço', fields.emitEndereco);

    section(doc, 'Tomador');
    line(doc, 'Razão social', fields.tomaNome);
    line(doc, 'CNPJ', formatCnpj(fields.tomaCnpj));
    line(doc, 'Endereço', fields.tomaEndereco);

    section(doc, 'Serviço');
    line(doc, 'Descrição', fields.descServ);
    line(doc, 'CTN', fields.cTribNac);
    line(doc, 'NBS', fields.cNbs);
    if (fields.xTribNac) {
      doc.font('Helvetica').fontSize(8).fillColor('#444').text(fields.xTribNac, { width: doc.page.width - 96 });
    }

    section(doc, 'Valores');
    line(doc, 'Valor do serviço', formatMoney(fields.vServ));
    line(doc, 'Valor líquido', formatMoney(fields.vLiq));
    line(doc, 'Alíquota tot. trib. SN (%)', fields.pTotTribSn);

    doc.moveDown(1.2);
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#888')
      .text(
        'Documento auxiliar gerado localmente a partir do XML autorizado. ' +
          'Para consulta pública oficial use o portal NFS-e Nacional com a chave de acesso. ' +
          'A API ADN de DANFSe foi desativada (NT 008/2026).',
        { align: 'left', width: doc.page.width - 96 }
      );

    if (fields.accessKey) {
      doc.moveDown(0.4);
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#666')
        .text(`Consulta pública: https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${fields.accessKey}`, {
          link: `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${fields.accessKey}`,
          underline: true,
        });
    }

    doc.end();
  });
}

export type DanfsePdfSource = 'xml_danfse_br' | 'nt008_local' | 'adn' | 'local_xml';

/**
 * Resolve PDF DANFSe:
 * lib Java portal-patched (preferido) > NT 008 PDFKit > ADN > auxiliar PDFKit.
 * Flag: BILLING_DANFSE_LIB_ENABLED (default true). Retorna null só sem XML e sem ADN.
 */
export async function resolveDanfsePdfBuffer(params: {
  adnPdf?: Buffer | null;
  nfseXml?: string | Buffer | null;
  accessKey?: string | null;
  /** Preferir ADN sobre geradores locais (default false — decisão 2026-09-08). */
  preferAdn?: boolean;
}): Promise<{ pdf: Buffer; source: DanfsePdfSource } | null> {
  const hasXml = Boolean(
    params.nfseXml &&
      (Buffer.isBuffer(params.nfseXml) ? params.nfseXml.length : String(params.nfseXml).trim())
  );
  const adnOk =
    params.adnPdf &&
    params.adnPdf.length > 4 &&
    params.adnPdf.subarray(0, 4).toString('utf8') === '%PDF';

  if (params.preferAdn && adnOk) {
    return { pdf: params.adnPdf!, source: 'adn' };
  }

  if (hasXml) {
    const { generateDanfsePdfViaLib } = await import('./billingNfseDanfseLib');
    const lib = await generateDanfsePdfViaLib({ nfseXml: params.nfseXml! });
    if (lib.ok) return { pdf: lib.pdf, source: 'xml_danfse_br' };
  }

  if (hasXml) {
    const { generateDanfsePdfNt008 } = await import('./billingNfseDanfseNt008');
    const nt = await generateDanfsePdfNt008({
      nfseXml: params.nfseXml!,
      accessKey: params.accessKey,
    });
    if (nt.ok) return { pdf: nt.pdf, source: 'nt008_local' };
  }

  if (adnOk) {
    return { pdf: params.adnPdf!, source: 'adn' };
  }

  if (hasXml) {
    const pdf = await generateDanfsePdfFromXml(params.nfseXml!, { accessKey: params.accessKey });
    return { pdf, source: 'local_xml' };
  }
  return null;
}
