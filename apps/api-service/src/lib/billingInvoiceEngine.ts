import { randomBytes } from 'node:crypto';
import { supabase } from './supabase';
import { resolveSplitPercentages } from '@plataforma/billing-engine';
import { normalizePaymentPolicy, resolveCostCenterDueDates } from './billingPaymentPolicy';
import { omitInvoiceNfseWriteColumns } from './pharmacyNfseWrite';
import { collectInvoicePharmacyIds, invoiceKeysToSkip } from './billingInvoiceRegen';
import { isPaidFinancialLock } from './billingSettlementReopen';
import { invoiceHasPreservableInterest } from './billingInvoiceInterest';

function asOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function metadataString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function entityPortionCents(lineAmountCents: number, entityTotalCents: number, settlementTotalCents: number): number {
  if (lineAmountCents <= 0 || entityTotalCents <= 0 || settlementTotalCents <= 0) return 0;
  return Math.round((lineAmountCents * entityTotalCents) / settlementTotalCents);
}

export async function resolveInvoicePharmacyIdsForRegen(
  workspaceId: string,
  cycleId: string,
  pharmacyId: string
): Promise<string[]> {
  const { data: pharmacy, error: phErr } = await supabase
    .from('pharmacies')
    .select('billing_cost_centers!billing_cost_center_id(billing_pharmacy_id)')
    .eq('workspace_id', workspaceId)
    .eq('id', pharmacyId)
    .maybeSingle();
  if (phErr) throw new Error(phErr.message);
  const cc = asOne(pharmacy?.billing_cost_centers as Record<string, unknown> | Record<string, unknown>[] | null);

  const { data: invoices, error: invErr } = await supabase
    .from('billing_invoices')
    .select('id, pharmacy_id, billing_invoice_lines(metadata)')
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId);
  if (invErr) throw new Error(invErr.message);

  const fromLines: string[] = [];
  for (const inv of invoices || []) {
    const lines = (inv.billing_invoice_lines || []) as Array<{ metadata?: Record<string, unknown> }>;
    const sourced = lines.some((line) => metadataString(line.metadata?.source_pharmacy_id) === pharmacyId);
    if (sourced) fromLines.push(String(inv.pharmacy_id));
  }

  return collectInvoicePharmacyIds({
    operationalPharmacyId: pharmacyId,
    billingPharmacyId: cc?.billing_pharmacy_id ? String(cc.billing_pharmacy_id) : null,
    invoicePharmacyIdsFromLines: fromLines,
  });
}

export async function deleteRegenerablePharmacyInvoices(
  workspaceId: string,
  cycleId: string,
  pharmacyId: string
): Promise<number> {
  const targetIds = await resolveInvoicePharmacyIdsForRegen(workspaceId, cycleId, pharmacyId);
  const { data, error } = await supabase
    .from('billing_invoices')
    .select('id, amount_paid_cents, status, billing_invoice_lines(metadata)')
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .in('pharmacy_id', targetIds);
  if (error) throw new Error(error.message);

  const ids = (data || [])
    .filter((row) => !isPaidFinancialLock(String(row.status), row.amount_paid_cents))
    .filter((row) => !invoiceHasPreservableInterest(row.billing_invoice_lines as Array<{ metadata?: unknown }>))
    .map((row) => String(row.id));
  if (!ids.length) return 0;

  // ON DELETE SET NULL on billing_payments.invoice_id would orphan payments (both targets null)
  // and violate billing_payments_single_target_check — remove pending baixas first.
  const { error: payDelErr } = await supabase
    .from('billing_payments')
    .delete()
    .eq('workspace_id', workspaceId)
    .in('invoice_id', ids)
    .eq('reconciled', false);
  if (payDelErr) throw new Error(payDelErr.message);

  const { error: delErr } = await supabase.from('billing_invoices').delete().in('id', ids);
  if (delErr) throw new Error(delErr.message);
  return ids.length;
}

