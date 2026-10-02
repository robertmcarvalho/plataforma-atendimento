import { formatBrDate, formatBrDateTime, formatWeekdayPt } from './dates';
import type { SystemDescriptionContext } from './types';

export function buildSystemDescription(ctx: SystemDescriptionContext): string {
  const tz = ctx.timezone ?? 'America/Sao_Paulo';
  const launched = formatBrDateTime(ctx.createdAtIso, tz);
  const pay = formatBrDate(ctx.paymentDateIso);
  const payWd = formatWeekdayPt(ctx.paymentDateIso);
  const lines: string[] = [];

  if (ctx.entryType === 'daily') {
    lines.push(`[Crédito diária] Lançado: ${launched}`);
    lines.push(`Pagamento: ${pay} (${payWd})`);
  } else if (ctx.entryType === 'absence' && ctx.apuracao) {
    lines.push(`[Desconto falta] Evento: ${formatBrDate(ctx.apuracao.eventDate)}`);
    lines.push(
      `Apuração: ${formatBrDate(ctx.apuracao.apuracaoStart)} a ${formatBrDate(ctx.apuracao.apuracaoEnd)}`
    );
    lines.push(`Pagamento: ${pay} (${payWd})`);
  } else {
    lines.push(`[Desconto] Lançado: ${launched}`);
    lines.push(`Pagamento: ${pay} (${payWd})`);
    if (ctx.apuracao) {
      lines.push(
        `Apuração: ${formatBrDate(ctx.apuracao.apuracaoStart)} a ${formatBrDate(ctx.apuracao.apuracaoEnd)}`
      );
    }
  }

  lines.push(`Regra: ${ctx.ruleSummary}`);
  if (ctx.extraLine) lines.push(ctx.extraLine);
  return lines.join(' | ');
}

/** Extrai data de evento de descrição legada "Falta em YYYY-MM-DD". */
export function parseLegacyAbsenceEventDate(description: string | null | undefined): string | null {
  if (!description) return null;
  const m = description.match(/Falta em (\d{4}-\d{2}-\d{2})/i);
  return m?.[1] ?? null;
}

/** Extrai motivo legado após "Falta em DATE: " até ". Regra" ou fim. */
export function parseLegacyAbsenceReason(description: string | null | undefined): string | null {
  if (!description) return null;
  const m = description.match(/Falta em \d{4}-\d{2}-\d{2}:\s*(.+?)(?:\.\s*(?:Regra|Liquidação|\[))/i);
  if (m?.[1]) return m[1].trim();
  const m2 = description.match(/Falta em \d{4}-\d{2}-\d{2}:\s*(.+)$/i);
  return m2?.[1]?.trim() || null;
}
