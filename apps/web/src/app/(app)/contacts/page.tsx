'use client';

import { contactsPageApi } from '@/lib/contacts/contactsPageApi';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { ContactRound, Download, Filter, MoreHorizontal, Plus, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterSheet } from '@/components/ui/FilterSheet';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { DEFAULT_LIST_PAGE_SIZE, PaginationControls } from '@/components/ui/PaginationControls';
import {
  interactiveRowMuted,
  interactiveRowPrimary,
  interactiveRowSecondary,
  interactiveRowSurface,
  semanticPillClass,
} from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';
import {
  reviveKpiCardClassName,
  reviveTableHeadRowClassName,
  reviveTableShellClassName,
  reviveToolbarButtonClassName,
} from '@/lib/reviveSurfaces';
import { useAuth } from '@/store/auth';
import { canManageContacts } from '@/lib/contactPermissions';
import { BrPhoneInput } from '@/components/form/BrInputs';
import { FormControl } from '@/components/form/FormControl';
import { CadastroSearchCombobox } from '@/components/cadastro/CadastroSearchCombobox';
import { FormSelect } from '@/components/form/FormSelect';
import { normalizeBrazilPhone, formatBrazilPhone } from '@/lib/brFormat';
import { formatDateTimeBr } from '@/lib/datetimeBr';
import { pageContainerClassName } from '@/lib/pageLayout';
import { useIsLgUp } from '@/hooks/useMediaQuery';

type ContactProfile = 'driver' | 'pharmacy' | 'leader' | 'partner' | 'unknown';
type ContactProfileFilter = ContactProfile | 'all';
type BlockedFilter = 'all' | 'true' | 'false';

type ApiContact = {
  id: string;
  wa_phone: string;
  display_name: string | null;
  profile_type: ContactProfile;
  is_blocked: boolean;
  created_at: string;
  updated_at: string;
  driver?: { id: string; name: string | null; phone: string | null } | null;
  pharmacy?: { id: string; trade_name: string | null; phone: string | null } | null;
  leader?: { id: string; name: string | null; phone: string | null } | null;
};

type ApiDriver = { id: string; name: string; phone: string };
type ApiPharmacy = { id: string; trade_name: string; phone?: string | null };
type ApiLeader = { id: string; name: string; phone: string };

