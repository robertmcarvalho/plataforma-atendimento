'use client';

import { useEffect } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/store/auth';

const HEARTBEAT_MS = 60_000;

async function setPresence(presence: 'online' | 'offline') {
  try {
    await api.put('/api/presence/me', { presence });
  } catch {
    // ignore — presença é best-effort
  }
}

/** Mantém o usuário como online enquanto a aba estiver ativa (heartbeat a cada 60s). */
export function usePresenceHeartbeat(enabled = true) {
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const active = enabled && hasHydrated && isAuthenticated;

  useEffect(() => {
    if (!active) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startHeartbeat = () => {
      void setPresence('online');
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => void setPresence('online'), HEARTBEAT_MS);
    };

    const stopHeartbeat = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') startHeartbeat();
      else {
        stopHeartbeat();
        void setPresence('offline');
      }
    };

    startHeartbeat();
    document.addEventListener('visibilitychange', onVisibility);

    const onPageHide = () => {
      stopHeartbeat();
      void setPresence('offline');
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      stopHeartbeat();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      void setPresence('offline');
    };
  }, [active]);
}
