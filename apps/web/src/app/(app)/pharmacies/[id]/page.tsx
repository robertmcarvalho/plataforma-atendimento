'use client';

import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  CalendarDays,
  Clock,
  Crown,
  FileText,
  Headphones,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Truck,
  Wallet,
  Wrench,
  Edit3,
  DollarSign,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusDot } from '@/components/ui/StatusDot';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { interactiveRowSurface } from '@/lib/interactiveRow';
import { formatBrazilPhone, formatCep, formatCnpj } from '@/lib/brFormat';
import { cadastroStatusDot } from '@/lib/cadastroStatus';
import {
  ensureBusinessHoursPayload,
  formatWorkScheduleSummary,
  hasConfiguredWorkSchedule,
  type Weekday,
} from '@/components/settings/BusinessHoursEditor';
import { formatIsoDateBr } from '@/lib/datetimeBr';
import { formatCentsBRL } from '@/lib/pharmacyCommercial';
import { useBillingModuleEnabled } from '@/lib/billing/useBillingQueries';

type ApiPharmacySummary = {
  id: string;
  trade_name: string;
  legal_name: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  status: 'active' | 'inactive';
  leader?: { id: string; name: string } | null;
  drivers_count: number;
  open_conversations: number;
  sla_percent: number;
  sla_days: number;
};

type ApiPharmacyDetail = {
  id: string;
  trade_name: string;
  legal_name: string;
  primary_attendant?: { id: string; name: string; email?: string | null } | null;
  secondary_attendant?: { id: string; name: string; email?: string | null } | null;
  pharmacy_sector_attendants?: Array<{
    sector_id: string;
    attendant_id: string;
    sector?: { id: string; name: string } | null;
    attendant?: { id: string; name: string } | null;
  }>;
  cnpj?: string | null;
  address_cep?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_complement?: string | null;
  contact_expedition_name?: string | null;
  contact_expedition_phone?: string | null;
  contact_expedition_email?: string | null;
  contact_financial_name?: string | null;
  contact_financial_phone?: string | null;
  contact_financial_email?: string | null;
  contact_manager_name?: string | null;
  contact_manager_phone?: string | null;
  contact_manager_email?: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  status: 'active' | 'inactive';
  leader?: { id: string; name: string; phone?: string | null } | null;
  driver_pharmacy_links?: Array<{
    id: string;
    is_primary: boolean;
    is_active: boolean;
    started_at: string | null;
    drivers?: { id: string; name: string; phone: string; status: string; work_schedule?: unknown | null } | null;
  }>;
  delivery_fee_cents?: number | null;
  delivery_fee_driver_payout_cents?: number | null;
  minimum_guaranteed_cents?: number | null;
  minimum_guaranteed_driver_payout_cents?: number | null;
  delivery_schedule?: Record<string, unknown> | null;
  commercial_terms?: string[];
  delivery_schedule_summary?: string;
  delivery_open_now?: boolean | null;
  billing_cost_center_id?: string | null;
  contract_scope?: 'flux_only' | 'coop_only' | 'both';
  billing_email?: string | null;
  mg_enabled?: boolean;
  flux_codpes?: number | null;
  flux_codloc?: number | null;
};

type EntStatus = 'active' | 'blocked' | 'inactive';

const ENT_STATUS_LABEL: Record<EntStatus, string> = {
  active: 'Ativo',
  blocked: 'Bloqueado',
  inactive: 'Inativo',
};

const SETOR_ICONS = {
  geral: MessageSquare,
  financeiro: Wallet,
  operacional: Headphones,
  suporte: Wrench,
};

const SETOR_SLOTS = [
  ['geral', 'Atendimento Geral'],
  ['financeiro', 'Financeiro'],
  ['operacional', 'Operacional'],
  ['suporte', 'Suporte Técnico'],
] as const;

const DELIVERY_DAY_LABELS: { key: Weekday; label: string }[] = [
  { key: 'monday', label: 'Seg' },
  { key: 'tuesday', label: 'Ter' },
  { key: 'wednesday', label: 'Qua' },
  { key: 'thursday', label: 'Qui' },
  { key: 'friday', label: 'Sex' },
  { key: 'saturday', label: 'Sáb' },
  { key: 'sunday', label: 'Dom' },
];

