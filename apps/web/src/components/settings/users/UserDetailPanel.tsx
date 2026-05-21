'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, Key, Mail, Shield, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';
import { roleDisplayNamePt } from '@/lib/roleLabels';
import {
  deactivateUser,
  getChannelAssignments,
  getUser,
  getUserStats,
  listRoles,
  resetUserPassword,
  resendUserInvite,
  saveChannelAssignments,
  updateRolePermissions,
  type ChannelAssignmentRow,
} from '@/lib/users/usersApi';
import { FilasSetoresPicker } from '@/components/settings/users/FilasSetoresPicker';
import { formatBrazilPhone } from '@/lib/brFormat';
import { listChannels, parseChannelOperationalConfig } from '@/lib/integrations/channelsApi';

type Tab = 'profile' | 'permissions' | 'queues' | 'security';

type Sector = { id: string; name: string };
type PermissionTree = Record<string, Record<string, boolean> | boolean | unknown>;

const PERMISSION_CATALOG: Array<{
  resource: string;
  label: string;
  description: string;
  actions: Array<{ key: string; label: string }>;
}> = [
  {
    resource: 'conversations',
    label: 'Atendimento',
    description: 'Acesso à caixa de entrada, respostas, transferências e encerramento.',
    actions: [
      { key: 'view', label: 'Visualizar' },
      { key: 'reply', label: 'Responder' },
      { key: 'assign', label: 'Atribuir' },
      { key: 'transfer', label: 'Transferir' },
      { key: 'close', label: 'Resolver/encerrar' },
    ],
  },
  {
    resource: 'users',
    label: 'Usuários e perfis',
    description: 'Administração de usuários, convites, permissões e filas.',
    actions: [
      { key: 'view', label: 'Visualizar' },
      { key: 'manage', label: 'Gerenciar' },
    ],
  },
  {
    resource: 'automations',
    label: 'Automações',
    description: 'Configuração de fluxos e regras operacionais.',
    actions: [
      { key: 'view', label: 'Visualizar' },
      { key: 'manage', label: 'Gerenciar' },
    ],
  },
  {
    resource: 'reports',
    label: 'Relatórios',
    description: 'Acesso a relatórios operacionais e indicadores.',
    actions: [{ key: 'view', label: 'Visualizar' }],
  },
  {
    resource: 'campaigns',
    label: 'Campanhas',
    description: 'Acesso e criação de campanhas.',
    actions: [
      { key: 'view', label: 'Visualizar' },
      { key: 'create', label: 'Criar' },
    ],
  },
  {
    resource: 'templates',
    label: 'Templates',
    description: 'Uso de modelos aprovados de mensagem.',
    actions: [
      { key: 'view', label: 'Visualizar' },
      { key: 'use', label: 'Usar' },
    ],
  },
  {
    resource: 'notes',
    label: 'Notas internas',
    description: 'Registro de observações internas no atendimento.',
    actions: [{ key: 'create', label: 'Criar' }],
  },
  {
    resource: 'sla',
    label: 'SLA',
    description: 'Visualização e gestão de metas de atendimento.',
    actions: [
      { key: 'view', label: 'Visualizar' },
      { key: 'manage', label: 'Gerenciar' },
    ],
  },
  {
    resource: 'pharmacies',
    label: 'Farmácias',
    description: 'Cadastro e manutenção de farmácias.',
    actions: [
      { key: 'view', label: 'Visualizar' },
      { key: 'manage', label: 'Gerenciar' },
    ],
  },
  {
    resource: 'drivers',
    label: 'Entregadores',
    description: 'Cadastro e manutenção de entregadores.',
    actions: [
      { key: 'view', label: 'Visualizar' },
      { key: 'manage', label: 'Gerenciar' },
    ],
  },
  {
    resource: 'leaders',
    label: 'Líderes',
    description: 'Cadastro e manutenção de líderes.',
    actions: [
      { key: 'view', label: 'Visualizar' },
      { key: 'manage', label: 'Gerenciar' },
    ],
  },
  {
    resource: 'financial',
    label: 'Financeiro',
    description: 'Rotinas financeiras, aprovações e exportações.',
    actions: [
      { key: 'view', label: 'Visualizar' },
      { key: 'manage', label: 'Gerenciar' },
      { key: 'approve', label: 'Aprovar' },
      { key: 'export', label: 'Exportar' },
    ],
  },
];

