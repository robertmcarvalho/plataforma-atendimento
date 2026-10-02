import PDFDocument from 'pdfkit';
import {
  formatBrlCents,
  formatIsoDateBr,
  type DriverPayslip,
} from './billingPayslip';
import {
  payslipAlreadyPaidOrDiscountedCents,
  payslipDeliveryCount,
  payslipOccurrenceRows,
  payslipPharmacyRows,
} from './billingPayslipSections';

export type PayslipPdfTheme = 'light' | 'dark';

type ThemeColors = {
  pageBg: string | null;
  text: string;
  muted: string;
  faint: string;
  cardBg: string;
  cardBorder: string;
  negative: string;
  pillBg: string;
  pillText: string;
  barCurrent: string;
  barOther: string;
  fieldBg: string;
};

const THEMES: Record<PayslipPdfTheme, ThemeColors> = {
  light: {
    pageBg: null,
    text: '#111111',
    muted: '#5c5c5c',
    faint: '#8a8a8a',
    cardBg: '#f7f7f8',
    cardBorder: '#e4e4e7',
    negative: '#dc2626',
    pillBg: '#ecfdf5',
    pillText: '#047857',
    barCurrent: '#0ea5e9',
    barOther: '#d4d4d8',
    fieldBg: '#ffffff',
  },
  dark: {
    pageBg: '#0a0a0a',
    text: '#ffffff',
    muted: '#a3a3a3',
    faint: '#737373',
    cardBg: '#141414',
    cardBorder: '#2a2a2a',
    negative: '#f87171',
    pillBg: '#052e1c',
    pillText: '#34d399',
    barCurrent: '#0ea5e9',
    barOther: '#3f3f46',
    fieldBg: '#0a0a0a',
  },
};

type PdfDoc = InstanceType<typeof PDFDocument>;

function paintPageBackground(doc: PdfDoc, theme: ThemeColors) {
  if (!theme.pageBg) return;
  const page = doc.page;
  doc.save();
  doc.rect(0, 0, page.width, page.height).fill(theme.pageBg);
  doc.restore();
}

function ensureSpace(doc: PdfDoc, theme: ThemeColors, needed: number) {
  if (doc.y + needed <= doc.page.height - 48) return;
  doc.addPage();
  paintPageBackground(doc, theme);
  doc.y = 48;
}

function formatSupportPhone(raw: string | null | undefined): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length < 10) return String(raw).trim() || null;
  const ddd = local.slice(0, 2);
  const num = local.slice(2);
  const isMobile = num.length >= 9;
  const a = isMobile ? num.slice(0, 5) : num.slice(0, 4);
  const b = isMobile ? num.slice(5, 9) : num.slice(4, 8);
  return `(${ddd}) ${a}-${b}`;
}

function drawCard(doc: PdfDoc, theme: ThemeColors, title: string, desc: string, body: () => void) {
  ensureSpace(doc, theme, 72);
  const x = 48;
  const width = doc.page.width - 96;
  const top = doc.y;

  doc.save();
  doc.roundedRect(x, top, width, 8, 4).fill(theme.cardBorder);
  doc.restore();

  doc.y = top + 14;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(theme.text).text(title, x + 4, doc.y, { width: width - 8 });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(8).fillColor(theme.muted).text(desc, x + 4, doc.y, { width: width - 8 });
  doc.moveDown(0.55);
  body();

  doc.save();
  doc
    .moveTo(x, doc.y + 6)
    .lineTo(x + width, doc.y + 6)
    .strokeColor(theme.cardBorder)
    .lineWidth(0.75)
    .stroke();
  doc.restore();
  doc.y += 18;
}