export async function generateCycleInvoices(
  workspaceId: string,
  cycleId: string,
  options?: { forcePharmacyIds?: string[] }
): Promise<{ invoices: number }> {
  const { data: cycle, error: cycleErr } = await supabase
    .from('billing_cycles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', cycleId)
    .maybeSingle();
  if (cycleErr) throw new Error(cycleErr.message);
  if (!cycle) throw new Error('Ciclo não encontrado');

  const { data: settlements, error: stErr } = await supabase
    .from('billing_settlements')
    .select(
      '*, drivers(id, name), pharmacies(id, trade_name, legal_name, contract_scope, minimum_deliveries_count, split_coop_pct, split_flux_pct, billing_cost_center_id, billing_cost_centers!billing_cost_center_id(*)), billing_settlement_lines(*)'
    )
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId)
    .in('status', ['approved', 'paid']);
  if (stErr) throw new Error(stErr.message);
  if (!settlements?.length) return { invoices: 0 };

  const byBillingPharmacy = new Map<string, typeof settlements>();
  for (const row of settlements) {
    const pharmacy = asOne(row.pharmacies as Record<string, unknown> | Record<string, unknown>[] | null);
    const cc = asOne(pharmacy?.billing_cost_centers as Record<string, unknown> | Record<string, unknown>[] | null);
    const dailyBillingPharmacyId = ((row.billing_settlement_lines || []) as Array<{ metadata?: Record<string, unknown> }>)
      .map((line) => metadataString(line.metadata?.billing_pharmacy_id))
      .find(Boolean);
    const pid = String(cc?.billing_pharmacy_id || dailyBillingPharmacyId || row.pharmacy_id);
    if (!byBillingPharmacy.has(pid)) byBillingPharmacy.set(pid, []);
    byBillingPharmacy.get(pid)!.push(row);
  }

  const now = new Date().toISOString();
  let count = 0;
  const forcePharmacyIds = [...new Set((options?.forcePharmacyIds || []).map(String).filter(Boolean))];

  if (forcePharmacyIds.length) {
    const { data: forcedInvoices, error: forcedErr } = await supabase
      .from('billing_invoices')
      .select('id, amount_paid_cents, status, billing_invoice_lines(metadata)')
      .eq('workspace_id', workspaceId)
      .eq('billing_cycle_id', cycleId)
      .in('pharmacy_id', forcePharmacyIds);
    if (forcedErr) throw new Error(forcedErr.message);
    const forcedIds = (forcedInvoices || [])
      .filter((row) => !isPaidFinancialLock(String(row.status), row.amount_paid_cents))
      .filter((row) => !invoiceHasPreservableInterest(row.billing_invoice_lines as Array<{ metadata?: unknown }>))
      .map((row) => String(row.id));
    if (forcedIds.length) {
      const { error: payDelErr } = await supabase
        .from('billing_payments')
        .delete()
        .eq('workspace_id', workspaceId)
        .in('invoice_id', forcedIds)
        .eq('reconciled', false);
      if (payDelErr) throw new Error(payDelErr.message);
      const { error: delForcedErr } = await supabase.from('billing_invoices').delete().in('id', forcedIds);
      if (delForcedErr) throw new Error(delForcedErr.message);
    }
  }

  await supabase.from('billing_invoices').delete().eq('billing_cycle_id', cycleId).eq('workspace_id', workspaceId).eq('status', 'draft');
  const { data: preservedInvoices, error: preservedErr } = await supabase
    .from('billing_invoices')
    .select('pharmacy_id, entity_type, status, amount_paid_cents, billing_invoice_lines(metadata)')
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', cycleId);
  if (preservedErr) throw new Error(preservedErr.message);
  const preservedInvoiceKeys = invoiceKeysToSkip(
    (preservedInvoices || []).map((row) => ({
      pharmacy_id: String(row.pharmacy_id),
      entity_type: String(row.entity_type),
      status: row.status,
      amount_paid_cents: row.amount_paid_cents,
      // Treat interest-adjusted invoices like locked so regenerate does not recreate duplicates.
      force_preserve: invoiceHasPreservableInterest(row.billing_invoice_lines as Array<{ metadata?: unknown }>),
    })),
    forcePharmacyIds
  );

  for (const [pharmacyId, rows] of byBillingPharmacy) {
    const sourcePharmacy = asOne(rows[0]?.pharmacies as {
      id?: string;
      trade_name?: string;
      legal_name?: string;
      contract_scope?: string;
      minimum_deliveries_count?: number | null;
      split_coop_pct?: number | null;
      split_flux_pct?: number | null;
      billing_cost_center_id?: string | null;
      billing_cost_centers?: Record<string, unknown> | Record<string, unknown>[] | null;
    } | null);
    const rawCc = sourcePharmacy?.billing_cost_centers;
    const cc = asOne(rawCc);
    const policy = normalizePaymentPolicy(cc || null);
    const { invoice: invoiceDueDate } = await resolveCostCenterDueDates({
      workspaceId,
      cycleEndIso: String(cycle.apuracao_end).slice(0, 10),
      policy,
    });
    const split = resolveSplitPercentages({
      contractScope: (sourcePharmacy?.contract_scope as 'both' | 'coop_only' | 'flux_only') || 'both',
      pharmacySplitCoopPct: sourcePharmacy?.split_coop_pct != null ? Number(sourcePharmacy.split_coop_pct) : null,
      pharmacySplitFluxPct: sourcePharmacy?.split_flux_pct != null ? Number(sourcePharmacy.split_flux_pct) : null,
      costCenterSplitCoopPct: cc?.split_coop_pct != null ? Number(cc.split_coop_pct) : null,
      costCenterSplitFluxPct: cc?.split_flux_pct != null ? Number(cc.split_flux_pct) : null,
    });

    const entities: Array<'coop' | 'flux'> = ['coop', 'flux'];

    for (const entityType of entities) {
      if (preservedInvoiceKeys.has(`${pharmacyId}:${entityType}`)) continue;
      const totalCents = rows.reduce(
        (acc, row) => acc + (entityType === 'coop' ? Number(row.coop_cents) : Number(row.flux_cents)),
        0
      );
      if (totalCents <= 0) continue;

      const { data: invoice, error: invErr } = await supabase
        .from('billing_invoices')
        .insert(
          omitInvoiceNfseWriteColumns({
            workspace_id: workspaceId,
            billing_cycle_id: cycleId,
            pharmacy_id: pharmacyId,
            entity_type: entityType,
            status: 'draft',
            total_cents: totalCents,
            due_date: invoiceDueDate.effectiveDate,
            public_token: randomBytes(24).toString('hex'),
            notes: invoiceDueDate.adjusted
              ? `Vencimento original ${invoiceDueDate.originalDate} ajustado para ${invoiceDueDate.effectiveDate} (${invoiceDueDate.reason}).`
              : null,
            updated_at: now,
          })
        )
        .select('id')
        .single();
      if (invErr) throw new Error(invErr.message);

      const lineRows = rows.map((row, index) => {
        const driver = row.drivers as { name?: string } | null;
        const operationalPharmacy = asOne(row.pharmacies as {
          id?: string;
          trade_name?: string;
          legal_name?: string;
          billing_cost_center_id?: string | null;
          billing_cost_centers?: Record<string, unknown> | Record<string, unknown>[] | null;
          minimum_deliveries_count?: number | null;
        } | null);
        const operationalCc = asOne(operationalPharmacy?.billing_cost_centers);
        const amount = entityType === 'coop' ? Number(row.coop_cents) : Number(row.flux_cents);
        const settlementTotalCents = Number(row.pharmacy_charge_cents) || 0;
        const deliveryCount = Number(row.delivery_count) || 0;
        const minimumDeliveries = Number(operationalPharmacy?.minimum_deliveries_count) || 0;
        const settlementLines = (row.billing_settlement_lines || []) as Array<{
          kind?: string;
          description?: string | null;
          pharmacy_amount_cents?: number | null;
          metadata?: Record<string, unknown>;
        }>;
        const dailyLines = settlementLines
          .filter((line) => line.kind === 'daily' && Number(line.pharmacy_amount_cents || 0) > 0)
          .map((line) => {
            const totalAmountCents = Number(line.pharmacy_amount_cents || 0);
            return {
              description: line.description || 'Diária',
              total_amount_cents: totalAmountCents,
              entity_amount_cents: entityPortionCents(totalAmountCents, amount, settlementTotalCents),
              financial_entry_id: metadataString(line.metadata?.financial_entry_id),
              allocation_rule: metadataString(line.metadata?.allocation_rule),
              group_id: metadataString(line.metadata?.group_id),
              group_name: metadataString(line.metadata?.group_name),
            };
          });
        const comparison =
          minimumDeliveries > 0
            ? `${deliveryCount} entregas realizadas no ciclo; mínimo contratado: ${minimumDeliveries}`
            : `${deliveryCount} entregas realizadas no ciclo`;
        return {
          invoice_id: invoice.id,
          line_order: index,
          description: `${driver?.name || 'Entregador'} — ${comparison}${row.applied_mg ? '; MG aplicado' : ''}`,
          quantity: deliveryCount || 1,
          unit_cents: Math.round(amount / Math.max(1, deliveryCount)),
          amount_cents: amount,
          metadata: {
            settlement_id: row.id,
            driver_id: row.driver_id,
            delivery_count: deliveryCount,
            minimum_deliveries_count: minimumDeliveries || null,
            applied_mg: Boolean(row.applied_mg),
            split_coop_pct: split.coopPct,
            split_flux_pct: split.fluxPct,
            source_pharmacy_id: operationalPharmacy?.id || row.pharmacy_id,
            source_pharmacy_name: operationalPharmacy?.trade_name || operationalPharmacy?.legal_name || null,
            billing_pharmacy_id: pharmacyId,
            cost_center_id: operationalPharmacy?.billing_cost_center_id || null,
            cost_center_name: operationalCc?.name || null,
            daily_lines: dailyLines,
          },
        };
      });

      const { error: lineErr } = await supabase.from('billing_invoice_lines').insert(lineRows);
      if (lineErr) throw new Error(lineErr.message);
      count += 1;
    }
  }

  return { invoices: count };
}