function normalizePermissionTree(input: Record<string, unknown> | undefined): PermissionTree {
  const base: PermissionTree = { ...(input || {}) };
  if (base.all === true) {
    for (const group of PERMISSION_CATALOG) {
      base[group.resource] = {
        ...(typeof base[group.resource] === 'object' && base[group.resource] !== null ? base[group.resource] : {}),
      };
      for (const action of group.actions) {
        (base[group.resource] as Record<string, boolean>)[action.key] = true;
      }
    }
  }
  return base;
}

function permissionEnabled(permissions: PermissionTree, resource: string, action: string) {
  if (permissions.all === true) return true;
  const group = permissions[resource];
  return typeof group === 'object' && group !== null && (group as Record<string, unknown>)[action] === true;
}

function togglePermission(permissions: PermissionTree, resource: string, action: string): PermissionTree {
  const next: PermissionTree = { ...permissions, all: false };
  const current = typeof next[resource] === 'object' && next[resource] !== null ? { ...(next[resource] as Record<string, boolean>) } : {};
  current[action] = !permissionEnabled(permissions, resource, action);
  next[resource] = current;
  return next;
}

function errorMessage(error: unknown, fallback: string) {
  const responseMessage = (error as { response?: { data?: { error?: string; details?: unknown } } })?.response?.data?.error;
  if (responseMessage) return responseMessage;
  if (error instanceof Error) return error.message;
  return fallback;
}

