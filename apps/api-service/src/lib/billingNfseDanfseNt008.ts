/**
 * Gerador DANFSe conforme NT 008 (v1.02) a partir do XML autorizado.
 *
 * Decisão 2026-09-08: regeneração NT 008 aceita (bytes ≠ portal).
 * XSL/FO oficial do Anexo I não está empacotado no runtime — layout PDFKit
 * best-effort alinhado aos blocos/campos mínimos da NT.
 *
 * Gaps vs portal (documentados):
 * - Fontes: Helvetica (PDFKit) em vez de Arial / Microsoft Sans Serif
 * - Logomarca oficial NFS-e não embutida (texto “NFS-e” no cabeçalho)
 * - Coordenadas cm do Anexo I aproximadas (fluxo vertical PDFKit, não grid absoluto)
 * - Blocos IBS/CBS / canhoto / intermediário / destinatário omitidos quando ausentes no XML
 * - Sombreamento ~5% cinza aproximado (#f2f2f2)
 *
 * @see https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-008-se-cgnfse-danfse-20260714-v1-02.pdf
 * @see reports/billing-documentos-pdf-email-parecer-2026-09-08.md
 */

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  parseNfseAuthorizedXml,
  type NfseDanfseFields,
} from './billingNfseDanfsePdf';

export type DanfseNt008GenerateResult =
  | { ok: true; pdf: Buffer; source: 'nt008_local' }
  | { ok: false; code: 'MISSING_XML' | 'TRANSFORM_FAILED'; message: string };

/** Gaps conhecidos vs DANFSe do portal / Anexo I pixel-perfect. */
export const DANFSE_NT008_LAYOUT_GAPS = [
  'Fontes Helvetica (PDFKit) em vez de Arial / Microsoft Sans Serif',
  'Logomarca oficial NFS-e não embutida (placeholder textual)',
  'Posicionamento por fluxo vertical — não grid absoluto em cm do Anexo I',
  'Blocos IBS/CBS, canhoto e intermediário só se presentes no XML (supressão NT 2.3)',
  'Marca d’água CANCELADA/SUBSTITUÍDA não aplicada automaticamente neste gerador',
] as const;

const CM = 28.3465; // 1 cm em pontos PDF
const QR_SIZE_PT = 1.52 * CM;
const GRAY_HEADER = '#f2f2f2';
const BORDER = '#222222';

