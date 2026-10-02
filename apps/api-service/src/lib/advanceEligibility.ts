import type { SupabaseClient } from '@supabase/supabase-js';
import { FinancialEntryStatus } from '@plataforma/operational-notes';
import { supabase } from './supabase';
import { buildMonthlyDriverSummary } from './financialSummaries';

export async function buildAdvanceEligibility(
  db: SupabaseClient,
  workspaceId: string,
  driverId: string,
  requestedAmount?: number
) {
  const { data: entries } = await db
    .from('financial_entries')
    .select('id, total_amount, status, type, start_date')
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .eq('type', 'advance')
    .in('status', [
      FinancialEntryStatus.PENDING_APPROVAL,
      FinancialEntryStatus.APPROVED,
      FinancialEntryStatus.ACTIVE,
    ]);

  const open_advances = (entries || []).map((e) => ({
    entry_id: String(e.id),
    total_amount: Number(e.total_amount || 0),
    remaining: Number(e.total_amount || 0),
    start_date: String(e.start_date || '').slice(0, 10),
  }));

  let month_summary = { total_debits: 0, pending_installments_amount: 0, net_estimated: 0 };
  try {
    const month = new Date().toISOString().slice(0, 7);
    const summary = await buildMonthlyDriverSummary(driverId, month);
    month_summary = {
      total_debits: Number((summary as { total_debits?: number }).total_debits || 0),
      pending_installments_amount: Number((summary as { pending_installments_amount?: number }).pending_installments_amount || 0),
      net_estimated: Number((summary as { net_balance?: number }).net_balance || 0),
    };
  } catch {
    // optional
  }

  const { data: settings } = await db
    .from('app_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('key', 'financial_advance_policy')
    .maybeSingle();

  const policyRaw = (settings?.value as Record<string, unknown>) || {};
  const max_open_count = Number(policyRaw.max_open_count ?? 2);
  const max_percent = Number(policyRaw.max_percent_of_net ?? 50);

  const alerts: Array<{ code: string; message: string; severity: 'warn' | 'block' }> = [];
  if (open_advances.length >= max_open_count) {
    alerts.push({
      code: 'max_open',
      message: `Entregador já possui ${open_advances.length} adiantamento(s) em aberto.`,
      severity: 'block',
    });
  }

  const net = month_summary.net_estimated || 0;
  const recommended_max_amount = net > 0 ? Math.round(net * (max_percent / 100) * 100) / 100 : 0;
  if (requestedAmount && requestedAmount > recommended_max_amount && recommended_max_amount > 0) {
    alerts.push({
      code: 'over_recommended',
      message: `Valor solicitado acima do recomendado (R$ ${recommended_max_amount.toFixed(2)}).`,
      severity: 'warn',
    });
  }

  return {
    driver_id: driverId,
    open_advances,
    open_advance_count: open_advances.length,
    month_summary,
    policy: { max_open_count, max_percent_of_net: max_percent },
    requested_amount: requestedAmount,
    alerts,
    recommended_max_amount,
  };
}

export async function buildAdvanceEligibilityDefault(driverId: string, workspaceId: string, requestedAmount?: number) {
  return buildAdvanceEligibility(supabase, workspaceId, driverId, requestedAmount);
}
