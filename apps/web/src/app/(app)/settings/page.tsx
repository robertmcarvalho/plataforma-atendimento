'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useEffect, useMemo, useSyncExternalStore, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Bell,
  Bot,
  Building2,
  ChevronRight,
  ClipboardList,
  Headphones,
  Key,
  Layers,
  MessageSquare,
  Palette,
  Plus,
  Settings,
  Shield,
  Sparkles,
  User,
  Webhook,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { settingsPageApi } from '@/lib/settings/settingsPageApi';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { settingsNavItem } from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/Switch';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  SettingsAppearancePanel,
  SettingsApiTokensPanel,
  SettingsAuditPanel,
  SettingsChannelsPanel,
  SettingsNotificationsPanel,
  SettingsProfilePanel,
  SettingsRolesPanel,
  SettingsSecurityPolicyPanel,
  SettingsOperacaoPanel,
  SettingsServicePanel,
  SettingsTemplatesPanel,
  SettingsWorkspaceIdentityPanel,
} from '@/components/settings/settingsPanels';
import { BusinessHoursEditor } from '@/components/settings/BusinessHoursEditor';
import { SettingsMobileSectionPicker } from '@/components/settings/SettingsMobileSectionPicker';
import { useAuth } from '@/store/auth';
import { formatDateTimeBr } from '@/lib/datetimeBr';
import { roleDisplayNamePt } from '@/lib/roleLabels';
import { useRouter, useSearchParams } from 'next/navigation';
import { DEFAULT_AI_FEATURES, mergeAiFeatures, type AiFeaturesState } from '@/lib/ai/defaults';
import { BrPhoneInput } from '@/components/form/BrInputs';
import { normalizeBrazilPhone } from '@/lib/brFormat';
import { pageContainerClassName } from '@/lib/pageLayout';

// Avoid calling the API during `next build` prerendering.
const IS_BROWSER = typeof window !== 'undefined';

function defaultNewSectorBusinessHours(): Record<string, unknown> {
  return {
    timezone: 'America/Sao_Paulo',
    weekly: {
      monday: { is_open: true, intervals: [{ start: '09:00', end: '18:00' }] },
      tuesday: { is_open: true, intervals: [{ start: '09:00', end: '18:00' }] },
      wednesday: { is_open: true, intervals: [{ start: '09:00', end: '18:00' }] },
      thursday: { is_open: true, intervals: [{ start: '09:00', end: '18:00' }] },
      friday: { is_open: true, intervals: [{ start: '09:00', end: '18:00' }] },
      saturday: { is_open: false, intervals: [] },
      sunday: { is_open: false, intervals: [] },
    },
    holidays: [],
  };
}

function userHasCustomBusinessHours(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const weekly = (raw as Record<string, unknown>).weekly;
  if (!weekly || typeof weekly !== 'object') return false;
  return Object.keys(weekly as object).length > 0;
}

type SystemSettingsSection =
  | 'workspace'
  | 'profile'
  | 'channels'
  | 'notifications'
  | 'security_2fa'
  | 'api_tokens'
  | 'appearance';

type OpsSettingsSection =
  | 'operacao'
  | 'service'
  | 'automations'
  | 'ai'
  | 'templates'
  | 'users'
  | 'security';

type SettingsSection = SystemSettingsSection | OpsSettingsSection;

const SYSTEM_SETTINGS_SECTIONS: SystemSettingsSection[] = [
  'workspace',
  'profile',
  'channels',
  'notifications',
  'security_2fa',
  'api_tokens',
  'appearance',
];

const OPS_SETTINGS_SECTIONS: OpsSettingsSection[] = [
  'operacao',
  'service',
  'automations',
  'ai',
  'templates',
  'users',
  'security',
];

const ALL_SETTINGS_SECTIONS: SettingsSection[] = [...SYSTEM_SETTINGS_SECTIONS, ...OPS_SETTINGS_SECTIONS];

function settingsSectionsForRole(role: string | undefined): SettingsSection[] {
  const r = String(role || '').toLowerCase();
  if (r === 'leader') return [];
  const system = [...SYSTEM_SETTINGS_SECTIONS];
  if (r === 'admin') return [...system, ...OPS_SETTINGS_SECTIONS];
  if (r === 'supervisor') return [...system, 'operacao', 'automations', 'ai', 'templates'];
  return system;
}

function canViewSettingsSection(section: SettingsSection, ctx: { isAdmin: boolean; isSupervisor: boolean }): boolean {
  if (SYSTEM_SETTINGS_SECTIONS.includes(section as SystemSettingsSection)) return true;
  if (ctx.isAdmin) return OPS_SETTINGS_SECTIONS.includes(section as OpsSettingsSection);
  if (section === 'operacao') return ctx.isSupervisor || ctx.isAdmin;
  if (section === 'automations') return ctx.isSupervisor;
  if (section === 'templates') return ctx.isSupervisor;
  return false;
}

function cardTitleForSection(section: SettingsSection): string {
  const titles: Record<SettingsSection, string> = {
    workspace: 'Identidade do workspace',
    profile: 'Perfil',
    channels: 'Canais',
    notifications: 'Notificações',
    security_2fa: 'Segurança',
    api_tokens: 'API e Webhooks',
    appearance: 'Aparência',
    operacao: 'Operação',
    service: 'Atendimento',
    automations: 'Automações',
    ai: 'Inteligência Artificial',
    templates: 'Templates',
    users: 'Usuários e perfis',
    security: 'Segurança e auditoria',
  };
  return titles[section];
}

