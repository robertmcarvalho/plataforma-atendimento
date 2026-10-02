import axios from 'axios';

export type ApiErrorPayload = {
  error?: string;
  message?: string;
  operator_message?: string;
  code?: string;
  existing_driver_id?: string | null;
  existing_driver_name?: string | null;
  gaps?: Array<{ code?: string; label?: string; field?: string }>;
  details?: {
    formErrors?: string[];
    fieldErrors?: Record<string, string[]>;
  };
};

/** Mensagem amigável a partir de erro Axios (prioriza `error` retornado pela API). */
export function apiErrorMessage(err: unknown, fallback = 'Não foi possível concluir a operação.'): string {
  const payload = apiErrorPayload(err);
  if (payload?.error) {
    const fieldErrors = payload.details?.fieldErrors;
    if (payload.error === 'Dados inválidos' && fieldErrors) {
      const first = Object.entries(fieldErrors).find(([, msgs]) => msgs?.length);
      if (first) return `${payload.error}: ${first[0]} — ${first[1]![0]}`;
    }
    return payload.error;
  }
  if (err instanceof Error && err.message && !/^Request failed with status code \d+$/i.test(err.message)) {
    return err.message;
  }
  return fallback;
}

export function apiErrorPayload(err: unknown): ApiErrorPayload | null {
  if (!axios.isAxiosError(err)) return null;
  const data = err.response?.data;
  if (!data || typeof data !== 'object') return null;
  return data as ApiErrorPayload;
}

/** Handler padrão para `onError` de React Query (mutation/query). */
export function onApiError(
  report: (message: string) => void,
  fallback = 'Não foi possível concluir a operação.',
): (error: unknown) => void {
  return (error) => report(apiErrorMessage(error, fallback));
}
