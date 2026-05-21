import { brandingFaviconSrc } from '@/lib/brandingAssets';
import { isLightTheme, readThemePreference } from '@/hooks/useThemePreference';
import { LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from '@/lib/themeStorage';

const FAVICON_LINK_SELECTOR =
  'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]';

function hasStoredThemePreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(LEGACY_THEME_STORAGE_KEY));
  } catch {
    return false;
  }
}

/**
 * Aba do navegador: sem preferência salva (ex.: anônimo), segue o tema do SO.
 * Com preferência salva, segue a escolha do usuário na app.
 */
export function resolveFaviconLight(): boolean {
  if (typeof window === 'undefined') return false;
  if (!hasStoredThemePreference()) {
    return !window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return isLightTheme(readThemePreference());
}

/** Atualiza todos os `<link rel="icon">` para o favicon da marca conforme o tema. */
export function syncBrandingFavicon(light?: boolean): void {
  if (typeof document === 'undefined') return;
  const useLight = light ?? resolveFaviconLight();
  const href = brandingFaviconSrc(useLight);
  for (const el of document.querySelectorAll(FAVICON_LINK_SELECTOR)) {
    if (!(el instanceof HTMLLinkElement)) continue;
    el.href = href;
    el.type = 'image/svg+xml';
  }
}