function joinNonEmpty(parts: Array<string | null | undefined>, sep = ' · ') {
  return parts.map((p) => String(p || '').trim()).filter(Boolean).join(sep);
}

function formatAddress(detail: ApiPharmacyDetail) {
  const line = joinNonEmpty([detail.address_street, detail.address_number], ', ');
  const extra = joinNonEmpty([detail.address_neighborhood, detail.address_complement], ' · ');
  const city = joinNonEmpty([detail.city, detail.state], ' / ');
  const left = joinNonEmpty([line, extra], ' · ');
  return joinNonEmpty([left, city], ' · ');
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PharmacyFichaPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || '';
  const billingModuleEnabled = useBillingModuleEnabled(Boolean(id));

  const detailQuery = useQuery<ApiPharmacyDetail>({
    queryKey: ['pharmacy-ficha', id],
    enabled: Boolean(id),
    queryFn: async () => await cadastroPageApi.fetchPharmacy(id) as ApiPharmacyDetail,
  });

  const summaryQuery = useQuery<ApiPharmacySummary[]>({
    queryKey: ['pharmacies', 'summary'],
    enabled: Boolean(id),
    queryFn: async () => await cadastroPageApi.fetchPharmaciesSummary() as ApiPharmacySummary[],
  });

  const detail = detailQuery.data || null;
  const summary = useMemo(() => (summaryQuery.data || []).find((p) => p.id === id) || null, [summaryQuery.data, id]);

  const contatos = useMemo(() => {
    if (!detail) return [];
    return [
      {
        tag: 'Principal',
        accent: 'text-primary',
        name: detail.primary_attendant?.name || '',
        role: '',
        phone: '',
        email: detail.primary_attendant?.email || '',
      },
      {
        tag: 'Secundário',
        accent: 'text-foreground',
        name: detail.secondary_attendant?.name || '',
        role: '',
        phone: '',
        email: detail.secondary_attendant?.email || '',
      },
      {
        tag: 'Expedição',
        accent: 'text-subtle-foreground',
        name: detail.contact_expedition_name || '',
        role: '',
        phone: formatBrazilPhone(detail.contact_expedition_phone || ''),
        email: detail.contact_expedition_email || '',
      },
      {
        tag: 'Financeiro',
        accent: 'text-subtle-foreground',
        name: detail.contact_financial_name || '',
        role: '',
        phone: formatBrazilPhone(detail.contact_financial_phone || ''),
        email: detail.contact_financial_email || '',
      },
      {
        tag: 'Gestor',
        accent: 'text-subtle-foreground',
        name: detail.contact_manager_name || '',
        role: '',
        phone: formatBrazilPhone(detail.contact_manager_phone || ''),
        email: detail.contact_manager_email || '',
      },
    ] as const;
  }, [detail]);

  const atendentesPorSetor = useMemo(() => {
    const map: Record<(typeof SETOR_SLOTS)[number][0], string> = {
      geral: '',
      financeiro: '',
      operacional: '',
      suporte: '',
    };
    for (const r of detail?.pharmacy_sector_attendants || []) {
      if (!r.attendant_id) continue;
      const name = String(r.sector?.name || r.sector_id || '').toLowerCase();
      const key =
        name.includes('finan') ? 'financeiro' : name.includes('oper') ? 'operacional' : name.includes('suport') ? 'suporte' : 'geral';
      map[key] = r.attendant?.name || r.attendant_id;
    }
    if (!map.geral && detail?.primary_attendant?.name) map.geral = detail.primary_attendant.name;
    return map;
  }, [detail?.pharmacy_sector_attendants, detail?.primary_attendant?.name]);

  const deliveryScheduleCfg = useMemo(
    () => (detail?.delivery_schedule ? ensureBusinessHoursPayload(detail.delivery_schedule) : null),
    [detail?.delivery_schedule],
  );

  const deliveryHolidays = useMemo(() => {
    if (!deliveryScheduleCfg) return [];
    return [...deliveryScheduleCfg.holidays]
      .filter((h) => !String(h.name || '').startsWith('EXC:'))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [deliveryScheduleCfg]);

  const linkedDrivers = useMemo(() => {
    const links = (detail?.driver_pharmacy_links || []).filter((l) => l.is_active && l.drivers?.id);
    const out = links.map((l) => {
      const d = l.drivers!;
      const status = String(d.status || 'inactive') as EntStatus;
      return {
        id: d.id,
        name: d.name,
        phone: d.phone,
        status,
        schedule: hasConfiguredWorkSchedule(d.work_schedule) ? formatWorkScheduleSummary(d.work_schedule) : '',
      };
    });
    return out;
  }, [detail?.driver_pharmacy_links]);

  const activeDriversCount = useMemo(
    () => linkedDrivers.filter((d) => d.status === 'active').length,
    [linkedDrivers],
  );

  const exportData = useMemo(() => {
    if (!detail) return null;
    return {
      id: detail.id,
      trade_name: detail.trade_name,
      legal_name: detail.legal_name,
      status: detail.status,
      city: detail.city,
      state: detail.state,
      phone: detail.phone,
      cnpj: detail.cnpj,
      address: {
        cep: detail.address_cep,
        street: detail.address_street,
        number: detail.address_number,
        neighborhood: detail.address_neighborhood,
        complement: detail.address_complement,
      },
      contacts: {
        expedition: {
          name: detail.contact_expedition_name,
          phone: detail.contact_expedition_phone,
          email: detail.contact_expedition_email,
        },
        financial: {
          name: detail.contact_financial_name,
          phone: detail.contact_financial_phone,
          email: detail.contact_financial_email,
        },
        manager: {
          name: detail.contact_manager_name,
          phone: detail.contact_manager_phone,
          email: detail.contact_manager_email,
        },
      },
      attendants: {
        primary: detail.primary_attendant,
        secondary: detail.secondary_attendant,
        sectors: detail.pharmacy_sector_attendants || [],
      },
      drivers: linkedDrivers,
      summary,
    };
  }, [detail, linkedDrivers, summary]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <Link href="/pharmacies" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Voltar para farmácias
        </Link>

        <PageHeader
          icon={Building2}
          eyebrow="Operação · Ficha"
          title="Ficha da farmácia"
          description="Cadastro completo, contatos, atendentes e equipe vinculada."
          actions={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!exportData) return;
                  downloadJson(`farmacia_${id}.json`, exportData);
                }}
                disabled={!exportData}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), !exportData && 'opacity-50 pointer-events-none')}
              >
                <FileText className="h-3.5 w-3.5" /> Exportar
              </button>
              <Link
                href={`/pharmacies/new?id=${encodeURIComponent(id)}`}
                className={buttonVariants()}
              >
                <Edit3 className="h-3.5 w-3.5" /> Editar
              </Link>
            </div>
          }
        />

        {detailQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : detailQuery.isError || !detail ? (
          <div className="text-sm text-destructive">Não foi possível carregar a ficha da farmácia.</div>
        ) : (
          <>
            {/* Identificação */}
            <section className="mb-5 rounded-xl border border-border bg-surface p-6">
              <div className="flex items-start gap-4">
                <div className="relative">
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground">
                    <Building2 className="h-7 w-7" />
                  </div>
                  <StatusDot status={cadastroStatusDot(detail.status)} pulse={detail.status === 'active'} className="absolute -bottom-0.5 -right-0.5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold">{detail.trade_name}</h2>
                    <span
                      className={cn(
                        'rounded px-2 py-0.5 text-[10px] font-medium',
                        detail.status === 'active' ? 'bg-success/15 text-success' : 'bg-muted/50 text-subtle-foreground'
                      )}
                    >
                      {detail.status === 'active' ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" /> {formatAddress(detail) || '—'}
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-mono">
                      <Phone className="h-3 w-3" /> {formatBrazilPhone(detail.phone || '') || '—'}
                    </span>
                    {detail.contact_manager_email ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="h-3 w-3" /> {detail.contact_manager_email}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1.5 font-mono">CNPJ · {formatCnpj(detail.cnpj || '') || '—'}</span>
                  </div>
                </div>

                {summary ? (
                  <div className="grid grid-cols-3 gap-5 border-l border-border pl-6">
                    <div>
                      <div className="font-mono text-2xl font-semibold">{summary.drivers_count}</div>
                      <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Entregadores</div>
                    </div>
                    <div>
                      <div className="font-mono text-2xl font-semibold text-success">{Number(summary.sla_percent || 0).toFixed(0)}%</div>
                      <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">SLA</div>
                    </div>
                    <div>
                      <div className="font-mono text-2xl font-semibold">{summary.open_conversations}</div>
                      <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Conv. abertas</div>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-3">
              {/* Main */}
              <div className="space-y-5 lg:col-span-2">
                {/* Contatos */}
                <section className="rounded-xl border border-border bg-surface p-5">
                  <h3 className="mb-3 text-sm font-semibold">Contatos por perfil</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {contatos.map((it) => (
                      <div key={it.tag} className="rounded-lg border border-border bg-background p-3">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className={cn('text-[10px] font-medium uppercase tracking-wider', it.accent || 'text-subtle-foreground')}>{it.tag}</span>
                        </div>
                        <div className="text-sm font-medium">{it.name || '—'}</div>
                        {it.role ? <div className="text-[11px] text-muted-foreground">{it.role}</div> : null}
                        {it.phone ? <div className="mt-1 font-mono text-xs text-muted-foreground">{it.phone}</div> : null}
                        {it.email ? <div className="text-[11px] text-muted-foreground truncate">{it.email}</div> : null}
                      </div>
                    ))}
                  </div>
                </section>

                {/* Atendentes por setor */}
                <section className="rounded-xl border border-border bg-surface p-5">
                  <h3 className="mb-3 text-sm font-semibold">Atendentes por setor</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {SETOR_SLOTS.map(([key, label]) => {
                      const Icon = SETOR_ICONS[key];
                      return (
                        <div key={key} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1">
                            <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">{label}</div>
                            <div className="text-sm font-medium">{atendentesPorSetor[key] || '—'}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Condições comerciais */}
                <section className="rounded-xl border border-border bg-surface p-5">
                  <h3 className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                    <DollarSign className="h-3.5 w-3.5" /> Condições comerciais
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-border bg-background p-3">
                      <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Taxa de entrega</div>
                      <div className="mt-1 font-mono text-sm font-medium">{formatCentsBRL(detail.delivery_fee_cents)}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-background p-3">
                      <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Taxa repassada ao entregador</div>
                      <div className="mt-1 font-mono text-sm font-medium">{formatCentsBRL(detail.delivery_fee_driver_payout_cents)}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-background p-3">
                      <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Mínimo garantido</div>
                      <div className="mt-1 font-mono text-sm font-medium">{formatCentsBRL(detail.minimum_guaranteed_cents)}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-background p-3">
                      <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Mínimo garantido repassado</div>
                      <div className="mt-1 font-mono text-sm font-medium">{formatCentsBRL(detail.minimum_guaranteed_driver_payout_cents)}</div>
                    </div>
                  </div>
                  <div className="mt-3 rounded-md border border-dashed border-border bg-background/40 p-3 text-[11px] text-muted-foreground">
                    Valores em reais (BRL). O repasse ao entregador não pode exceder o valor cobrado da farmácia.
                  </div>
                </section>

                {billingModuleEnabled ? (
                  <section className="rounded-xl border border-border bg-surface p-5">
                    <h3 className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                      <Wallet className="h-3.5 w-3.5" /> Faturamento
                    </h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-border bg-background p-3">
                        <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Contrato</div>
                        <div className="mt-1 text-sm font-medium capitalize">{detail.contract_scope?.replace('_', ' ') || 'both'}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-background p-3">
                        <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">E-mail faturamento</div>
                        <div className="mt-1 text-sm font-medium">{detail.billing_email || '—'}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-background p-3">
                        <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">MG ativo</div>
                        <div className="mt-1 text-sm font-medium">{detail.mg_enabled === false ? 'Não' : 'Sim'}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-background p-3">
                        <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Flux CodPes / CodLoc</div>
                        <div className="mt-1 font-mono text-sm font-medium">
                          {detail.flux_codpes ?? '—'} / {detail.flux_codloc ?? '—'}
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {/* Horário delivery */}
                <section className="rounded-xl border border-border bg-surface p-5">
                  <h3 className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                    <CalendarDays className="h-3.5 w-3.5" /> Horário de funcionamento do delivery
                  </h3>
                  {deliveryScheduleCfg && hasConfiguredWorkSchedule(detail.delivery_schedule) ? (
                    <>
                      <div className="overflow-hidden rounded-md border border-border">
                        <table className="w-full text-xs">
                          <thead className="bg-background">
                            <tr className="text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
                              <th className="px-3 py-2">Dia</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2">Início</th>
                              <th className="px-3 py-2">Fim</th>
                            </tr>
                          </thead>
                          <tbody>
                            {DELIVERY_DAY_LABELS.map(({ key, label }) => {
                              const day = deliveryScheduleCfg.weekly[key];
                              const active = Boolean(day.is_open && day.intervals.length > 0);
                              const start = day.intervals[0]?.start || '—';
                              const end = day.intervals[0]?.end || '—';
                              return (
                                <tr key={key} className="border-t border-border/60">
                                  <td className="px-3 py-2 font-medium">{label}</td>
                                  <td className="px-3 py-2">
                                    <span
                                      className={cn(
                                        'rounded px-2 py-0.5 text-[10px] font-medium',
                                        active ? 'bg-success/15 text-success' : 'bg-muted/50 text-subtle-foreground',
                                      )}
                                    >
                                      {active ? 'Aberto' : 'Fechado'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-mono text-muted-foreground">{active ? start : '—'}</td>
                                  <td className="px-3 py-2 font-mono text-muted-foreground">{active ? end : '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {deliveryHolidays.length > 0 ? (
                        <div className="mt-4">
                          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Feriados</h4>
                          <div className="space-y-2">
                            {deliveryHolidays.map((fer) => {
                              const abre = fer.is_open !== false && (fer.intervals?.length || 0) > 0;
                              const ini = fer.intervals?.[0]?.start || '';
                              const fim = fer.intervals?.[0]?.end || '';
                              return (
                                <div
                                  key={fer.date}
                                  className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background p-2.5 text-xs"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <CalendarDays className="h-3 w-3 text-muted-foreground" />
                                    <span className="font-mono">{formatIsoDateBr(fer.date)}</span>
                                  </div>
                                  <span className="font-medium">{fer.name || '—'}</span>
                                  <span
                                    className={cn(
                                      'rounded px-2 py-0.5 text-[10px] font-medium',
                                      abre ? 'bg-success/15 text-success' : 'bg-muted/50 text-subtle-foreground',
                                    )}
                                  >
                                    {abre ? `Aberto ${ini}–${fim}` : 'Fechado'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      {detail.delivery_open_now != null ? (
                        <div
                          className={cn(
                            'mt-3 inline-flex rounded px-2 py-0.5 text-[10px] font-medium',
                            detail.delivery_open_now ? 'bg-success/15 text-success' : 'bg-muted/50 text-subtle-foreground',
                          )}
                        >
                          Delivery agora: {detail.delivery_open_now ? 'aberto' : 'fechado'}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">Horário não configurado.</div>
                  )}
                </section>

                {/* Entregadores vinculados */}
                <section className="rounded-xl border border-border bg-surface p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
                      <Truck className="h-3.5 w-3.5" /> Entregadores vinculados
                    </h3>
                    <span className="font-mono text-[10px] text-subtle-foreground">
                      {activeDriversCount} ativos / {linkedDrivers.length} total
                    </span>
                  </div>
                  {linkedDrivers.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Nenhum vínculo ativo.</div>
                  ) : (
                    <div className="overflow-hidden rounded-md border border-border">
                      <table className="w-full text-xs">
                        <thead className="bg-background">
                          <tr className="text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
                            <th className="px-3 py-2">Entregador</th>
                            <th className="px-3 py-2">Telefone</th>
                            <th className="px-3 py-2">Escala</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2 w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {linkedDrivers.map((e) => (
                            <tr key={e.id} className={cn('border-t border-border/60', interactiveRowSurface())}>
                              <td className="px-3 py-2">
                                <Link href={`/drivers/${e.id}`} className="flex items-center gap-2 hover:underline">
                                  <div className="relative">
                                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-channel-whatsapp/40 to-primary/40 text-[10px] font-semibold">
                                      {e.name
                                        .trim()
                                        .split(/\s+/)
                                        .filter(Boolean)
                                        .slice(0, 2)
                                        .map((w) => w[0]?.toUpperCase())
                                        .join('') || '??'}
                                    </div>
                                    <StatusDot status={cadastroStatusDot(e.status)} className="absolute -bottom-0.5 -right-0.5" />
                                  </div>
                                  <span className="font-medium">{e.name}</span>
                                </Link>
                              </td>
                              <td className="px-3 py-2 font-mono text-muted-foreground">{formatBrazilPhone(e.phone) || '—'}</td>
                              <td className="px-3 py-2 text-muted-foreground">{e.schedule || '—'}</td>
                              <td className="px-3 py-2">
                                <span
                                  className={cn(
                                    'rounded px-2 py-0.5 text-[10px] font-medium',
                                    e.status === 'active' && 'bg-success/15 text-success',
                                    e.status === 'blocked' && 'bg-warning/15 text-warning',
                                    e.status === 'inactive' && 'bg-muted/50 text-subtle-foreground'
                                  )}
                                >
                                  {ENT_STATUS_LABEL[e.status]}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <Link href={`/drivers/${e.id}`}>
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* Histórico (não mapeado no projeto) */}
                <section className="hidden rounded-xl border border-border bg-surface p-5">
                  <h3 className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                    <Clock className="h-3.5 w-3.5" /> Histórico recente
                  </h3>
                </section>
              </div>

              {/* Sidebar */}
              <div className="space-y-5">
                {detail.leader?.id ? (
                  <section className="rounded-xl border border-border bg-surface p-5">
                    <h3 className="mb-3 text-sm font-semibold">Líder responsável</h3>
                    <Link
                      href={`/leaders/${detail.leader.id}`}
                      className="group flex items-center gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-primary/40 hover:bg-sidebar-accent/40"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-warning/20 text-warning">
                        <Crown className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{detail.leader.name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{formatBrazilPhone(detail.leader.phone || '') || ''}</div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    </Link>
                  </section>
                ) : null}

                <section className="rounded-xl border border-border bg-surface p-5">
                  <h3 className="mb-3 text-sm font-semibold">Dados cadastrais</h3>
                  <div className="space-y-2.5 text-xs">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Razão social</div>
                      <div className="mt-0.5">{detail.legal_name || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">CEP</div>
                      <div className="mt-0.5 font-mono">{formatCep(detail.address_cep || '') || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Endereço</div>
                      <div className="mt-0.5">{joinNonEmpty([detail.address_street, detail.address_number], ', ') || '—'}</div>
                    </div>
                  </div>
                </section>

                {/* Performance do mês (parcialmente mapeada) */}
                {summary ? (
                  <section className="rounded-xl border border-border bg-surface p-5">
                    <h3 className="mb-3 text-sm font-semibold">Performance do mês</h3>
                    <div className="space-y-2.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Conv. abertas</span>
                        <span className="font-mono font-medium">{summary.open_conversations}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">SLA</span>
                        <span className="font-mono font-medium text-success">{Number(summary.sla_percent || 0).toFixed(1)}%</span>
                      </div>
                    </div>
                  </section>
                ) : null}

                {summary ? (
                  <section className="rounded-xl border border-border bg-surface p-5">
                    <h3 className="mb-3 text-sm font-semibold">Equipe</h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Truck className="h-3.5 w-3.5" />
                      {summary.drivers_count} entregadores
                    </div>
                  </section>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

