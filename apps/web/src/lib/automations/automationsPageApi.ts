import api from '@/lib/api';

export const automationsPageApi = {
  list: () => api.get('/api/automations').then((r) => r.data),
  listApprovedTemplates: () => api.get('/api/templates/list/approved').then((r) => r.data),
  listMcpTools: () => api.get('/api/mcp/tools').then((r) => r.data),
  listRuns: (ruleId: string) => api.get(`/api/automations/${ruleId}/runs`).then((r) => r.data),
  create: (body: unknown) => api.post('/api/automations', body),
  toggle: (ruleId: string) => api.patch(`/api/automations/${ruleId}/toggle`),
  run: (ruleId: string, context: unknown) => api.post(`/api/automations/${ruleId}/run`, { context }),
};
