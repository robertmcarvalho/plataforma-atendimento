'use client';

import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Edit3, MapPin, MoreHorizontal, Plus, Truck } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { StatusDot } from '@/components/ui/StatusDot';
import { useAuth } from '@/store/auth';
import { canManageCadastro } from '@/lib/cadastroPermissions';
import {
  interactiveRowMuted,
  interactiveRowPrimary,
  interactiveRowSecondary,
} from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';
import {
  reviveKpiCardClassName,
  reviveTableHeadRowClassName,
  reviveTableRowClassName,
  reviveTableShellClassName,
  reviveToolbarButtonClassName,
  reviveStatusPill,
} from '@/lib/reviveSurfaces';
import { CadastroImportTrigger } from '@/components/cadastros/CadastroImportModal';
import { formatBrazilPhone } from '@/lib/brFormat';
import { DEFAULT_LIST_PAGE_SIZE, PaginationControls } from '@/components/ui/PaginationControls';
import { buttonVariants } from '@/components/ui/button';
import { cadastroStatusDot } from '@/lib/cadastroStatus';
import { ToolbarSelect } from '@/components/form/ToolbarSelect';
import { DriverDocumentHeaderBadge } from '@/components/cadastro/driver/DriverDocumentStatusBadge';

type DriverDocStatus = 'ok' | 'pending' | 'expired';

type DriverStatus = 'active' | 'inactive' | 'blocked';
type DriverType = 'fixed' | 'daily';