type NavDef = {
  key: SettingsSection;
  label: string;
  desc: string;
  icon: LucideIcon;
  count?: number | null;
};

function buildSystemNavDefs(): NavDef[] {
  return [
    { key: 'workspace', label: 'Workspace', desc: 'Nome, logo e identidade da empresa', icon: Building2 },
    { key: 'profile', label: 'Perfil', desc: 'Seus dados pessoais e preferências', icon: User },
    { key: 'channels', label: 'Canais', desc: 'WhatsApp, Instagram, e-mail e webchat', icon: MessageSquare },
    { key: 'notifications', label: 'Notificações', desc: 'Alertas na plataforma', icon: Bell },
    { key: 'security_2fa', label: 'Segurança', desc: '2FA, sessões e logs de acesso', icon: Shield },
    { key: 'api_tokens', label: 'API e Webhooks', desc: 'Tokens e integrações externas', icon: Webhook },
    { key: 'appearance', label: 'Aparência', desc: 'Tema e personalização visual', icon: Palette },
  ];
}

function showOpsDecisionSummary(section: SettingsSection): boolean {
  return ['automations', 'users'].includes(section);
}

function buildOpsNavDefs(counts: { templates: number; users: number }): NavDef[] {
  return [
    { key: 'automations', label: 'Automações', desc: 'Roteamento e bot (sem canvas)', icon: Bot, count: null },
    { key: 'operacao', label: 'Operação', desc: 'Checklists e SLA das tarefas operacionais', icon: ClipboardList, count: null },
    { key: 'service', label: 'Atendimento', desc: 'Assinatura global e preferências do chat', icon: Headphones, count: null },
    { key: 'ai', label: 'IA', desc: 'Habilitar/desabilitar capacidades por recurso', icon: Sparkles, count: null },
    { key: 'templates', label: 'Templates', desc: 'Mensagens e aprovação Meta', icon: Layers, count: counts.templates },
    { key: 'users', label: 'Usuários e perfis', desc: 'Atendentes, papéis e permissões de acesso', icon: Key, count: counts.users },
    { key: 'security', label: 'Auditoria', desc: 'RBAC e visão de segurança operacional', icon: Shield, count: null },
  ];
}

interface Sector {
  id: string;
  name: string;
  is_active: boolean;
  description?: string | null;
  business_hours?: Record<string, unknown>;
}

interface TemplateCountRow {
  id: string;
}

interface UserLite {
  id: string;
  name: string;
  is_active?: boolean;
}

interface RoleRecord {
  id: string;
  name: string;
  permissions?: Record<string, unknown>;
}

interface WorkspacePayload {
  display_name: string;
  slug: string;
  cnpj: string;
  logo_url: string;
  timezone: string;
}

interface UserRecord {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  is_active?: boolean;
  role_id?: string | null;
  sector_id?: string | null;
  user_sectors?: Array<{ sector_id: string; is_primary?: boolean; sectors?: { name: string } | null }>;
  business_hours?: Record<string, unknown> | null;
  roles?: { name: string } | null;
  sectors?: { name: string } | null;
  leaders?: { id: string; name: string } | null;
}

interface LeaderRecord {
  id: string;
  name: string;
}

function ModalShell({
  eyebrow,
  title,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] overflow-y-auto overscroll-contain bg-[rgba(20,25,30,0.28)] px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex min-h-[calc(100dvh-3rem)] w-full items-center justify-center">
        <div className="panel w-full max-w-2xl max-h-[min(90dvh,calc(100dvh-4rem))] overflow-y-auto rounded-[1.8rem] p-6 shadow-lg">
          <div className="mb-6 flex shrink-0 items-start justify-between gap-3">
            <div className="min-w-0 pr-2">
              <p className="eyebrow mb-2">{eyebrow}</p>
              <h3 className="text-2xl font-semibold text-foreground">
                {title}
              </h3>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} className="shrink-0" title="Fechar">
              <span className="text-base font-bold">x</span>
            </Button>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

