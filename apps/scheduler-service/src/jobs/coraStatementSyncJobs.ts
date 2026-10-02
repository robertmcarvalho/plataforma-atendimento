/**
 * Job Cloud Scheduler: proxy autenticado → api-service sync extrato Cora.
 * Engine + mTLS ficam no api-service (menor diff).
 */

export async function runCoraStatementSyncViaApi(): Promise<{
  ok: boolean;
  status?: number;
  body?: unknown;
  skipped?: string;
  error?: string;
}> {
  if (process.env.BILLING_CORA_STATEMENT_SYNC_ENABLED === 'false') {
    return { ok: true, skipped: 'BILLING_CORA_STATEMENT_SYNC_ENABLED=false' };
  }

  const apiBase =
    process.env.API_SERVICE_URL?.trim() ||
    process.env.FLUX_FARMA_API_URL?.trim() ||
    'https://flux-farma-api-713561463013.us-central1.run.app';
  const token = process.env.SCHEDULER_JOB_TOKEN?.trim();
  if (!token) {
    throw new Error('SCHEDULER_JOB_TOKEN ausente — não é possível chamar sync Cora na API');
  }

  const url = `${apiBase.replace(/\/$/, '')}/api/billing/cora/sync/statement/job`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Scheduler-Token': token,
    },
    body: '{}',
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      body,
      error: `API sync Cora HTTP ${res.status}`,
    };
  }
  return { ok: true, status: res.status, body };
}
