import api from '@/lib/api';

export const settingsPageApi = {
  fetchWorkspace: () => api.get('/api/workspace').then((r) => r.data),
  patchWorkspace: (payload: unknown) => api.patch('/api/workspace', payload),
  fetchSettings: () => api.get<Record<string, unknown>>('/api/settings').then((r) => r.data),
  putSetting: (key: string, value: unknown) => api.put('/api/settings', { key, value }),
  fetchSectors: () => api.get('/api/sectors').then((r) => r.data),
  fetchTemplates: () => api.get('/api/templates').then((r) => r.data),
  fetchUsersLite: () => api.get('/api/users').then((r) => r.data),
  fetchUsers: () => api.get('/api/users').then((r) => r.data),
  fetchRoles: () => api.get('/api/roles').then((r) => r.data),
  fetchLeaders: () => api.get('/api/leaders').then((r) => r.data),
  fetchUserStatus: (userId: string) => api.get(`/api/users/${userId}/status`).then((r) => r.data),
  createUser: (payload: unknown) => api.post('/api/users', payload),
  updateUser: (id: string, payload: unknown) => api.put(`/api/users/${id}`, payload),
  toggleUser: (userId: string) => api.patch(`/api/users/${userId}/toggle`),
  fetchMcpTools: () => api.get('/api/mcp/tools').then((r) => r.data),
  fetchIntegrationsPriority: () => api.get('/api/integrations/connectors/priority').then((r) => r.data),
};
