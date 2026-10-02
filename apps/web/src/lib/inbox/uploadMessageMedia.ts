import { resolveApiBaseUrl } from '@/lib/api';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

export type UploadMessageMediaResult = Record<string, unknown>;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window === 'undefined') return headers;
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const rawUser = localStorage.getItem('user');
  if (rawUser) {
    try {
      const parsed = JSON.parse(rawUser) as { workspace_id?: string | null };
      if (parsed.workspace_id) headers['x-workspace-id'] = parsed.workspace_id;
    } catch {
      /* ignore */
    }
  }
  return headers;
}

/** Upload multipart via fetch nativo — axios pode quebrar boundary do FormData no browser. */
export async function uploadMessageMedia(
  conversationId: string,
  form: FormData,
  timeoutMs = 180_000
): Promise<UploadMessageMediaResult> {
  const baseUrl = resolveApiBaseUrl().replace(/\/$/, '');
  const url = `${baseUrl}/api/messages/upload?conversation_id=${encodeURIComponent(conversationId)}`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
      signal: controller.signal,
      credentials: 'omit',
    });

    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      throw Object.assign(new Error(payload?.error || `Upload falhou (${res.status})`), {
        response: { status: res.status, data: payload },
      });
    }
    return (payload || {}) as UploadMessageMediaResult;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Upload excedeu ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export function formatUploadClientError(err: unknown, fallback = 'Falha ao enviar arquivo.'): string {
  const msg = apiErrorMessage(err, fallback);
  if (/^network error$/i.test(msg) || err instanceof TypeError) {
    return 'Falha de conexão ao enviar o arquivo. Verifique sua internet e tente novamente.';
  }
  if (/timeout|excedeu|abort/i.test(msg)) {
    return 'O envio demorou demais. Tente novamente em alguns instantes.';
  }
  return msg;
}
