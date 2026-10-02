import PDFDocument from 'pdfkit';
import { parse } from 'node-html-parser';

function stripHtml(html: string): string {
  const root = parse(html);
  return root.text.replace(/\s+/g, ' ').trim();
}

/** Converte HTML salvo da proposta em PDF (texto estruturado). */
export function generateProposalPdfFromHtml(html: string, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const root = parse(html);
    const body = root.querySelector('body') ?? root;

    doc.fontSize(9).fillColor('#666').text('FLUX FARMA · GESTÃO DE ENTREGAS PARA FARMÁCIAS');
    doc.moveDown(0.5);
    doc.fontSize(18).fillColor('#111').text(title || 'Proposta Comercial');
    doc.moveDown(1);

    const walk = (node: { tagName?: string; text?: string; childNodes?: unknown[] }) => {
      const tag = (node.tagName || '').toLowerCase();
      const text = (node.text || '').trim();
      if (tag === 'h1') {
        doc.moveDown(0.3);
        doc.fontSize(16).fillColor('#111').text(text, { continued: false });
        doc.moveDown(0.4);
      } else if (tag === 'h2') {
        doc.moveDown(0.5);
        doc.fontSize(12).fillColor('#111').text(text, { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor('#333');
      } else if (tag === 'p' && text) {
        doc.text(text, { align: tag.includes('center') ? 'center' : 'left' });
        doc.moveDown(0.2);
      } else if (node.childNodes) {
        for (const ch of node.childNodes as { tagName?: string; text?: string; childNodes?: unknown[] }[]) {
          if (ch && typeof ch === 'object' && ('tagName' in ch || 'text' in ch)) walk(ch);
        }
      }
    };

    try {
      walk(body as { tagName?: string; text?: string; childNodes?: unknown[] });
    } catch {
      doc.fontSize(10).fillColor('#333').text(stripHtml(html), { align: 'justify' });
    }

    doc.end();
  });
}
