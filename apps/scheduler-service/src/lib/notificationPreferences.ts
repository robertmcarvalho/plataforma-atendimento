const SIGNATURE_PREF_KEYS = [
  'driver_signature_pending',
  'driver_signature_viewed',
  'driver_signature_signed',
  'driver_signature_rejected',
  'driver_signature_overdue',
] as const;

export type SignaturePrefKey = (typeof SIGNATURE_PREF_KEYS)[number];

export function isInAppEnabled(prefs: Record<string, unknown> | null | undefined, key: SignaturePrefKey): boolean {
  const raw = prefs?.[key];
  if (typeof raw === 'boolean') return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const inApp = (raw as Record<string, unknown>).in_app;
    if (typeof inApp === 'boolean') return inApp;
  }
  return true;
}
