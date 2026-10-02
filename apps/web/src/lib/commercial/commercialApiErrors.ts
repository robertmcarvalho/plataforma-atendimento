import axios from 'axios';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { resolveApiBaseUrl } from '@/lib/api';

export function commercialSelectScenarioErrorMessage(err: unknown): string {
  const apiBase = resolveApiBaseUrl();
  const isLocalApi = /localhost|127\.0\.0\.1/.test(apiBase);

  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const path = String(err.config?.url ?? '');
    const requestUrl = String(err.config?.baseURL ?? apiBase) + path;

    if (status === 404) {
      if (isLocalApi) {
        return (
          'Rota POST /dimensioning/select não encontrada (404). ' +
          'Reinicie o api-service local (`npm run dev:api` ou `npm run dev:local`) e confirme ' +
          `GET ${apiBase}/api/commercial/dev/routes → dimensioning_select: true. URL: ${requestUrl}`
        );
      }
      return (
        'Rota POST /dimensioning/select não encontrada na API (404). ' +
        'Deploy pendente ou URL de API incorreta. ' +
        `API: ${requestUrl}`
      );
    }

    if (status === 403) {
      return 'Sem permissão para selecionar cenário neste workspace.';
    }

    if (status === 400) {
      return apiErrorMessage(err, 'Cenário inválido ou snapshot sem cenários A/B. Recalcule a viabilidade.');
    }

    if (status === 401) {
      return 'Sessão expirada — faça login novamente.';
    }
  }

  return apiErrorMessage(err, 'Falha ao selecionar cenário.');
}