function formatCnpj(digits: string | null): string {
  if (!digits) return '';
  const d = digits.replace(/\D/g, '');
  if (d.length !== 14) return digits;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function formatMoney(raw: string | null): string {
  if (!raw) return '';
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatAccessKeyGrouped(key: string | null): string {
  if (!key) return '';
  const d = key.replace(/\D/g, '');
  return d.replace(/(.{4})/g, '$1 ').trim();
}

function consultaPublicaUrl(accessKey: string): string {
  return `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${accessKey.replace(/\D/g, '')}`;
}

function drawBlockTitle(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  w: number,
  title: string
): number {
  const h = 14;
  doc.save();
  doc.rect(x, y, w, h).fill(GRAY_HEADER);
  doc.rect(x, y, w, h).lineWidth(0.5).stroke(BORDER);
  doc
    .fillColor('#111')
    .font('Helvetica-Bold')
    .fontSize(7)
    .text(title.toUpperCase(), x + 3, y + 3, { width: w - 6, lineBreak: false });
  doc.restore();
  return y + h;
}

function fieldRow(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  w: number,
  label: string,
  value: string,
  opts?: { labelW?: number; valueFontSize?: number }
): number {
  const labelW = opts?.labelW ?? Math.min(118, Math.floor(w * 0.28));
  const valueFontSize = opts?.valueFontSize ?? 7;
  doc.font('Helvetica').fontSize(valueFontSize);
  const h = Math.max(16, doc.heightOfString(value || '—', { width: w - labelW - 8 }) + 6);
  doc.rect(x, y, w, h).lineWidth(0.4).stroke(BORDER);
  doc
    .font('Helvetica-Bold')
    .fontSize(6)
    .fillColor('#333')
    .text(label, x + 3, y + 3, { width: labelW - 4 });
  doc
    .font('Helvetica')
    .fontSize(valueFontSize)
    .fillColor('#111')
    .text(value || '—', x + labelW + 2, y + 3, { width: w - labelW - 6 });
  return y + h;
}

function twoColFields(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  w: number,
  left: { label: string; value: string },
  right: { label: string; value: string }
): number {
  const gap = 0;
  const half = w / 2;
  const y1 = fieldRow(doc, x, y, half, left.label, left.value);
  const y2 = fieldRow(doc, x + half + gap, y, half, right.label, right.value);
  return Math.max(y1, y2);
}

async function renderDanfseNt008Pdf(fields: NfseDanfseFields): Promise<Buffer> {
  const accessKey = fields.accessKey || '';
  const qrUrl = accessKey ? consultaPublicaUrl(accessKey) : 'https://www.nfse.gov.br/ConsultaPublica/';
  const qrPng = await QRCode.toBuffer(qrUrl, {
    type: 'png',
    margin: 0,
    errorCorrectionLevel: 'M',
    width: Math.ceil(QR_SIZE_PT * 2),
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0.5 * CM,
      info: {
        Title: 'DANFSe v2.0',
        Author: 'Flux Farma / NT 008 local',
        Subject: 'Documento Auxiliar da NFS-e (regenerado NT 008)',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const margin = 0.5 * CM;
    const contentW = pageW - margin * 2;
    let y = margin;
    const x = margin;

    // Borda da página (1 pt)
    doc.rect(margin * 0.4, margin * 0.4, pageW - margin * 0.8, doc.page.height - margin * 0.8)
      .lineWidth(1)
      .stroke(BORDER);

    // --- Cabeçalho ---
    const headerH = 2.6 * CM;
    doc.rect(x, y, contentW, headerH).fill(GRAY_HEADER);
    doc.rect(x, y, contentW, headerH).lineWidth(0.5).stroke(BORDER);

    // Logo placeholder
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#0b3d91')
      .text('NFS-e', x + 6, y + 10, { width: 2.2 * CM });
    doc
      .font('Helvetica')
      .fontSize(6)
      .fillColor('#333')
      .text('Nacional', x + 6, y + 24, { width: 2.2 * CM });

    // Título centro
    const titleX = x + 2.5 * CM;
    const titleW = contentW - 2.5 * CM - QR_SIZE_PT - 0.8 * CM;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#111')
      .text('DANFSe v2.0', titleX, y + 8, { width: titleW, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('Documento Auxiliar da NFS-e', titleX, y + 20, { width: titleW, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#222')
      .text(fields.xLocEmi || '', titleX, y + 36, { width: titleW, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(6)
      .fillColor('#444')
      .text(`Ambiente: ${fields.verAplic || '—'}`, titleX, y + 48, { width: titleW, align: 'center' });

    // QR à direita
    const qrX = x + contentW - QR_SIZE_PT - 4;
    const qrY = y + 6;
    doc.image(qrPng, qrX, qrY, { width: QR_SIZE_PT, height: QR_SIZE_PT });
    doc
      .font('Helvetica')
      .fontSize(5.5)
      .fillColor('#333')
      .text(
        'A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e',
        qrX - 0.4 * CM,
        qrY + QR_SIZE_PT + 2,
        { width: QR_SIZE_PT + 0.6 * CM, align: 'center' }
      );

    y += headerH + 2;

    // Chave de acesso
    y = drawBlockTitle(doc, x, y, contentW, 'Chave de Acesso');
    y = fieldRow(doc, x, y, contentW, 'Chave de Acesso', formatAccessKeyGrouped(accessKey), {
      valueFontSize: 8,
      labelW: 90,
    });

    // Identificação
    y = drawBlockTitle(doc, x, y, contentW, 'Identificação da NFS-e');
    y = twoColFields(
      doc,
      x,
      y,
      contentW,
      { label: 'Número da NFS-e', value: fields.nNfse || '' },
      { label: 'Competência', value: fields.dCompet || '' }
    );
    y = twoColFields(
      doc,
      x,
      y,
      contentW,
      { label: 'Data/Hora Processamento', value: fields.dhProc || '' },
      { label: 'Nº DFSe', value: fields.nDfse || '' }
    );
    y = twoColFields(
      doc,
      x,
      y,
      contentW,
      { label: 'Série DPS', value: fields.serie || '' },
      { label: 'Número DPS', value: fields.nDps || '' }
    );
    y = twoColFields(
      doc,
      x,
      y,
      contentW,
      { label: 'Situação (cStat)', value: fields.cStat || '' },
      { label: 'Local Emissão', value: fields.xLocEmi || '' }
    );

    // Prestador
    y = drawBlockTitle(doc, x, y, contentW, 'Prestador / Fornecedor');
    y = twoColFields(
      doc,
      x,
      y,
      contentW,
      { label: 'CNPJ', value: formatCnpj(fields.emitCnpj) },
      { label: 'Nome', value: fields.emitNome || '' }
    );
    y = fieldRow(doc, x, y, contentW, 'Endereço', fields.emitEndereco || '');

    // Tomador
    y = drawBlockTitle(doc, x, y, contentW, 'Tomador / Adquirente da Operação');
    if (!fields.tomaNome && !fields.tomaCnpj) {
      y = fieldRow(
        doc,
        x,
        y,
        contentW,
        'Observação',
        'TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e'
      );
    } else {
      y = twoColFields(
        doc,
        x,
        y,
        contentW,
        { label: 'CNPJ', value: formatCnpj(fields.tomaCnpj) },
        { label: 'Nome', value: fields.tomaNome || '' }
      );
      y = fieldRow(doc, x, y, contentW, 'Endereço', fields.tomaEndereco || '');
    }

    // Destinatário = próprio tomador (supressão NT 2.3.2)
    y = drawBlockTitle(doc, x, y, contentW, 'Destinatário da Operação');
    y = fieldRow(
      doc,
      x,
      y,
      contentW,
      'Observação',
      'O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO'
    );

    // Serviço
    y = drawBlockTitle(doc, x, y, contentW, 'Serviço Prestado');
    y = twoColFields(
      doc,
      x,
      y,
      contentW,
      { label: 'CTN', value: fields.cTribNac || '' },
      { label: 'NBS', value: fields.cNbs || '' }
    );
    y = twoColFields(
      doc,
      x,
      y,
      contentW,
      { label: 'Local Prestação', value: fields.xLocPrestacao || '' },
      { label: 'Local Incidência', value: fields.xLocIncid || '' }
    );
    if (fields.xTribNac) {
      y = fieldRow(doc, x, y, contentW, 'Desc. CTN', fields.xTribNac);
    }
    y = fieldRow(doc, x, y, contentW, 'Descrição do Serviço', fields.descServ || '');

    // Tributação municipal (quando há local incidência / SN)
    y = drawBlockTitle(doc, x, y, contentW, 'Tributação Municipal (ISSQN)');
    if (!fields.xLocIncid && !fields.pTotTribSn) {
      y = fieldRow(
        doc,
        x,
        y,
        contentW,
        'Observação',
        'TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN'
      );
    } else {
      y = twoColFields(
        doc,
        x,
        y,
        contentW,
        { label: 'Município Incidência', value: fields.xLocIncid || '' },
        { label: 'Alíq. Tot. Trib. SN (%)', value: fields.pTotTribSn || '' }
      );
    }

    // Valores
    y = drawBlockTitle(doc, x, y, contentW, 'Valor Total da NFS-e');
    const valorY = y;
    const half = contentW / 2;
    fieldRow(doc, x, valorY, half, 'Valor do Serviço', formatMoney(fields.vServ));
    doc.rect(x + half, valorY, half, 18).fill(GRAY_HEADER);
    y = fieldRow(doc, x + half, valorY, half, 'Valor Líquido', formatMoney(fields.vLiq));

    // Complementares
    y = drawBlockTitle(doc, x, y, contentW, 'Informações Complementares');
    const complement = [
      fields.pTotTribSn
        ? `Totais aproximados de tributos (SN): ${fields.pTotTribSn}%`
        : null,
      accessKey ? `Consulta: ${consultaPublicaUrl(accessKey)}` : null,
      'DANFSe regenerado localmente conforme NT 008/2026 (layout best-effort).',
    ]
      .filter(Boolean)
      .join('\n');
    y = fieldRow(doc, x, y, contentW, 'Informações', complement);

    doc
      .font('Helvetica')
      .fontSize(5)
      .fillColor('#888')
      .text(
        'Gerado conforme NT 008 SE/CGNFS-e (v1.02) — regeneração local a partir do XML. Bytes podem diferir do portal.',
        x,
        Math.min(y + 8, doc.page.height - margin - 12),
        { width: contentW }
      );

    doc.end();
  });
}

/**
 * Gera PDF DANFSe NT 008 a partir do XML autorizado.
 */
export async function generateDanfsePdfNt008(params: {
  nfseXml: string | Buffer;
  accessKey?: string | null;
}): Promise<DanfseNt008GenerateResult> {
  const raw = params.nfseXml;
  const hasXml = Buffer.isBuffer(raw) ? raw.length > 0 : Boolean(String(raw || '').trim());
  if (!hasXml) {
    return { ok: false, code: 'MISSING_XML', message: 'XML NFS-e ausente para gerar DANFSe NT 008.' };
  }
  try {
    const fields = parseNfseAuthorizedXml(raw, params.accessKey);
    if (!fields.accessKey && params.accessKey) {
      fields.accessKey = String(params.accessKey).replace(/\D/g, '') || params.accessKey;
    }
    const pdf = await renderDanfseNt008Pdf(fields);
    if (!pdf?.length || pdf.subarray(0, 4).toString('utf8') !== '%PDF') {
      return {
        ok: false,
        code: 'TRANSFORM_FAILED',
        message: 'Gerador NT 008 não produziu PDF válido.',
      };
    }
    return { ok: true, pdf, source: 'nt008_local' };
  } catch (err) {
    return {
      ok: false,
      code: 'TRANSFORM_FAILED',
      message: err instanceof Error ? err.message : 'Falha ao gerar DANFSe NT 008',
    };
  }
}

export const DANFSE_NT008_SPIKE_CHECKLIST = [
  'Baixar NT 008 + Anexo I (layout) do gov.br — feito (v1.02)',
  'Localizar XSL/FO oficial — inviável no prazo; PDFKit best-effort',
  'PoC: XML autorizado → PDF NT 008 local',
  'Runtime Node + pdfkit + qrcode (sem sidecar Java)',
  'Gravar source=nt008_local via resolveDanfsePdfBuffer',
  'UI: botão PDF preferindo NT008 > auxiliar',
] as const;
