import api from '@/lib/api';

/**
 * Campos NFS-e (migration 116) não existem em produção.
 * Não enviar vazio/null no PUT da farmácia — o PostgREST falha com schema cache
 * e bloqueia o save de diárias no mesmo payload.
 */
export function pharmacyNfseFieldsForSave(
  ibgeRaw: string,
  municipalRaw: string,
): { ibge_city_code?: string; municipal_registration?: string } {
  const ibge = String(ibgeRaw || '').replace(/\D/g, '').slice(0, 7);
  const municipal = String(municipalRaw || '').trim();
  return {
    ...(ibge.length === 7 ? { ibge_city_code: ibge } : {}),
    ...(municipal ? { municipal_registration: municipal } : {}),
  };
}

export const cadastroPageApi = {
  fetchPharmaciesSummary: () => api.get('/api/pharmacies/summary').then((r) => r.data),
  fetchPharmacies: (params?: Record<string, unknown>) => api.get('/api/pharmacies', { params }).then((r) => r.data),
  fetchPharmacy: (id: string) => api.get(`/api/pharmacies/${id}`).then((r) => r.data),
  createPharmacy: (payload: unknown) => api.post('/api/pharmacies', payload).then((r) => r.data),
  updatePharmacy: (id: string, payload: unknown) => api.put(`/api/pharmacies/${id}`, payload).then((r) => r.data),
  deletePharmacy: (id: string) => api.delete(`/api/pharmacies/${id}`),

  fetchLeaders: (params?: Record<string, unknown>) => api.get('/api/leaders', { params }).then((r) => r.data),
  fetchLeadersSummary: (params?: Record<string, unknown>) =>
    api.get('/api/leaders/summary', { params }).then((r) => r.data),
  fetchLeader: (id: string) => api.get(`/api/leaders/${id}`).then((r) => r.data),
  createLeader: (payload: unknown) => api.post('/api/leaders', payload).then((r) => r.data),
  updateLeader: (id: string, payload: unknown) => api.put(`/api/leaders/${id}`, payload).then((r) => r.data),
  patchLeaderStatus: (id: string, status: string) => api.put(`/api/leaders/${id}`, { status }),

  fetchDrivers: (params?: Record<string, unknown>) => api.get('/api/drivers', { params }).then((r) => r.data),
  fetchDriver: (id: string) => api.get(`/api/drivers/${id}`).then((r) => r.data),
  createDriver: (payload: unknown) => api.post('/api/drivers', payload).then((r) => r.data),
  updateDriver: (id: string, payload: unknown) => api.put(`/api/drivers/${id}`, payload).then((r) => r.data),
  patchDriverStatus: (id: string, status: string) => api.put(`/api/drivers/${id}`, { status }),
  linkDriverPharmacy: (driverId: string, payload: unknown) =>
    api.post(`/api/drivers/${driverId}/pharmacies`, payload),
  unlinkDriverPharmacy: (driverId: string, pharmacyId: string) =>
    api.delete(`/api/drivers/${driverId}/pharmacies/${pharmacyId}`),

  fetchSectors: () => api.get('/api/sectors').then((r) => r.data),
  fetchAttendants: (params?: Record<string, unknown>) =>
    api.get('/api/users/attendants', { params }).then((r) => r.data),
  fetchGeoStates: () => api.get('/api/geo/states').then((r) => r.data),
  fetchGeoCities: (state: string) =>
    api.get(`/api/geo/states/${encodeURIComponent(state)}/cities`).then((r) => r.data),
};