function UserModal({
  roles,
  sectors,
  leaders,
  user,
  onClose,
  onSaved,
}: {
  roles: RoleRecord[];
  sectors: Sector[];
  leaders: LeaderRecord[];
  user?: UserRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [userTab, setUserTab] = useState<'geral' | 'horario'>('geral');
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    password: '',
    phone: user?.phone || '',
    role_id: user?.role_id || '',
    sector_ids: (user?.user_sectors?.map((x) => x.sector_id) ?? (user?.sector_id ? [user.sector_id] : [])) as string[],
    primary_sector_id:
      user?.user_sectors?.find((x) => x.is_primary)?.sector_id ?? user?.sector_id ?? '',
    leader_id: user?.leaders?.id || '',
  });
  const [customHours, setCustomHours] = useState(() => userHasCustomBusinessHours(user?.business_hours));
  const [businessHours, setBusinessHours] = useState<Record<string, unknown>>(() =>
    userHasCustomBusinessHours(user?.business_hours)
      ? { ...(user!.business_hours as Record<string, unknown>) }
      : defaultNewSectorBusinessHours(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const hoursPayload = customHours ? businessHours : {};

      const sectorPayload = {
        sector_ids: form.sector_ids,
        primary_sector_id: form.primary_sector_id || form.sector_ids[0] || undefined,
      };

      if (!user?.id) {
        const payload = {
          name: form.name.trim(),
          email: String(form.email || '').trim(),
          password: String(form.password || ''),
          phone: normalizeBrazilPhone(form.phone) || undefined,
          role_id: form.role_id,
          ...sectorPayload,
          leader_id: form.leader_id || undefined,
          business_hours: hoursPayload,
        };
        await settingsPageApi.createUser(payload);
      } else {
        const payload = {
          name: form.name.trim(),
          phone: normalizeBrazilPhone(form.phone) || undefined,
          role_id: form.role_id,
          ...sectorPayload,
          leader_id: form.leader_id || undefined,
          business_hours: hoursPayload,
        };
        await settingsPageApi.updateUser(user.id, payload);
      }

      onSaved();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'Falha ao salvar usuario.'));
    } finally {
      setSaving(false);
    }
  };

  const creating = !user?.id;

  return (
    <ModalShell eyebrow="Usuários" title={creating ? 'Novo usuário' : 'Editar usuário'} onClose={onClose}>
      <div className="mb-4 flex gap-2 border-b border-border pb-2">
        <button
          type="button"
          onClick={() => setUserTab('geral')}
          className={cn(
            'rounded-full px-4 py-2 text-sm font-medium transition-colors',
            userTab === 'geral' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          )}
        >
          Geral
        </button>
        <button
          type="button"
          onClick={() => setUserTab('horario')}
          className={cn(
            'rounded-full px-4 py-2 text-sm font-medium transition-colors',
            userTab === 'horario' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          )}
        >
          Horário do atendente
        </button>
      </div>

      {userTab === 'geral' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-2 lg:col-span-2">
            <span className="text-sm font-medium text-muted-foreground">
              Nome
            </span>
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              className="rounded-[1rem] border px-4 py-3 text-sm outline-none rounded-md border border-border bg-muted text-foreground"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              Email
            </span>
            <input
              value={form.email}
              disabled={!creating}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              className="rounded-[1rem] border px-4 py-3 text-sm outline-none disabled:opacity-70 rounded-md border border-border bg-muted text-foreground"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              Telefone
            </span>
            <BrPhoneInput
              value={form.phone}
              onChange={(phone) => setForm((prev) => ({ ...prev, phone }))}
              className="rounded-[1rem] border px-4 py-3 text-sm outline-none rounded-md border border-border bg-muted text-foreground"
            />
          </label>

          {creating ? (
            <label className="flex flex-col gap-2 lg:col-span-2">
              <span className="text-sm font-medium text-muted-foreground">
                Senha
              </span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                className="rounded-[1rem] border px-4 py-3 text-sm outline-none rounded-md border border-border bg-muted text-foreground"
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              Perfil
            </span>
            <FormSelect
              value={form.role_id}
              onChange={(v) => setForm((prev) => ({ ...prev, role_id: v }))}
              placeholder="Selecionar perfil"
              options={roles.map((r) => ({ value: r.id, label: roleDisplayNamePt(r.name) }))}
            />
          </label>

          <div className="flex flex-col gap-3 lg:col-span-2">
            <span className="text-sm font-medium text-muted-foreground">
              Setores (atendente pode ter vários)
            </span>
            <div className="flex flex-wrap gap-3">
              {sectors.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.sector_ids.includes(s.id)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setForm((prev) => {
                        let sector_ids = [...prev.sector_ids];
                        if (checked) {
                          if (!sector_ids.includes(s.id)) sector_ids.push(s.id);
                        } else {
                          sector_ids = sector_ids.filter((x) => x !== s.id);
                        }
                        let primary_sector_id = prev.primary_sector_id;
                        if (!sector_ids.includes(primary_sector_id)) {
                          primary_sector_id = sector_ids[0] || '';
                        }
                        return { ...prev, sector_ids, primary_sector_id };
                      });
                    }}
                  />
                  {s.name}
                </label>
              ))}
            </div>
            {form.sector_ids.length > 0 ? (
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Setor principal
                </span>
                <FormSelect
                  value={form.primary_sector_id}
                  onChange={(v) => setForm((prev) => ({ ...prev, primary_sector_id: v }))}
                  options={form.sector_ids.map((id) => {
                    const s = sectors.find((x) => x.id === id);
                    return { value: id, label: s?.name || id };
                  })}
                />
              </label>
            ) : null}
          </div>

          {roles.find((r) => r.id === form.role_id)?.name === 'leader' ? (
            <label className="flex flex-col gap-2 lg:col-span-2">
              <span className="text-sm font-medium text-muted-foreground">
                Perfil de líder vinculado
              </span>
              <FormSelect
                value={form.leader_id}
                onChange={(v) => setForm((prev) => ({ ...prev, leader_id: v }))}
                placeholder="Nao vinculado"
                options={leaders.map((l) => ({ value: l.id, label: l.name }))}
              />
            </label>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4">
          <label className="panel-muted flex items-center justify-between gap-3 rounded-[1rem] px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Usar horario proprio do atendente
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Desligado: nao restringe pelo horario individual (herda políticas de SLA sem bloquear roteamento por este JSON).
              </p>
            </div>
            <input
              type="checkbox"
              checked={customHours}
              onChange={(e) => setCustomHours(e.target.checked)}
            />
          </label>
          {customHours ? (
            <BusinessHoursEditor value={businessHours} onChange={setBusinessHours} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem grade individual: o sistema nao trata este usuario como &quot;fechado&quot; por ausência de weekly.
            </p>
          )}
        </div>
      )}

      {error ? (
        <div
          className="mt-4 rounded-md border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-muted px-4 py-3 text-sm font-medium text-muted-foreground"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={
            saving ||
            !form.name.trim() ||
            !form.role_id ||
            (creating && (!String(form.email || '').trim() || String(form.password || '').length < 6))
          }
          className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </ModalShell>
  );
}

