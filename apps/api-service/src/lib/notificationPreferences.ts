/** Preferências apenas na plataforma (jsonb em `users.notification_preferences`). */

export const NOTIFICATION_PREF_KEYS = [
  'conversation_assigned',
  'mention_internal_note',
  'sla_warning',
  'open_tasks_inbox',
  'campaign_done',
  'overdue_installment',
  'driver_document_expiry_warning',
  'driver_document_expired',
  'driver_signature_pending',
  'driver_signature_viewed',
  'driver_signature_signed',
  'driver_signature_rejected',
  'driver_signature_overdue',
] as const;

export type NotificationPrefKey = (typeof NOTIFICATION_PREF_KEYS)[number];

const DEFAULT_BY_KEY: Record<NotificationPrefKey, boolean> = {
  conversation_assigned: true,
  mention_internal_note: true,
  sla_warning: true,
  open_tasks_inbox: true,
  campaign_done: false,
  overdue_installment: true,
  driver_document_expiry_warning: true,
  driver_document_expired: true,
  driver_signature_pending: true,
  driver_signature_viewed: true,
  driver_signature_signed: true,
  driver_signature_rejected: true,
  driver_signature_overdue: true,
};

/** Valor gravado como boolean OU legado objeto `{ in_app?: boolean }`. */
export function prefToBoolean(key: NotificationPrefKey, raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const inApp = (raw as Record<string, unknown>).in_app;
    if (typeof inApp === 'boolean') return inApp;
  }
  return DEFAULT_BY_KEY[key];
}

export function mergeNotificationPrefs(raw: Record<string, unknown> | null | undefined): Record<NotificationPrefKey, boolean> {
  const out = {} as Record<NotificationPrefKey, boolean>;
  for (const key of NOTIFICATION_PREF_KEYS) {
    out[key] = prefToBoolean(key, raw?.[key]);
  }
  return out;
}

export function serializeNotificationPrefs(merged: Record<NotificationPrefKey, boolean>): Record<string, boolean> {
  const o: Record<string, boolean> = {};
  for (const key of NOTIFICATION_PREF_KEYS) {
    o[key] = merged[key];
  }
  return o;
}

export function mergeNotificationPrefPatch(
  prev: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...prev };
  for (const [k, val] of Object.entries(patch)) {
    if (!NOTIFICATION_PREF_KEYS.includes(k as NotificationPrefKey)) continue;
    const key = k as NotificationPrefKey;
    if (typeof val === 'boolean') {
      next[k] = val;
      continue;
    }
    // Aceita PATCH legado { in_app?: boolean }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const o = val as Record<string, unknown>;
      if (typeof o.in_app === 'boolean') next[k] = o.in_app;
    }
  }
  return next;
}

export function isInAppEnabled(prefs: Record<string, unknown> | null | undefined, key: NotificationPrefKey): boolean {
  return mergeNotificationPrefs(prefs)[key];
}
