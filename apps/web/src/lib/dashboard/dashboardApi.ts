import api from '@/lib/api';

export const dashboardApi = {
  fetchOverview: (periodDays: number) =>
    api.get('/api/dashboard/overview', { params: { period: String(periodDays) } }).then((r) => r.data),
  exportOverview: (params: Record<string, unknown>) =>
    api.get('/api/dashboard/export', { params, responseType: 'blob' }),
};
