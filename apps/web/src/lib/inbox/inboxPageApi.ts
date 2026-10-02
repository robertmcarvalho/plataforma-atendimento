import api from '@/lib/api';

export const inboxPageApi = {
  listConversations: () => api.get('/api/conversations').then((r) => r.data),
  fetchConversation: (id: string) => api.get(`/api/conversations/${id}`).then((r) => r.data),
  sendMessage: (payload: unknown) => api.post('/api/messages/send', payload),
};
