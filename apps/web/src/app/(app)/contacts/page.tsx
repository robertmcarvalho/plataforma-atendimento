'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { Download, Filter, MoreHorizontal, Plus, Search, Tag } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DEFAULT_LIST_PAGE_SIZE, PaginationControls } from '@/components/ui/PaginationControls';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { useAuth } from '@/store/auth';
import { BrPhoneInput } from '@/components/form/BrInputs';
import { normalizeBrazilPhone, formatBrazilPhone } from '@/lib/brFormat';
import { formatDateTimeBr } from '@/lib/datetimeBr';

type ContactProfile = 'driver' | 'pharmacy' | 'leader' | 'unknown';
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
  return 'Desconhecido';
}

function profileTone(p: ContactProfile) {
  if (p === 'driver') return 'bg-primary/15 text-primary border-primary/30';
  if (p === 'pharmacy') return 'bg-success/15 text-success border-success/30';
  if (p === 'leader') return 'bg-warning/15 text-warning border-warning/30';
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
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface-elevated shadow-glow">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="text-sm font-semibold tracking-tight">{title}</div>
          <button onClick={onClose} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground">
            Fechar
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const canFetch = hasHydrated && isAuthenticated;

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
      const res = await api.get('/api/contacts', { params });
      return res.data as ApiContact[];
    },
  });

  const driversQuery = useQuery({
    queryKey: ['contacts', 'drivers'],
    enabled: canFetch && editorOpen && formProfile === 'driver',
    queryFn: async () => (await api.get('/api/drivers')).data as ApiDriver[],
  });

  const pharmaciesQuery = useQuery({
    queryKey: ['contacts', 'pharmacies'],
    enabled: canFetch && editorOpen && formProfile === 'pharmacy',
    queryFn: async () => (await api.get('/api/pharmacies')).data as ApiPharmacy[],
  });

  const leadersQuery = useQuery({
    queryKey: ['contacts', 'leaders'],
    enabled: canFetch && editorOpen && formProfile === 'leader',
    queryFn: async () => (await api.get('/api/leaders')).data as ApiLeader[],
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

      if (editing) await api.put(`/api/contacts/${editing.id}`, payload);
      else await api.post('/api/contacts', payload);

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
      await api.patch(`/api/contacts/${c.id}/block`, { blocked: !c.is_blocked });
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <PageHeader
          eyebrow="CRM"
          title="Contatos"
          description="Base unificada de contatos (WhatsApp)."
          actions={
            <>
              <button
                onClick={exportNow}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-hover transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> Exportar
              </button>
              <button
                onClick={openCreate}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Novo contato
              </button>
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
            <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
              <div className={cn('text-xl font-semibold tracking-tight', s.accent)}>{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
            />
          </div>

          <div className="relative">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-surface-hover"
              aria-expanded={filtersOpen}
            >
              <Filter className="h-3.5 w-3.5" /> Filtros
            </button>
            {filtersOpen ? (
              <div className="absolute right-0 top-11 z-30 w-64 rounded-xl border border-border bg-surface-elevated p-3 shadow-glow">
                <div className="text-xs font-semibold">Filtros</div>
                <div className="mt-2 space-y-2">
                  <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Perfil</label>
                  <select
                    value={profile}
                    onChange={(e) => setProfile(e.target.value as ContactProfileFilter)}
                    className="w-full rounded-md border border-border bg-surface px-2 py-2 text-xs outline-none"
                  >
                    <option value="all">Todos</option>
                    <option value="unknown">Desconhecido</option>
                    <option value="driver">Entregador</option>
                    <option value="pharmacy">Farmácia</option>
                    <option value="leader">Líder</option>
                  </select>

                  <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Bloqueado</label>
                  <select
                    value={blocked}
                    onChange={(e) => setBlocked(e.target.value as BlockedFilter)}
                    className="w-full rounded-md border border-border bg-surface px-2 py-2 text-xs outline-none"
                  >
                    <option value="all">Todos</option>
                    <option value="false">Não bloqueado</option>
                    <option value="true">Bloqueado</option>
                  </select>

                  <div className="pt-1">
                    <button
                      onClick={() => {
                        setProfile('all');
                        setBlocked('all');
                        setFiltersOpen(false);
                      }}
                      className="w-full rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="relative">
            <button
              onClick={() => setProfileMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-surface-hover"
              aria-expanded={profileMenuOpen}
            >
              <Tag className="h-3.5 w-3.5" /> Tipos
            </button>
            {profileMenuOpen ? (
              <div className="absolute right-0 top-11 z-30 w-44 rounded-xl border border-border bg-surface-elevated p-1 shadow-glow">
                {(['all', 'unknown', 'driver', 'pharmacy', 'leader'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setProfile(p);
                      setProfileMenuOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-surface-hover',
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
        </div>

        {contactsQuery.isError ? <div className="mb-3 text-xs text-destructive">Falha ao carregar contatos.</div> : null}

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" className="rounded border-border bg-background" />
                </th>
                <th className="px-4 py-3">Contato</th>
                <th className="px-4 py-3">Perfil</th>
                <th className="px-4 py-3">Vínculo</th>
                <th className="px-4 py-3">Bloqueio</th>
                <th className="px-4 py-3">Atualizado</th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {contactsQuery.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-sm text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-sm text-muted-foreground">
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
                    <tr key={c.id} className="border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors">
                      <td className="px-4 py-3">
                        <input type="checkbox" className="rounded border-border bg-background" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 to-channel-instagram/40 text-[11px] font-semibold">
                            {initials(displayName)}
                          </div>
                          <div>
                            <div className="text-sm font-medium">{displayName}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{formatBrazilPhone(c.wa_phone) || c.wa_phone}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', profileTone(c.profile_type))}>
                          {profileLabel(c.profile_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{linkName}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'rounded px-2 py-0.5 text-[10px] font-medium',
                            c.is_blocked ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {c.is_blocked ? 'Bloqueado' : 'OK'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{formatDateTimeBr(c.updated_at)}</td>
                      <td className="px-4 py-3">
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                              setMenu((cur) => (cur?.id === c.id ? null : { id: c.id, x: rect.right, y: rect.bottom }));
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded hover:bg-surface-elevated"
                            title="Ações"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          {menu?.id === c.id
                            ? createPortal(
                                <div
                                  ref={menuRef}
                                  style={{ position: 'fixed', top: menu.y + 6, left: menu.x, transform: 'translateX(-100%)' }}
                                  className="z-[100] w-40 rounded-xl border border-border bg-surface-elevated p-1 shadow-glow"
                                >
                                  <button
                                    onClick={() => {
                                      setMenu(null);
                                      openEdit(c);
                                    }}
                                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    onClick={() => {
                                      setMenu(null);
                                      void toggleBlock(c);
                                    }}
                                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover"
                                  >
                                    {c.is_blocked ? 'Desbloquear' : 'Bloquear'}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setMenu(null);
                                      void navigator.clipboard?.writeText(c.wa_phone);
                                    }}
                                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover"
                                  >
                                    Copiar telefone
                                  </button>
                                </div>,
                                document.body
                              )
                            : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls page={currentPage} totalItems={items.length} onPageChange={setCurrentPage} itemLabel="contatos" />
      </div>

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
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none"
                placeholder="Opcional"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Telefone</label>
              <BrPhoneInput value={formPhone} onChange={setFormPhone} className="bg-surface font-mono" placeholder="(11) 99999-9999" required />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Perfil</label>
              <select
                value={formProfile}
                onChange={(e) => {
                  const next = e.target.value as ContactProfile;
                  setFormProfile(next);
                  setFormDriverId('');
                  setFormPharmacyId('');
                  setFormLeaderId('');
                }}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none"
              >
                <option value="unknown">Desconhecido</option>
                <option value="driver">Entregador</option>
                <option value="pharmacy">Farmácia</option>
                <option value="leader">Líder</option>
              </select>
            </div>

            {formProfile === 'driver' ? (
              <div className="col-span-2">
                <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Vincular entregador</label>
                <select
                  value={formDriverId}
                  onChange={(e) => setFormDriverId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none"
                >
                  <option value="">—</option>
                  {(driversQuery.data || []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({formatBrazilPhone(d.phone) || d.phone})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {formProfile === 'pharmacy' ? (
              <div className="col-span-2">
                <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Vincular farmácia</label>
                <select
                  value={formPharmacyId}
                  onChange={(e) => setFormPharmacyId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none"
                >
                  <option value="">—</option>
                  {(pharmaciesQuery.data || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.trade_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {formProfile === 'leader' ? (
              <div className="col-span-2">
                <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Vincular líder</label>
                <select
                  value={formLeaderId}
                  onChange={(e) => setFormLeaderId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none"
                >
                  <option value="">—</option>
                  {(leadersQuery.data || []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({formatBrazilPhone(l.phone) || l.phone})
                    </option>
                  ))}
                </select>
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
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              disabled={saving}
              className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-glow disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