type ApiDriver = {
  id: string;
  name: string;
  cpf?: string | null;
  phone: string;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  status: DriverStatus;
  driver_type?: DriverType | null;
  primary_pharmacy_id?: string | null;
  primary_pharmacy?: {
    id: string;
    trade_name: string;
    city?: string | null;
    state?: string | null;
    leader_id?: string | null;
    leader?: { id: string; name: string } | null;
  } | null;
  override_leader?: { id: string; name: string; city?: string | null; state?: string | null; status?: string | null } | null;
  is_mei?: boolean | null;
  mei_cnpj?: string | null;
  is_leader?: boolean | null;
  leader_role?: string | null;
  leader_notes?: string | null;
  has_digital_certificate?: boolean | null;
  digital_certificate_expires_at?: string | null;
  cnh_expires_at?: string | null;
  doc_status?: DriverDocStatus | null;
  work_schedule?: Record<string, unknown> | null;
  pix_key?: string | null;
  created_at?: string;
  updated_at?: string;
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

function statusLabel(status: DriverStatus) {
  if (status === 'active') return 'Ativo';
  if (status === 'blocked') return 'Bloqueado';
  return 'Inativo';
}

function normText(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export default function DriversPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const user = useAuth((s) => s.user);
  const hasPermission = useAuth((s) => s.hasPermission);
  const canManage = canManageCadastro(user?.role, hasPermission, 'drivers');
  const canBulkImport = user?.role === 'admin' || user?.role === 'supervisor';
  const canFetch = hasHydrated && isAuthenticated;

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<DriverStatus>('active');
  const [typeFilter, setTypeFilter] = useState<DriverType | 'all'>('all');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [leaderFilter, setLeaderFilter] = useState<string>('all');
  const [docStatusFilter, setDocStatusFilter] = useState<DriverDocStatus | 'all'>('all');
  const [currentPage, setCurrentPage] = useState(1);

  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const driversQuery = useQuery({
    queryKey: ['drivers', { q, status, docStatusFilter }],
    enabled: canFetch,
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (q.trim()) params.search = q.trim();
      params.status = status;
      if (docStatusFilter !== 'all') params.doc_status = docStatusFilter;
      return (await cadastroPageApi.fetchDrivers(params)) as ApiDriver[];
    },
  });

  const rawItems = useMemo(() => driversQuery.data ?? [], [driversQuery.data]);
  const items = useMemo(() => {
    return rawItems.filter((d) => {
      if (cityFilter !== 'all' && normText(d.city) !== normText(cityFilter)) return false;
      if (stateFilter !== 'all' && normText(d.state) !== normText(stateFilter)) return false;
      if (typeFilter !== 'all' && d.driver_type !== typeFilter) return false;
      if (leaderFilter !== 'all') {
        const lid = d.override_leader?.id || d.primary_pharmacy?.leader_id || '';
        if (lid !== leaderFilter) return false;
      }
      return true;
    });
  }, [rawItems, cityFilter, stateFilter, leaderFilter, typeFilter]);

  const cityOptions = useMemo(() => {
    const source = rawItems.filter((d) => stateFilter === 'all' || normText(d.state) === normText(stateFilter));
    return Array.from(new Set(source.map((d) => String(d.city || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [rawItems, stateFilter]);
  const stateOptions = useMemo(() => {
    const source = rawItems.filter((d) => cityFilter === 'all' || normText(d.city) === normText(cityFilter));
    return Array.from(new Set(source.map((d) => String(d.state || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [rawItems, cityFilter]);
  const leaderOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of rawItems) {
      if (d.override_leader?.id) map.set(d.override_leader.id, d.override_leader.name || 'Líder');
      const pLeader = d.primary_pharmacy?.leader;
      if (pLeader?.id) map.set(pLeader.id, pLeader.name || 'Líder');
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [rawItems]);

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((d) => d.status === 'active').length;
    const inactive = items.filter((d) => d.status === 'inactive').length;
    return { total, active, inactive };
  }, [items]);

  const totalPages = Math.max(1, Math.ceil(items.length / DEFAULT_LIST_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pagedItems = useMemo(() => {
    const start = (safeCurrentPage - 1) * DEFAULT_LIST_PAGE_SIZE;
    return items.slice(start, start + DEFAULT_LIST_PAGE_SIZE);
  }, [items, safeCurrentPage]);

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

  const setDriverStatus = async (d: ApiDriver, next: DriverStatus) => {
    try {
      await cadastroPageApi.patchDriverStatus(d.id, next);
      await driversQuery.refetch();
    } catch {
      // ignore
    }
  };

  const clearFilters = () => {
    setCurrentPage(1);
    setStatus('active');
    setTypeFilter('all');
    setCityFilter('all');
    setStateFilter('all');
    setLeaderFilter('all');
    setDocStatusFilter('all');
    setQ('');
  };

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) return;
    router.replace(`/drivers/new?id=${encodeURIComponent(editId)}`);
  }, [router, searchParams]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <PageHeader
          icon={Truck}
          live
          eyebrow="Operação"
          title="Entregadores"
          description="Equipe de entrega vinculada às farmácias."
          actions={
            <>
              <CadastroImportTrigger
                canImport={Boolean(canBulkImport)}
                templatePath="/api/drivers/import/template"
                importPath="/api/drivers/import"
                entityLabel="entregadores"
                onImported={() => void driversQuery.refetch()}
              />
              {canManage ? (
                <Link href="/drivers/new" className={buttonVariants({ size: 'sm' })}>
                  <Plus className="h-3.5 w-3.5" /> Cadastrar entregador
                </Link>
              ) : null}
            </>
          }
        />

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Total cadastrados', value: String(stats.total), icon: Truck },
            { label: 'Ativos', value: String(stats.active), accent: stats.active ? 'text-success' : undefined },
            { label: 'Inativos', value: String(stats.inactive) },
          ].map((s) => (
            <div key={s.label} className={reviveKpiCardClassName}>
              <div className={cn('text-xl font-semibold tracking-tight', s.accent)}>{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        <ListToolbar
          searchValue={q}
          onSearchChange={(value) => {
            setCurrentPage(1);
            setQ(value);
          }}
          searchPlaceholder="Buscar entregador..."
        >
          <ToolbarSelect
            value={status}
            onChange={(v) => {
              setCurrentPage(1);
              setStatus(v as DriverStatus);
            }}
            options={[
              { value: 'active', label: 'Ativo' },
              { value: 'inactive', label: 'Inativo' },
              { value: 'blocked', label: 'Bloqueado' },
            ]}
          />
          <ToolbarSelect
            value={typeFilter}
            onChange={(v) => {
              setCurrentPage(1);
              setTypeFilter(v as DriverType | 'all');
            }}
            options={[
              { value: 'all', label: 'Tipo' },
              { value: 'fixed', label: 'Fixo' },
              { value: 'daily', label: 'Diarista' },
            ]}
          />
          <ToolbarSelect
            wideMenu
            value={cityFilter}
            onChange={(v) => {
              setCurrentPage(1);
              setCityFilter(v);
            }}
            options={[{ value: 'all', label: 'Cidade' }, ...cityOptions.map((city) => ({ value: city, label: city }))]}
          />
          <ToolbarSelect
            value={stateFilter}
            onChange={(v) => {
              setCurrentPage(1);
              setStateFilter(v);
            }}
            options={[{ value: 'all', label: 'Estado' }, ...stateOptions.map((uf) => ({ value: uf, label: uf }))]}
          />
          <ToolbarSelect
            value={docStatusFilter}
            onChange={(v) => {
              setCurrentPage(1);
              setDocStatusFilter(v as DriverDocStatus | 'all');
            }}
            options={[
              { value: 'all', label: 'Documentação' },
              { value: 'ok', label: 'Doc. OK' },
              { value: 'pending', label: 'Doc. pendente' },
              { value: 'expired', label: 'Doc. vencida' },
            ]}
          />
          <ToolbarSelect
            wideMenu
            value={leaderFilter}
            onChange={(v) => {
              setCurrentPage(1);
              setLeaderFilter(v);
            }}
            options={[
              { value: 'all', label: 'Líder' },
              ...leaderOptions.map(([id, name]) => ({ value: id, label: name })),
            ]}
          />
          <button
            type="button"
            onClick={clearFilters}
            className={reviveToolbarButtonClassName}
          >
            Limpar filtros
          </button>
        </ListToolbar>

        {driversQuery.isError ? <div className="mb-3 text-xs text-destructive">Falha ao carregar entregadores.</div> : null}

        {/* Table */}
        <div className={reviveTableShellClassName}>
          <table className="w-full">
            <thead>
              <tr className={reviveTableHeadRowClassName}>
                <th className="px-4 py-3">Entregador</th>
                <th className="px-4 py-3">Farmácia primária</th>
                <th className="px-4 py-3">Cidade</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {driversQuery.isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-sm text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-sm text-muted-foreground">
                    Nenhum entregador encontrado.
                  </td>
                </tr>
              ) : (
                pagedItems.map((d) => (
                  <tr
                    key={d.id}
                    data-driver-id={d.id}
                    onClick={() => router.push(`/drivers/${d.id}`)}
                    className={reviveTableRowClassName}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="relative">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-channel-whatsapp/40 to-primary/40 text-[11px] font-semibold">
                            {initials(d.name)}
                          </div>
                          <StatusDot status={cadastroStatusDot(d.status)} pulse={d.status === 'active'} className="absolute -bottom-0.5 -right-0.5" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <div className={cn('text-sm font-medium', interactiveRowPrimary())}>{d.name}</div>
                            {(d.doc_status && d.doc_status !== 'ok') || d.cnh_expires_at ? (
                              <DriverDocumentHeaderBadge
                                cnhExpiresAt={d.cnh_expires_at}
                                hasDigitalCertificate={d.has_digital_certificate}
                                digitalCertificateExpiresAt={d.digital_certificate_expires_at}
                                className="shrink-0"
                              />
                            ) : null}
                          </div>
                          <div className={cn('font-mono text-[10px]', interactiveRowSecondary())}>{formatBrazilPhone(d.phone) || d.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td className={cn('px-4 py-3 text-xs', interactiveRowSecondary())}>{d.primary_pharmacy?.trade_name || '—'}</td>
                    <td className="px-4 py-3">
                      <div className={cn('flex items-center gap-1 text-xs', interactiveRowSecondary())}>
                        <MapPin className="h-3 w-3" /> {d.city || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={reviveStatusPill(
                          d.status === 'active' ? 'success' : d.status === 'blocked' ? 'warning' : 'muted'
                        )}
                      >
                        {statusLabel(d.status)}
                      </span>
                      <div className={cn('mt-1 text-[10px]', interactiveRowMuted())}>
                        {d.driver_type === 'daily' ? 'Diarista' : 'Fixo'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                            setMenu((cur) => (cur?.id === d.id ? null : { id: d.id, x: rect.right, y: rect.bottom }));
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded hover:bg-sidebar-accent/40"
                          title="Ações"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        {menu?.id === d.id
                          ? createPortal(
                              <div
                                ref={menuRef}
                                style={{ position: 'fixed', top: menu.y + 6, left: menu.x, transform: 'translateX(-100%)' }}
                                className="z-[100] w-44 rounded-xl border border-border bg-card p-1 shadow-md"
                              >
                                {canManage ? (
                                  <Link
                                    href={`/drivers/new?id=${encodeURIComponent(d.id)}`}
                                    onClick={() => setMenu(null)}
                                    className={`${buttonVariants()} flex w-full justify-start`}
                                  >
                                    <Edit3 className="h-3.5 w-3.5" /> Editar
                                  </Link>
                                ) : null}
                                <button
                                  onClick={() => {
                                    setMenu(null);
                                    navigator.clipboard?.writeText(d.phone || '').catch(() => undefined);
                                  }}
                                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60"
                                >
                                  Copiar telefone
                                </button>
                                <button
                                  onClick={() => {
                                    setMenu(null);
                                    void setDriverStatus(d, d.status === 'active' ? 'inactive' : 'active');
                                  }}
                                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60"
                                >
                                  {d.status === 'active' ? 'Inativar' : 'Ativar'}
                                </button>
                                <button
                                  onClick={() => {
                                    setMenu(null);
                                    void setDriverStatus(d, d.status === 'blocked' ? 'active' : 'blocked');
                                  }}
                                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60"
                                >
                                  {d.status === 'blocked' ? 'Desbloquear' : 'Bloquear'}
                                </button>
                              </div>,
                              document.body
                            )
                          : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls page={safeCurrentPage} totalItems={items.length} onPageChange={setCurrentPage} itemLabel="entregadores" />
      </div>

    </div>
  );
}