function row(
  doc: PdfDoc,
  theme: ThemeColors,
  label: string,
  value: string,
  opts?: { sublabel?: string; negative?: boolean; strong?: boolean }
) {
  const x = 62;
  const width = doc.page.width - 124;
  const y = doc.y;
  const labelWidth = width * 0.62;
  const valueWidth = width * 0.38;
  doc
    .font(opts?.strong ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(9)
    .fillColor(theme.text)
    .text(label, x, y, { width: labelWidth, continued: false });
  let nextY = doc.y;
  if (opts?.sublabel) {
    doc.font('Helvetica').fontSize(7.5).fillColor(theme.faint).text(opts.sublabel, x, nextY, { width: labelWidth });
    nextY = doc.y;
  }
  doc
    .font(opts?.strong ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(9)
    .fillColor(opts?.negative ? theme.negative : theme.text)
    .text(value, x + labelWidth, y, { width: valueWidth, align: 'right' });
  doc.y = Math.max(nextY, y + 12) + 2;
}

function fieldBox(
  doc: PdfDoc,
  theme: ThemeColors,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string
) {
  doc.save();
  doc.roundedRect(x, y, w, h, 8).fillAndStroke(theme.fieldBg, theme.cardBorder);
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(7).fillColor(theme.faint).text(label.toUpperCase(), x + 10, y + 8, {
    width: w - 20,
  });
  doc.font('Helvetica').fontSize(9).fillColor(theme.text).text(value || '—', x + 10, y + 22, {
    width: w - 20,
    ellipsis: true,
  });
}

export function parsePayslipPdfTheme(raw: unknown): PayslipPdfTheme {
  return String(raw || '').trim().toLowerCase() === 'dark' ? 'dark' : 'light';
}

export function generatePayslipPdf(
  payslip: DriverPayslip,
  options?: { theme?: PayslipPdfTheme }
): Promise<Buffer> {
  const themeKey = options?.theme === 'dark' ? 'dark' : 'light';
  const theme = THEMES[themeKey];
  const deliveryCount = payslipDeliveryCount(payslip);
  const alreadyPaid = payslipAlreadyPaidOrDiscountedCents(payslip);
  const occurrences = payslipOccurrenceRows(payslip);
  const pharmacies = payslipPharmacyRows(payslip);
  const receiveAmount = payslip.pix.amount_cents;
  const supportPhone = formatSupportPhone(payslip.support_phone);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    paintPageBackground(doc, theme);
    doc.y = 48;

    doc.font('Helvetica-Bold').fontSize(11).fillColor(theme.text).text('COOPMOB');
    doc.moveDown(0.45);
    doc.font('Helvetica-Bold').fontSize(20).fillColor(theme.text).text('Seu pagamento da semana');
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(theme.muted)
      .text(
        `Período de ${formatIsoDateBr(payslip.cycle.apuracao_start)} a ${formatIsoDateBr(payslip.cycle.apuracao_end)}`
      );
    doc.moveDown(0.7);

    doc.font('Helvetica-Bold').fontSize(8).fillColor(theme.faint).text('VOCÊ VAI RECEBER');
    doc.moveDown(0.2);
    const amountY = doc.y;
    const amountText = formatBrlCents(receiveAmount);
    doc.font('Helvetica-Bold').fontSize(26).fillColor(theme.text).text(amountText, 48, amountY);
    if (payslip.pix.payment_date) {
      const pillText = `PIX em ${formatIsoDateBr(payslip.pix.payment_date)}`;
      doc.font('Helvetica').fontSize(8);
      const pillW = Math.min(180, doc.widthOfString(pillText) + 18);
      doc.font('Helvetica-Bold').fontSize(26);
      const pillX = 48 + doc.widthOfString(amountText) + 16;
      doc.save();
      doc.roundedRect(pillX, amountY + 6, pillW, 18, 9).fill(theme.pillBg);
      doc.restore();
      doc.font('Helvetica').fontSize(8).fillColor(theme.pillText).text(pillText, pillX + 9, amountY + 10, {
        width: pillW - 18,
      });
    }
    doc.y = amountY + 36;
    doc.moveDown(0.4);

    drawCard(doc, theme, 'Como chegamos nesse valor', 'Conta simples do que entrou e do que saiu na semana.', () => {
      row(doc, theme, 'Entregas realizadas', formatBrlCents(payslip.totals.earnings_cents), {
        sublabel: deliveryCount ? `${deliveryCount} entregas no período` : undefined,
      });
      if (payslip.totals.weekly_dailies_cents > 0) {
        row(doc, theme, 'Diária-base de escala', formatBrlCents(payslip.totals.weekly_dailies_cents));
      }
      for (const occ of occurrences) {
        row(doc, theme, occ.label, `− ${formatBrlCents(occ.amountCents)}`, { negative: true });
      }
      row(doc, theme, 'Você vai receber', formatBrlCents(receiveAmount), { strong: true });
      doc.moveDown(0.25);
      const statsY = doc.y;
      const colW = (doc.page.width - 124) / 3;
      const stats = [
        { value: String(deliveryCount), label: 'Entregas', negative: false },
        { value: formatBrlCents(payslip.totals.cycle_total_cents), label: 'Total da semana', negative: false },
        { value: formatBrlCents(alreadyPaid), label: 'Já pago / descontado', negative: alreadyPaid > 0 },
      ];
      stats.forEach((stat, i) => {
        const x = 62 + i * colW;
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(stat.negative ? theme.negative : theme.text)
          .text(stat.value, x, statsY, { width: colW - 8, align: 'center' });
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor(theme.faint)
          .text(stat.label, x, statsY + 14, { width: colW - 8, align: 'center' });
      });
      doc.y = statsY + 30;
    });

    if (pharmacies.length) {
      drawCard(
        doc,
        theme,
        'Onde você trabalhou',
        'Locais em que suas entregas foram registradas nesta semana.',
        () => {
          for (const ph of pharmacies) {
            row(doc, theme, ph.name, formatBrlCents(ph.amountCents), {
              sublabel: ph.note || undefined,
            });
          }
        }
      );
    }

    if (payslip.recent_weeks?.length) {
      drawCard(doc, theme, 'Suas últimas semanas', 'Comparação com as semanas anteriores.', () => {
        const weeks = payslip.recent_weeks;
        const max = Math.max(1, ...weeks.map((w) => w.amount_cents));
        const chartX = 62;
        const chartW = doc.page.width - 124;
        const barGap = 10;
        const barW = Math.min(48, (chartW - barGap * (weeks.length - 1)) / Math.max(1, weeks.length));
        const totalBarsW = weeks.length * barW + (weeks.length - 1) * barGap;
        const baseY = doc.y + 88;
        weeks.forEach((week, i) => {
          const height = Math.max(8, Math.round((week.amount_cents / max) * 72));
          const x = chartX + (chartW - totalBarsW) / 2 + i * (barW + barGap);
          const y = baseY - height;
          doc.save();
          doc.roundedRect(x, y, barW, height, 4).fill(week.is_current ? theme.barCurrent : theme.barOther);
          doc.restore();
          doc
            .font('Helvetica')
            .fontSize(7)
            .fillColor(theme.faint)
            .text(week.label, x - 4, baseY + 6, { width: barW + 8, align: 'center' });
        });
        doc.y = baseY + 22;
      });
    }

    drawCard(doc, theme, 'Dados do pagamento', 'Confira se está tudo certo com a sua chave PIX.', () => {
      const gap = 10;
      const boxW = (doc.page.width - 124 - gap) / 2;
      const boxH = 46;
      const x0 = 62;
      let y = doc.y;
      fieldBox(doc, theme, x0, y, boxW, boxH, 'Cooperado', payslip.driver.name);
      fieldBox(doc, theme, x0 + boxW + gap, y, boxW, boxH, 'CPF', payslip.driver.cpf_masked);
      y += boxH + gap;
      fieldBox(
        doc,
        theme,
        x0,
        y,
        boxW,
        boxH,
        'Data do pagamento',
        payslip.pix.payment_date ? formatIsoDateBr(payslip.pix.payment_date) : '—'
      );
      fieldBox(doc, theme, x0 + boxW + gap, y, boxW, boxH, 'Chave PIX', payslip.driver.pix_key || '—');
      doc.y = y + boxH + 4;
    });

    ensureSpace(doc, theme, 48);
    doc.moveDown(0.3);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(theme.muted)
      .text(
        supportPhone
          ? `Alguma dúvida sobre esses valores? Fale com a CoopMob pelo ${supportPhone}.`
          : 'Alguma dúvida sobre esses valores? Fale com a CoopMob.',
        { align: 'center' }
      );
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(theme.faint)
      .text('Este link é pessoal e vale por 7 dias. Não repasse para outras pessoas.', { align: 'center' });

    doc.end();
  });
}
