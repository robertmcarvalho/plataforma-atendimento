'use client';

import { useEffect } from 'react';
import { syncBrandingFavicon } from '@/lib/syncBrandingFavicon';
import { THEME_CHANGE_EVENT } from '@/lib/themeStorage';
import { applyThemeClass, readThemePreference, useThemePreference } from '@/hooks/useThemePreference';

/** Mantém favicon alinhado à preferência de tema (inclui troca em Configurações). */
export function ThemeAwareFavicon() {
  const { preference } = useThemePreference();

  useEffect(() => {
    syncBrandingFavicon();
  }, [preference]);

  useEffect(() => {
    const onThemeChange = () => {
      const pref = readThemePreference();
      applyThemeClass(pref);
      syncBrandingFavicon();
    };
    const onReady = () => syncBrandingFavicon();

    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    window.addEventListener('storage', onThemeChange);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      onReady();
    }
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
      window.removeEventListener('storage', onThemeChange);
      document.removeEventListener('DOMContentLoaded', onReady);
    };
  }, []);

  return null;
}
