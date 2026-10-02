import api from '@/lib/api';

export const campaignsPageApi = {
  list: () => api.get('/api/campaigns').then((r) => r.data),
  listApprovedTemplates: () => api.get('/api/templates/list/approved').then((r) => r.data),
  create: (body: unknown) => api.post('/api/campaigns', body),
  pause: (id: string) => api.patch(`/api/campaigns/${id}/pause`),
  resume: (id: string) => api.patch(`/api/campaigns/${id}/resume`),
  dispatch: (id: string) => api.post(`/api/campaigns/${id}/dispatch`),
};
