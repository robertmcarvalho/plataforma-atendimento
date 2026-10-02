import { useEffect, useMemo, useState } from 'react';
import { startColumnResize } from '@/lib/inbox/inboxColumnResize';
import {
  COPILOT_EXPANDED_W,
  COPILOT_RAIL_W,
  INBOX_LS_CONTEXT_W,
  INBOX_LS_FOLDER_W,
  INBOX_LS_LIST_W,
  readInboxStoredWidth,
} from '@/lib/inbox/inboxLayout';

export function useInboxLayout(copilotOpen: boolean, copilotCollapsed: boolean) {
  const [folderColW, setFolderColW] = useState(() => readInboxStoredWidth(INBOX_LS_FOLDER_W, 224, 180, 380));
  const [listColW, setListColW] = useState(() => readInboxStoredWidth(INBOX_LS_LIST_W, 340, 260, 560));
  const [contextColW, setContextColW] = useState(() => readInboxStoredWidth(INBOX_LS_CONTEXT_W, 320, 280, 480));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(INBOX_LS_FOLDER_W, String(folderColW));
  }, [folderColW]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(INBOX_LS_LIST_W, String(listColW));
  }, [listColW]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(INBOX_LS_CONTEXT_W, String(contextColW));
  }, [contextColW]);

  const copilotColW = copilotOpen ? (copilotCollapsed ? COPILOT_RAIL_W : COPILOT_EXPANDED_W) : 0;

  const inboxGridColumns = useMemo(() => {
    const copilotPart = copilotOpen ? ` minmax(${COPILOT_RAIL_W}px, ${copilotColW}px)` : '';
    return `${folderColW}px 4px ${listColW}px 4px minmax(min(300px, 100%), 1.25fr) 4px minmax(220px, ${contextColW}px)${copilotPart}`;
  }, [folderColW, listColW, contextColW, copilotOpen, copilotColW]);

  return {
    inboxGridColumns,
    startResizeFolderColumn: (e: { preventDefault: () => void; clientX: number }) => {
      startColumnResize(e, folderColW, setFolderColW, 180, 380);
    },
    startResizeListColumn: (e: { preventDefault: () => void; clientX: number }) => {
      startColumnResize(e, listColW, setListColW, 260, 560);
    },
    startResizeContextColumn: (e: { preventDefault: () => void; clientX: number }) => {
      startColumnResize(e, contextColW, setContextColW, 280, 480, true);
    },
  };
}
