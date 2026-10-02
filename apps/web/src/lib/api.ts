import axios from 'axios';

const PRODUCTION_API_BASE = 'https://flux-farma-api-713561463013.us-central1.run.app';
const LOCAL_API_BASE = 'http://localhost:3001';

export function resolveApiBaseUrl(): string {
  const isDev = process.env.NODE_ENV === 'development';
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();

  // Validação local: nunca usar Cloud Run em `next dev`, salvo URL explícita localhost.
  if (isDev) {
    if (fromEnv && /localhost|127\.0\.0\.1/i.test(fromEnv)) return fromEnv;
    return LOCAL_API_BASE;
  }

  if (fromEnv) return fromEnv;

  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    if (
      host === 'www.aetheraai.com.br' ||
      host === 'aetheraai.com.br' ||
      host.endsWith('.aetheraai.com.br')
    ) {
      return PRODUCTION_API_BASE;
    }
  }

  return LOCAL_API_BASE;
}

const api = axios.create({
  baseURL: resolveApiBaseUrl(),
});

api.interceptors.request.use((config) => {
  config.baseURL = resolveApiBaseUrl();

  if (config.data instanceof FormData && config.headers) {
    delete config.headers['Content-Type'];
    delete config.headers['content-type'];
  }

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
