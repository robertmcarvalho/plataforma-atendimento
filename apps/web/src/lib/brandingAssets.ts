export const BRANDING_MARK_DARK = '/branding/aethera-mark.svg';
export const BRANDING_MARK_LIGHT = '/branding/aethera-mark-light.svg';
export const BRANDING_LOGO_DARK = '/branding/aethera-logo.svg';
export const BRANDING_LOGO_LIGHT = '/branding/aethera-logo-light.svg';
/** Favicon com fundo sólido — legível em abas claras e escuras (fallback). */
export const BRANDING_FAVICON = '/branding/aethera-favicon.svg';
export const BRANDING_FAVICON_LIGHT = '/branding/aethera-favicon-light.svg';
export const BRANDING_FAVICON_DARK = '/branding/aethera-favicon-dark.svg';

export function brandingMarkSrc(light: boolean): string {
  return light ? BRANDING_MARK_LIGHT : BRANDING_MARK_DARK;
}

export function brandingFaviconSrc(light: boolean): string {
  return light ? BRANDING_FAVICON_LIGHT : BRANDING_FAVICON_DARK;
}

export function brandingLogoSrc(light: boolean): string {
  return light ? BRANDING_LOGO_LIGHT : BRANDING_LOGO_DARK;
}
