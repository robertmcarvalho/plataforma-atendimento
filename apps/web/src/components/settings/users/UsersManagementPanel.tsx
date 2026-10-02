'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Briefcase,
  Crown,
  Handshake,
  Headphones,
  Mail,
  Phone,
  Plus,
  Search,
  Shield,
  UserCog,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FormControl } from '@/components/form/FormControl';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';
import { interactiveHover, interactiveActive } from '@/lib/interactiveRow';
import {
  reviveKpiCardClassName,
  reviveTableHeadRowClassName,
  reviveTableRowClassName,
  reviveTableShellClassName,
} from '@/lib/reviveSurfaces';
import { roleDisplayNamePt } from '@/lib/roleLabels';
import {
  getCountsByRole,
  listUsers,
  resetUserPassword,
  resendUserInvite,
  toggleUserActive,
  type UserRecord,
} from '@/lib/users/usersApi';
import { ProvisionUserModal } from './ProvisionUserModal';
import { UserActionsMenu } from './UserActionsMenu';
import { formatBrazilPhone } from '@/lib/brFormat';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

type RoleFilter =
  | 'all'
  | 'admin'
  | 'supervisor'
  | 'financial'
  | 'operational'
  | 'attendant'
  | 'leader'
  | 'commercial'
  | 'sales';

