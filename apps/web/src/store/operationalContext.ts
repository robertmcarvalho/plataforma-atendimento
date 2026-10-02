import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const LEGACY_STORAGE_PREFIX = 'operational-context-channel';

type OperationalContextState = {
  selectedByWorkspace: Record<string, string | null>;
  setSelectedChannelId: (workspaceId: string, channelId: string | null) => void;
};

function legacyChannelId(workspaceId: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(`${LEGACY_STORAGE_PREFIX}:${workspaceId}`);
}

function syncLegacyStorage(workspaceId: string, channelId: string | null) {
  if (typeof window === 'undefined') return;
  const key = `${LEGACY_STORAGE_PREFIX}:${workspaceId}`;
  if (channelId) window.localStorage.setItem(key, channelId);
  else window.localStorage.removeItem(key);
}

export const useOperationalContextStore = create<OperationalContextState>()(
  persist(
    (set) => ({
      selectedByWorkspace: {},
      setSelectedChannelId: (workspaceId, channelId) => {
        set((state) => ({
          selectedByWorkspace: { ...state.selectedByWorkspace, [workspaceId]: channelId },
        }));
        syncLegacyStorage(workspaceId, channelId);
      },
    }),
    {
      name: 'operational-context-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ selectedByWorkspace: state.selectedByWorkspace }),
      onRehydrateStorage: () => (state) => {
        if (!state || typeof window === 'undefined') return;
        for (const workspaceId of Object.keys(state.selectedByWorkspace)) {
          const channelId = state.selectedByWorkspace[workspaceId];
          if (channelId) syncLegacyStorage(workspaceId, channelId);
        }
      },
    }
  )
);

export function readSelectedChannelId(workspaceId: string): string | null {
  const fromStore = useOperationalContextStore.getState().selectedByWorkspace[workspaceId];
  if (fromStore) return fromStore;
  return legacyChannelId(workspaceId);
}
