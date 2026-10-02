import { apiErrorMessage, apiErrorPayload } from '@/lib/apiErrorMessage';
import {
  reconcileFluxMysql,
  syncFluxDeliveries,
  type BillingCycle,
} from '@/lib/billing/billingApi';
import {
  addBillingDeliveryNotificationSafe,
  compactJsonDetail,
} from '@/lib/billing/billingDeliveryNotifications';

export type BillingSyncRange = { data_inicio: string; data_fim: string };

/** Últimos 7 dias (UTC) quando não há ciclo selecionado. */
export function defaultBillingSyncRange(): BillingSyncRange {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 7);
  return {
    data_inicio: start.toISOString().slice(0, 10),
    data_fim: end.toISOString().slice(0, 10),
  };
}

export function resolveBillingSyncRange(cycle?: Pick<BillingCycle, 'apuracao_start' | 'apuracao_end'> | null): BillingSyncRange {
  if (cycle?.apuracao_start && cycle?.apuracao_end) {
    return { data_inicio: cycle.apuracao_start, data_fim: cycle.apuracao_end };
  }
  return defaultBillingSyncRange();
}

export function formatBillingSyncRangeLabel(range: BillingSyncRange): string {
  return `${range.data_inicio} → ${range.data_fim}`;
}

function importedFromFluxResult(result: Record<string, unknown> | undefined): number | null {
  if (!result) return null;
  const candidates = [result.imported, result.inserted, result.created, result.upserted];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function summarizeFluxResult(result: Record<string, unknown> | undefined) {
  if (!result) return undefined;
  const imported = importedFromFluxResult(result);
  const keys = Object.keys(result).slice(0, 24);
  return {
    imported,
    keys,
    // Keep only scalar / small fields for Storage — never the full delivery lists.
    ...Object.fromEntries(
      keys
        .filter((k) => {
          const v = result[k];
          return v == null || ['string', 'number', 'boolean'].includes(typeof v);
        })
        .map((k) => [k, result[k]])
    ),
  };
}

function summarizeMysqlReconcile(data: {
  imported?: number;
  operator_message?: string;
  report?: Record<string, unknown>;
}) {
  const report = data.report && typeof data.report === 'object' ? data.report : undefined;
  const reportSummary = report
    ? Object.fromEntries(
        Object.entries(report)
          .filter(([, v]) => v == null || ['string', 'number', 'boolean'].includes(typeof v))
          .slice(0, 20)
      )
    : undefined;
  return {
    imported: data.imported ?? 0,
    operator_message: data.operator_message,
    report_keys: report ? Object.keys(report).slice(0, 24) : undefined,
    report_summary: reportSummary,
  };
}

function notifyPersistMiss(title: string, source: 'flux_api' | 'flux_mysql') {
  // Soft warning only — API already succeeded/failed independently.
  addBillingDeliveryNotificationSafe({
    kind: 'warning',
    source,
    title,
    message:
      'A rotina terminou, mas o histórico local de notificações não coube no Storage do navegador. O resultado da API não foi afetado.',
  });
}

export function notifyFluxSyncStarted(range: BillingSyncRange, context?: string) {
  addBillingDeliveryNotificationSafe({
    kind: 'info',
    source: 'flux_api',
    title: context || 'Sincronização Flux iniciada',
    message: `Importando entregas da API Flux no período ${formatBillingSyncRangeLabel(range)}. Isso pode levar alguns minutos.`,
  });
}

export function notifyFluxSyncSuccess(
  data: { result?: Record<string, unknown>; operator_message?: string },
  range: BillingSyncRange
) {
  const imported = importedFromFluxResult(data.result);
  const { persisted } = addBillingDeliveryNotificationSafe({
    kind: 'success',
    source: 'flux_api',
    title: 'Sincronização Flux concluída',
    message:
      data.operator_message ||
      (imported != null
        ? `API Flux: ${imported} entrega(s) processada(s) em ${formatBillingSyncRangeLabel(range)}.`
        : `API Flux concluída para ${formatBillingSyncRangeLabel(range)}. Confira pendências no retorno técnico.`),
    detail: compactJsonDetail(summarizeFluxResult(data.result)),
  });
  if (!persisted) notifyPersistMiss('Aviso: histórico local cheio', 'flux_api');
}

export function notifyFluxSyncError(error: unknown, range: BillingSyncRange) {
  const payload = apiErrorPayload(error) as { operator_message?: string } | null;
  addBillingDeliveryNotificationSafe({
    kind: 'error',
    source: 'flux_api',
    title: 'Falha na sincronização Flux',
    message:
      payload?.operator_message ||
      apiErrorMessage(error, `Não foi possível sincronizar a API Flux (${formatBillingSyncRangeLabel(range)}).`),
    detail: compactJsonDetail(payload ? { operator_message: payload.operator_message } : { message: String(error) }),
  });
}

export function notifyMysqlReconcileSuccess(
  data: { imported?: number; operator_message?: string; report?: Record<string, unknown> },
  range: BillingSyncRange
) {
  const imported = data.imported ?? 0;
  const { persisted } = addBillingDeliveryNotificationSafe({
    kind: imported > 0 ? 'success' : 'info',
    source: 'flux_mysql',
    title: 'Reconciliação MySQL concluída',
    message:
      data.operator_message ||
      `MySQL Flux: ${imported} entrega(s) faltante(s) importada(s) em ${formatBillingSyncRangeLabel(range)}.`,
    detail: compactJsonDetail(summarizeMysqlReconcile(data)),
  });
  if (!persisted) notifyPersistMiss('Aviso: histórico local cheio', 'flux_mysql');
}

export function notifyMysqlReconcileError(error: unknown, range: BillingSyncRange) {
  const payload = apiErrorPayload(error) as { operator_message?: string } | null;
  // Never treat browser Storage quota as a MySQL reconcile failure.
  const rawMessage =
    payload?.operator_message ||
    apiErrorMessage(error, `Não foi possível reconciliar o MySQL Flux (${formatBillingSyncRangeLabel(range)}).`);
  const isStorageQuota =
    typeof rawMessage === 'string' && /setItem|QuotaExceeded|exceeded the quota|Storage/i.test(rawMessage);

  addBillingDeliveryNotificationSafe({
    kind: isStorageQuota ? 'warning' : 'error',
    source: 'flux_mysql',
    title: isStorageQuota ? 'Aviso no histórico local' : 'Falha na reconciliação MySQL',
    message: isStorageQuota
      ? 'A reconciliação pode ter concluído, mas o navegador não conseguiu gravar o histórico local (Storage cheio). Atualize a lista de entregas para confirmar.'
      : rawMessage,
    detail: isStorageQuota
      ? undefined
      : compactJsonDetail(payload ? { operator_message: payload.operator_message } : { message: String(error) }),
  });
}

/** Dispara sync Flux sem bloquear a UI; notifica início e resultado. */
export async function fireFluxDeliverySync(range: BillingSyncRange, options?: { contextTitle?: string }) {
  try {
    notifyFluxSyncStarted(range, options?.contextTitle);
  } catch (persistError) {
    console.warn('[billingFluxIngest] notify sync started failed', persistError);
  }
  try {
    const data = await syncFluxDeliveries({
      data_inicio: range.data_inicio,
      data_fim: range.data_fim,
      dry_run: false,
    });
    try {
      notifyFluxSyncSuccess(data, range);
    } catch (persistError) {
      console.warn('[billingFluxIngest] notify after Flux success failed', persistError);
    }
    return data;
  } catch (error) {
    try {
      notifyFluxSyncError(error, range);
    } catch (persistError) {
      console.warn('[billingFluxIngest] notify after Flux error failed', persistError);
    }
    throw error;
  }
}

export async function fireMysqlReconcile(range: BillingSyncRange) {
  try {
    const data = await reconcileFluxMysql({
      data_inicio: range.data_inicio,
      data_fim: range.data_fim,
      import_missing: true,
    });
    // Persistence must never turn a successful API call into a thrown failure.
    try {
      notifyMysqlReconcileSuccess(data, range);
    } catch (persistError) {
      console.warn('[billingFluxIngest] notify after MySQL success failed', persistError);
    }
    return data;
  } catch (error) {
    try {
      notifyMysqlReconcileError(error, range);
    } catch (persistError) {
      console.warn('[billingFluxIngest] notify after MySQL error failed', persistError);
    }
    throw error;
  }
}
