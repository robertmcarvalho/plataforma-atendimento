import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAdvanceEligibility } from './advanceEligibility';
import { buildWeeklyDriverSummary } from './financialSummaries';
import {
  formatFinancialDateBr,
  formatFinancialEntryStatusLabel,
  formatFinancialEntryTypeLabel,
} from './financialHumanLabels';

const DISCOUNT_LIKE_TYPES = new Set([
  'absence',
  'uniform',
  'bag',
  'quota',
  'digital_cert',
  'other',
  'advance',
]);

export type LeaderFinancialReviewContext = {
  advance_eligibility: Awaited<ReturnType<typeof buildAdvanceEligibility>>;
  recent_entries: Array<{
    id: string;
    type: string;
    status: string;
    total_amount: number;
    start_date: string;
  }>;
  week_summary: Record<string, unknown> | null;
};

export function isLeaderFinancialDemand(demandKey: string, sectorName?: string | null): boolean {
  const key = String(demandKey || '').toLowerCase();
  if (key.startsWith('drv-fin-') || key.startsWith('ph-fin-')) return true;
  const sector = String(sectorName || '').toLowerCase();
  return sector.includes('financeiro');
}

export function isLeaderAdvanceDemand(demandKey: string): boolean {
  return String(demandKey || '').toLowerCase() === 'drv-fin-adv';
}

export async function buildDriverFinancialReviewContext(
  db: SupabaseClient,
  workspaceId: string,
  driverId: string
): Promise<LeaderFinancialReviewContext> {
  const advance_eligibility = await buildAdvanceEligibility(db, workspaceId, driverId);

  const { data: entries } = await db
    .from('financial_entries')
    .select('id, type, status, total_amount, start_date')
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(20);

  const recent_entries = (entries || []).map((e) => ({
    id: String(e.id),
    type: String(e.type || ''),
    status: String(e.status || ''),
    total_amount: Number(e.total_amount || 0),
    start_date: String(e.start_date || '').slice(0, 10),
  }));

  let week_summary: Record<string, unknown> | null = null;
  try {
    week_summary = (await buildWeeklyDriverSummary(driverId)) as Record<string, unknown>;
  } catch {
    week_summary = null;
  }

  return { advance_eligibility, recent_entries, week_summary };
}

function formatBrl(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

export type AttendantFinancialDisplay = {
  driver_name: string;
  open_advance_count: number;
  open_advances: Array<{ date_label: string; amount_label: string }>;
  month_summary_line: string | null;
  recent_advances: Array<{ line: string }>;
  recent_occurrences: Array<{ line: string }>;
  alerts: string[];
  flow_hint: string;
};

export function buildAttendantFinancialDisplay(
  ctx: LeaderFinancialReviewContext,
  driverName: string
): AttendantFinancialDisplay {
  const open_advances = ctx.advance_eligibility.open_advances.map((a) => ({
    date_label: formatFinancialDateBr(a.start_date),
    amount_label: formatBrl(a.total_amount),
  }));

  const ms = ctx.advance_eligibility.month_summary;
  const month_summary_line = ms
    ? `No mês: débitos ${formatBrl(ms.total_debits)}, parcelas a descontar ${formatBrl(ms.pending_installments_amount)}, saldo líquido estimado ${formatBrl(ms.net_estimated)}.`
    : null;

  const discounts = ctx.recent_entries.filter((e) => DISCOUNT_LIKE_TYPES.has(e.type) && e.type !== 'advance');
  const advances = ctx.recent_entries.filter((e) => e.type === 'advance');

  const recent_advances = advances.slice(0, 5).map((e) => ({
    line: `${formatFinancialDateBr(e.start_date)} — ${formatFinancialEntryTypeLabel(e.type)}, ${formatFinancialEntryStatusLabel(e.status)}, ${formatBrl(e.total_amount)}`,
  }));

  const recent_occurrences = discounts.slice(0, 8).map((e) => ({
    line: `${formatFinancialDateBr(e.start_date)} — ${formatFinancialEntryTypeLabel(e.type)}, ${formatFinancialEntryStatusLabel(e.status)}, ${formatBrl(e.total_amount)}`,
  }));

  return {
    driver_name: driverName?.trim() || 'Entregador',
    open_advance_count: ctx.advance_eligibility.open_advance_count,
    open_advances,
    month_summary_line,
    recent_advances,
    recent_occurrences,
    alerts: ctx.advance_eligibility.alerts.map((a) => a.message),
    flow_hint:
      'Gestor financeiro revisa na Inbox, aprova ou reprova e registra o lançamento se aprovado. Depois, qualquer retorno ao líder ou entregador é manual.',
  };
}

export function formatLeaderFinancialContextNote(ctx: LeaderFinancialReviewContext, driverName: string): string {
  const d = buildAttendantFinancialDisplay(ctx, driverName);
  const lines: string[] = ['Situação financeira do entregador:', `- Entregador: ${d.driver_name}`];

  if (d.open_advance_count === 0) {
    lines.push('- Adiantamentos em aberto: nenhum');
  } else {
    lines.push(`- Adiantamentos em aberto: ${d.open_advance_count}`);
    for (const a of d.open_advances) {
      lines.push(`  · ${a.date_label}: ${a.amount_label}`);
    }
  }

  if (d.month_summary_line) lines.push(`- ${d.month_summary_line}`);

  if (d.recent_advances.length) {
    lines.push('- Adiantamentos recentes:');
    for (const r of d.recent_advances) lines.push(`  · ${r.line}`);
  }

  if (d.recent_occurrences.length) {
    lines.push('- Descontos e ocorrências recentes:');
    for (const r of d.recent_occurrences) lines.push(`  · ${r.line}`);
  } else {
    lines.push('- Descontos e ocorrências recentes: nenhum além de adiantamentos.');
  }

  for (const msg of d.alerts) lines.push(`- Atenção: ${msg}`);

  lines.push(`- ${d.flow_hint}`);
  return lines.join('\n');
}
