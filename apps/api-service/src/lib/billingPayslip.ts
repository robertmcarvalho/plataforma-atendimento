import { createHash, randomBytes } from 'node:crypto';
import { canonicalBrazilWaPhone } from '@plataforma/channel-runtime';
import { resolveDailyPayTrack, DAILY_PAY_TRACK_WEEKLY_SETTLEMENT } from '@plataforma/billing-engine';
import { supabase } from './supabase';
import { normalizePaymentPolicy, resolveCostCenterDueDates } from './billingPaymentPolicy';
import { readWorkspaceSetting } from './workspaceSettings';
import { resolveWebAppBaseUrl } from './webAppUrl';
import {
  DISCOUNT_KINDS_ONCE,
  DISCOUNT_LABELS,
  PAYSLIP_SUPPORT_PHONE_SETTING_KEY,
  PAYSLIP_TEMPLATE_SETTING_KEY,
  resolvePayslipSupportPhone,
  addIsoDays,
  computePayslipTotals,
  costCenterScheduleNote,
  dailyCentsFromSettlementLine,
  isFinancialDailyPayable,
  compactPayslipWeekLabel,
  maskCpf,
  metaObject,
  payableNetAmount,
  payslipTrackFromPayable,
  type DriverPayslipRecentWeek,
  resolvePayslipTemplateLanguage,
  resolvePayslipTemplateName,
  type DriverPayslip,
  type DriverPayslipCostCenter,
  type DriverPayslipPharmacy,
  type PayslipLineLike,
} from './billingPayslipCore';

export * from './billingPayslipCore';

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

export function generatePayslipToken(): { token: string; tokenHash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, tokenHash: hashPayslipToken(token) };
}

export function hashPayslipToken(token: string): string {
  return createHash('sha256').update(String(token || '').trim()).digest('hex');
}

export function resolvePayslipPublicUrl(token: string): string {
  return `${resolveWebAppBaseUrl()}/public/recibo/${encodeURIComponent(token)}`;
}

async function loadPayslipRecentWeeks(input: {
  workspaceId: string;
  driverId: string;
  currentCycleId: string;
  currentCycleEnd: string;
  currentAmountCents: number;
}): Promise<DriverPayslipRecentWeek[]> {
  const { data: rows } = await supabase
    .from('billing_payables')
    .select('net_amount_cents, amount_cents, billing_cycle_id, billing_cycles(id, label, apuracao_end)')
    .eq('workspace_id', input.workspaceId)
    .eq('beneficiary_type', 'driver')
    .eq('beneficiary_id', input.driverId)
    .eq('origin_type', 'cycle_settlement')
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(16);

  const byCycle = new Map<string, { label: string; amount_cents: number; end: string }>();
  for (const row of rows || []) {
    const cycle = asOne(row.billing_cycles as Record<string, unknown> | Record<string, unknown>[] | null);
    const cycleId = String(row.billing_cycle_id || cycle?.id || '');
    if (!cycleId || byCycle.has(cycleId)) continue;
    const end = String(cycle?.apuracao_end || '').slice(0, 10);
    byCycle.set(cycleId, {
      label: compactPayslipWeekLabel(cycle?.label ? String(cycle.label) : null, end),
      amount_cents: payableNetAmount(row as { net_amount_cents?: number | null; amount_cents?: number | null }),
      end,
    });
  }

  if (!byCycle.has(input.currentCycleId)) {
    byCycle.set(input.currentCycleId, {
      label: compactPayslipWeekLabel(null, input.currentCycleEnd),
      amount_cents: input.currentAmountCents,
      end: input.currentCycleEnd,
    });
  } else {
    const current = byCycle.get(input.currentCycleId)!;
    current.amount_cents = input.currentAmountCents;
  }

  const sorted = [...byCycle.entries()]
    .sort((a, b) => a[1].end.localeCompare(b[1].end))
    .slice(-4)
    .map(([, week]) => week);

  return sorted.map((week, index) => ({
    label: week.label,
    amount_cents: week.amount_cents,
    is_current: index === sorted.length - 1,
  }));
}

