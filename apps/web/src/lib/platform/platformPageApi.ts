import api from '@/lib/api';

export const platformPageApi = {
  listWorkspaces: () => api.get('/api/platform/workspaces').then((r) => r.data),
  createWorkspace: (payload: unknown) => api.post('/api/platform/workspaces', payload),
  fetchSystemEmail: () => api.get('/api/platform/settings/system-email').then((r) => r.data),
  fetchEmailDeliveryLog: (limit = 40) =>
    api.get(`/api/platform/email-delivery-log?limit=${limit}`).then((r) => r.data.items),
  putSystemEmail: (payload: unknown) => api.put('/api/platform/settings/system-email', payload),
};