function SettingsPageInner() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const [section, setSection] = useState<SettingsSection>('workspace');
  const searchParams = useSearchParams();
  const roleName = String(user?.role || '').toLowerCase();
  const isAdmin = roleName === 'admin';
  const isSupervisor = roleName === 'supervisor';

  const allowedSections = useMemo(() => settingsSectionsForRole(user?.role), [user?.role]);

  useEffect(() => {
    const wanted = searchParams.get('section');
    if (wanted === 'sectors') {
      router.replace('/settings?section=channels');
      return;
    }
    if (wanted === 'automations' && allowedSections.includes('automations')) {
      router.replace('/automacoes');
      return;
    }
    if (wanted === 'users' && isAdmin) {
      router.replace('/settings/users');
      return;
    }
    if (!wanted) return;
    if (!ALL_SETTINGS_SECTIONS.includes(wanted as SettingsSection)) return;
    if (allowedSections.includes(wanted as SettingsSection)) setSection(wanted as SettingsSection);
  }, [searchParams, allowedSections, isAdmin, router]);

  useEffect(() => {
    if (section === 'automations') router.replace('/automacoes');
  }, [section, router]);

  useEffect(() => {
    if (allowedSections.length === 0) return;
    if (!allowedSections.includes(section)) setSection(allowedSections[0]);
  }, [allowedSections, section]);

  const [editingUser, setEditingUser] = useState<UserRecord | undefined>(undefined);
  const [showUserModal, setShowUserModal] = useState(false);

  const [aiFeatures, setAiFeatures] = useState<AiFeaturesState>(DEFAULT_AI_FEATURES);
  const [aiFeaturesDraft, setAiFeaturesDraft] = useState<AiFeaturesState>(DEFAULT_AI_FEATURES);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsNote, setSettingsNote] = useState<{ tone: 'ok' | 'err'; message: string } | null>(null);
  const [settingsLastSavedAt, setSettingsLastSavedAt] = useState<string | null>(null);
  const [workspaceTimezoneDraft, setWorkspaceTimezoneDraft] = useState('America/Sao_Paulo');
  const [workspaceTzNote, setWorkspaceTzNote] = useState<{ tone: 'ok' | 'err'; message: string } | null>(null);
  const [workspaceIdentityDraft, setWorkspaceIdentityDraft] = useState({
    display_name: '',
    slug: '',
    cnpj: '',
    logo_url: '',
  });
  const [workspaceIdentityNote, setWorkspaceIdentityNote] = useState<{ tone: 'ok' | 'err'; message: string } | null>(
    null
  );
  const [savingWorkspaceIdentity, setSavingWorkspaceIdentity] = useState(false);

  const {
    data: workspaceData,
    isLoading: workspaceLoading,
    isError: workspaceQueryFailed,
    error: workspaceQueryErr,
    refetch: refetchWorkspace,
  } = useQuery<WorkspacePayload>({
    queryKey: ['workspace'],
    queryFn: async () => settingsPageApi.fetchWorkspace() as Promise<WorkspacePayload>,
    enabled: IS_BROWSER,
    staleTime: 45_000,
  });

  const workspaceLoadError = workspaceQueryFailed
    ? apiErrorMessage(workspaceQueryErr, 'Não foi possível carregar o workspace.')
    : null;

  useEffect(() => {
    if (!workspaceData) return;
    setWorkspaceIdentityDraft({
      display_name: workspaceData.display_name,
      slug: workspaceData.slug,
      cnpj: workspaceData.cnpj,
      logo_url: workspaceData.logo_url || '',
    });
    setWorkspaceTimezoneDraft(workspaceData.timezone);
  }, [workspaceData]);

  const { data: sectors = [] } = useQuery<Sector[]>({
    queryKey: ['sectors'],
    queryFn: async () => settingsPageApi.fetchSectors() as Promise<Sector[]>,
    enabled: IS_BROWSER && isAdmin && section === 'users',
  });
  const { data: templateItems = [] } = useQuery<TemplateCountRow[]>({
    queryKey: ['templates-all'],
    queryFn: async () => settingsPageApi.fetchTemplates() as Promise<TemplateCountRow[]>,
    enabled: IS_BROWSER && (isAdmin || isSupervisor),
  });
  useQuery<UserLite[]>({
    queryKey: ['users-lite'],
    queryFn: async () => settingsPageApi.fetchUsersLite() as Promise<UserLite[]>,
    enabled: IS_BROWSER && isAdmin,
  });
  const { data: usersFull = [], refetch: refetchUsers } = useQuery<UserRecord[]>({
    queryKey: ['users-full'],
    queryFn: async () => settingsPageApi.fetchUsers() as Promise<UserRecord[]>,
    enabled: IS_BROWSER && isAdmin,
  });
  const { data: roles = [] } = useQuery<RoleRecord[]>({
    queryKey: ['roles'],
    queryFn: async () => settingsPageApi.fetchRoles() as Promise<RoleRecord[]>,
    enabled: IS_BROWSER && isAdmin,
  });

  const { data: leadersData = [] } = useQuery<LeaderRecord[]>({
    queryKey: ['leaders-lite'],
    queryFn: async () => settingsPageApi.fetchLeaders() as Promise<LeaderRecord[]>,
    enabled: IS_BROWSER && section === 'users' && isAdmin,
  });

  const leaders = leadersData;

  const userHourQueries = useQueries({
    queries: usersFull.map((u) => ({
      queryKey: ['user-status', u.id] as const,
      queryFn: async () => {
        try {
          return settingsPageApi.fetchUserStatus(u.id) as Promise<{ is_open: boolean; next_open_at_label: string | null }>;
        } catch {
          return { is_open: true, next_open_at_label: null };
        }
      },
      enabled: IS_BROWSER && isAdmin && section === 'users',
      staleTime: 60_000,
      retry: false,
    })),
  });

  useQuery({
    queryKey: ['global-settings'],
    queryFn: async () => {
      const data = (await settingsPageApi.fetchSettings()) || {};
      const merged = mergeAiFeatures(data.ai_features_config);
      setAiFeatures(merged);
      setAiFeaturesDraft(merged);
      return data;
    },
    enabled: IS_BROWSER,
  });

  useEffect(() => {
    // Keep the draft aligned if the source value changes (first load / refetch).
    setAiFeaturesDraft(aiFeatures);
  }, [aiFeatures]);

  const updateGlobalSetting = async (key: string, value: unknown) => {
    setSavingSettings(true);
    setSettingsNote(null);
    try {
      await settingsPageApi.putSetting(key, value);
      setSettingsLastSavedAt(new Date().toISOString());
      setSettingsNote({ tone: 'ok', message: 'Configuracao salva.' });
      return true;
    } catch (err) {
      setSettingsNote({ tone: 'err', message: err instanceof Error ? err.message : 'Falha ao salvar configuracao.' });
      return false;
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleAiFeature = async (key: keyof AiFeaturesState) => {
    if (!isAdmin || savingSettings) return;
    const next = { ...aiFeaturesDraft, [key]: !aiFeaturesDraft[key] };
    setAiFeaturesDraft(next);
    const ok = await updateGlobalSetting('ai_features_config', next);
    if (ok) {
      setAiFeatures(next);
    } else {
      setAiFeaturesDraft(aiFeatures);
    }
  };

  const toggleUser = async (userId: string) => {
    await settingsPageApi.toggleUser(userId);
    await refetchUsers();
  };

  const systemNav = useMemo(
    () => buildSystemNavDefs().filter((i) => allowedSections.includes(i.key)),
    [allowedSections]
  );

  const opsNav = useMemo(
    () =>
      buildOpsNavDefs({
        templates: templateItems.length,
        users: usersFull.length,
      }).filter((i) => allowedSections.includes(i.key)),
    [allowedSections, templateItems.length, usersFull.length]
  );

  const saveWorkspaceTimezone = async () => {
    if (!isAdmin) return;
    setSavingSettings(true);
    setWorkspaceTzNote(null);
    try {
      await settingsPageApi.patchWorkspace({ timezone: workspaceTimezoneDraft });
      await queryClient.invalidateQueries({ queryKey: ['workspace'] });
      await queryClient.invalidateQueries({ queryKey: ['global-settings'] });
      setWorkspaceTzNote({ tone: 'ok', message: 'Fuso horário salvo.' });
    } catch (err) {
      setWorkspaceTzNote({ tone: 'err', message: apiErrorMessage(err, 'Não foi possível salvar o fuso horário.') });
    } finally {
      setSavingSettings(false);
    }
  };

  const saveWorkspaceIdentity = async () => {
    if (!isAdmin) return;
    setSavingWorkspaceIdentity(true);
    setWorkspaceIdentityNote(null);
    try {
      await settingsPageApi.patchWorkspace({
        display_name: workspaceIdentityDraft.display_name.trim(),
        slug: workspaceIdentityDraft.slug.trim(),
        cnpj: workspaceIdentityDraft.cnpj.trim(),
        logo_url: workspaceIdentityDraft.logo_url.trim(),
      });
      await refetchWorkspace();
      await refreshUser();
      setWorkspaceIdentityNote({ tone: 'ok', message: 'Identidade do workspace atualizada.' });
    } catch (err) {
      setWorkspaceIdentityNote({
        tone: 'err',
        message: apiErrorMessage(err, 'Não foi possível salvar a identidade do workspace.'),
      });
    } finally {
      setSavingWorkspaceIdentity(false);
    }
  };

  const allNavItems = useMemo(() => [...systemNav, ...opsNav], [systemNav, opsNav]);

  const sectionPickerOptions = useMemo(
    () =>
      allNavItems.map((item) => ({
        value: item.key,
        label: item.label,
      })),
    [allNavItems],
  );

  const handleSectionPickerChange = (key: string) => {
    if (key === 'automations') {
      router.push('/automacoes');
      return;
    }
    if (key === 'users' && isAdmin) {
      router.push('/settings/users');
      return;
    }
    setSection(key as SettingsSection);
  };

  if (allowedSections.length === 0) {
    return (
      <div className="mx-auto flex min-h-[320px] max-w-lg flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-surface p-10 text-center shadow-sm">
        <AlertTriangle className="h-10 w-10 text-amber-600" />
        <div>
          <p className="text-lg font-semibold tracking-tight text-foreground">Configurações indisponíveis</p>
          <p className="mt-2 text-sm text-muted-foreground">
            O portal do líder não inclui esta área. Para configurações do workspace, use outro perfil (atendente, operacional, financeiro, supervisor ou administrador).
          </p>
        </div>
      </div>
    );
  }

  const renderNavItem = (item: NavDef) => {
    const Icon = item.icon;
    const active = section === item.key;
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => {
          if (item.key === 'automations') {
            router.push('/automacoes');
            return;
          }
          if (item.key === 'users' && isAdmin) {
            router.push('/settings/users');
            return;
          }
          setSection(item.key);
        }}
        className={settingsNavItem(active)}
      >
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
            active
              ? 'bg-primary/15 text-primary'
              : 'bg-muted text-muted-foreground group-hover:bg-primary/15 group-hover:text-primary'
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{item.label}</span>
            {typeof item.count === 'number' ? (
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                {item.count}
              </span>
            ) : null}
          </div>
          <div className="truncate text-[10px] text-subtle-foreground">{item.desc}</div>
        </div>
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 transition-colors', active ? 'text-primary' : 'text-subtle-foreground')}
        />
      </button>
    );
  };

  return (
    <>
      <div className="h-full min-h-0 overflow-y-auto">
        <div className={pageContainerClassName}>
          <PageHeader
            icon={Settings}
            eyebrow="Sistema"
            title="Configurações"
            description="Gerencie workspace, canais, segurança e integrações."
          />

          <SettingsMobileSectionPicker
            value={section}
            onChange={handleSectionPickerChange}
            options={sectionPickerOptions}
          />

          <div className="grid grid-cols-12 gap-6">
            <nav className="col-span-12 hidden space-y-0.5 lg:block lg:col-span-4 xl:col-span-3">
              {systemNav.map(renderNavItem)}
              {opsNav.length > 0 ? (
                <>
                  <div className="my-4 border-t border-border pt-3" />
                  <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Operação</p>
                  {opsNav.map(renderNavItem)}
                </>
              ) : null}
            </nav>

            <div className="col-span-12 flex min-h-0 min-w-0 flex-col gap-4 lg:col-span-8 xl:col-span-9">
              <div className="flex flex-wrap justify-end gap-2">
              {isAdmin && section === 'users' ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingUser(undefined);
                    setShowUserModal(true);
                  }}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Plus size={14} />
                    Novo usuário
                  </span>
                </button>
              ) : null}
              </div>

              <div
                className={cn(
                  'flex flex-col overflow-hidden lg:max-h-[min(70vh,calc(100dvh-10.5rem))]',
                  section !== 'templates' && section !== 'service' && 'rounded-xl border border-border bg-surface shadow-sm',
                )}
              >
                {section !== 'templates' && section !== 'service' ? (
                <div className="shrink-0 border-b border-border/60 bg-surface px-5 py-4">
                  <h2 className="text-sm font-semibold tracking-tight text-foreground">{cardTitleForSection(section)}</h2>
                </div>
                ) : null}
                <div className={cn('min-h-0 flex-1 overflow-y-auto', section === 'templates' || section === 'service' ? 'p-0' : 'px-5 py-4')}>
                  <div className={section === 'templates' || section === 'service' ? '' : 'space-y-5'}>
            {!canViewSettingsSection(section, { isAdmin, isSupervisor }) ? (
              <div className="p-4">
                <div className="flex items-start gap-3 rounded-md border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
                  <AlertTriangle size={18} style={{ marginTop: 2 }} />
                  <div className="min-w-0">
                    <p className="font-semibold">Acesso restrito</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Secao nao permitida para o seu perfil (<span className="font-semibold">{user?.role || 'desconhecido'}</span>). Administradores veem todas as secoes (incluindo <span className="font-semibold">Usuários e perfis</span> em Operação); supervisores veem templates, automações e IA.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {section === 'workspace' ? (
                  <SettingsWorkspaceIdentityPanel
                    workspaceName={workspaceIdentityDraft.display_name}
                    slug={workspaceIdentityDraft.slug}
                    cnpj={workspaceIdentityDraft.cnpj}
                    logoUrl={workspaceIdentityDraft.logo_url}
                    timezone={workspaceTimezoneDraft}
                    onTimezoneChange={setWorkspaceTimezoneDraft}
                    canEditTimezone={isAdmin}
                    onSaveTimezone={() => void saveWorkspaceTimezone()}
                    saving={savingSettings}
                    note={workspaceTzNote?.message ?? null}
                    noteTone={workspaceTzNote?.tone}
                    canEditIdentity={isAdmin}
                    onWorkspaceNameChange={(v) => setWorkspaceIdentityDraft((d) => ({ ...d, display_name: v }))}
                    onSlugChange={(v) => setWorkspaceIdentityDraft((d) => ({ ...d, slug: v }))}
                    onCnpjChange={(v) => setWorkspaceIdentityDraft((d) => ({ ...d, cnpj: v }))}
                    onLogoUrlChange={(v) => setWorkspaceIdentityDraft((d) => ({ ...d, logo_url: v }))}
                    onSaveIdentity={() => void saveWorkspaceIdentity()}
                    identitySaving={savingWorkspaceIdentity}
                    identityNote={workspaceIdentityNote?.message ?? null}
                    identityNoteTone={workspaceIdentityNote?.tone}
                    loading={workspaceLoading}
                    loadError={workspaceLoadError}
                    onRetryLoad={() => void refetchWorkspace()}
                  />
                ) : section === 'profile' ? (
                  <SettingsProfilePanel />
                ) : section === 'channels' ? (
                  <SettingsChannelsPanel isAdmin={isAdmin} />
                ) : section === 'notifications' ? (
                  <SettingsNotificationsPanel />
                ) : section === 'security_2fa' ? (
                  <SettingsSecurityPolicyPanel />
                ) : section === 'api_tokens' ? (
                  <SettingsApiTokensPanel />
                ) : section === 'appearance' ? (
                  <SettingsAppearancePanel />
                ) : section === 'operacao' ? (
                  <SettingsOperacaoPanel isAdmin={isAdmin} />
                ) : section === 'service' ? (
              <SettingsServicePanel />
            ) : section === 'ai' ? (
              <div>
                <p className="text-xs text-muted-foreground">
                  Capacidades de IA aplicadas ao runtime do workspace. A interface também respeita flags
                  <span className="font-mono"> NEXT_PUBLIC_*</span> quando aplicável.
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Chave: <span className="font-mono text-foreground">ai_features_config</span>
                </p>
                {!isAdmin ? (
                  <p className="mt-2 text-xs font-medium text-amber-500">
                    Somente administradores podem alterar estas opções.
                  </p>
                ) : null}

                <div className="mt-4 space-y-4">
                  {(
                    [
                      {
                        key: 'sentiment',
                        label: 'Sentimento',
                        desc: 'Análise de sentimento em mensagens inbound.',
                      },
                      {
                        key: 'urgency',
                        label: 'Urgência',
                        desc: 'Classificação de urgência em mensagens inbound.',
                      },
                      {
                        key: 'suggest_reply',
                        label: 'Sugerir resposta',
                        desc: 'Habilita o endpoint e o botão de sugestão no composer.',
                      },
                      {
                        key: 'inbound_assist',
                        label: 'Briefing automático do Copiloto',
                        desc: 'Gera resumo, timeline operacional, próximos passos e rascunho no Copiloto interno.',
                      },
                      {
                        key: 'nps_predicted',
                        label: 'NPS preditivo',
                        desc: 'Estimativa NPS ao encerrar uma conversa.',
                      },
                    ] as const
                  ).map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between border-b border-border/50 pb-4 last:border-0 last:pb-0"
                    >
                      <div>
                        <div className="text-sm font-medium text-foreground">{item.label}</div>
                        <div className="text-[11px] text-muted-foreground">{item.desc}</div>
                      </div>
                      <Switch
                        checked={aiFeaturesDraft[item.key]}
                        disabled={!isAdmin || savingSettings}
                        onCheckedChange={() => void toggleAiFeature(item.key)}
                        aria-label={item.label}
                      />
                    </div>
                  ))}
                </div>
                {settingsNote ? (
                  <p className={cn('mt-3 text-xs font-medium', settingsNote.tone === 'ok' ? 'text-emerald-500' : 'text-destructive')}>
                    {settingsNote.message}
                  </p>
                ) : null}
              </div>
            ) : section === 'templates' ? (
              <SettingsTemplatesPanel />
            ) : section === 'users' ? (
              <>
              <div className="overflow-x-auto rounded-lg border border-border/60 bg-muted/30">
              <table className="workspace-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Perfil</th>
                    <th>Setor</th>
                    <th>Status</th>
                    <th>Horario</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {usersFull.map((u, idx) => (
                    <tr key={u.id} className="border-b border-border hover:bg-sidebar-accent/60">
                      <td className="px-3 py-2 align-middle">
                        <p className="text-sm font-semibold text-foreground">
                          {u.name}
                        </p>
                        <p className="mt-1 text-[11px] text-subtle-foreground">
                          {u.email || '-'}
                        </p>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <span className="text-sm text-muted-foreground">
                          {u.roles?.name ? roleDisplayNamePt(u.roles.name) : '-'}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <span className="text-sm text-muted-foreground">
                          {u.sectors?.name || sectors.find((s) => s.id === u.sector_id)?.name || '-'}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold',
                            u.is_active !== false ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {u.is_active !== false ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        {(() => {
                          const qh = userHourQueries[idx]?.data;
                          if (!qh) {
                            return (
                              <span className="text-xs text-muted-foreground">
                                ...
                              </span>
                            );
                          }
                          return (
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold',
                                qh.is_open ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
                              )}
                              title={qh.next_open_at_label || undefined}
                            >
                              {qh.is_open ? 'Aberto' : 'Fechado'}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            onClick={() => {
                              setEditingUser(u);
                              setShowUserModal(true);
                            }}
                            variant="ghost"
                            size="icon-sm"
                            title="Editar"
                          >
                            <Settings size={16} />
                          </Button>
                          <Button
                            type="button"
                            onClick={() => void toggleUser(u.id)}
                            variant="secondary"
                            style={{ padding: '0.55rem 0.75rem' }}
                          >
                            {u.is_active !== false ? 'Desativar' : 'Ativar'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {isAdmin ? <SettingsRolesPanel /> : null}
              </>
            ) : section === 'security' ? (
              <SettingsAuditPanel />
            ) : (
              <div className="rounded-xl border border-border bg-muted/20 p-6">
                <div className="rounded-xl border border-border bg-surface p-6">
                  <p className="text-sm font-semibold tracking-tight text-foreground">Secção</p>
                  <p className="mt-1 text-xs text-muted-foreground">Conteúdo em preparação.</p>
                </div>
              </div>
            )}

                {showOpsDecisionSummary(section) ? (
                <div className="space-y-4 border-t border-border pt-6">
            {section === 'ai' ? (
              <div className="grid gap-3">
                <div className="rounded-xl border border-border bg-muted/20 p-6">
                  <p className="eyebrow mb-2">Mudancas</p>
                  <p className="text-sm font-semibold text-foreground">
                    Capacidades de IA (runtime)
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    sentiment: {aiFeaturesDraft.sentiment ? 'on' : 'off'} · urgency: {aiFeaturesDraft.urgency ? 'on' : 'off'} · suggest_reply:{' '}
                    {aiFeaturesDraft.suggest_reply ? 'on' : 'off'} · briefing_copilot: {aiFeaturesDraft.inbound_assist ? 'on' : 'off'} · nps_predicted:{' '}
                    {aiFeaturesDraft.nps_predicted ? 'on' : 'off'}
                  </p>
                  <p className="mt-3 text-xs text-subtle-foreground">
                    Impacto: afeta execução do orchestrator e disponibilidade de recursos/insights na UI.
                  </p>
                  {settingsLastSavedAt ? (
                    <p className="mt-2 text-xs mono text-subtle-foreground">
                      ultimo update: {formatDateTimeBr(settingsLastSavedAt)}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <Button
                    type="button"
                    disabled={!isAdmin || savingSettings || JSON.stringify(aiFeaturesDraft) === JSON.stringify(aiFeatures)}
                    onClick={() => void (async () => {
                      const ok = await updateGlobalSetting('ai_features_config', aiFeaturesDraft);
                      if (ok) setAiFeatures(aiFeaturesDraft);
                    })()}
                  >
                    {savingSettings ? 'Salvando...' : isAdmin ? 'Salvar' : 'Somente admin'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={savingSettings || JSON.stringify(aiFeaturesDraft) === JSON.stringify(aiFeatures)}
                    onClick={() => {
                      setAiFeaturesDraft(aiFeatures);
                      setSettingsNote(null);
                    }}
                  >
                    Desfazer
                  </Button>
                  {settingsNote ? (
                    <p className={cn('text-xs font-semibold', settingsNote.tone === 'ok' ? 'text-success' : 'text-destructive')}>
                      {settingsNote.message}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : section === 'users' ? (
              <div className="grid gap-3">
                <div className="panel-muted rounded-[1.1rem] p-4">
                  <p className="eyebrow mb-2">Acoes</p>
                  <Button
                    type="button"
                    onClick={() => {
                      setEditingUser(undefined);
                      setShowUserModal(true);
                    }}
                    className="w-full"
                  >
                    <Plus size={16} />
                    Novo usuário
                  </Button>
                </div>
                <div className="panel-muted rounded-[1.1rem] p-4">
                  <p className="eyebrow mb-2">Recorte</p>
                  <p className="text-sm font-semibold text-foreground">
                    {usersFull.filter((u) => u.is_active !== false).length} ativos / {usersFull.length} total
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="panel-muted rounded-[1.1rem] p-4">
                  <p className="eyebrow mb-2">Proximo</p>
                  <p className="text-sm font-semibold text-foreground">
                    Consolidar usuarios/roles/auditoria
                  </p>
                </div>
              </div>
            )}
                </div>
                ) : null}
              </>
            )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showUserModal ? (
        <UserModal
          key={editingUser?.id || 'new-user'}
          roles={roles}
          sectors={sectors}
          leaders={leaders}
          user={editingUser}
          onClose={() => setShowUserModal(false)}
          onSaved={() => void refetchUsers()}
        />
      ) : null}
    </>
  );
}

export default function SettingsPage() {
  // Next.js requires `useSearchParams()` to be wrapped in a Suspense boundary.
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">
          Carregando configuracoes...
        </div>
      }
    >
      <SettingsPageInner />
    </Suspense>
  );
}
