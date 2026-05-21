'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Edit3, MapPin, MoreHorizontal, Plus, Search, Truck } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusDot } from '@/components/ui/StatusDot';
import api from '@/lib/api';
import { useAuth } from '@/store/auth';
import { canManageCadastro } from '@/lib/cadastroPermissions';
import { cn } from '@/lib/utils';
import { CadastroImportTrigger } from '@/components/cadastros/CadastroImportModal';
import { formatBrazilPhone } from '@/lib/brFormat';
import { DEFAULT_LIST_PAGE_SIZE, PaginationControls } from '@/components/ui/PaginationControls';
import { reviveHeaderPrimaryActionClass, revivePrimarySmActionClass } from '@/components/ui/reviveActionButtonStyles';

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

function statusToDot(status: DriverStatus) {
  if (status === 'active') return 'online';
  if (status === 'blocked') return 'busy';
  return 'offline';
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
  const [status, setStatus] = useState<DriverStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<DriverType | 'all'>('all');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [leaderFilter, setLeaderFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);

  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const driversQuery = useQuery({
    queryKey: ['drivers', { q, status }],
    enabled: canFetch,
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (q.trim()) params.search = q.trim();
      if (status !== 'all') params.status = status;
      const res = await api.get('/api/drivers', { params });
      return res.data as ApiDriver[];
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
      await api.put(`/api/drivers/${d.id}`, { status: next });
      await driversQuery.refetch();
    } catch {
      // ignore
    }
  };

  const clearFilters = () => {
    setCurrentPage(1);
    setStatus('all');
    setTypeFilter('all');
    setCityFilter('all');
    setStateFilter('all');
    setLeaderFilter('all');
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
          eyebrow="Operação"
          title="Entregadores"
          description="Cadastro e vínculo de entregadores."
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
                <Link href="/drivers/new" className={reviveHeaderPrimaryActionClass}>
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
            <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
              <div className={cn('text-xl font-semibold tracking-tight', s.accent)}>{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Toolbar (sem tabs Todos/Disponível/Em rota/Pausa/Offline) */}
        <div className="mb-4 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => {
                setCurrentPage(1);
                setQ(e.target.value);
              }}
              placeholder="Buscar entregador..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setCurrentPage(1);
              setStatus(e.target.value as DriverStatus | 'all');
            }}
            className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground outline-none"
          >
            <option value="all">Status</option>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
            <option value="blocked">Bloqueado</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => {
              setCurrentPage(1);
              setTypeFilter(e.target.value as DriverType | 'all');
            }}
            className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground outline-none"
          >
            <option value="all">Tipo</option>
            <option value="fixed">Fixo</option>
            <option value="daily">Diarista</option>
          </select>
          <select
            value={cityFilter}
            onChange={(e) => {
              setCurrentPage(1);
              setCityFilter(e.target.value);
            }}
            className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground outline-none"
          >
            <option value="all">Cidade</option>
            {cityOptions.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          <select
            value={stateFilter}
            onChange={(e) => {
              setCurrentPage(1);
              setStateFilter(e.target.value);
            }}
            className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground outline-none"
          >
            <option value="all">Estado</option>
            {stateOptions.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
          <select
            value={leaderFilter}
            onChange={(e) => {
              setCurrentPage(1);
              setLeaderFilter(e.target.value);
            }}
            className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground outline-none"
          >
            <option value="all">Líder</option>
            {leaderOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            Limpar filtros
          </button>
        </div>

        {driversQuery.isError ? <div className="mb-3 text-xs text-destructive">Falha ao carregar entregadores.</div> : null}

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-subtle-foreground">
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
                  <tr key={d.id} data-driver-id={d.id} className="border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/drivers/${d.id}`} className="flex items-center gap-2.5 hover:underline">
                        <div className="relative">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-channel-whatsapp/40 to-primary/40 text-[11px] font-semibold">
                            {initials(d.name)}
                          </div>
                          <StatusDot status={statusToDot(d.status)} className="absolute -bottom-0.5 -right-0.5" />
                        </div>
                      <div>
                        <div className="text-sm font-medium">{d.name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{formatBrazilPhone(d.phone) || d.phone}</div>
                      </div>
                    </Link>
                  </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{d.primary_pharmacy?.trade_name || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" /> {d.city || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'rounded px-2 py-0.5 text-[10px] font-medium',
                          d.status === 'active' && 'bg-success/15 text-success',
                          d.status === 'blocked' && 'bg-warning/15 text-warning',
                          d.status === 'inactive' && 'bg-muted text-muted-foreground'
                        )}
                      >
                        {statusLabel(d.status)}
                      </span>
                      <div className="mt-1 text-[10px] text-subtle-foreground">
                        {d.driver_type === 'daily' ? 'Diarista' : 'Fixo'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                            setMenu((cur) => (cur?.id === d.id ? null : { id: d.id, x: rect.right, y: rect.bottom }));
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded hover:bg-surface-elevated"
                          title="Ações"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        {menu?.id === d.id
                          ? createPortal(
                              <div
                                ref={menuRef}
                                style={{ position: 'fixed', top: menu.y + 6, left: menu.x, transform: 'translateX(-100%)' }}
                                className="z-[100] w-44 rounded-xl border border-border bg-surface-elevated p-1 shadow-glow"
                              >
                                {canManage ? (
                                  <Link
                                    href={`/drivers/new?id=${encodeURIComponent(d.id)}`}
                                    onClick={() => setMenu(null)}
                                    className={`${revivePrimarySmActionClass} flex w-full justify-start`}
                                  >
                                    <Edit3 className="h-3.5 w-3.5" /> Editar
                                  </Link>
                                ) : null}
                                <button
                                  onClick={() => {
                                    setMenu(null);
                                    navigator.clipboard?.writeText(d.phone || '').catch(() => undefined);
                                  }}
                                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover"
                                >
                                  Copiar telefone
                                </button>
                                <button
                                  onClick={() => {
                                    setMenu(null);
                                    void setDriverStatus(d, d.status === 'active' ? 'inactive' : 'active');
                                  }}
                                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover"
                                >
                                  {d.status === 'active' ? 'Inativar' : 'Ativar'}
                                </button>
                                <button
                                  onClick={() => {
                                    setMenu(null);
                                    void setDriverStatus(d, d.status === 'blocked' ? 'active' : 'blocked');
                                  }}
                                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-surface-hover"
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
