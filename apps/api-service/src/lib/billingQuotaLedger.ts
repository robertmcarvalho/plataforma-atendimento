import type { SupabaseClient } from '@supabase/supabase-js';

type Db = SupabaseClient;

function cents(value: unknown): number {
  return Math.round(Number(value || 0) * 100);
}

async function recalcQuotaAccount(db: Db, workspaceId: string, accountId: string) {
  const { data: rows, error } = await db
    .from('billing_quota_account_entries')
    .select('entry_type, amount_cents')
    .eq('workspace_id', workspaceId)
    .eq('account_id', accountId);
  if (error) throw new Error(error.message);

  let integralized = 0;
  let adjusted = 0;
  let compensated = 0;
  let refunded = 0;
  for (const row of rows || []) {
    const amount = Number(row.amount_cents || 0);
    if (row.entry_type === 'integralization') integralized += amount;
    else if (row.entry_type === 'adjustment' || row.entry_type === 'reversal') adjusted += amount;
    else if (row.entry_type === 'compensation') compensated += Math.abs(amount);
    else if (row.entry_type === 'refund') refunded += Math.abs(amount);
  }
  const balance = integralized + adjusted - compensated - refunded;
  const { error: updErr } = await db
    .from('billing_quota_accounts')
    .update({
      integralized_cents: integralized,
      adjusted_cents: adjusted,
      compensated_cents: compensated,
      refunded_cents: refunded,
      balance_cents: balance,
      last_movement_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', accountId);
  if (updErr) throw new Error(updErr.message);
}

export async function ensureQuotaAccount(db: Db, workspaceId: string, driverId: string): Promise<string> {
  const { data: existing, error: loadErr } = await db
    .from('billing_quota_accounts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .maybeSingle();
  if (loadErr) throw new Error(loadErr.message);
  if (existing?.id) return String(existing.id);

  const { data, error } = await db
    .from('billing_quota_accounts')
    .insert({ workspace_id: workspaceId, driver_id: driverId })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

/** Garante que parcelas de cota pagas no financeiro estejam no ledger antes do acerto de desligamento. */
export async function syncDriverPaidQuotaIntegralizations(
  db: Db,
  input: { workspaceId: string; driverId: string; actorId?: string | null }
): Promise<{ synced: number; balance_cents: number }> {
  const { data: entries, error } = await db
    .from('financial_entries')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('driver_id', input.driverId)
    .eq('type', 'quota')
    .neq('status', 'cancelled');
  if (error) throw new Error(error.message);

  const entryIds = (entries || []).map((entry) => String(entry.id));
  if (!entryIds.length) {
    const accountId = await ensureQuotaAccount(db, input.workspaceId, input.driverId);
    const { data: account } = await db
      .from('billing_quota_accounts')
      .select('balance_cents, integralized_cents, adjusted_cents, compensated_cents, refunded_cents')
      .eq('id', accountId)
      .maybeSingle();
    const balanceFromColumns = Math.max(
      0,
      Number(account?.integralized_cents || 0) +
        Number(account?.adjusted_cents || 0) -
        Number(account?.compensated_cents || 0) -
        Number(account?.refunded_cents || 0)
    );
    return { synced: 0, balance_cents: Math.max(Number(account?.balance_cents || 0), balanceFromColumns) };
  }

  const { data: installments, error: instErr } = await db
    .from('financial_installments')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .in('entry_id', entryIds)
    .eq('status', 'paid');
  if (instErr) throw new Error(instErr.message);

  let synced = 0;
  for (const installment of installments || []) {
    const result = await syncQuotaInstallmentPayment(db, {
      workspaceId: input.workspaceId,
      installmentId: String(installment.id),
      actorId: input.actorId || null,
    });
    if (result) synced += 1;
  }

  const accountId = await ensureQuotaAccount(db, input.workspaceId, input.driverId);
  const { data: account } = await db
    .from('billing_quota_accounts')
    .select('balance_cents, integralized_cents, adjusted_cents, compensated_cents, refunded_cents')
    .eq('id', accountId)
    .maybeSingle();
  const balanceFromColumns = Math.max(
    0,
    Number(account?.integralized_cents || 0) +
      Number(account?.adjusted_cents || 0) -
      Number(account?.compensated_cents || 0) -
      Number(account?.refunded_cents || 0)
  );
  return {
    synced,
    balance_cents: Math.max(Number(account?.balance_cents || 0), balanceFromColumns),
  };
}

export async function syncQuotaInstallmentPayment(
  db: Db,
  input: {
    workspaceId: string;
    installmentId: string;
    actorId?: string | null;
  }
) {
  const { data: installment, error } = await db
    .from('financial_installments')
    .select(
      `
      id, entry_id, amount, due_date, status,
      financial_entries!inner(id, type, driver_id, description, status)
    `
    )
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.installmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!installment) return null;
  const entry = Array.isArray(installment.financial_entries)
    ? installment.financial_entries[0]
    : installment.financial_entries;
  if (!entry || String(entry.type) !== 'quota' || String(installment.status) !== 'paid') return null;

  const accountId = await ensureQuotaAccount(db, input.workspaceId, String(entry.driver_id));
  const amountCents = cents(installment.amount);
  const { error: insertErr } = await db.from('billing_quota_account_entries').insert({
    workspace_id: input.workspaceId,
    account_id: accountId,
    driver_id: entry.driver_id,
    entry_type: 'integralization',
    amount_cents: amountCents,
    source_installment_id: installment.id,
    source_entry_id: entry.id,
    description: entry.description || 'Integralização de cota',
    metadata: { due_date: installment.due_date },
    created_by: input.actorId || null,
  });
  if (insertErr && insertErr.code !== '23505') throw new Error(insertErr.message);
  await recalcQuotaAccount(db, input.workspaceId, accountId);
  return { account_id: accountId, amount_cents: amountCents };
}

export async function addQuotaLedgerEntry(
  db: Db,
  input: {
    workspaceId: string;
    driverId: string;
    entryType: 'adjustment' | 'reversal' | 'compensation' | 'refund';
    amountCents: number;
    description?: string | null;
    offboardingPreviewId?: string | null;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const accountId = await ensureQuotaAccount(db, input.workspaceId, input.driverId);
  const signed =
    input.entryType === 'compensation' || input.entryType === 'refund'
      ? -Math.abs(input.amountCents)
      : input.amountCents;
  const { error } = await db.from('billing_quota_account_entries').insert({
    workspace_id: input.workspaceId,
    account_id: accountId,
    driver_id: input.driverId,
    entry_type: input.entryType,
    amount_cents: signed,
    offboarding_preview_id: input.offboardingPreviewId || null,
    description: input.description || null,
    metadata: input.metadata || {},
    created_by: input.actorId || null,
  });
  if (error) throw new Error(error.message);
  await recalcQuotaAccount(db, input.workspaceId, accountId);
  return { account_id: accountId, amount_cents: signed };
}
