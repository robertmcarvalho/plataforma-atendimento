'use client';

import { useMemo, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

function realWorkspaceName(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && text.toLowerCase() !== 'workspace') return text;
  }
  return 'Workspace';
}

export function WorkspaceSwitcher({
  compact = false,
  variant = 'sidebar',
  rail = false,
}: {
  compact?: boolean;
  variant?: 'sidebar' | 'pill';
  rail?: boolean;
}) {
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

  const isPill = variant === 'pill';

  const trigger = (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      className={cn(
        'h-auto justify-start gap-2 text-left text-xs font-medium',
        isPill
          ? 'max-w-[min(100%,20rem)] rounded-full bg-card/80 px-3 py-1.5'
          : 'w-full rounded-lg bg-sidebar-accent/40 px-3 py-2',
        !canSwitch && 'cursor-default',
        busy && 'opacity-60'
      )}
      onClick={canSwitch ? undefined : (e) => e.preventDefault()}
    >
      {isPill ? (
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_oklch,var(--success),transparent_88%)]" />
      ) : (
        <Building2 className="h-4 w-4 shrink-0 text-primary" />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-foreground transition-opacity duration-200',
          rail && !isPill && 'max-w-0 overflow-hidden opacity-0 group-hover/shell-sidebar:max-w-none group-hover/shell-sidebar:opacity-100'
        )}
      >
        {isPill ? `${activeWorkspaceName}${active?.is_default ? ' · Workspace principal' : ''}` : activeWorkspaceName}
      </span>
      {canSwitch ? (
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition',
            open && 'rotate-180',
            rail && !isPill && 'hidden group-hover/shell-sidebar:block'
          )}
        />
      ) : null}
    </Button>
  );

  return (
    <div className={isPill ? 'relative' : compact ? 'px-2 pb-2' : 'px-3 pb-3'}>
      {canSwitch ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={trigger} />
          <PopoverContent align="start" className="w-[var(--anchor-width)] p-1">
            <div className="max-h-48 overflow-auto">
              {memberships.map((item) => (
                <Button
                  key={item.workspace_id}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start gap-2 px-2 py-2 text-xs"
                  onClick={() => void onSelect(item.workspace_id)}
                >
                  <span className="min-w-0 flex-1 truncate text-left">{item.workspace_name}</span>
                  {item.workspace_id === activeId ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        trigger
      )}
    </div>
  );
}
