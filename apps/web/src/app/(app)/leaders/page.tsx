'use client';

import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Building2, ChevronDown, Crown, Mail, MoreHorizontal, Phone, Plus, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { DEFAULT_LIST_PAGE_SIZE, PaginationControls } from '@/components/ui/PaginationControls';
import { StatusDot } from '@/components/ui/StatusDot';
import { useAuth } from '@/store/auth';
import { canManageCadastro } from '@/lib/cadastroPermissions';
import { cn } from '@/lib/utils';
import { BrPhoneInput } from '@/components/form/BrInputs';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { ToolbarSelect } from '@/components/form/ToolbarSelect';
import { formatBrazilPhone, normalizeBrazilPhone } from '@/lib/brFormat';
import { cadastroStatusDot } from '@/lib/cadastroStatus';
import { CadastroField, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import { reviveKpiCardClassName, reviveListCardClassName } from '@/lib/reviveSurfaces';

type ApiLeaderSummary = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  status: 'active' | 'inactive';
  pharmacies_managed: string[];
  pharmacies_count: number;
  sla_percent: number;
  csat: number | null;
  sla_days: number;
};

type ApiLeadersSummaryResponse = {
  totals: {
    leaders_active: number;
    pharmacies_managed: number;
    attendants_total: number;
    drivers_total?: number;
    team_total?: number;
    sla_avg_percent: number;
  };
  leaders: ApiLeaderSummary[];
};

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

type PharmacyWithDrivers = {
  pharmacy_id: string;
  trade_name: string;
  city: string | null;
  drivers: Array<{ id: string; name: string; phone: string; is_primary: boolean }>;
};