export async function buildDriverPayslip(input: {
  workspaceId: string;
  payableId: string;
}): Promise<DriverPayslip | null> {
  const { data: payable, error: payErr } = await supabase
    .from('billing_payables')
    .select(
      'id, workspace_id, beneficiary_type, beneficiary_id, billing_cycle_id, origin_type, description, amount_cents, net_amount_cents, status, due_date, scheduled_payment_date, payment_method, metadata'
    )
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.payableId)
    .maybeSingle();
  if (payErr) throw new Error(payErr.message);
  if (!payable || String(payable.beneficiary_type) !== 'driver' || !payable.beneficiary_id) return null;

  const driverId = String(payable.beneficiary_id);
  const track = payslipTrackFromPayable(payable.origin_type);
  let cycleId = payable.billing_cycle_id ? String(payable.billing_cycle_id) : null;

  if (!cycleId && track === 'daily') {
    const { data: openCycles } = await supabase
      .from('billing_cycles')
      .select('id, apuracao_start, apuracao_end')
      .eq('workspace_id', input.workspaceId)
      .order('apuracao_end', { ascending: false })
      .limit(12);
    const due = String(payable.scheduled_payment_date || payable.due_date || '').slice(0, 10);
    const hit = (openCycles || []).find((c) => {
      const start = String(c.apuracao_start).slice(0, 10);
      const end = addIsoDays(String(c.apuracao_end).slice(0, 10), 14);
      return due && due >= start && due <= end;
    });
    cycleId = hit ? String(hit.id) : null;
  }
  if (!cycleId) return null;

  const { data: cycle, error: cycleErr } = await supabase
    .from('billing_cycles')
    .select('id, label, apuracao_start, apuracao_end')
    .eq('workspace_id', input.workspaceId)
    .eq('id', cycleId)
    .maybeSingle();
  if (cycleErr) throw new Error(cycleErr.message);
  if (!cycle) return null;

  const apuracaoStart = String(cycle.apuracao_start).slice(0, 10);
  const apuracaoEnd = String(cycle.apuracao_end).slice(0, 10);

  const [{ data: driver }, { data: settlements, error: stErr }, { data: payables }] = await Promise.all([
    supabase.from('drivers').select('id, name, cpf, phone, pix_key, pix_key_type').eq('id', driverId).maybeSingle(),
    supabase
      .from('billing_settlements')
      .select(
        'id, driver_id, pharmacy_id, net_driver_payout_cents, pharmacies(id, trade_name, legal_name, mg_mode, billing_cost_center_id, billing_cost_centers!billing_cost_center_id(*)), billing_settlement_lines(kind, description, driver_amount_cents, metadata)'
      )
      .eq('workspace_id', input.workspaceId)
      .eq('billing_cycle_id', cycleId)
      .eq('driver_id', driverId),
    supabase
      .from('billing_payables')
      .select(
        'id, origin_type, amount_cents, net_amount_cents, amount_paid_cents, status, due_date, scheduled_payment_date, payment_method, metadata, billing_cycle_id'
      )
      .eq('workspace_id', input.workspaceId)
      .eq('beneficiary_type', 'driver')
      .eq('beneficiary_id', driverId),
  ]);
  if (stErr) throw new Error(stErr.message);

  const driverPayables = payables || [];
  const weeklyPayable =
    driverPayables.find(
      (p) =>
        String(p.origin_type || '') === 'cycle_settlement' &&
        String(p.billing_cycle_id || '') === cycleId &&
        String(p.status) !== 'cancelled'
    ) || (track === 'weekly' ? payable : null);

  const dailyWindowEnd = addIsoDays(apuracaoEnd, 14);
  const dailyPayables = driverPayables.filter((p) => {
    if (String(p.status) === 'cancelled') return false;
    if (!isFinancialDailyPayable(p)) return false;
    if (String(p.billing_cycle_id || '') === cycleId) return true;
    const due = String(p.scheduled_payment_date || p.due_date || '').slice(0, 10);
    return Boolean(due && due >= apuracaoStart && due <= dailyWindowEnd);
  });

  const pharmacyNameById = new Map<string, string>();
  const ccNameById = new Map<string, string>();
  const grouped = new Map<
    string,
    {
      ccId: string | null;
      ccRow: Record<string, unknown> | null;
      pharmacies: Map<string, DriverPayslipPharmacy>;
    }
  >();
  const discounts: DriverPayslip['discounts'] = [];
  const discountKeys = new Set<string>();
  const dailyFromLines: DriverPayslip['dailies'] = [];
  let earningsCents = 0;
  let absencesCents = 0;
  // Diária-base de escala: compõe o PIX de quinta, então fica fora da lista de diárias
  // da trilha de terça — senão o total da semana contaria o mesmo valor duas vezes.
  let weeklyDailiesCents = 0;

  for (const row of settlements || []) {
    const pharmacy = asOne(row.pharmacies as Record<string, unknown> | Record<string, unknown>[] | null);
    const pharmacyId = String(row.pharmacy_id || pharmacy?.id || '');
    const pharmacyName = String(pharmacy?.trade_name || pharmacy?.legal_name || 'Farmácia');
    if (pharmacyId) pharmacyNameById.set(pharmacyId, pharmacyName);
    const rawCc = pharmacy?.billing_cost_centers as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
    const cc = asOne(rawCc);
    const ccId = cc?.id ? String(cc.id) : pharmacy?.billing_cost_center_id ? String(pharmacy.billing_cost_center_id) : null;
    const groupKey = ccId || 'none';
    if (cc?.id) {
      ccNameById.set(String(cc.id), String(cc.name || 'Centro de custo'));
    }
    const bucket =
      grouped.get(groupKey) ||
      {
        ccId,
        ccRow: cc,
        pharmacies: new Map<string, DriverPayslipPharmacy>(),
      };
    const ph =
      bucket.pharmacies.get(pharmacyId) ||
      {
        id: pharmacyId || `unknown-${bucket.pharmacies.size}`,
        name: pharmacyName,
        mg_mode: pharmacy?.mg_mode ? String(pharmacy.mg_mode) : null,
        earnings: null,
        absences: [],
        dailies: [],
        subtotal_cents: 0,
      };

    const lines = (row.billing_settlement_lines || []) as PayslipLineLike[];
    for (const line of lines) {
      const kind = String(line.kind || '');
      const meta = metaObject(line.metadata);
      if (kind === 'minimum_guarantee' || kind === 'deliveries') {
        const amount = Math.max(0, Number(line.driver_amount_cents || 0));
        ph.earnings = {
          kind,
          description: String(line.description || (kind === 'minimum_guarantee' ? 'Mínimo garantido' : 'Entregas')),
          amount_cents: amount,
          delivery_count: meta.delivery_count != null ? Number(meta.delivery_count) : null,
          active_days: meta.fixed_link_active_days != null ? Number(meta.fixed_link_active_days) : null,
          total_days: meta.fixed_link_total_days != null ? Number(meta.fixed_link_total_days) : null,
        };
        earningsCents += amount;
      } else if (kind === 'absence') {
        const amount = Math.abs(Number(line.driver_amount_cents || 0));
        if (amount > 0) {
          ph.absences.push({ description: String(line.description || 'Falta'), amount_cents: amount });
          absencesCents += amount;
        }
      } else if (kind === 'daily') {
        const amount = dailyCentsFromSettlementLine(line);
        if (amount > 0) {
          const eventDate = meta.event_date ? String(meta.event_date).slice(0, 10) : null;
          const payTrack = resolveDailyPayTrack(line) || 'financial_daily';
          ph.dailies.push({
            description: String(line.description || 'Diária'),
            amount_cents: amount,
            event_date: eventDate,
            pay_track: payTrack,
          });
          if (payTrack === DAILY_PAY_TRACK_WEEKLY_SETTLEMENT) {
            weeklyDailiesCents += amount;
          } else {
            dailyFromLines.push({
              description: String(line.description || 'Diária'),
              amount_cents: amount,
              payment_date: null,
              pharmacy_name: pharmacyName,
              paid: false,
            });
          }
        }
      } else if (DISCOUNT_KINDS_ONCE.has(kind)) {
        const amount = Math.abs(Number(line.driver_amount_cents || 0));
        if (amount <= 0) continue;
        const fingerprint = String(meta.financial_installment_id || `${kind}:${line.description}:${amount}`);
        if (discountKeys.has(fingerprint)) continue;
        discountKeys.add(fingerprint);
        discounts.push({
          kind,
          label: DISCOUNT_LABELS[kind] || kind,
          description: String(line.description || DISCOUNT_LABELS[kind] || kind),
          amount_cents: amount,
        });
      }
    }

    bucket.pharmacies.set(ph.id, ph);
    grouped.set(groupKey, bucket);
  }

  const dailiesFromPayables: DriverPayslip['dailies'] = dailyPayables.map((p) => {
    const meta = metaObject(p.metadata);
    const pharmacyId = meta.pharmacy_id ? String(meta.pharmacy_id) : null;
    return {
      description: 'Diária (PIX terça)',
      amount_cents: payableNetAmount(p),
      payment_date: String(p.scheduled_payment_date || p.due_date || '').slice(0, 10) || null,
      pharmacy_name: pharmacyId ? pharmacyNameById.get(pharmacyId) || null : null,
      paid: String(p.status) === 'paid' || Number(p.amount_paid_cents || 0) > 0,
    };
  });

  const dailiesCentsFromPayables = dailiesFromPayables.reduce((sum, row) => sum + row.amount_cents, 0);
  const dailiesCentsFromLines = dailyFromLines.reduce((sum, row) => sum + row.amount_cents, 0);
  const dailiesList = dailiesFromPayables.length ? dailiesFromPayables : dailyFromLines;
  const dailiesCents = dailiesFromPayables.length ? dailiesCentsFromPayables : dailiesCentsFromLines;
  const dailiesPaidCents = dailiesFromPayables.reduce((sum, row) => sum + (row.paid ? row.amount_cents : 0), 0);

  if (dailiesFromPayables.length) {
    for (const bucket of grouped.values()) {
      for (const ph of bucket.pharmacies.values()) {
        // Diária-base de escala não vem de payable da trilha de terça; ela não deve
        // bloquear o backfill nem ser sobrescrita por ele.
        if (!ph.dailies.some((d) => d.pay_track === 'financial_daily')) {
          const matched = dailiesFromPayables.filter((d) => d.pharmacy_name === ph.name);
          ph.dailies = [
            ...ph.dailies,
            ...matched.map((d) => ({
              description: d.description,
              amount_cents: d.amount_cents,
              event_date: d.payment_date,
              pay_track: 'financial_daily' as const,
            })),
          ];
        }
      }
    }
  }

  const thursdayPixCents = weeklyPayable
    ? payableNetAmount(weeklyPayable)
    : Math.max(
        0,
        earningsCents + weeklyDailiesCents - absencesCents - discounts.reduce((s, d) => s + d.amount_cents, 0)
      );
  const totals = computePayslipTotals({
    thursdayPixCents,
    dailiesCents,
    dailiesPaidCents: dailiesFromPayables.length ? dailiesPaidCents : dailiesCents,
  });

  const costCenters: DriverPayslipCostCenter[] = [];
  for (const bucket of grouped.values()) {
    const policy = normalizePaymentPolicy(bucket.ccRow);
    const dates = await resolveCostCenterDueDates({
      workspaceId: input.workspaceId,
      cycleEndIso: apuracaoEnd,
      policy,
    });
    const pharmacies = [...bucket.pharmacies.values()].map((ph) => {
      const dailySum = ph.dailies.reduce((s, d) => s + d.amount_cents, 0);
      const absenceSum = ph.absences.reduce((s, d) => s + d.amount_cents, 0);
      return {
        ...ph,
        subtotal_cents: Math.max(0, Number(ph.earnings?.amount_cents || 0) + dailySum - absenceSum),
      };
    });
    const closesWeekday =
      bucket.ccRow?.cycle_closes_weekday != null ? Number(bucket.ccRow.cycle_closes_weekday) : 7;
    costCenters.push({
      id: bucket.ccId,
      name: bucket.ccId ? ccNameById.get(bucket.ccId) || 'Centro de custo' : 'Sem centro de custo',
      apuracao_start: apuracaoStart,
      apuracao_end: apuracaoEnd,
      cycle_closes_weekday: closesWeekday,
      boleto_due_date: dates.invoice.effectiveDate,
      driver_payment_date: dates.driverPayment.effectiveDate,
      invoice_due_week_offset: policy.invoice_due_week_offset,
      driver_payment_week_offset: policy.driver_payment_week_offset,
      schedule_note: costCenterScheduleNote({
        cycle_closes_weekday: closesWeekday,
        invoice_due_weekday: policy.invoice_due_weekday,
        invoice_due_week_offset: policy.invoice_due_week_offset,
        driver_payment_weekday: policy.driver_payment_weekday,
        driver_payment_week_offset: policy.driver_payment_week_offset,
      }),
      pharmacies,
    });
  }
  costCenters.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const phone = driver?.phone ? canonicalBrazilWaPhone(String(driver.phone)) || String(driver.phone) : null;
  const pixToday = track === 'daily' ? payableNetAmount(payable) : totals.thursdayPixCents;
  const paymentDate =
    String(
      payable.scheduled_payment_date || payable.due_date || weeklyPayable?.scheduled_payment_date || weeklyPayable?.due_date || ''
    ).slice(0, 10) || null;

  const { data: latestToken } = await supabase
    .from('billing_payslip_tokens')
    .select('expires_at, revoked_at, last_sent_at')
    .eq('workspace_id', input.workspaceId)
    .eq('payable_id', input.payableId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const [recentWeeks, supportPhoneSetting] = await Promise.all([
    loadPayslipRecentWeeks({
      workspaceId: input.workspaceId,
      driverId,
      currentCycleId: cycleId,
      currentCycleEnd: apuracaoEnd,
      currentAmountCents: totals.cycleTotalCents,
    }),
    readWorkspaceSetting(input.workspaceId, PAYSLIP_SUPPORT_PHONE_SETTING_KEY),
  ]);

  return {
    payable_id: String(payable.id),
    track,
    driver: {
      id: driverId,
      name: String(driver?.name || 'Entregador'),
      cpf_masked: maskCpf(driver?.cpf ? String(driver.cpf) : null),
      phone,
      pix_key: driver?.pix_key ? String(driver.pix_key) : null,
      pix_key_type: driver?.pix_key_type ? String(driver.pix_key_type) : null,
    },
    cycle: {
      id: cycleId,
      label: cycle.label ? String(cycle.label) : null,
      apuracao_start: apuracaoStart,
      apuracao_end: apuracaoEnd,
    },
    pix: {
      payment_date: paymentDate,
      amount_cents: pixToday,
      method: String(payable.payment_method || weeklyPayable?.payment_method || 'pix'),
    },
    totals: {
      cycle_total_cents: totals.cycleTotalCents,
      dailies_cents: totals.dailiesCents,
      dailies_paid_cents: totals.dailiesPaidCents,
      weekly_dailies_cents: weeklyDailiesCents,
      thursday_pix_cents: totals.thursdayPixCents,
      absences_cents: absencesCents,
      discounts_cents: discounts.reduce((s, d) => s + d.amount_cents, 0),
      earnings_cents: earningsCents,
    },
    cost_centers: costCenters,
    discounts,
    dailies: dailiesList,
    recent_weeks: recentWeeks,
    send: {
      can_send: Boolean(phone),
      phone,
      last_sent_at: latestToken?.last_sent_at ? String(latestToken.last_sent_at) : null,
      expires_at: latestToken?.expires_at ? String(latestToken.expires_at) : null,
      public_url: null,
      revoked: Boolean(latestToken?.revoked_at),
    },
    support_phone: resolvePayslipSupportPhone(supportPhoneSetting),
  };
}

export async function loadPayslipTemplateConfig(workspaceId: string): Promise<{ name: string; language: string }> {
  const setting = await readWorkspaceSetting(workspaceId, PAYSLIP_TEMPLATE_SETTING_KEY);
  return {
    name: resolvePayslipTemplateName(setting),
    language: resolvePayslipTemplateLanguage(setting),
  };
}
