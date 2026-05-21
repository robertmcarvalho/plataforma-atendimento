'use client';

import { useMemo, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';

function realWorkspaceName(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && text.toLowerCase() !== 'workspace') return text;
  }
  return 'Workspace';
}

export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const user = useAuth((s) => s.user);
  const switchWorkspace = useAuth((s) => s.switchWorkspace);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeId = user?.workspace_id || null;
  const userWorkspaceName = (user as { workspace_name?: string | null; active_workspace_name?: string | null } | null)
    ?.workspace_name ||
    (user as { workspace_name?: string | null; active_workspace_name?: string | null } | null)?.active_workspace_name ||
    null;
  const legacyMemberships =
    ((user as { memberships?: NonNullable<typeof user>['workspace_memberships'] } | null)?.memberships || []);
  const rawMemberships = user?.workspace_memberships?.length ? user.workspace_memberships : legacyMemberships;
  const memberships = rawMemberships.length
    ? rawMemberships
    : user
      ? [
          {
            workspace_id: activeId || 'active-workspace',
            workspace_slug: '',
            workspace_name: realWorkspaceName(userWorkspaceName),
            workspace_role: user?.workspace_role || user?.role || '',
            is_default: true,
          },
        ]
      : [];
  const active = memberships.find((m) => m.workspace_id === activeId) || memberships[0];
  const activeWorkspaceName = realWorkspaceName(active?.workspace_name, userWorkspaceName);

  const canSwitch = useMemo(() => {
    const platform = String(user?.platform_role || '');
    return memberships.length > 1 || platform === 'platform_admin' || platform === 'platform_owner';
  }, [memberships.length, user?.platform_role]);

  if (!user) return null;

  const onSelect = async (workspaceId: string) => {
    if (!canSwitch || workspaceId === activeId || workspaceId === 'active-workspace' || busy) return;
    setBusy(true);
    try {
      await switchWorkspace(workspaceId);
      setOpen(false);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? 'px-2 pb-2' : 'px-3 pb-3'}>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (canSwitch) setOpen((v) => !v);
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border border-border/70 bg-surface/60 px-3 py-2 text-left text-xs hover:bg-surface-hover',
          !canSwitch && 'cursor-default',
          busy && 'opacity-60'
        )}
      >
        <Building2 className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {activeWorkspaceName}
        </span>
        {canSwitch ? (
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition', open && 'rotate-180')} />
        ) : null}
      </button>
      {canSwitch && open ? (
        <div className="mt-1 max-h-48 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {memberships.map((item) => (
            <button
              key={item.workspace_id}
              type="button"
              onClick={() => void onSelect(item.workspace_id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-muted"
            >
              <span className="min-w-0 flex-1 truncate">{item.workspace_name}</span>
              {item.workspace_id === activeId ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
