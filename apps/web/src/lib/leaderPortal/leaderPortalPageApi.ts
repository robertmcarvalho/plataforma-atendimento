import api from '@/lib/api';
import type {
  LeaderFinancialEntry,
  LeaderFinancialEntryDetail,
  LeaderFinancialListParams,
  LeaderFinancialListResult,
} from './leaderFinancialEntries';

export const leaderPortalPageApi = {
  fetchMe: () => api.get('/api/leader-portal/me').then((r) => r.data),
  fetchStats: () => api.get('/api/leader-portal/stats').then((r) => r.data),
  fetchDashboard: () => api.get('/api/leader-portal/dashboard').then((r) => r.data),
  fetchDocumentAlerts: () => api.get('/api/leader-portal/document-alerts').then((r) => r.data),
  fetchDrivers: () => api.get('/api/leader-portal/drivers').then((r) => r.data),
  fetchPharmacies: () => api.get('/api/leader-portal/pharmacies').then((r) => r.data),
  fetchPreRegistrations: () => api.get('/api/leader-portal/pre-registrations').then((r) => r.data),
  createPreRegistration: (payload: unknown) =>
    api.post('/api/leader-portal/pre-registrations', payload).then((r) => r.data),
  fetchTerminationRequests: () => api.get('/api/leader-portal/termination-requests').then((r) => r.data),
  createTerminationRequest: (payload: unknown) =>
    api.post('/api/leader-portal/termination-requests', payload).then((r) => r.data),
  fetchFinancialEntries: (params?: LeaderFinancialListParams) =>
    api
      .get('/api/leader-portal/financial-entries', { params })
      .then((r) => r.data as LeaderFinancialListResult),
  fetchFinancialEntryDetail: (id: string) =>
    api.get(`/api/leader-portal/financial-entries/${id}`).then((r) => r.data as LeaderFinancialEntryDetail),
  checkDuplicateOccurrences: (params: { driver_id: string; event_date: string; pharmacy_id: string }) =>
    api
      .get('/api/leader-portal/financial-entries/duplicate-check', { params })
      .then((r) => r.data as { duplicates: LeaderFinancialEntry[] }),
  cancelFinancialEntry: (id: string, cancel_reason: string) =>
    api.post(`/api/leader-portal/financial-entries/${id}/cancel`, { cancel_reason }).then((r) => r.data),
};