function sectorsFromWhatsAppWebhooks(channels: Awaited<ReturnType<typeof listChannels>>): Sector[] {
  const map = new Map<string, Sector>();
  for (const channel of channels.filter((c) => c.channel_type === 'whatsapp')) {
    const operational = parseChannelOperationalConfig(channel.config);
    for (const sector of operational.sectors.filter((s) => s.is_active !== false)) {
      map.set(sector.id, { id: sector.id, name: sector.name });
    }
    for (const queue of operational.queues) {
      for (const sectorId of queue.sector_ids) {
        if (!map.has(sectorId)) map.set(sectorId, { id: sectorId, name: sectorId });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function UserDetailPanel({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('profile');
  const [queueDraft, setQueueDraft] = useState<ChannelAssignmentRow[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [permissionsDraft, setPermissionsDraft] = useState<PermissionTree | null>(null);

  const userQuery = useQuery({ queryKey: ['user', userId], queryFn: () => getUser(userId) });
  const statsQuery = useQuery({ queryKey: ['user-stats', userId], queryFn: () => getUserStats(userId) });
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const queuesQuery = useQuery({
    queryKey: ['user-channel-assignments', userId],
    queryFn: () => getChannelAssignments(userId),
  });
  const channelsQuery = useQuery({ queryKey: ['integrations', 'channels'], queryFn: listChannels });

  const roleName = String(userQuery.data?.workspace_role || userQuery.data?.roles?.name || '').toLowerCase();
  const showQueues = roleName === 'attendant' || roleName === 'supervisor';
  const queueValue = queueDraft ?? queuesQuery.data ?? [];
  const webhookSectors = useMemo(() => sectorsFromWhatsAppWebhooks(channelsQuery.data || []), [channelsQuery.data]);
  const roleRecord = useMemo(
    () => (rolesQuery.data || []).find((role) => role.name === roleName || role.id === userQuery.data?.role_id),
    [roleName, rolesQuery.data, userQuery.data?.role_id]
  );
  const defaultPermissionsDraft = useMemo(() => {
    const permissions = roleRecord?.permissions || userQuery.data?.permissions || {};
    return normalizePermissionTree(permissions);
  }, [roleRecord?.permissions, userQuery.data?.permissions]);
  const permissionsValue = permissionsDraft ?? defaultPermissionsDraft;

  const saveQueuesMut = useMutation({
    mutationFn: async () => {
      await saveChannelAssignments(
        userId,
        queueValue.map((c) => ({
          workspace_channel_id: c.workspace_channel_id,
          enabled: c.enabled,
          sector_ids: c.sector_ids,
        }))
      );
    },
    onSuccess: async () => {
      setStatus('Filas salvas.');
      setQueueDraft(null);
      await qc.invalidateQueries({ queryKey: ['user-channel-assignments', userId] });
      await qc.invalidateQueries({ queryKey: ['user', userId] });
      await qc.invalidateQueries({ queryKey: ['users-full'] });
    },
    onError: (e) => setStatus(errorMessage(e, 'Falha ao salvar filas.')),
  });

  const passwordMut = useMutation({
    mutationFn: () => resetUserPassword(userId, { generate: true }),
    onSuccess: (data) => {
      setTempPassword(data.temporary_password || null);
      setStatus('Senha redefinida. O usuário deve trocar no próximo login.');
    },
    onError: (e) => setStatus(errorMessage(e, 'Falha ao redefinir senha.')),
  });

  const resendMut = useMutation({
    mutationFn: () => resendUserInvite(userId),
    onSuccess: (data) => {
      setTempPassword(data.temporary_password || null);
      setStatus(`Convite reenviado. Usuário: ${data.username}`);
    },
    onError: (e) => setStatus(errorMessage(e, 'Falha ao reenviar acesso.')),
  });

  const deleteMut = useMutation({
    mutationFn: () => deactivateUser(userId),
    onSuccess: async () => {
      setStatus('Usuário desativado.');
      await qc.invalidateQueries({ queryKey: ['users-full'] });
    },
    onError: (e) => setStatus(errorMessage(e, 'Falha ao desativar usuário.')),
  });

  const permissionsMut = useMutation({
    mutationFn: async () => {
      if (!roleRecord?.id) throw new Error('Perfil do workspace não encontrado.');
      await updateRolePermissions(roleRecord.id, permissionsValue as Record<string, unknown>);
    },
    onSuccess: async () => {
      setStatus('Permissões do perfil salvas. Usuários com este perfil precisam atualizar a sessão (sair e entrar ou recarregar a página) para aplicar na API.');
      setPermissionsDraft(null);
      await qc.invalidateQueries({ queryKey: ['roles'] });
      await qc.invalidateQueries({ queryKey: ['user', userId] });
    },
    onError: (e) => setStatus(errorMessage(e, 'Falha ao salvar permissões.')),
  });

  const tabs = useMemo(() => {
    const base: { id: Tab; label: string }[] = [
      { id: 'profile', label: 'Perfil' },
      { id: 'permissions', label: 'Perfis e Permissões' },
    ];
    if (showQueues) base.push({ id: 'queues', label: 'Filas WhatsApp' });
    base.push({ id: 'security', label: 'Segurança' });
    return base;
  }, [showQueues]);

  const data = userQuery.data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
      <Link href="/settings/users" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Usuários e Perfis
      </Link>

      <PageHeader
        eyebrow="Configurações"
        title={data?.name || 'Usuário'}
        description="Ficha do usuário no workspace."
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-md px-3 py-2 text-xs font-medium',
              tab === t.id ? 'bg-surface-elevated text-foreground' : 'text-muted-foreground hover:bg-surface-hover'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {userQuery.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
      {userQuery.isError ? <p className="text-sm text-destructive">Usuário não encontrado.</p> : null}

      {data && tab === 'profile' ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-6 text-sm">
            <Row label="E-mail" value={data.email || '—'} />
            <Row label="Telefone" value={formatBrazilPhone(data.phone || '') || '—'} />
            <Row label="Usuário de login" value={data.username || '—'} mono />
            <Row label="Perfil" value={roleDisplayNamePt(data.workspace_role || data.roles?.name)} />
            <Row label="Setores operacionais" value={data.operational_sector_labels?.length ? data.operational_sector_labels.join(', ') : '—'} />
            <Row label="Status" value={data.is_active !== false ? 'Ativo' : 'Inativo'} />
            {data.leaders?.name ? <Row label="Perfil líder" value={data.leaders.name} /> : null}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatCard label="Conversas (30d)" value={String(statsQuery.data?.conversations_handled ?? '—')} />
            <StatCard label="Msgs enviadas (30d)" value={String(statsQuery.data?.outbound_messages ?? '—')} />
            <StatCard
              label="Último login"
              value={
                statsQuery.data?.last_login_at
                  ? new Date(statsQuery.data.last_login_at).toLocaleString('pt-BR')
                  : '—'
              }
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void resendMut.mutate()}
              disabled={resendMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface-hover"
            >
              <Mail className="h-3.5 w-3.5" /> Reenviar convite
            </button>
            <button
              type="button"
              onClick={() => void passwordMut.mutate()}
              disabled={passwordMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface-hover"
            >
              <Key className="h-3.5 w-3.5" /> Redefinir senha
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Desativar este usuário no workspace?')) void deleteMut.mutate();
              }}
              disabled={deleteMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> Desativar
            </button>
          </div>

          {tempPassword ? (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 font-mono text-xs">
              Senha temporária: <strong>{tempPassword}</strong>
            </p>
          ) : null}
        </div>
      ) : null}

      {data && tab === 'queues' && showQueues ? (
        <div className="rounded-xl border border-border bg-surface p-6">
          {queuesQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando filas…</p>
          ) : (
            <>
              <FilasSetoresPicker
                channels={queueValue}
                sectors={webhookSectors}
                value={queueValue}
                onChange={setQueueDraft}
                perfil={roleName === 'supervisor' ? 'supervisor' : 'attendant'}
              />
              <button
                type="button"
                disabled={saveQueuesMut.isPending}
                onClick={() => void saveQueuesMut.mutate()}
                className="mt-4 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {saveQueuesMut.isPending ? 'Salvando…' : 'Salvar filas'}
              </button>
            </>
          )}
        </div>
      ) : null}

      {data && tab === 'permissions' ? (
        <div className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4" /> Perfis e Permissões
          </div>
          <p className="text-[11px] text-muted-foreground">
            Acesso definido pelo perfil <strong>{roleDisplayNamePt(data.workspace_role || data.roles?.name)}</strong> do workspace. Alterações abaixo afetam todos os usuários com este perfil neste workspace, não a plataforma inteira.
          </p>
          <div className="mt-4 grid gap-3">
            {PERMISSION_CATALOG.map((group) => (
              <div key={group.resource} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-foreground">{group.label}</div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{group.description}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {group.actions.map((action) => {
                      const enabled = permissionEnabled(permissionsValue, group.resource, action.key);
                      return (
                        <button
                          key={`${group.resource}.${action.key}`}
                          type="button"
                          onClick={() => setPermissionsDraft((current) => togglePermission(current ?? permissionsValue, group.resource, action.key))}
                          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] text-foreground hover:bg-surface-hover"
                        >
                          <span
                            className={cn(
                              'relative inline-flex h-4 w-7 items-center rounded-full transition-colors',
                              enabled ? 'bg-primary' : 'bg-muted'
                            )}
                          >
                            <span
                              className={cn(
                                'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                                enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                              )}
                            />
                          </span>
                          {action.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">Administrador aqui é o perfil administrador do workspace atual.</p>
            <button
              type="button"
              disabled={permissionsMut.isPending || !roleRecord?.id}
              onClick={() => void permissionsMut.mutate()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {permissionsMut.isPending ? 'Salvando…' : 'Salvar permissões'}
            </button>
          </div>
        </div>
      ) : null}

      {data && tab === 'security' ? (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm">
          <p className="text-muted-foreground">
            Sessões ativas são gerenciadas pelo provedor de autenticação. O perfil{' '}
            <strong>{roleDisplayNamePt(data.workspace_role || data.roles?.name)}</strong> define permissões no portal.
          </p>
          <ul className="mt-4 space-y-2 text-xs text-muted-foreground">
            <li>Provisionado: {data.provisioned_at ? new Date(data.provisioned_at).toLocaleString('pt-BR') : '—'}</li>
            <li>Último login: {data.last_login_at ? new Date(data.last_login_at).toLocaleString('pt-BR') : '—'}</li>
            <li>Troca de senha obrigatória: {data.username ? 'conforme política do workspace' : '—'}</li>
          </ul>
        </div>
      ) : null}

      {status || tempPassword ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {status}
          {tempPassword ? ` · Senha: ${tempPassword}` : ''}
        </p>
      ) : null}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/50 py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs' : 'font-medium'}>{value}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-elevated p-3">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