export async function fetchPublicBillingReport(
  publicToken: string,
  filters?: { date?: string | null; driver_id?: string | null; pharmacy_id?: string | null; page?: number | null }
) {
  const { data: invoice, error } = await supabase
    .from('billing_invoices')
    .select(
      '*, pharmacies(id, trade_name, legal_name, cnpj), billing_cycles(id, label, apuracao_start, apuracao_end), billing_invoice_lines(*)'
    )
    .eq('public_token', publicToken)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invoice) return null;

  if (invoice.entity_type === 'flux') {
    const { data: coopInvoice, error: coopErr } = await supabase
      .from('billing_invoices')
      .select('public_token')
      .eq('workspace_id', invoice.workspace_id)
      .eq('billing_cycle_id', invoice.billing_cycle_id)
      .eq('pharmacy_id', invoice.pharmacy_id)
      .eq('entity_type', 'coop')
      .maybeSingle();
    if (coopErr) throw new Error(coopErr.message);
    return coopInvoice?.public_token
      ? { redirect_token: coopInvoice.public_token, public_report_blocked: true }
      : { invoice, public_report_blocked: true };
  }

  const selectedDate = filters?.date && /^\d{4}-\d{2}-\d{2}$/.test(filters.date) ? filters.date : null;
  const selectedDriverId = filters?.driver_id || null;
  const selectedPharmacyId = filters?.pharmacy_id || null;
  const page = Math.max(1, Number(filters?.page) || 1);
  const limit = 50;
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const invoiceLines = (invoice.billing_invoice_lines || []) as Array<{ metadata?: Record<string, unknown> }>;
  const sourcePharmacyIds = [
    ...new Set(
      invoiceLines
        .map((line) => metadataString(line.metadata?.source_pharmacy_id))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const filteredSourcePharmacyIds =
    selectedPharmacyId && sourcePharmacyIds.includes(selectedPharmacyId)
      ? [selectedPharmacyId]
      : sourcePharmacyIds.length
        ? sourcePharmacyIds
        : [String(invoice.pharmacy_id)];

  let deliveriesQuery = supabase
    .from('billing_delivery_records')
    .select('id, delivered_at, document_number, cancelled, driver_id, pharmacy_id, drivers(id, name), pharmacies(id, trade_name, legal_name)', { count: 'exact' })
    .eq('billing_cycle_id', invoice.billing_cycle_id)
    .eq('cancelled', false)
    .order('delivered_at')
    .range(from, to);
  deliveriesQuery =
    filteredSourcePharmacyIds.length === 1
      ? deliveriesQuery.eq('pharmacy_id', filteredSourcePharmacyIds[0])
      : deliveriesQuery.in('pharmacy_id', filteredSourcePharmacyIds);

  if (selectedDate) {
    deliveriesQuery = deliveriesQuery
      .gte('delivered_at', `${selectedDate}T00:00:00.000Z`)
      .lte('delivered_at', `${selectedDate}T23:59:59.999Z`);
  }
  if (selectedDriverId) deliveriesQuery = deliveriesQuery.eq('driver_id', selectedDriverId);

  const { data: deliveries, count: deliveriesCount, error: deliveriesError } = await deliveriesQuery;
  if (deliveriesError) throw new Error(deliveriesError.message);

  const { data: optionRows, error: optionErr } = await supabase
    .from('billing_delivery_records')
    .select('driver_id, delivered_at, pharmacy_id, drivers(id, name), pharmacies(id, trade_name, legal_name)')
    .eq('billing_cycle_id', invoice.billing_cycle_id)
    .in('pharmacy_id', sourcePharmacyIds.length ? sourcePharmacyIds : [String(invoice.pharmacy_id)])
    .eq('cancelled', false)
    .order('delivered_at');
  if (optionErr) throw new Error(optionErr.message);

  const driverMap = new Map<string, string>();
  const daySet = new Set<string>();
  const pharmacyMap = new Map<string, string>();
  for (const line of invoiceLines) {
    const id = metadataString(line.metadata?.source_pharmacy_id);
    if (!id) continue;
    pharmacyMap.set(id, metadataString(line.metadata?.source_pharmacy_name) || id);
  }
  for (const row of optionRows || []) {
    const driver = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
    const pharmacy = Array.isArray(row.pharmacies) ? row.pharmacies[0] : row.pharmacies;
    if (row.driver_id && driver?.name) driverMap.set(String(row.driver_id), String(driver.name));
    if (row.pharmacy_id) pharmacyMap.set(String(row.pharmacy_id), String(pharmacy?.trade_name || pharmacy?.legal_name || row.pharmacy_id));
    if (row.delivered_at) daySet.add(String(row.delivered_at).slice(0, 10));
  }

  const { data: legal } = await supabase
    .from('billing_legal_entities')
    .select('*')
    .eq('workspace_id', invoice.workspace_id)
    .eq('entity_type', invoice.entity_type)
    .maybeSingle();

  const { data: companionInvoice, error: companionErr } = await supabase
    .from('billing_invoices')
    .select('id, entity_type, status, total_cents, amount_paid_cents, due_date, public_token, billing_invoice_lines(*)')
    .eq('workspace_id', invoice.workspace_id)
    .eq('billing_cycle_id', invoice.billing_cycle_id)
    .eq('pharmacy_id', invoice.pharmacy_id)
    .eq('entity_type', 'flux')
    .maybeSingle();
  if (companionErr) throw new Error(companionErr.message);

  const { data: previousCycles, error: previousCyclesErr } = await supabase
    .from('billing_cycles')
    .select('id, label, apuracao_start, apuracao_end')
    .eq('workspace_id', invoice.workspace_id)
    .lt('apuracao_end', String(invoice.billing_cycles?.apuracao_start || '').slice(0, 10))
    .order('apuracao_end', { ascending: false })
    .limit(3);
  if (previousCyclesErr) throw new Error(previousCyclesErr.message);

  const previousCycleIds = (previousCycles || []).map((cycle) => String(cycle.id));
  const { data: previousSettlements, error: previousSettlementsErr } = previousCycleIds.length
    ? await supabase
        .from('billing_settlements')
        .select('billing_cycle_id, driver_id, pharmacy_charge_cents, applied_mg')
        .eq('workspace_id', invoice.workspace_id)
        .in('pharmacy_id', filteredSourcePharmacyIds)
        .in('billing_cycle_id', previousCycleIds)
        .in('status', ['approved', 'paid'])
    : { data: [], error: null };
  if (previousSettlementsErr) throw new Error(previousSettlementsErr.message);

  const { data: previousDeliveryRows, error: previousDeliveryErr } = previousCycleIds.length
    ? await supabase
        .from('billing_delivery_records')
        .select('billing_cycle_id')
        .eq('workspace_id', invoice.workspace_id)
        .in('pharmacy_id', filteredSourcePharmacyIds)
        .eq('cancelled', false)
        .in('billing_cycle_id', previousCycleIds)
    : { data: [], error: null };
  if (previousDeliveryErr) throw new Error(previousDeliveryErr.message);

  const previousByCycle = new Map<
    string,
    { delivery_count: number; total_cents: number; mg_count: number; driver_ids: Set<string> }
  >();
  for (const row of previousSettlements || []) {
    const cycleId = String(row.billing_cycle_id);
    const bucket = previousByCycle.get(cycleId) || {
      delivery_count: 0,
      total_cents: 0,
      mg_count: 0,
      driver_ids: new Set<string>(),
    };
    bucket.total_cents += Number(row.pharmacy_charge_cents) || 0;
    if (row.applied_mg) bucket.mg_count += 1;
    if (row.driver_id) bucket.driver_ids.add(String(row.driver_id));
    previousByCycle.set(cycleId, bucket);
  }
  for (const row of previousDeliveryRows || []) {
    const cycleId = String(row.billing_cycle_id);
    const bucket = previousByCycle.get(cycleId) || {
      delivery_count: 0,
      total_cents: 0,
      mg_count: 0,
      driver_ids: new Set<string>(),
    };
    bucket.delivery_count += 1;
    previousByCycle.set(cycleId, bucket);
  }

  return {
    invoice,
    companion_invoice: companionInvoice || null,
    public_report_blocked: false,
    cycle_comparison: {
      previous_cycles: (previousCycles || [])
        .slice()
        .reverse()
        .map((cycle) => {
          const bucket = previousByCycle.get(String(cycle.id));
          return {
            id: cycle.id,
            label: cycle.label,
            apuracao_start: cycle.apuracao_start,
            apuracao_end: cycle.apuracao_end,
            delivery_count: bucket?.delivery_count || 0,
            total_cents: bucket?.total_cents || 0,
            driver_count: bucket?.driver_ids.size || 0,
            minimum_guaranteed_count: bucket?.mg_count || 0,
          };
        }),
    },
    deliveries: deliveries || [],
    legal_entity: legal,
    delivery_filters: {
      date: selectedDate,
      driver_id: selectedDriverId,
      pharmacy_id: selectedPharmacyId,
      page,
      limit,
      total: deliveriesCount || 0,
      total_pages: Math.max(1, Math.ceil((deliveriesCount || 0) / limit)),
      days: [...daySet].sort(),
      drivers: [...driverMap.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      pharmacies: [...pharmacyMap.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    },
  };
}