function initials(input: string) {
  const trimmed = (input || '').trim();
  if (!trimmed) return '??';
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

function yyyyMm(input: string) {
  const d = new Date(input);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isWithinDays(input: string, days: number) {
  const d = new Date(input).getTime();
  if (!Number.isFinite(d)) return false;
  return Date.now() - d <= days * 24 * 60 * 60 * 1000;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const headers = Array.from(
    rows.reduce((acc, r) => {
      for (const k of Object.keys(r)) acc.add(k);
      return acc;
    }, new Set<string>())
  );
  const esc = (v: unknown) => {
    const raw = v === null || v === undefined ? '' : String(v);
    const needs = /[",\n]/.test(raw);
    const escaped = raw.replace(/"/g, '""');
    return needs ? `"${escaped}"` : escaped;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function profileLabel(p: ContactProfile) {
  if (p === 'driver') return 'Entregador';
  if (p === 'pharmacy') return 'Farmácia';
  if (p === 'leader') return 'Líder';
  if (p === 'partner') return 'Parceiro';
  return 'Desconhecido';
}

function profileTone(p: ContactProfile) {
  if (p === 'driver') return 'bg-primary/15 text-primary border-primary/30';
  if (p === 'pharmacy') return 'bg-success/15 text-success border-success/30';
  if (p === 'leader') return 'bg-warning/15 text-warning border-warning/30';
  if (p === 'partner') return 'bg-channel-whatsapp/15 text-channel-whatsapp border-channel-whatsapp/30';
  return 'bg-muted text-muted-foreground border-border';
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-md">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="text-sm font-semibold tracking-tight">{title}</div>
          <button onClick={onClose} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground">
            Fechar
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const isLgUp = useIsLgUp();
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const user = useAuth((s) => s.user);
  const canFetch = hasHydrated && isAuthenticated;
  const canManage = canManageContacts(user?.role, user?.permissions);

  const [q, setQ] = useState('');
  const [profile, setProfile] = useState<ContactProfileFilter>('all');
  const [blocked, setBlocked] = useState<BlockedFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ApiContact | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formProfile, setFormProfile] = useState<ContactProfile>('unknown');
  const [formDriverId, setFormDriverId] = useState<string>('');
  const [formPharmacyId, setFormPharmacyId] = useState<string>('');
  const [formLeaderId, setFormLeaderId] = useState<string>('');
  const [formBlocked, setFormBlocked] = useState(false);

  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const contactsQuery = useQuery({
    queryKey: ['contacts', { q, profile, blocked }],
    enabled: canFetch,
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (q.trim()) params.search = q.trim();
      if (profile !== 'all') params.profile_type = profile;
      if (blocked !== 'all') params.blocked = blocked;
      const res = await contactsPageApi.list(params);
      return res.data as ApiContact[];
    },
  });

  const driversQuery = useQuery({
    queryKey: ['contacts', 'drivers'],
    enabled: canFetch && editorOpen && formProfile === 'driver',
    queryFn: async () => await contactsPageApi.fetchDrivers() as ApiDriver[],
  });

  const pharmaciesQuery = useQuery({
    queryKey: ['contacts', 'pharmacies'],
    enabled: canFetch && editorOpen && formProfile === 'pharmacy',
    queryFn: async () => await contactsPageApi.fetchPharmacies() as ApiPharmacy[],
  });

  const leadersQuery = useQuery({
    queryKey: ['contacts', 'leaders'],
    enabled: canFetch && editorOpen && formProfile === 'leader',
    queryFn: async () => await contactsPageApi.fetchLeaders() as ApiLeader[],
  });

  const items = useMemo(() => contactsQuery.data ?? [], [contactsQuery.data]);
  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * DEFAULT_LIST_PAGE_SIZE;
    return items.slice(start, start + DEFAULT_LIST_PAGE_SIZE);
  }, [currentPage, items]);

  const stats = useMemo(() => {
    const total = items.length;
    const currentYm = yyyyMm(new Date().toISOString());
    const newThisMonth = items.filter((c) => yyyyMm(c.created_at) === currentYm).length;
    const active30d = items.filter((c) => isWithinDays(c.updated_at || c.created_at, 30)).length;
    const blockedCount = items.filter((c) => c.is_blocked).length;
    return { total, newThisMonth, active30d, blockedCount };
  }, [items]);

  useEffect(() => {
    setCurrentPage(1);
  }, [q, profile, blocked]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(items.length / DEFAULT_LIST_PAGE_SIZE));
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, items.length]);

  useEffect(() => {
    if (!menu) return;
    const onClick = (e: MouseEvent) => {
      const el = menuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setMenu(null);
    };
    window.addEventListener('mousedown', onClick);
    const onResize = () => setMenu(null);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('resize', onResize);
    };
  }, [menu]);

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormPhone('');
    setFormProfile('unknown');
    setFormDriverId('');
    setFormPharmacyId('');
    setFormLeaderId('');
    setFormBlocked(false);
    setSaveError(null);
    setEditorOpen(true);
  };

  const openEdit = (c: ApiContact) => {
    setEditing(c);
    setFormName(c.display_name || '');
    setFormPhone(c.wa_phone || '');
    setFormProfile(c.profile_type || 'unknown');
    setFormDriverId(c.driver?.id || '');
    setFormPharmacyId(c.pharmacy?.id || '');
    setFormLeaderId(c.leader?.id || '');
    setFormBlocked(Boolean(c.is_blocked));
    setSaveError(null);
    setEditorOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formPhone.trim()) return;
    const phoneDigits = normalizeBrazilPhone(formPhone);
    if (!phoneDigits || phoneDigits.length < 12) {
      setSaveError('Telefone inválido (inclua DDD).');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload: {
        wa_phone: string;
        display_name: string | null;
        profile_type: ContactProfile;
        is_blocked: boolean;
        driver_id?: string | null;
        pharmacy_id?: string | null;
        leader_id?: string | null;
      } = {
        wa_phone: phoneDigits,
        display_name: formName.trim() || null,
        profile_type: formProfile,
        is_blocked: formBlocked,
      };
      if (formProfile === 'driver') payload.driver_id = formDriverId || null;
      if (formProfile === 'pharmacy') payload.pharmacy_id = formPharmacyId || null;
      if (formProfile === 'leader') payload.leader_id = formLeaderId || null;

      if (editing) await contactsPageApi.update(editing.id, payload);
      else await contactsPageApi.create(payload);

      setEditorOpen(false);
      setEditing(null);
      await contactsQuery.refetch();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSaveError(msg || 'Falha ao salvar contato.');
    } finally {
      setSaving(false);
    }
  };

  const toggleBlock = async (c: ApiContact) => {
    try {
      await contactsPageApi.toggleBlock(c.id, !c.is_blocked);
      await contactsQuery.refetch();
    } catch {
      // ignore
    }
  };

  const exportNow = () => {
    const rows = items.map((c) => ({
      id: c.id,
      name: c.display_name || '',
      wa_phone: c.wa_phone,
      profile_type: c.profile_type,
      blocked: c.is_blocked ? 'true' : 'false',
      created_at: c.created_at,
      updated_at: c.updated_at,
    }));
    downloadCsv(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const filtersForm = (
    <div className="space-y-3">
      <div>
        <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Perfil</label>
        <FormSelect
          value={profile}
          onChange={(v) => setProfile(v as ContactProfileFilter)}
          size="sm"
          className="mt-1"
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'unknown', label: 'Desconhecido' },
            { value: 'driver', label: 'Entregador' },
            { value: 'pharmacy', label: 'Farmácia' },
            { value: 'leader', label: 'Líder' },
            { value: 'partner', label: 'Parceiro' },
          ]}
        />
      </div>
      <div>
        <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Bloqueado</label>
        <FormSelect
          value={blocked}
          onChange={(v) => setBlocked(v as BlockedFilter)}
          size="sm"
          className="mt-1"
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'false', label: 'Não bloqueado' },
            { value: 'true', label: 'Bloqueado' },
          ]}
        />
      </div>
    </div>
  );

  const renderContactActions = (c: ApiContact) =>
    canManage ? (
      <button
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
          setMenu((cur) => (cur?.id === c.id ? null : { id: c.id, x: rect.right, y: rect.bottom }));
        }}
        className="flex max-lg:min-h-11 max-lg:min-w-11 items-center justify-center rounded hover:bg-sidebar-accent/60"
        title="Ações"
      >
        <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    ) : null;

  const menuContact = menu ? items.find((c) => c.id === menu.id) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className={pageContainerClassName}>
        <PageHeader
          icon={ContactRound}
          eyebrow="CRM"
          title="Contatos"
          description="Base unificada de contatos (WhatsApp)."
          actions={
            <>
              <Button type="button" variant="outline" size="sm" onClick={exportNow}>
                <Download className="h-3.5 w-3.5" /> Exportar
              </Button>
              {canManage ? (
                <Button type="button" size="sm" onClick={openCreate}>
                  <Plus className="h-3.5 w-3.5" /> Novo contato
                </Button>
              ) : null}
            </>
          }
        />

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Total de contatos', value: String(stats.total) },
            { label: 'Novos este mês', value: String(stats.newThisMonth), accent: stats.newThisMonth ? 'text-success' : undefined },
            { label: 'Ativos (30d)', value: String(stats.active30d) },
            { label: 'Bloqueados', value: String(stats.blockedCount), accent: stats.blockedCount ? 'text-warning' : undefined },
          ].map((s) => (
            <div key={s.label} className={reviveKpiCardClassName}>
              <div className={cn('text-xl font-semibold tracking-tight', s.accent)}>{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        <ListToolbar
          searchValue={q}
          onSearchChange={setQ}
          searchPlaceholder="Buscar por nome ou telefone..."
        >
          <div className="relative">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className={cn(reviveToolbarButtonClassName, 'flex max-lg:min-h-11 items-center gap-1.5')}
              aria-expanded={filtersOpen}
            >
              <Filter className="h-3.5 w-3.5" /> Filtros
            </button>
            {filtersOpen && isLgUp ? (
              <div className="absolute right-0 top-11 z-30 w-64 rounded-xl border border-border bg-surface p-3 shadow-md">
                <div className="text-xs font-semibold">Filtros</div>
                <div className="mt-2">{filtersForm}</div>
                <div className="pt-2">
                  <button
                    onClick={() => {
                      setProfile('all');
                      setBlocked('all');
                      setFiltersOpen(false);
                    }}
                    className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  >
                    Limpar
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="relative">
            <button
              onClick={() => setProfileMenuOpen((v) => !v)}
              className={cn(reviveToolbarButtonClassName, 'flex items-center gap-1.5')}
              aria-expanded={profileMenuOpen}
            >
              <Tag className="h-3.5 w-3.5" /> Tipos
            </button>
            {profileMenuOpen ? (
              <div className="absolute right-0 top-11 z-30 w-44 rounded-xl border border-border bg-surface p-1 shadow-md">
                {(['all', 'unknown', 'driver', 'pharmacy', 'leader'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setProfile(p);
                      setProfileMenuOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-sidebar-accent/60',
                      profile === p ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <span>{p === 'all' ? 'Todos' : profileLabel(p)}</span>
                    {profile === p ? <span className="font-mono text-[10px] text-primary">✓</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </ListToolbar>

        {contactsQuery.isError ? <div className="mb-3 text-xs text-destructive">Falha ao carregar contatos.</div> : null}

        {!isLgUp ? (
          <FilterSheet
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            onClear={() => {
              setProfile('all');
              setBlocked('all');
            }}
          >
            {filtersForm}
          </FilterSheet>
        ) : null}

        {/* Mobile card list */}
        <div className="space-y-2 lg:hidden">
          {contactsQuery.isLoading ? (
            <div className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted-foreground">Carregando…</div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted-foreground">Nenhum contato encontrado.</div>
          ) : (
            pagedItems.map((c) => {
              const displayName = c.display_name || '—';
              const linkName =
                c.profile_type === 'driver'
                  ? c.driver?.name || '—'
                  : c.profile_type === 'pharmacy'
                    ? c.pharmacy?.trade_name || '—'
                    : c.profile_type === 'leader'
                      ? c.leader?.name || '—'
                      : '—';
              return (
                <div
                  key={c.id}
                  className={cn('rounded-xl border border-border bg-surface px-4 py-3', interactiveRowSurface())}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 to-channel-instagram/40 text-[11px] font-semibold">
                      {initials(displayName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-sm font-medium', interactiveRowPrimary())}>{displayName}</div>
                      <div className={cn('font-mono text-xs', interactiveRowSecondary())}>
                        {formatBrazilPhone(c.wa_phone) || c.wa_phone}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', profileTone(c.profile_type))}>
                          {profileLabel(c.profile_type)}
                        </span>
                        <span className={cn('text-[10px]', semanticPillClass(c.is_blocked ? 'warning' : 'neutral'))}>
                          {c.is_blocked ? 'Bloqueado' : 'OK'}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">Vínculo: {linkName}</div>
                      <div className={cn('mt-1 text-[11px] font-mono', interactiveRowMuted())}>
                        {formatDateTimeBr(c.updated_at)}
                      </div>
                    </div>
                    {renderContactActions(c)}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop table */}
        <div className={cn(reviveTableShellClassName, 'hidden lg:block')}>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className={reviveTableHeadRowClassName}>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" className="rounded border-border bg-background" />
                </th>
                <th className="px-4 py-3">Contato</th>
                <th className="px-4 py-3">Perfil</th>
                <th className="hidden px-4 py-3 xl:table-cell">Vínculo</th>
                <th className="px-4 py-3">Bloqueio</th>
                <th className="hidden px-4 py-3 lg:table-cell">Atualizado</th>
                {canManage ? <th className="px-4 py-3 w-8" /> : null}
              </tr>
            </thead>
            <tbody>
              {contactsQuery.isLoading ? (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="px-4 py-6 text-sm text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="px-4 py-6 text-sm text-muted-foreground">
                    Nenhum contato encontrado.
                  </td>
                </tr>
              ) : (
                pagedItems.map((c) => {
                  const displayName = c.display_name || '—';
                  const linkName =
                    c.profile_type === 'driver'
                      ? c.driver?.name || '—'
                      : c.profile_type === 'pharmacy'
                        ? c.pharmacy?.trade_name || '—'
                        : c.profile_type === 'leader'
                          ? c.leader?.name || '—'
                          : '—';
                  return (
                    <tr key={c.id} className={cn('border-b border-border/50 last:border-0', interactiveRowSurface())}>
                      <td className="px-4 py-3">
                        <input type="checkbox" className="rounded border-border bg-background" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 to-channel-instagram/40 text-[11px] font-semibold">
                            {initials(displayName)}
                          </div>
                          <div>
                            <div className={cn('text-sm font-medium', interactiveRowPrimary())}>{displayName}</div>
                          <div className={cn('font-mono text-[10px]', interactiveRowSecondary())}>{formatBrazilPhone(c.wa_phone) || c.wa_phone}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', profileTone(c.profile_type))}>
                          {profileLabel(c.profile_type)}
                        </span>
                      </td>
                      <td className={cn('hidden px-4 py-3 text-xs xl:table-cell', interactiveRowSecondary())}>{linkName}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'text-[10px]',
                            semanticPillClass(c.is_blocked ? 'warning' : 'neutral')
                          )}
                        >
                          {c.is_blocked ? 'Bloqueado' : 'OK'}
                        </span>
                      </td>
                      <td className={cn('hidden px-4 py-3 text-xs font-mono lg:table-cell', interactiveRowMuted())}>{formatDateTimeBr(c.updated_at)}</td>
                      {canManage ? (
                      <td className="px-4 py-3">
                        <div className="relative">{renderContactActions(c)}</div>
                      </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </div>
        <PaginationControls page={currentPage} totalItems={items.length} onPageChange={setCurrentPage} itemLabel="contatos" />
      </div>

      {menu && menuContact
        ? createPortal(
            <div
              ref={menuRef}
              style={{ position: 'fixed', top: menu.y + 6, left: menu.x, transform: 'translateX(-100%)' }}
              className="z-[100] w-40 rounded-xl border border-border bg-surface p-1 shadow-md"
            >
              <button
                onClick={() => {
                  setMenu(null);
                  openEdit(menuContact);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60"
              >
                Editar
              </button>
              <button
                onClick={() => {
                  setMenu(null);
                  void toggleBlock(menuContact);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60"
              >
                {menuContact.is_blocked ? 'Desbloquear' : 'Bloquear'}
              </button>
              <button
                onClick={() => {
                  setMenu(null);
                  void navigator.clipboard?.writeText(menuContact.wa_phone);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60"
              >
                Copiar telefone
              </button>
            </div>,
            document.body,
          )
        : null}

      <Modal
        open={editorOpen}
        title={editing ? 'Editar contato' : 'Novo contato'}
        onClose={() => {
          if (saving) return;
          setEditorOpen(false);
        }}
      >
        <form onSubmit={submit} className="space-y-3">
          {saveError ? <div className="text-xs text-destructive">{saveError}</div> : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Nome</label>
              <FormControl
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="mt-1"
                placeholder="Opcional"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Telefone</label>
              <BrPhoneInput value={formPhone} onChange={setFormPhone} className="font-mono" placeholder="(11) 99999-9999" required />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Perfil</label>
              <FormSelect
                value={formProfile}
                onChange={(v) => {
                  const next = v as ContactProfile;
                  setFormProfile(next);
                  setFormDriverId('');
                  setFormPharmacyId('');
                  setFormLeaderId('');
                }}
                className="mt-1"
                options={[
                  { value: 'unknown', label: 'Desconhecido' },
                  { value: 'driver', label: 'Entregador' },
                  { value: 'pharmacy', label: 'Farmácia' },
                  { value: 'leader', label: 'Líder' },
                  { value: 'partner', label: 'Parceiro' },
                ]}
              />
            </div>

            {formProfile === 'driver' ? (
              <div className="col-span-2">
                <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Vincular entregador</label>
                <CadastroSearchCombobox entity="driver" value={formDriverId} onChange={setFormDriverId} className="mt-1" />
              </div>
            ) : null}

            {formProfile === 'pharmacy' ? (
              <div className="col-span-2">
                <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Vincular farmácia</label>
                <CadastroSearchCombobox entity="pharmacy" value={formPharmacyId} onChange={setFormPharmacyId} className="mt-1" />
              </div>
            ) : null}

            {formProfile === 'leader' ? (
              <div className="col-span-2">
                <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Vincular líder</label>
                <CadastroSearchCombobox entity="leader" value={formLeaderId} onChange={setFormLeaderId} className="mt-1" />
              </div>
            ) : null}

            <div className="col-span-2 flex items-center gap-2 pt-1">
              <input
                id="blocked"
                type="checkbox"
                checked={formBlocked}
                onChange={(e) => setFormBlocked(e.target.checked)}
                className="rounded border-border bg-background"
              />
              <label htmlFor="blocked" className="text-sm text-muted-foreground">
                Bloquear contato
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