function LeaderPharmaciesDriversAccordion({ leaderId }: { leaderId: string }) {
  const detailQuery = useQuery({
    queryKey: ['leader-detail', leaderId],
    queryFn: async () =>
      await cadastroPageApi.fetchLeader(leaderId) as {
        pharmacies_with_drivers?: PharmacyWithDrivers[];
      },
  });

  const rows = detailQuery.data?.pharmacies_with_drivers || [];

  if (detailQuery.isLoading) {
    return <div className="text-xs text-muted-foreground">Carregando entregadores por farmácia…</div>;
  }
  if (detailQuery.isError) {
    return <div className="text-xs text-destructive">Não foi possível carregar entregadores.</div>;
  }
  if (!rows.length) {
    return <div className="text-xs text-muted-foreground">Nenhum entregador ativo vinculado às farmácias deste líder.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Entregadores ativos por farmácia</div>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {rows.map((row) => (
          <details key={row.pharmacy_id} className="group rounded-lg border border-border bg-muted/30">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium">
              <span className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>
                  {row.trade_name}
                  {row.city ? <span className="text-muted-foreground"> — {row.city}</span> : null}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-border px-3 py-2">
              {row.drivers.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">Nenhum entregador ativo nesta farmácia.</span>
              ) : (
                <ul className="space-y-1.5">
                  {row.drivers.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-medium text-foreground">{d.name}</span>
                      <span className="font-mono text-muted-foreground">{formatBrazilPhone(d.phone) || d.phone}</span>
                      {d.is_primary ? (
                        <span className="rounded bg-primary/15 px-1.5 py-0 text-[10px] text-primary">Primário</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
  wide,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
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
      <div className={cn('w-full rounded-2xl border border-border bg-surface shadow-md', wide ? 'max-w-2xl' : 'max-w-lg')}>
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

export default function LeadersPage() {
  const searchParams = useSearchParams();
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const user = useAuth((s) => s.user);
  const hasPermission = useAuth((s) => s.hasPermission);
  const canManage = canManageCadastro(user?.role, hasPermission, 'leaders');
  const canFetch = hasHydrated && isAuthenticated;
  const queryClient = useQueryClient();

  const [menuId, setMenuId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive'>('active');
  const [currentPage, setCurrentPage] = useState(1);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ApiLeaderSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formStatus, setFormStatus] = useState<'active' | 'inactive'>('active');

  const summaryQuery = useQuery({
    queryKey: ['leaders', 'summary', q, statusFilter],
    enabled: canFetch,
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (q.trim()) params.search = q.trim();
      params.status = statusFilter;
      return await cadastroPageApi.fetchLeadersSummary(params) as ApiLeadersSummaryResponse;
    },
  });

  const leaders = useMemo(() => summaryQuery.data?.leaders ?? [], [summaryQuery.data?.leaders]);
  const totals = summaryQuery.data?.totals || { leaders_active: 0, pharmacies_managed: 0, attendants_total: 0, sla_avg_percent: 0 };

  useEffect(() => {
    if (!menuId) return;
    const onClick = (e: MouseEvent) => {
      const el = menuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setMenuId(null);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuId]);

  const openCreate = () => {
    window.location.href = '/leaders/new';
  };

  const openEdit = (l: ApiLeaderSummary) => {
    window.location.href = `/leaders/new?id=${encodeURIComponent(l.id)}`;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formPhone.trim()) return;
    const phoneDigits = normalizeBrazilPhone(formPhone);
    if (!phoneDigits || phoneDigits.length < 12) {
      setSaveError('Telefone inválido (inclua DDD).');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        name: formName.trim(),
        phone: phoneDigits,
        email: formEmail.trim() || undefined,
        status: formStatus,
      };
      if (editing) await cadastroPageApi.updateLeader(editing.id, payload);
      else await cadastroPageApi.createLeader(payload);
      setEditorOpen(false);
      setEditing(null);
      await summaryQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ['leader-detail'] });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSaveError(msg || 'Falha ao salvar líder.');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (l: ApiLeaderSummary) => {
    try {
      await cadastroPageApi.patchLeaderStatus(l.id, l.status === 'active' ? 'inactive' : 'active');
      await summaryQuery.refetch();
    } catch {
      // ignore
    }
  };

  const clearEditQueryParam = () => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('edit')) return;
    url.searchParams.delete('edit');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || editorOpen) return;
    const target = leaders.find((l) => l.id === editId);
    if (target) {
      const el = document.querySelector(`[data-leader-id="${editId}"]`);
      if (el instanceof HTMLElement) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      openEdit(target);
      clearEditQueryParam();
    }
  }, [searchParams, leaders, editorOpen]);

  const cards = useMemo(() => leaders, [leaders]);
  const pagedCards = useMemo(() => {
    const start = (currentPage - 1) * DEFAULT_LIST_PAGE_SIZE;
    return cards.slice(start, start + DEFAULT_LIST_PAGE_SIZE);
  }, [cards, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [q, statusFilter]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(cards.length / DEFAULT_LIST_PAGE_SIZE));
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [cards.length, currentPage]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <PageHeader
          icon={Crown}
          eyebrow="Pessoas"
          title="Líderes"
          description="Gestores responsáveis por farmácias e equipes."
          actions={
            canManage ? (
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" /> Convidar líder
              </Button>
            ) : null
          }
        />

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Líderes ativos', value: String(totals.leaders_active) },
            { label: 'Farmácias geridas', value: String(totals.pharmacies_managed) },
            { label: 'Equipe total', value: String(totals.team_total ?? totals.attendants_total) },
            { label: 'SLA médio', value: `${totals.sla_avg_percent.toFixed(1)}%`, accent: totals.sla_avg_percent > 0 ? 'text-success' : undefined },
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
          searchPlaceholder="Buscar líder por nome ou telefone..."
        >
          <ToolbarSelect
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as 'active' | 'inactive')}
            options={[
              { value: 'active', label: 'Ativo' },
              { value: 'inactive', label: 'Inativo' },
            ]}
          />
        </ListToolbar>

        {summaryQuery.isError ? <div className="mb-3 text-xs text-destructive">Falha ao carregar líderes.</div> : null}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {summaryQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Carregando…</div>
          ) : cards.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhum líder encontrado.</div>
          ) : (
            pagedCards.map((l) => (
              <div key={l.id} data-leader-id={l.id} className={reviveListCardClassName}>
                <div className="flex items-start justify-between">
                  <Link href={`/leaders/${l.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="relative shrink-0">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-primary text-sm font-semibold text-primary-foreground">
                        {initials(l.name)}
                      </div>
                      <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-warning text-warning-foreground">
                        <Crown className="h-3 w-3" />
                      </div>
                      <StatusDot status={cadastroStatusDot(l.status)} pulse={l.status === 'active'} className="absolute -bottom-0.5 -right-0.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{l.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{l.email || '—'}</div>
                    </div>
                  </Link>
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setMenuId((v) => (v === l.id ? null : l.id))}
                      className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-sidebar-accent/60"
                      title="Ações"
                    >
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </button>
                    {menuId === l.id ? (
                      <div ref={menuRef} className="absolute right-0 top-8 z-30 w-40 rounded-xl border border-border bg-surface p-1 shadow-md">
                        <Link
                          href={`/leaders/${l.id}`}
                          onClick={() => setMenuId(null)}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60"
                        >
                          Abrir ficha
                        </Link>
                        <div className="my-1 h-px bg-border/60" />
                        {canManage ? (
                          <button
                            onClick={() => {
                              setMenuId(null);
                              openEdit(l);
                            }}
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60"
                          >
                            Editar
                          </button>
                        ) : null}
                        {canManage ? (
                          <button
                            onClick={() => {
                              setMenuId(null);
                              void toggleStatus(l);
                            }}
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60"
                          >
                            {l.status === 'active' ? 'Inativar' : 'Ativar'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <Link href={`/leaders/${l.id}`} className="mt-4 block">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Farmácias</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(l.pharmacies_managed || []).slice(0, 6).map((p) => (
                      <span key={p} className="inline-flex items-center gap-1 rounded border border-border bg-background/40 px-1.5 py-0.5 text-[10px]">
                        <Building2 className="h-2.5 w-2.5 text-muted-foreground" /> {p}
                      </span>
                    ))}
                    {(l.pharmacies_managed || []).length === 0 ? (
                      <span className="text-[10px] text-subtle-foreground">—</span>
                    ) : null}
                  </div>
                </Link>

                <Link href={`/leaders/${l.id}`} className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3">
                  <div>
                    <div className="font-mono text-base font-semibold">{l.pharmacies_count}</div>
                    <div className="text-[10px] text-subtle-foreground">Unidades</div>
                  </div>
                  <div>
                    <div className={cn('font-mono text-base font-semibold', l.sla_percent > 0 ? 'text-success' : 'text-muted-foreground')}>
                      {l.sla_percent.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-subtle-foreground">SLA ({l.sla_days}d)</div>
                  </div>
                  <div>
                    <div className="font-mono text-base font-semibold">
                      {l.csat == null ? '—' : l.csat}
                      <span className="text-[10px] text-subtle-foreground">{l.csat == null ? '' : '/5'}</span>
                    </div>
                    <div className="text-[10px] text-subtle-foreground">CSAT</div>
                  </div>
                </Link>
              </div>
            ))
          )}
        </div>
      </div>
        <PaginationControls page={currentPage} totalItems={cards.length} onPageChange={setCurrentPage} itemLabel="líderes" />

      <Modal
        open={editorOpen}
        wide={Boolean(editing)}
        title={editing ? 'Editar líder' : 'Convidar líder'}
        onClose={() => {
          if (saving) return;
          clearEditQueryParam();
          setEditorOpen(false);
        }}
      >
        <form onSubmit={submit} className="space-y-4">
          {saveError ? <div className="text-xs text-destructive">{saveError}</div> : null}
          {editing ? (
            <CadastroSection title="Vínculos" desc="Farmácias vinculadas a este líder">
              <div className="flex flex-wrap gap-1.5">
                {(editing.pharmacies_managed || []).length > 0 ? (
                  editing.pharmacies_managed.map((p) => (
                    <span key={p} className="inline-flex items-center gap-1 rounded border border-border bg-background/40 px-2 py-0.5 text-[10px] text-foreground">
                      <Building2 className="h-2.5 w-2.5 text-muted-foreground" />
                      {p}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">Nenhuma farmácia vinculada.</span>
                )}
              </div>
              {(editing.pharmacies_managed || []).length > 0 ? (
                <div>
                  <Link href="/pharmacies" className="text-[11px] font-medium text-primary hover:underline">
                    Abrir em Farmácias →
                  </Link>
                </div>
              ) : null}
            </CadastroSection>
          ) : null}
          {editing ? (
            <CadastroSection title="Farmácias e equipe" desc="Detalhes (leitura) do que está vinculado ao líder">
              <LeaderPharmaciesDriversAccordion leaderId={editing.id} />
            </CadastroSection>
          ) : null}

          <CadastroSection title="Contato" desc="Dados usados para comunicação e acesso">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <CadastroField icon={User} label="Nome" required>
                <FormControl
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                />
              </CadastroField>
              <CadastroField icon={Phone} label="Telefone" required>
                <BrPhoneInput value={formPhone} onChange={setFormPhone} className="font-mono" placeholder="(11) 99999-9999" required />
              </CadastroField>
              <div className="sm:col-span-2">
                <CadastroField icon={Mail} label="E-mail">
                  <FormControl
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="Opcional"
                  />
                </CadastroField>
              </div>
            </div>
          </CadastroSection>

          <CadastroSection title="Status">
            <CadastroField icon={StatusDot as unknown as typeof Crown} label="Status">
              <FormSelect
                value={formStatus}
                onChange={(v) => setFormStatus(v as 'active' | 'inactive')}
                options={[
                  { value: 'active', label: 'Ativo' },
                  { value: 'inactive', label: 'Inativo' },
                ]}
              />
            </CadastroField>
          </CadastroSection>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                clearEditQueryParam();
                setEditorOpen(false);
              }}
              disabled={saving}
            >
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
