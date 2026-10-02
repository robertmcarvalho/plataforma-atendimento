const STORAGE_PREFIX = 'inbox-notifications-seen-at';

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

export function readNotificationsSeenAt(userId: string | undefined): string | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

export function writeNotificationsSeenAt(userId: string | undefined, iso: string): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userId), iso);
  } catch {
    // ignore
  }
}
