import api from '@/lib/api';

export const operationalAuditApi = {
  listMcpExecutions: (params?: Record<string, unknown>) => api.get('/api/mcp/executions', { params }),
};
