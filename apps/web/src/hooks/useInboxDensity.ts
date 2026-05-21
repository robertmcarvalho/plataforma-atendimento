'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { INBOX_DENSITY_CHANGE_EVENT, INBOX_DENSITY_STORAGE_KEY } from '@/lib/inboxDensityStorage';

export type InboxDensity = 'compact' | 'comfort';

export function readInboxDensity(): InboxDensity {
  if (typeof window === 'undefined') return 'compact';
  try {
    const v = localStorage.getItem(INBOX_DENSITY_STORAGE_KEY);
    if (v === 'compact' || v === 'comfort') return v;
  } catch {
    /* ignore */
  }
  return 'compact';
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(INBOX_DENSITY_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(INBOX_DENSITY_CHANGE_EVENT, onStoreChange);
  };
}

function getSnapshot(): InboxDensity {
  return readInboxDensity();
}

function getServerSnapshot(): InboxDensity {
  return 'compact';
}

export function applyInboxDensityToStorage(next: InboxDensity): void {
  try {
    localStorage.setItem(INBOX_DENSITY_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(INBOX_DENSITY_CHANGE_EVENT));
}

export function useInboxDensity() {
  const density = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setDensity = useCallback((next: InboxDensity) => {
    applyInboxDensityToStorage(next);
  }, []);

  return { density, setDensity };
}
