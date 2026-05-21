'use client';

import { useEffect } from 'react';
import { applyThemeClass, readThemePreference } from '@/hooks/useThemePreference';

/** Aplica tema antes da primeira pintura do React (após hidratação do HTML). */
export function ThemeBoot() {
  useEffect(() => {
    applyThemeClass(readThemePreference());
  }, []);
  return null;
}
