import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { applyThemeClass } from '@/hooks/useThemePreference';
import { applyInboxDensityToStorage } from '@/hooks/useInboxDensity';
import { LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from '@/lib/themeStorage';
import api from '@/lib/api';

type WorkspaceMembershipState = {
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
  workspace_role: string;
  is_default: boolean;
};

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  workspace_role?: string | null;
  platform_role?: string | null;
  workspace_name?: string | null;
  workspace_id?: string | null;
  workspace_memberships?: WorkspaceMembershipState[];
  sector_id: string | null;
  /** Todos os setores (vínculo `user_sectors`); inbox/pendências usam a união. */
  sector_ids?: string[];
  permissions: Record<string, unknown>;
}

function isGenericWorkspaceName(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  return !text || text === 'workspace';
}

function normalizeMemberships(
  raw: Array<Partial<WorkspaceMembershipState>> | undefined,
  activeWorkspaceId: string | null,
  activeWorkspaceName: string | null
): WorkspaceMembershipState[] {
  return (raw || [])
    .map((item) => {
      const workspaceId = String(item.workspace_id || '');
      const currentName = String(item.workspace_name || '');
      const workspaceName =
        activeWorkspaceName && workspaceId === activeWorkspaceId && isGenericWorkspaceName(currentName)
          ? activeWorkspaceName
          : currentName;
      return {
        workspace_id: workspaceId,
        workspace_slug: String(item.workspace_slug || ''),
        workspace_name: workspaceName,
        workspace_role: String(item.workspace_role || ''),
        is_default: Boolean(item.is_default),
      };
    })
    .filter((item) => item.workspace_id.length > 0);
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  hasPermission: (resource: string, action: string) => boolean;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),

      login: async (email, password) => {
        try {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          localStorage.removeItem('auth-storage');
        } catch {
          /* ignore */
        }
        const res = await api.post('/api/auth/login', { email: email.trim(), password });
        const { token, user } = res.data;
        const normalizedUser = {
          ...user,
          workspace_id: user?.workspace_id || user?.active_workspace_id || null,
          workspace_name: user?.workspace_name || user?.active_workspace_name || null,
          workspace_memberships: normalizeMemberships(
            user?.workspace_memberships || user?.memberships || [],
            user?.workspace_id || user?.active_workspace_id || null,
            user?.workspace_name || user?.active_workspace_name || null
          ),
        };
        try {
          localStorage.setItem('token', token);
          // Keep a debuggable copy (not used as source of truth).
          localStorage.setItem('user', JSON.stringify(normalizedUser));
        } catch {
          /* Zustand persist below remains the source of truth for this session. */
        }
        set({ token, user: normalizedUser, isAuthenticated: true });
        void get().refreshUser();
      },

      logout: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // Clear persisted zustand state to avoid "stuck role" after user changes.
        localStorage.removeItem('auth-storage');
        set({ token: null, user: null, isAuthenticated: false });
        window.location.href = '/login';
      },

      switchWorkspace: async (workspaceId) => {
        const { token } = get();
        if (!token) return;
        const res = await api.post('/api/auth/switch-workspace', { workspace_id: workspaceId });
        const nextToken = String(res.data?.token || '');
        const nextUser = res.data?.user;
        if (!nextToken || !nextUser) return;
        const normalizedUser = {
          ...nextUser,
          workspace_id: nextUser?.workspace_id || nextUser?.active_workspace_id || null,
          workspace_name: nextUser?.workspace_name || nextUser?.active_workspace_name || null,
          workspace_memberships: normalizeMemberships(
            nextUser?.workspace_memberships || nextUser?.memberships || [],
            nextUser?.workspace_id || nextUser?.active_workspace_id || null,
            nextUser?.workspace_name || nextUser?.active_workspace_name || null
          ),
        };
        localStorage.setItem('token', nextToken);
        localStorage.setItem('user', JSON.stringify(normalizedUser));
        set({ token: nextToken, user: normalizedUser, isAuthenticated: true });
      },

      refreshUser: async () => {
        const { token } = get();
        if (!token) return;
        try {
          const { data } = await api.get<Record<string, unknown>>('/api/auth/me');
          const roles = data.roles as { name?: string; permissions?: Record<string, unknown> } | null | undefined;
          const memberships =
            (data.workspace_memberships as Array<{
              workspace_id?: string;
              workspace_slug?: string;
              workspace_name?: string;
              workspace_role?: string;
              is_default?: boolean;
            }> | null | undefined) || [];
          const ui = data.ui_preferences as { theme?: string; inbox_density?: string } | null | undefined;
          const theme = ui?.theme;
          if (theme === 'light' || theme === 'dark' || theme === 'system') {
            try {
              localStorage.setItem(THEME_STORAGE_KEY, theme);
              try {
                localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
              } catch {
                /* ignore */
              }
            } catch {
              /* ignore */
            }
            applyThemeClass(theme);
          }
          const inboxDensity = ui?.inbox_density;
          if (inboxDensity === 'compact' || inboxDensity === 'comfort') {
            applyInboxDensityToStorage(inboxDensity);
          }
          const us = data.user_sectors as Array<{ sector_id?: string }> | null | undefined;
          const sector_ids = (us || [])
            .map((r) => r.sector_id)
            .filter((x): x is string => typeof x === 'string' && x.length > 0);
          const activeWorkspaceId = data.active_workspace_id ? String(data.active_workspace_id) : null;
          const activeWorkspaceName = data.active_workspace_name ? String(data.active_workspace_name) : null;
          const nextUser = {
            id: String(data.id),
            name: String(data.name || ''),
            email: String(data.email || ''),
            role: String(data.workspace_role || roles?.name || 'attendant'),
            workspace_role: data.workspace_role ? String(data.workspace_role) : null,
            platform_role: data.platform_role ? String(data.platform_role) : null,
            workspace_name: activeWorkspaceName,
            workspace_id: activeWorkspaceId,
            workspace_memberships: normalizeMemberships(memberships, activeWorkspaceId, activeWorkspaceName),
            sector_id: (data.sector_id as string | null) ?? null,
            sector_ids: sector_ids.length ? sector_ids : undefined,
            permissions:
              (data.effective_permissions as Record<string, unknown>) ||
              (roles?.permissions as Record<string, unknown>) ||
              {},
          };
          try {
            localStorage.setItem('user', JSON.stringify(nextUser));
          } catch {
            /* ignore */
          }
          set({ user: nextUser });
        } catch {
          /* ignore */
        }
      },

      hasPermission: (resource, action) => {
        const { user } = get();
        if (!user) return false;
        if (user.role === 'admin' || user.platform_role === 'platform_admin' || user.platform_role === 'platform_owner') return true;
        const perms = user.permissions as Record<string, Record<string, boolean>>;
        return perms?.[resource]?.[action] === true;
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => {
        const noopStorage: StateStorage = {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
        };

        return typeof window === 'undefined' ? noopStorage : localStorage;
      }),
      // Prevent SSR/client mismatch: hydrate only after mount.
      skipHydration: true,
      onRehydrateStorage: () => () => {
        // O segundo callback recebe estado persistido (parcial); não há `setHasHydrated` nele — usar API da store.
        useAuth.getState().setHasHydrated(true);
      },
      partialize: (s) => ({ token: s.token, user: s.user, isAuthenticated: s.isAuthenticated }),
    }
  )
);
