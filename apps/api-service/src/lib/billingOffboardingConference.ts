import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getFluxDeliveryClient,
  isFluxDeliverySkipped,
  loadFluxDeliveryConfig,
  runFluxDeliverySyncForWorkspace,
} from '@plataforma/flux-delivery';
import { loadFluxMysqlConfig, publicMysqlReconcileReport, reconcileBillingWithFluxMysql } from './billingFluxMysqlReconcile';
import { addQuotaLedgerEntry, ensureQuotaAccount } from './billingQuotaLedger';
import type { BillingDriverOffboardingPreviewPayload } from './billingDriverOffboardingPreview';
import { syncOffboardingPreviewPayloadTotals } from './billingDriverOffboardingPreview';

export type OffboardingConferenceState = {
  checked_at: string | null;
  checked_by: string | null;
  notes: string | null;
  quota_decisions: Record<string, 'waived' | 'kept' | 'compensated'>;
};

export type OffboardingConferenceChecklist = {
  pix_ok: boolean;
  cpf_ok: boolean;
  signature_signed: boolean;
  conference_ok: boolean;
  pending_entries_count: number;
  pending_quota_count: number;
  undecided_quota_count: number;
  open_cycles_count: number;
  can_generate_payable: boolean;
  blockers: string[];
};

export type OffboardingPendingQuotaLine = {
  installment_id: string;
  entry_id: string;
  label: string;
  amount_cents: number;
  due_date: string | null;
  installment_number: number | null;
  decision: 'waived' | 'kept' | 'compensated' | null;
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function readConferenceState(payload: BillingDriverOffboardingPreviewPayload): OffboardingConferenceState {
  const raw = (payload as BillingDriverOffboardingPreviewPayload & { conference_state?: OffboardingConferenceState })
    .conference_state;
  return {
    checked_at: raw?.checked_at || null,
    checked_by: raw?.checked_by || null,
    notes: raw?.notes || null,
    quota_decisions: raw?.quota_decisions || {},
  };
}

function isSignatureSigned(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase().trim();
  return s === 'signed' || s === 'document_finished';
}

function buildLivePendingQuotas(
  relevantEntries: Array<Record<string, unknown>>,
  conferenceState: OffboardingConferenceState
): OffboardingPendingQuotaLine[] {
  const lines: OffboardingPendingQuotaLine[] = [];
  for (const entry of relevantEntries) {
    if (String(entry.type) !== 'quota') continue;
    const installments = (entry.financial_installments as Array<Record<string, unknown>>) || [];
    for (const inst of installments) {
      if (String(inst.status) !== 'pending') continue;
      const installmentId = String(inst.id);
      lines.push({
        installment_id: installmentId,
        entry_id: String(entry.id),
        label: String(entry.description || 'Parcela de cota'),
        amount_cents: Math.round(Number(inst.amount || 0) * 100),
        due_date: inst.due_date ? String(inst.due_date).slice(0, 10) : null,
        installment_number: inst.installment_number != null ? Number(inst.installment_number) : null,
        decision: conferenceState.quota_decisions[installmentId] || null,
      });
    }
  }
  return lines.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
}

export async function loadOffboardingConference(
  db: SupabaseClient,
  workspaceId: string,
  previewId: string
) {
  const { data: preview, error: previewErr } = await db
    .from('billing_driver_offboarding_previews')
    .select('*, drivers(id, name, cpf, pix_key, pix_key_type, status)')
    .eq('workspace_id', workspaceId)
    .eq('id', previewId)
    .maybeSingle();
  if (previewErr) throw new Error(previewErr.message);
  if (!preview) throw new Error('Prévia de desligamento não encontrada');

  const payload = preview.payload as BillingDriverOffboardingPreviewPayload;
  const lastWorkedAt = String(preview.last_worked_at).slice(0, 10);
  const driverId = String(preview.driver_id);
  const conferenceState = readConferenceState(payload);

  const cycleStartWindow = addDays(lastWorkedAt, -21);
  const { data: cycles } = await db
    .from('billing_cycles')
    .select('id, label, apuracao_start, apuracao_end, status')
    .eq('workspace_id', workspaceId)
    .eq('status', 'open')
    .gte('apuracao_end', cycleStartWindow)
    .lte('apuracao_start', lastWorkedAt)
    .order('apuracao_start', { ascending: true });

  const cycleIds = (cycles || []).map((c) => String(c.id));

  const { data: financialEntries } = await db
    .from('financial_entries')
    .select(
      `id, type, description, total_amount, status, start_date, event_date, absence_disposition,
       proposed_discount_amount, daily_billing_treatment, notes, created_at,
       drivers(id, name), pharmacies(id, trade_name, legal_name),
       financial_installments(id, installment_number, amount, due_date, status, paid_at)`
    )
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .neq('status', 'cancelled')
    .order('event_date', { ascending: false });

  const relevantEntries = (financialEntries || []).filter((entry) => {
    const eventDate = String(entry.event_date || entry.start_date || '').slice(0, 10);
    return !eventDate || eventDate <= lastWorkedAt;
  });

  const pendingEntries = relevantEntries.filter((e) =>
    ['pending_approval', 'draft', 'submitted'].includes(String(e.status || ''))
  );

  const { data: quotaAccount } = await db
    .from('billing_quota_accounts')
    .select('*, drivers(id, name, cpf)')
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .maybeSingle();

  const { data: quotaLedger } = await db
    .from('billing_quota_account_entries')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(50);

  let deliveries: Array<Record<string, unknown>> = [];
  if (cycleIds.length) {
    const { data: deliveryRows } = await db
      .from('billing_delivery_records')
      .select(
        `id, delivered_at, document_number, route_id, source, verified, cancelled, billing_cycle_id,
         pharmacies(id, trade_name, legal_name), billing_cycles(id, label, apuracao_start, apuracao_end)`
      )
      .eq('workspace_id', workspaceId)
      .eq('driver_id', driverId)
      .eq('cancelled', false)
      .in('billing_cycle_id', cycleIds)
      .order('delivered_at', { ascending: false })
      .limit(200);
    deliveries = (deliveryRows || []) as Array<Record<string, unknown>>;
  }

  const settlements: Array<Record<string, unknown>> = [];
  if (cycleIds.length) {
    const { data: settlementRows } = await db
      .from('billing_settlements')
      .select(
        `id, billing_cycle_id, pharmacy_id, status, net_driver_payout_cents, applied_mg,
         pharmacies(id, trade_name, legal_name),
         billing_cycles(id, label, apuracao_start, apuracao_end)`
      )
      .eq('workspace_id', workspaceId)
      .eq('driver_id', driverId)
      .in('billing_cycle_id', cycleIds);

    const settlementIds = (settlementRows || []).map((r) => String(r.id));
    const linesBySettlement = new Map<string, Array<Record<string, unknown>>>();
    if (settlementIds.length) {
      const { data: lineRows } = await db
        .from('billing_settlement_lines')
        .select('id, settlement_id, kind, description, pharmacy_amount_cents, driver_amount_cents, metadata')
        .in('settlement_id', settlementIds);
      for (const line of lineRows || []) {
        const key = String(line.settlement_id);
        const bucket = linesBySettlement.get(key) || [];
        bucket.push(line as Record<string, unknown>);
        linesBySettlement.set(key, bucket);
      }
    }

    for (const row of settlementRows || []) {
      settlements.push({
        ...row,
        lines: linesBySettlement.get(String(row.id)) || [],
      });
    }
  }

  let financialTask: Record<string, unknown> | null = null;
  let signatureTask: Record<string, unknown> | null = null;
  if (preview.task_id) {
    const { data: task } = await db
      .from('pending_tasks')
      .select('id, task_type, title, status, due_at, metadata, created_at, completed_at')
      .eq('workspace_id', workspaceId)
      .eq('id', preview.task_id)
      .maybeSingle();
    financialTask = (task as Record<string, unknown>) || null;
  }
  const finMeta =
    financialTask?.metadata && typeof financialTask.metadata === 'object' && !Array.isArray(financialTask.metadata)
      ? (financialTask.metadata as Record<string, unknown>)
      : {};
  const requestId = String(finMeta.request_id || '').trim();
  const operationalTaskId = String(finMeta.operational_task_id || '').trim();
  if (operationalTaskId) {
    const { data: opTask } = await db
      .from('pending_tasks')
      .select('id, task_type, title, status, metadata, completed_at')
      .eq('workspace_id', workspaceId)
      .eq('id', operationalTaskId)
      .maybeSingle();
    signatureTask = (opTask as Record<string, unknown>) || null;
  } else if (requestId) {
    const { data: opTask } = await db
      .from('pending_tasks')
      .select('id, task_type, title, status, metadata, completed_at')
      .eq('workspace_id', workspaceId)
      .filter('metadata->>request_id', 'eq', requestId)
      .in('task_type', ['driver_termination_prep', 'driver_termination_request'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    signatureTask = (opTask as Record<string, unknown>) || null;
  }

  const sigMeta =
    signatureTask?.metadata && typeof signatureTask.metadata === 'object' && !Array.isArray(signatureTask.metadata)
      ? (signatureTask.metadata as Record<string, unknown>)
      : {};
  const signatureStatus = String(sigMeta.signature_status || finMeta.termination_signature_status || '');

  const pendingQuotas = buildLivePendingQuotas(
    relevantEntries as Array<Record<string, unknown>>,
    conferenceState
  );
  const undecidedQuota = pendingQuotas.filter((line) => !line.decision);
  const unresolvedQuota = pendingQuotas.filter((line) => !line.decision || line.decision === 'kept');

  const driver = payload.driver || {
    id: driverId,
    name: String((preview.drivers as { name?: string } | null)?.name || ''),
    cpf: null,
    pix_key: null,
  };

  const blockers: string[] = [];
  if (!driver.pix_key) blockers.push('Chave PIX ausente no cadastro do entregador.');
  if (!driver.cpf) blockers.push('CPF ausente no cadastro do entregador.');
  if (pendingEntries.length) blockers.push(`${pendingEntries.length} lançamento(s) financeiro(s) pendente(s) de aprovação.`);
  if (unresolvedQuota.length) {
    blockers.push(
      undecidedQuota.length
        ? `${undecidedQuota.length} cota(s) pendente(s) sem decisão registrada.`
        : `${unresolvedQuota.length} cota(s) ainda em aberto após decisão "manter pendente".`
    );
  }
  if (!conferenceState.checked_at) blockers.push('Conferência ainda não marcada como concluída.');
  if (preview.status !== 'preview') blockers.push('Prévia já convertida em AP ou cancelada.');

  const checklist: OffboardingConferenceChecklist = {
    pix_ok: Boolean(driver.pix_key),
    cpf_ok: Boolean(driver.cpf),
    signature_signed: isSignatureSigned(signatureStatus),
    conference_ok: Boolean(conferenceState.checked_at),
    pending_entries_count: pendingEntries.length,
    pending_quota_count: unresolvedQuota.length,
    undecided_quota_count: undecidedQuota.length,
    open_cycles_count: cycleIds.length,
    can_generate_payable:
      preview.status === 'preview' &&
      Number(preview.net_cents || 0) > 0 &&
      Boolean(driver.pix_key) &&
      Boolean(driver.cpf) &&
      pendingEntries.length === 0 &&
      unresolvedQuota.length === 0 &&
      Boolean(conferenceState.checked_at),
    blockers,
  };

  return {
    preview: {
      id: String(preview.id),
      driver_id: driverId,
      task_id: preview.task_id ? String(preview.task_id) : null,
      status: preview.status,
      last_worked_at: lastWorkedAt,
      gross_cents: Number(preview.gross_cents || 0),
      discount_cents: Number(preview.discount_cents || 0),
      net_cents: Number(preview.net_cents || 0),
      payable_id: preview.payable_id ? String(preview.payable_id) : null,
      payload,
    },
    conference_state: conferenceState,
    checklist,
    operational: {
      financial_task: financialTask,
      signature_task: signatureTask,
      signature_status: signatureStatus || null,
      signature_label: String(finMeta.termination_signature_label || sigMeta.signature_status_label || ''),
      signed_at: String(finMeta.termination_signed_at || sigMeta.signature_signed_at || '') || null,
      settlement_due_at: String(finMeta.settlement_due_at || financialTask?.due_at || '') || null,
    },
    open_cycles: (cycles || []).map((c) => ({
      id: String(c.id),
      label: c.label ? String(c.label) : null,
      apuracao_start: String(c.apuracao_start).slice(0, 10),
      apuracao_end: String(c.apuracao_end).slice(0, 10),
      delivery_count: deliveries.filter((d) => String(d.billing_cycle_id) === String(c.id)).length,
    })),
    financial_entries: relevantEntries,
    pending_quotas: pendingQuotas,
    deliveries,
    quota_account: quotaAccount,
    quota_ledger: quotaLedger || [],
    settlements,
    integrations: {
      flux_api_configured: Boolean(loadFluxDeliveryConfig()) && !isFluxDeliverySkipped(),
      mysql_configured: Boolean(loadFluxMysqlConfig()),
    },
    warnings: payload.warnings || [],
  };
}

export async function updateOffboardingConferenceState(
  db: SupabaseClient,
  workspaceId: string,
  previewId: string,
  input: { checked?: boolean; notes?: string | null; actorId: string }
) {
  const { data: preview, error } = await db
    .from('billing_driver_offboarding_previews')
    .select('id, payload, status')
    .eq('workspace_id', workspaceId)
    .eq('id', previewId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!preview) throw new Error('Prévia de desligamento não encontrada');
  if (preview.status !== 'preview') throw new Error('Prévia não está em status de conferência');

  const payload = preview.payload as BillingDriverOffboardingPreviewPayload & {
    conference_state?: OffboardingConferenceState;
  };
  const prev = readConferenceState(payload);
  const nextState: OffboardingConferenceState = {
    ...prev,
    notes: input.notes !== undefined ? input.notes : prev.notes,
    checked_at: input.checked ? new Date().toISOString() : input.checked === false ? null : prev.checked_at,
    checked_by: input.checked ? input.actorId : input.checked === false ? null : prev.checked_by,
  };

  const nextPayload = { ...payload, conference_state: nextState };
  const { error: updErr } = await db
    .from('billing_driver_offboarding_previews')
    .update({ payload: nextPayload, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', previewId);
  if (updErr) throw new Error(updErr.message);
  return nextState;
}

export async function syncOffboardingDeliveries(
  db: SupabaseClient,
  workspaceId: string,
  previewId: string,
  input: { import_mysql?: boolean }
) {
  const conference = await loadOffboardingConference(db, workspaceId, previewId);
  const cycles = conference.open_cycles;
  if (!cycles.length) return { flux: null, mysql: null, operator_message: 'Nenhum ciclo aberto no período.' };

  const dataInicio = cycles.reduce((min, c) => (c.apuracao_start < min ? c.apuracao_start : min), cycles[0].apuracao_start);
  const dataFim = cycles.reduce((max, c) => (c.apuracao_end > max ? c.apuracao_end : max), cycles[0].apuracao_end);

  let fluxResult: Record<string, unknown> | null = null;
  const fluxClient = getFluxDeliveryClient();
  if (fluxClient) {
    fluxResult = (await runFluxDeliverySyncForWorkspace(db, {
      workspaceId,
      fluxClient,
      dataInicio,
      dataFim,
      dryRun: false,
    })) as Record<string, unknown>;
  }

  let mysqlResult: Record<string, unknown> | null = null;
  if (input.import_mysql && loadFluxMysqlConfig()) {
    const report = await reconcileBillingWithFluxMysql(db, workspaceId, dataInicio, dataFim);
    mysqlResult = publicMysqlReconcileReport(report) as unknown as Record<string, unknown>;
  }

  return {
    flux: fluxResult,
    mysql: mysqlResult,
    period: { data_inicio: dataInicio, data_fim: dataFim },
    operator_message: `Sincronização do período ${dataInicio} a ${dataFim} concluída.`,
  };
}

export async function decideOffboardingPendingQuota(
  db: SupabaseClient,
  workspaceId: string,
  previewId: string,
  input: {
    installment_id: string;
    decision: 'waived' | 'kept' | 'compensated';
    actorId: string;
    notes?: string | null;
  }
) {
  const { data: preview, error } = await db
    .from('billing_driver_offboarding_previews')
    .select('id, driver_id, payload, status')
    .eq('workspace_id', workspaceId)
    .eq('id', previewId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!preview) throw new Error('Prévia de desligamento não encontrada');
  if (preview.status !== 'preview') throw new Error('Prévia não está em conferência');

  const { data: installment, error: instErr } = await db
    .from('financial_installments')
    .select('id, entry_id, amount, status, due_date')
    .eq('workspace_id', workspaceId)
    .eq('id', input.installment_id)
    .maybeSingle();
  if (instErr) throw new Error(instErr.message);
  if (!installment) throw new Error('Parcela de cota não encontrada');

  const { data: entry, error: entryErr } = await db
    .from('financial_entries')
    .select('id, driver_id, type, status')
    .eq('workspace_id', workspaceId)
    .eq('id', installment.entry_id)
    .maybeSingle();
  if (entryErr) throw new Error(entryErr.message);
  if (!entry || String(entry.type) !== 'quota' || String(entry.driver_id) !== String(preview.driver_id)) {
    throw new Error('Parcela não pertence a cota deste entregador');
  }

  if (input.decision === 'waived') {
    await db
      .from('financial_installments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', input.installment_id);
    const { data: siblings } = await db
      .from('financial_installments')
      .select('id, status')
      .eq('workspace_id', workspaceId)
      .eq('entry_id', installment.entry_id);
    const active = (siblings || []).filter((s) => !['cancelled', 'paid'].includes(String(s.status)));
    if (!active.length) {
      await db
        .from('financial_entries')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('id', installment.entry_id);
    }
  } else if (input.decision === 'compensated') {
    const amountCents = Math.round(Number(installment.amount || 0) * 100);
    await ensureQuotaAccount(db, workspaceId, String(preview.driver_id));
    await addQuotaLedgerEntry(db, {
      workspaceId,
      driverId: String(preview.driver_id),
      entryType: 'compensation',
      amountCents,
      description: input.notes || 'Compensação de cota pendente no desligamento',
      offboardingPreviewId: previewId,
      actorId: input.actorId,
      metadata: { installment_id: input.installment_id, entry_id: installment.entry_id },
    });
    await db
      .from('financial_installments')
      .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', input.installment_id);
  }

  const payload = preview.payload as BillingDriverOffboardingPreviewPayload & {
    conference_state?: OffboardingConferenceState;
  };
  payload.pending_quota_lines = (payload.pending_quota_lines || []).filter(
    (line) => String(line.source_id || '') !== input.installment_id
  );

  if (input.decision === 'compensated') {
    const { data: quotaAccount } = await db
      .from('billing_quota_accounts')
      .select('balance_cents')
      .eq('workspace_id', workspaceId)
      .eq('driver_id', preview.driver_id)
      .maybeSingle();
    const refundLine = payload.gross_lines.find((line) => line.kind === 'quota_refund');
    if (refundLine) {
      refundLine.amount_cents = Math.max(0, Number(quotaAccount?.balance_cents || 0));
    }
  }

  const prev = readConferenceState(payload);
  const nextState: OffboardingConferenceState = {
    ...prev,
    quota_decisions: {
      ...prev.quota_decisions,
      [input.installment_id]: input.decision,
    },
  };
  const totals = syncOffboardingPreviewPayloadTotals({ ...payload, conference_state: nextState });
  const { error: updErr } = await db
    .from('billing_driver_offboarding_previews')
    .update({
      payload: { ...payload, conference_state: nextState },
      gross_cents: totals.gross_cents,
      discount_cents: totals.discount_cents,
      net_cents: totals.net_cents,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', previewId);
  if (updErr) throw new Error(updErr.message);

  return nextState;
}

export async function completeOffboardingFinancialTask(
  db: SupabaseClient,
  workspaceId: string,
  taskId: string | null | undefined
): Promise<void> {
  if (!taskId) return;
  const now = new Date().toISOString();
  await db
    .from('pending_tasks')
    .update({ status: 'done', completed_at: now, updated_at: now })
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
    .in('status', ['open', 'in_progress']);
}
