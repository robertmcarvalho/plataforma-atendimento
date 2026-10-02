export const INBOX_LS_FOLDER_W = 'inbox-col-folder-w';
export const INBOX_LS_LIST_W = 'inbox-col-list-w';
export const INBOX_LS_CONTEXT_W = 'inbox-col-context-w';
export const COPILOT_RAIL_W = 48;
export const COPILOT_EXPANDED_W = 440;

export function readInboxStoredWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === 'undefined') return fallback;
  const n = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
