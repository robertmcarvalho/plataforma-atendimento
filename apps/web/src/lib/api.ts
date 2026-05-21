import axios from 'axios';

const PRODUCTION_API_BASE = 'https://flux-farma-api-713561463013.us-central1.run.app';

function resolveApiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    if (host === 'www.aetheraai.online' || host === 'aetheraai.online' || host.endsWith('.aetheraai.online')) {
      return PRODUCTION_API_BASE;
    }
  }
  return 'http://localhost:3001';
}

const api = axios.create({
  baseURL: resolveApiBaseUrl(),
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const url = String(config.url || '');
    if (url.includes('/api/auth/login')) {
      delete config.headers.Authorization;
      delete config.headers['x-workspace-id'];
      return config;
    }
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    const rawUser = localStorage.getItem('user');
    if (rawUser) {
      try {
        const parsed = JSON.parse(rawUser) as { workspace_id?: string | null };
        if (parsed.workspace_id) config.headers['x-workspace-id'] = parsed.workspace_id;
      } catch {
        /* ignore */
      }
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      const url = String(err.config?.url || '');
      const skipLogout =
        url.includes('/api/users/me/password') ||
        url.includes('/api/auth/login');
      if (!skipLogout) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('auth-storage');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
