import api from '@/lib/api';
import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';

export const contactsPageApi = {
  list: (params?: Record<string, unknown>) => api.get('/api/contacts', { params }),
  create: (payload: unknown) => api.post('/api/contacts', payload),
  update: (id: string, payload: unknown) => api.put(`/api/contacts/${id}`, payload),
  toggleBlock: (id: string, blocked: boolean) => api.patch(`/api/contacts/${id}/block`, { blocked }),
  fetchDrivers: () => cadastroPageApi.fetchDrivers(),
  fetchPharmacies: () => cadastroPageApi.fetchPharmacies(),
  fetchLeaders: () => cadastroPageApi.fetchLeaders(),
};
