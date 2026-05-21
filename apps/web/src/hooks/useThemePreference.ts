'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { LEGACY_THEME_STORAGE_KEY, THEME_CHANGE_EVENT, THEME_STORAGE_KEY } from '@/lib/themeStorage';

export type ThemePreference = 'dark' | 'light' | 'system';

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'dark';
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY) ?? localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'dark';
}

function readStored(): ThemePreference {
  return readThemePreference();
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function isLightTheme(pref: ThemePreference): boolean {
  return pref === 'light' || (pref === 'system' && !systemPrefersDark());
}

export function applyThemeClass(pref: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('theme-light', isLightTheme(pref));
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onMq = () => {
    if (readStored() === 'system') onStoreChange();
  };
  mq.addEventListener('change', onMq);
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => {
    mq.removeEventListener('change', onMq);
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
  };
}

function getSnapshot(): ThemePreference {
  return readStored();
}

function getServerSnapshot(): ThemePreference {
  return 'dark';
}

export function useThemePreference() {
  const pref = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    applyThemeClass(pref);
  }, [pref]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
      localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    applyThemeClass(next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  return { preference: pref, setPreference };
}
