'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Inbox,
  LayoutDashboard,
  Users,
  Receipt,
  Settings,
  Search,
  Command,
  Building2,
  Truck,
  Crown,
  Megaphone,
  BarChart3,
  ClipboardList,
  Briefcase,
  Workflow,
  Wallet,
  CalendarCheck,
  MessageCircle,
  UserPlus,
  UserX,
  UserMinus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusDot } from '@/components/ui/StatusDot';
import { useAuth } from '@/store/auth';
import api from '@/lib/api';
import { roleHasSettingsAccess, sidebarHrefsForRole } from '@/lib/roleNav';
import { isCommercialCrmEnabled, roleCanAccessCommercial } from '@/lib/commercial/commercialAccess';
import { roleCanAccessBilling } from '@/lib/billing/billingAccess';
import { useBillingModuleEnabled } from '@/lib/billing/useBillingQueries';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

const commercialNav: Array<Omit<NavItem, 'badge'>> = [
  { href: '/commercial', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/commercial/pipeline', label: 'Pipeline', icon: Workflow },
  { href: '/commercial/leads', label: 'Leads', icon: Users },
  { href: '/commercial/settings', label: 'Configurações', icon: Settings },
];

const baseNav: Array<Omit<NavItem, 'badge'>> = [
  { href: '/inbox', label: 'Caixa de entrada', icon: Inbox },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/contacts', label: 'Contatos', icon: Users },
  { href: '/pharmacies', label: 'Farmácias', icon: Building2 },
  { href: '/drivers', label: 'Entregadores', icon: Truck },
  { href: '/leaders', label: 'Líderes', icon: Crown },
  { href: '/campaigns', label: 'Campanhas', icon: Megaphone },
  { href: '/operacao', label: 'Operação', icon: ClipboardList },
  { href: '/reports', label: 'Relatórios', icon: BarChart3 },
  { href: '/financial', label: 'Financeiro', icon: Wallet },
  { href: '/billing', label: 'Faturamento', icon: Receipt },
  { href: '/settings', label: 'Configurações', icon: Settings },
];

export function Sidebar() {
  return <SidebarInner />;
}

export function SidebarInner({
  width = 240,
  mobile = false,
  rail = false,
  onNavigate,
}: {
  width?: number;
  mobile?: boolean;
  /** Desktop: ícones only; labels on parent hover (group/shell-sidebar) */
  rail?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { user } = useAuth();
  const logout = useAuth((s) => s.logout);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const presenceRef = useRef<HTMLDivElement | null>(null);
  const billingModuleEnabled = useBillingModuleEnabled(Boolean(user?.id));

  const displayName = user?.name || 'Robert Carvalho';
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || 'RC';

  const presenceQuery = useQuery({
    queryKey: ['presence', 'me', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => (await api.get('/api/presence/me')).data as { presence: 'online' | 'offline'; updated_at: string },
  });

  const openConvsQuery = useQuery({
    queryKey: ['sidebar', 'open-conversations', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const res = await api.get('/api/conversations', { params: { attendant_id: user!.id, status: 'open', page: 1, limit: 1 } });
      return res.data as { total: number };
    },
  });

  const presence = presenceQuery.data?.presence || 'online';
  const openChats = openConvsQuery.data?.total ?? 0;

  const nav = useMemo((): NavItem[] => {
    if (user?.role === 'leader') {
      return [
        { href: '/lider', label: 'Visão geral', icon: LayoutDashboard },
        { href: '/lider/farmacias', label: 'Minhas farmácias', icon: Building2 },
        { href: '/lider/entregadores', label: 'Meus entregadores', icon: Truck },
        { href: '/lider/ocorrencias', label: 'Ocorrências e lançamentos', icon: UserX },
        { href: '/lider/pre-cadastro', label: 'Pré-cadastro', icon: UserPlus },
        { href: '/lider/desligamento', label: 'Desligamento', icon: UserMinus },
        { href: '/lider/chat', label: 'Chat atendimento', icon: MessageCircle },
      ];
    }

    const hrefs = sidebarHrefsForRole(user?.role, user?.permissions);
    let items: NavItem[] = hrefs === 'all' ? [...baseNav] : baseNav.filter((i) => (hrefs as readonly string[]).includes(i.href));

    if (!roleHasSettingsAccess(user?.role)) {
      items = items.filter((i) => i.href !== '/settings');
    }

    if (!billingModuleEnabled || !roleCanAccessBilling(user?.role, user?.permissions)) {
      items = items.filter((i) => i.href !== '/billing');
    }

    const platformAdmin =
      user?.platform_role === 'platform_admin' || user?.platform_role === 'platform_owner';
    if (platformAdmin) {
      items = [{ href: '/platform/workspaces', label: 'Plataforma', icon: Building2 }, ...items];
    }

    return items.map((item) => (item.href === '/inbox' ? { ...item, badge: openChats || undefined } : item));
  }, [billingModuleEnabled, openChats, user?.permissions, user?.platform_role, user?.role]);

  useEffect(() => {
    if (!presenceOpen) return;
    const onClick = (e: MouseEvent) => {
      const el = presenceRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setPresenceOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [presenceOpen]);

  const showCommercialSection = useMemo(() => {
    if (!isCommercialCrmEnabled() || !roleCanAccessCommercial(user?.role)) return false;
    const hrefs = sidebarHrefsForRole(user?.role, user?.permissions);
    if (hrefs === 'all') return true;
    return (hrefs as readonly string[]).includes('/commercial');
  }, [user?.permissions, user?.role]);

  const setPresence = async (next: 'online' | 'offline') => {
    await api.put('/api/presence/me', { presence: next });
    setPresenceOpen(false);
    void presenceQuery.refetch();
  };

  return (
    <aside
      id="app-shell-sidebar"
      className={cn(
        'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar',
        mobile ? 'h-[100dvh] w-full' : 'h-screen'
      )}
      style={mobile ? undefined : { width }}
    >
      <div className={cn('border-b border-sidebar-border pt-3', rail && 'px-1')}>
        <WorkspaceSwitcher compact rail={rail} />
      </div>

      {/* Search */}
      <div className={cn('px-3 pt-3', rail && 'px-2')}>
        <button
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-background/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent',
            rail && 'justify-center px-2 group-hover/shell-sidebar:justify-start'
          )}
          title="Buscar"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span
            className={cn(
              'flex-1 text-left transition-opacity duration-200',
              rail && 'max-w-0 overflow-hidden opacity-0 group-hover/shell-sidebar:max-w-none group-hover/shell-sidebar:opacity-100'
            )}
          >
            Buscar...
          </span>
          <kbd
            className={cn(
              'hidden items-center gap-0.5 rounded border border-sidebar-border bg-sidebar-accent px-1 py-0.5 font-mono text-[10px] sm:flex',
              rail && 'hidden group-hover/shell-sidebar:flex'
            )}
          >
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 p-3">
        {nav.map((item) => {
          const active = pathname === item.href || (item.href === '/inbox' && pathname === '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => onNavigate?.()}
              className={cn(
                'group/nav relative flex min-h-[44px] items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
              )}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-[18px] w-0.5 -translate-y-1/2 rounded-r bg-primary shadow-[0_0_8px_color-mix(in_oklch,var(--primary)_60%,transparent)]"
                />
              ) : null}
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span
                className={cn(
                  'flex-1 truncate transition-opacity duration-200',
                  rail && 'max-w-0 overflow-hidden opacity-0 group-hover/shell-sidebar:max-w-none group-hover/shell-sidebar:opacity-100'
                )}
              >
                {item.label}
              </span>
              {item.badge ? (
                <span
                  className={cn(
                    'rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary',
                    rail && 'hidden group-hover/shell-sidebar:inline'
                  )}
                >
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}

        {showCommercialSection ? (
          <div className={cn('pt-4', rail && 'group-hover/shell-sidebar:pt-4')}>
            <div
              className={cn(
                'mb-1 flex items-center gap-1.5 px-2.5 text-[10px] font-medium uppercase tracking-wider text-subtle-foreground',
                rail && 'max-h-0 overflow-hidden opacity-0 group-hover/shell-sidebar:max-h-none group-hover/shell-sidebar:opacity-100'
              )}
            >
              <Briefcase className="h-3 w-3 shrink-0" /> Comercial
            </div>
            {commercialNav.map((item) => {
              const active =
                item.href === '/commercial'
                  ? pathname === '/commercial'
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => onNavigate?.()}
                  className={cn(
                    'group/nav relative flex min-h-[40px] items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                  )}
                >
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-[18px] w-0.5 -translate-y-1/2 rounded-r bg-primary shadow-[0_0_8px_color-mix(in_oklch,var(--primary)_60%,transparent)]"
                    />
                  ) : null}
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                  <span
                    className={cn(
                      'flex-1 truncate transition-opacity duration-200',
                      rail && 'max-w-0 overflow-hidden opacity-0 group-hover/shell-sidebar:max-w-none group-hover/shell-sidebar:opacity-100'
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : null}
      </nav>

      {/* User */}
      <div ref={presenceRef} className="relative border-t border-sidebar-border p-3">
        {presenceOpen ? (
          <div
            className="absolute bottom-[4.25rem] left-3 right-3 z-50 rounded-xl border border-border bg-muted p-1 shadow-md"
          >
            <button
              onClick={() => void setPresence('online')}
              className={cn(
                'flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-sidebar-accent/60',
                presence === 'online' ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              Online
              {presence === 'online' ? <span className="font-mono text-[10px] text-primary">✓</span> : null}
            </button>
            <button
              onClick={() => void setPresence('offline')}
              className={cn(
                'flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-sidebar-accent/60',
                presence === 'offline' ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              Offline
              {presence === 'offline' ? <span className="font-mono text-[10px] text-primary">✓</span> : null}
            </button>
            <div className="my-1 h-px bg-border/60" />
            {roleHasSettingsAccess(user?.role) ? (
              <Link
                href="/settings"
                onClick={() => {
                  setPresenceOpen(false);
                  onNavigate?.();
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              >
                Configurações
              </Link>
            ) : null}
            <button
              onClick={() => {
                setPresenceOpen(false);
                logout();
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-destructive hover:bg-sidebar-accent/60"
            >
              Sair
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-2.5 rounded-md p-1.5 hover:bg-sidebar-accent transition-colors">
          <div className="relative">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-channel-instagram text-xs font-semibold text-primary-foreground">
              {initials}
            </div>
            <StatusDot
              status={presence === 'online' ? 'online' : 'offline'}
              pulse={presence === 'online'}
              className="absolute -bottom-0.5 -right-0.5"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate text-xs font-medium text-foreground">{displayName}</div>
            <div className="truncate text-[10px] text-muted-foreground">{presence === 'online' ? 'Online' : 'Offline'} · {openChats} chats</div>
          </div>
          <button
            type="button"
            onClick={() => setPresenceOpen((v) => !v)}
            className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
            title="Configurações de presença"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
