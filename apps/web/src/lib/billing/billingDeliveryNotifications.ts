export type BillingDeliveryNotification = {
  id: string;
  kind: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message: string;
  detail?: string;
  source: 'ativmob' | 'flux_api' | 'flux_mysql' | 'manual' | 'external_app';
  createdAt: string;
};

const STORAGE_KEY = 'billing.delivery.ingestionNotifications.v1';
const EVENT_NAME = 'billing-delivery-notifications';
/** Keep a small, bounded history — full API reports must not live in Storage. */
const MAX_NOTIFICATIONS = 30;
const MAX_TITLE_CHARS = 160;
const MAX_MESSAGE_CHARS = 500;
const MAX_DETAIL_CHARS = 1_500;
/** Soft budget so a single bad payload cannot fill the origin quota. */
const MAX_PAYLOAD_CHARS = 80_000;

/** Session fallback when localStorage is full or unavailable. */
let memoryCache: BillingDeliveryNotification[] | null = null;

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function compactNotification(item: BillingDeliveryNotification): BillingDeliveryNotification {
  return {
    id: item.id,
    kind: item.kind,
    source: item.source,
    createdAt: item.createdAt,
    title: truncateText(String(item.title || ''), MAX_TITLE_CHARS),
    message: truncateText(String(item.message || ''), MAX_MESSAGE_CHARS),
    detail: item.detail ? truncateText(String(item.detail), MAX_DETAIL_CHARS) : undefined,
  };
}

function normalizeList(items: BillingDeliveryNotification[]): BillingDeliveryNotification[] {
  return items.slice(0, MAX_NOTIFICATIONS).map(compactNotification);
}

function isQuotaExceeded(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014;
  }
  if (error instanceof Error) {
    return /quota|exceeded|storage/i.test(error.message);
  }
  return false;
}

function emitChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EVENT_NAME));
}

function trySetItem(serialized: string): boolean {
  if (!canUseStorage()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch (error) {
    if (!isQuotaExceeded(error)) {
      console.warn('[billingDeliveryNotifications] persist failed', error);
    }
    return false;
  }
}

/**
 * Best-effort persistence. Never throws — Storage failures must not surface as API sync failures.
 * Returns false when nothing could be written to localStorage (in-memory cache still updated).
 */
function saveNotifications(items: BillingDeliveryNotification[]): boolean {
  const compact = normalizeList(items);
  memoryCache = compact;

  if (!canUseStorage()) {
    emitChange();
    return false;
  }

  let payload = JSON.stringify(compact);
  if (payload.length > MAX_PAYLOAD_CHARS) {
    const trimmed = compact.map((n) => ({ ...n, detail: undefined })).slice(0, 12);
    memoryCache = trimmed;
    payload = JSON.stringify(trimmed);
  }

  if (trySetItem(payload)) {
    emitChange();
    return true;
  }

  // Aggressive prune: drop details, keep a handful.
  const aggressive = compact.slice(0, 8).map((n) => ({ ...n, detail: undefined }));
  memoryCache = aggressive;
  if (trySetItem(JSON.stringify(aggressive))) {
    emitChange();
    return true;
  }

  // Last resort: clear key and store a single summary row.
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  const emergency = aggressive.slice(0, 1).map((n) => ({
    ...n,
    message: truncateText(n.message, 200),
    detail: undefined,
  }));
  memoryCache = emergency.length ? emergency : [];
  const ok = emergency.length ? trySetItem(JSON.stringify(emergency)) : true;
  if (!ok) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  emitChange();
  return ok;
}

export function listBillingDeliveryNotifications(): BillingDeliveryNotification[] {
  if (memoryCache) return memoryCache;
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && raw.length > MAX_PAYLOAD_CHARS) {
      // Migrate bloated payloads left by older builds — drop details and rewrite.
      const parsedHuge = JSON.parse(raw) as BillingDeliveryNotification[];
      const pruned = normalizeList(Array.isArray(parsedHuge) ? parsedHuge : []).map((n) => ({
        ...n,
        detail: undefined,
      }));
      memoryCache = pruned.slice(0, 12);
      saveNotifications(memoryCache);
      return memoryCache;
    }
    const parsed = raw ? (JSON.parse(raw) as BillingDeliveryNotification[]) : [];
    memoryCache = Array.isArray(parsed) ? normalizeList(parsed) : [];
    return memoryCache;
  } catch {
    memoryCache = [];
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return memoryCache;
  }
}

export type AddBillingDeliveryNotificationResult = {
  notification: BillingDeliveryNotification;
  persisted: boolean;
};

export function addBillingDeliveryNotification(
  input: Omit<BillingDeliveryNotification, 'id' | 'createdAt'>
): BillingDeliveryNotification {
  const notification = compactNotification({
    ...input,
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`,
    createdAt: new Date().toISOString(),
  });
  try {
    saveNotifications([notification, ...listBillingDeliveryNotifications()]);
  } catch (error) {
    console.warn('[billingDeliveryNotifications] add failed; keeping in-memory only', error);
    memoryCache = normalizeList([notification, ...(memoryCache || [])]);
    emitChange();
  }
  return notification;
}

/** Like addBillingDeliveryNotification, but reports whether localStorage accepted the write. */
export function addBillingDeliveryNotificationSafe(
  input: Omit<BillingDeliveryNotification, 'id' | 'createdAt'>
): AddBillingDeliveryNotificationResult {
  const notification = compactNotification({
    ...input,
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`,
    createdAt: new Date().toISOString(),
  });
  let persisted = false;
  try {
    persisted = saveNotifications([notification, ...listBillingDeliveryNotifications()]);
  } catch (error) {
    console.warn('[billingDeliveryNotifications] addSafe failed; keeping in-memory only', error);
    memoryCache = normalizeList([notification, ...(memoryCache || [])]);
    emitChange();
  }
  return { notification, persisted };
}

export function clearBillingDeliveryNotifications() {
  memoryCache = [];
  try {
    saveNotifications([]);
  } catch {
    if (canUseStorage()) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    emitChange();
  }
}

export function subscribeBillingDeliveryNotifications(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(EVENT_NAME, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(EVENT_NAME, callback);
    window.removeEventListener('storage', callback);
  };
}

/** Compact technical detail for Storage — no pretty-print, hard length cap. */
export function compactJsonDetail(value: unknown): string | undefined {
  if (value == null) return undefined;
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    if (!raw || raw === '{}' || raw === 'null') return undefined;
    return truncateText(raw, MAX_DETAIL_CHARS);
  } catch {
    return truncateText(String(value), MAX_DETAIL_CHARS);
  }
}