const KPI_META: Record<Exclude<RoleFilter, 'all'>, { label: string; color: string; icon: typeof Shield }> = {
  admin: { label: 'Administrador', color: 'bg-destructive/15 text-destructive', icon: Shield },
  supervisor: { label: 'Gestor', color: 'bg-primary/15 text-primary', icon: UserCog },
  financial: { label: 'Gestor (legado)', color: 'bg-amber-500/15 text-amber-800 dark:text-amber-200', icon: Shield },
  operational: { label: 'Analista Operacional', color: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-200', icon: Headphones },
  attendant: { label: 'Atendente', color: 'bg-success/15 text-success', icon: Headphones },
  leader: { label: 'Líder', color: 'bg-warning/15 text-warning', icon: Crown },
  commercial: { label: 'Comercial', color: 'bg-violet-500/15 text-violet-700 dark:text-violet-300', icon: Briefcase },
  sales: { label: 'Vendas', color: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', icon: Handshake },
};

const ROLE_BADGE: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  admin: { label: 'Administrador', color: 'bg-destructive/15 text-destructive', icon: Shield },
  supervisor: { label: 'Gestor', color: 'bg-primary/15 text-primary', icon: UserCog },
  financial: { label: 'Gestor (legado)', color: 'bg-amber-500/15 text-amber-800 dark:text-amber-200', icon: Shield },
  operational: { label: 'Analista Operacional', color: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-200', icon: Headphones },
  attendant: { label: 'Atendente', color: 'bg-success/15 text-success', icon: Headphones },
  leader: { label: 'Líder', color: 'bg-warning/15 text-warning', icon: Crown },
  commercial: { label: 'Comercial', color: 'bg-violet-500/15 text-violet-700 dark:text-violet-300', icon: Briefcase },
  sales: { label: 'Vendas', color: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', icon: Handshake },
};

export function UsersManagementPanel() {
  const [filter, setFilter] = useState<RoleFilter>('all');
  const [search, setSearch] = useState('');
  const [showProvision, setShowProvision] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const {
    data: users = [],
    refetch,
    isError,
    error,
  } = useQuery({ queryKey: ['users-full'], queryFn: listUsers });
  const { data: countsFromApi } = useQuery({ queryKey: ['users-counts-by-role'], queryFn: getCountsByRole });

  const counts = useMemo(() => {
    const c: Record<Exclude<RoleFilter, 'all'>, number> = {
      admin: countsFromApi?.admin ?? 0,
      supervisor: countsFromApi?.supervisor ?? 0,
      financial: countsFromApi?.financial ?? 0,
      operational: countsFromApi?.operational ?? 0,
      attendant: countsFromApi?.attendant ?? 0,
      leader: countsFromApi?.leader ?? 0,
      commercial: countsFromApi?.commercial ?? 0,
      sales: countsFromApi?.sales ?? 0,
    };
    if (countsFromApi) return c;
    for (const u of users) {
      const n = (u.workspace_role || u.roles?.name) as keyof typeof c | undefined;
      if (n && n in c) c[n] += 1;
    }
    return c;
  }, [users, countsFromApi]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const role = u.workspace_role || u.roles?.name;
      if (filter !== 'all' && role !== filter) return false;
      if (!q) return true;
      return [u.name, u.email, u.phone, u.username].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [users, filter, search]);

  const runResend = async (u: UserRecord) => {
    try {
      const res = await resendUserInvite(u.id);
      setTempPassword(res.temporary_password ?? null);
      setActionMsg(`Acesso reenviado para ${u.email}. Usuário: ${res.username}`);
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Falha ao reenviar');
    }
  };

  const runPassword = async (u: UserRecord) => {
    try {
      const res = await resetUserPassword(u.id, { generate: true });
      setTempPassword(res.temporary_password || null);
      setActionMsg(`Senha redefinida para ${u.name}.`);
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Falha ao redefinir senha');
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Configurações
        </Link>

        <PageHeader
          icon={Users}
          eyebrow="Configurações"
          title="Usuários e Perfis"
          description="Gestão de acesso, perfis e permissões da plataforma."
          actions={
            <Button type="button" size="xs" onClick={() => setShowProvision(true)}>
              <Plus className="h-3.5 w-3.5" /> Novo usuário
            </Button>
          }
        />

        {isError ? (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Não foi possível carregar os usuários: {apiErrorMessage(error)}
          </div>
        ) : null}

        {actionMsg || tempPassword ? (
          <div className="mb-4 space-y-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            {actionMsg ? <p>{actionMsg}</p> : null}
            {tempPassword ? (
              <p className="font-mono">
                Senha temporária: <strong className="text-foreground">{tempPassword}</strong>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(Object.keys(KPI_META) as Array<Exclude<RoleFilter, 'all'>>).map((key) => {
            const meta = KPI_META[key];
            const Icon = meta.icon;
            const count = counts[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  reviveKpiCardClassName,
                  'text-left transition-colors',
                  filter === key && 'ring-2 ring-primary/40'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className={cn('flex h-7 w-7 items-center justify-center rounded-md', meta.color)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="font-mono text-lg font-semibold">{count}</div>
                </div>
                <div className="mt-2 text-xs font-medium">{meta.label}</div>
                <div className="text-[10px] text-muted-foreground">{count === 1 ? '1 usuário' : `${count} usuários`}</div>
              </button>
            );
          })}
        </div>

        <div className="mb-3 flex items-center gap-3">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <FormControl
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, email ou telefone..."
              inputSize="sm"
              className="pl-9 pr-3 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={cn('rounded-md border border-border px-3 py-1.5 text-xs transition-colors', filter === 'all' ? interactiveActive : interactiveHover)}
          >
            Todos
          </button>
        </div>

        <div className={reviveTableShellClassName}>
          <table className="w-full text-sm">
            <thead className={reviveTableHeadRowClassName}>
              <tr>
                <th className="px-4 py-2.5 text-left">Usuário</th>
                <th className="px-4 py-2.5 text-left">Perfil</th>
                <th className="px-4 py-2.5 text-left">Setor / Vínculo</th>
                <th className="px-4 py-2.5 text-left">Filas WhatsApp</th>
                <th className="px-4 py-2.5 text-left">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const roleKey = String(u.workspace_role || u.roles?.name || '');
                const badge = ROLE_BADGE[roleKey];
                const Icon = badge?.icon;
                const setorLabel =
                  roleKey === 'leader' && u.leaders?.name
                    ? u.leaders.name
                    : u.operational_sector_labels?.length
                      ? u.operational_sector_labels.join(', ')
                      : '—';
                return (
                  <tr key={u.id} className={cn('border-t border-border', reviveTableRowClassName)}>
                    <td className="px-4 py-3">
                      <Link href={`/settings/users/${u.id}`} className="block">
                        <div className="text-xs font-medium hover:text-primary">{u.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                          {u.email ? (
                            <span className="inline-flex items-center gap-1">
                              <Mail className="h-2.5 w-2.5" /> {u.email}
                            </span>
                          ) : null}
                          {u.phone ? (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="h-2.5 w-2.5" /> {formatBrazilPhone(u.phone || '') || u.phone}
                            </span>
                          ) : null}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {badge && Icon ? (
                        <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', badge.color)}>
                          <Icon className="h-2.5 w-2.5" /> {badge.label}
                        </span>
                      ) : (
                        <span className="text-xs">{roleDisplayNamePt(roleKey)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{setorLabel}</td>
                    <td className="px-4 py-3 font-mono text-xs">{u.whatsapp_queues_count ?? 0}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                          u.is_active !== false ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', u.is_active !== false ? 'bg-success' : 'bg-muted-foreground')} />
                        {u.is_active !== false ? 'ativo' : 'inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <UserActionsMenu
                        user={u}
                        onResend={() => void runResend(u)}
                        onEditPassword={() => void runPassword(u)}
                        onToggleActive={() => void toggleUserActive(u.id).then(() => refetch())}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="p-6 text-center text-xs text-muted-foreground">Nenhum usuário encontrado.</p>
          )}
        </div>
      </div>

      {showProvision ? (
        <ProvisionUserModal
          onClose={() => setShowProvision(false)}
          onSaved={() => {
            void refetch();
            setShowProvision(false);
          }}
        />
      ) : null}
    </div>
  );
}
