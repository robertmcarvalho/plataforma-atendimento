'use client';

import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Calendar,
  ChevronRight,
  Clock,
  CreditCard,
  Crown,
  Edit3,
  FileText,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Truck,
  Star,
  Car,
  Link2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusDot } from '@/components/ui/StatusDot';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatBrazilPhone, formatCep, formatCnpj, formatCpf } from '@/lib/brFormat';
import { cadastroStatusDot } from '@/lib/cadastroStatus';
import { DriverDocumentationSection } from '@/components/cadastro/driver/DriverDocumentationSection';
import { DriverDocumentHeaderBadge } from '@/components/cadastro/driver/DriverDocumentStatusBadge';
import { ensureBusinessHoursPayload } from '@/components/settings/BusinessHoursEditor';

type DriverStatus = 'active' | 'inactive' | 'blocked';
type DriverType = 'fixed' | 'daily';

type ApiDriverPharmacyLink = {
  id: string;
  is_primary: boolean;
  is_active: boolean;
  started_at: string | null;
  ended_at: string | null;
  notes: string | null;
  pharmacies: { id: string; trade_name: string; city: string | null } | null;
};

type ApiDriverDetail = {
  id: string;
  name: string;
  cpf: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  status: DriverStatus;
  driver_type: DriverType;
  is_mei: boolean;
  mei_cnpj: string | null;
  has_digital_certificate: boolean;
  digital_certificate_expires_at: string | null;
  pix_key: string | null;
  pix_key_type: string | null;
  whatsapp: string | null;
  birth_date: string | null;
  cnh_number: string | null;
  cnh_expires_at: string | null;
  address_cep: string | null;
  address_street: string | null;
  address_number: string | null;
  address_neighborhood: string | null;
  address_complement: string | null;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_renavam: string | null;
  vehicle_model_year: string | null;
  flux_delivery_driver_id: string | null;
  flux_delivery_synced_at: string | null;
  is_leader: boolean;
  work_schedule: unknown | null;
  primary_pharmacy: { id: string; trade_name: string; city: string | null; leader_id: string | null } | null;
  override_leader: { id: string; name: string } | null;
  driver_pharmacy_links: ApiDriverPharmacyLink[];
};

const STATUS_LABEL: Record<DriverStatus, string> = {
  active: 'Ativo',
  blocked: 'Bloqueado',
  inactive: 'Inativo',
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

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DriverFichaPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || '';

  const driverQuery = useQuery<ApiDriverDetail>({
    queryKey: ['driver-ficha', id],
    enabled: Boolean(id),
    queryFn: async () => await cadastroPageApi.fetchDriver(id) as ApiDriverDetail,
  });

  const driver = driverQuery.data || null;

  const leader = useMemo(() => {
    if (!driver) return null;
    if (driver.override_leader?.id) return { id: driver.override_leader.id, name: driver.override_leader.name };
    if (driver.primary_pharmacy?.leader_id) {
      const leaderName =
        (driver.primary_pharmacy as { leader?: { name?: string } }).leader?.name?.trim() || 'Líder';
      return { id: driver.primary_pharmacy.leader_id, name: leaderName };
    }
    return null;
  }, [driver]);

  const pharmacies = useMemo(() => {
    const links = (driver?.driver_pharmacy_links || []).filter((l) => l.is_active && l.pharmacies?.id);
    const seen = new Set<string>();
    return links
      .map((l) => l.pharmacies!)
      .filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
  }, [driver?.driver_pharmacy_links]);

  const weekGrid = useMemo(() => {
    const cfg = ensureBusinessHoursPayload(driver?.work_schedule);
    const meta = [
      { key: 'monday' as const, label: 'Seg' },
      { key: 'tuesday' as const, label: 'Ter' },
      { key: 'wednesday' as const, label: 'Qua' },
      { key: 'thursday' as const, label: 'Qui' },
      { key: 'friday' as const, label: 'Sex' },
      { key: 'saturday' as const, label: 'Sáb' },
      { key: 'sunday' as const, label: 'Dom' },
    ];
    return meta.map((d) => {
      const day = cfg.weekly[d.key];
      const interval = day?.intervals?.[0];
      const turno = day?.is_open && interval?.start && interval?.end ? `${interval.start} - ${interval.end}` : 'Folga';
      return { dia: d.label, turno };
    });
  }, [driver?.work_schedule]);

  const exportData = useMemo(() => {
    if (!driver) return null;
    return {
      id: driver.id,
      name: driver.name,
      cpf: driver.cpf,
      phone: driver.phone,
      email: driver.email,
      city: driver.city,
      state: driver.state,
      status: driver.status,
      driver_type: driver.driver_type,
      is_mei: driver.is_mei,
      mei_cnpj: driver.mei_cnpj,
      has_digital_certificate: driver.has_digital_certificate,
      digital_certificate_expires_at: driver.digital_certificate_expires_at,
      pix_key: driver.pix_key,
      is_leader: driver.is_leader,
      work_schedule: driver.work_schedule,
      pharmacies,
      leader,
    };
  }, [driver, pharmacies, leader]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <Link href="/drivers" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Voltar para entregadores
        </Link>

        <PageHeader
          icon={Truck}
          eyebrow="Pessoas · Ficha"
          title="Ficha do entregador"
          description="Cadastro completo, escala, vínculos e histórico operacional."
          actions={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!exportData) return;
                  downloadJson(`entregador_${id}.json`, exportData);
                }}
                disabled={!exportData}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), !exportData && 'opacity-50 pointer-events-none')}
              >
                <FileText className="h-3.5 w-3.5" /> Exportar
              </button>
              <Link
                href={`/drivers/new?id=${encodeURIComponent(id)}`}
                className={buttonVariants()}
              >
                <Edit3 className="h-3.5 w-3.5" /> Editar
              </Link>
            </div>
          }
        />

        {driverQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : driverQuery.isError || !driver ? (
          <div className="text-sm text-destructive">Não foi possível carregar a ficha do entregador.</div>
        ) : (
          <>
            {/* Identificação */}
            <section className="mb-5 rounded-xl border border-border bg-surface p-6">
              <div className="flex items-start gap-4">
                <div className="relative">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-channel-whatsapp/40 to-primary/40 text-lg font-semibold">
                    {initials(driver.name)}
                  </div>
                  {driver.is_leader ? (
                    <div className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-warning text-warning-foreground">
                      <Crown className="h-3.5 w-3.5" />
                    </div>
                  ) : null}
                  <StatusDot status={cadastroStatusDot(driver.status)} pulse={driver.status === 'active'} className="absolute -bottom-0.5 -right-0.5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold">{driver.name}</h2>
                    <span
                      className={cn(
                        'rounded px-2 py-0.5 text-[10px] font-medium',
                        driver.status === 'active' && 'bg-success/15 text-success',
                        driver.status === 'blocked' && 'bg-warning/15 text-warning',
                        driver.status === 'inactive' && 'bg-muted/50 text-subtle-foreground'
                      )}
                    >
                      {STATUS_LABEL[driver.status]}
                    </span>
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {driver.driver_type === 'daily' ? 'Diarista' : 'Fixo'}
                    </span>
                    {driver.flux_delivery_driver_id ? (
                      <span className="rounded bg-info/15 px-2 py-0.5 text-[10px] font-medium text-info">
                        Sincronizado Flux
                      </span>
                    ) : null}
                    <DriverDocumentHeaderBadge
                      cnhExpiresAt={driver.cnh_expires_at}
                      hasDigitalCertificate={driver.has_digital_certificate}
                      digitalCertificateExpiresAt={driver.digital_certificate_expires_at}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                    {driver.email ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="h-3 w-3" /> {driver.email}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1.5 font-mono">
                      <Phone className="h-3 w-3" /> {formatBrazilPhone(driver.phone) || driver.phone}
                    </span>
                    {driver.whatsapp ? (
                      <span className="inline-flex items-center gap-1.5 font-mono">
                        WhatsApp · {formatBrazilPhone(driver.whatsapp) || driver.whatsapp}
                      </span>
                    ) : null}
                    {driver.cpf ? <span className="inline-flex items-center gap-1.5 font-mono">CPF · {formatCpf(driver.cpf) || driver.cpf}</span> : null}
                    {driver.birth_date ? <span>Nasc. · {driver.birth_date}</span> : null}
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" /> {driver.city && driver.state ? `${driver.city} - ${driver.state}` : driver.city || driver.state || '—'}
                    </span>
                    {driver.flux_delivery_driver_id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Link2 className="h-3 w-3" /> Flux ID {driver.flux_delivery_driver_id}
                        {driver.flux_delivery_synced_at
                          ? ` · sync ${new Date(driver.flux_delivery_synced_at).toLocaleString('pt-BR')}`
                          : ''}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Indicadores não mapeados no projeto (entregas/mês, avaliação, SLA) */}
                <div className="hidden grid-cols-3 gap-5 border-l border-border pl-6">
                  <div>
                    <div className="font-mono text-2xl font-semibold">0</div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Entregas/mês</div>
                  </div>
                  <div>
                    <div className="font-mono text-2xl font-semibold inline-flex items-center gap-1">
                      0<Star className="h-3.5 w-3.5 fill-warning text-warning" />
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Avaliação</div>
                  </div>
                  <div>
                    <div className="font-mono text-2xl font-semibold text-success">0%</div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">SLA</div>
                  </div>
                </div>
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-3">
              {/* Coluna principal */}
              <div className="space-y-5 lg:col-span-2">
                <DriverDocumentationSection driver={driver} />

                {/* Farmácias vinculadas */}
                <section className="rounded-xl border border-border bg-surface p-5">
                  <h3 className="mb-3 text-sm font-semibold">Farmácias vinculadas</h3>
                  {pharmacies.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Nenhuma farmácia vinculada.</div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {pharmacies.map((p) => (
                        <Link
                          key={p.id}
                          href={`/pharmacies/${p.id}`}
                          className="group flex items-center gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-sidebar-accent/40"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
                            <Building2 className="h-4.5 w-4.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{p.trade_name}</div>
                            <div className="font-mono text-[10px] text-subtle-foreground">{p.city || '—'}</div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                        </Link>
                      ))}
                    </div>
                  )}
                </section>

                {/* Escala */}
                <section className="rounded-xl border border-border bg-surface p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
                      <Calendar className="h-3.5 w-3.5" /> Escala semanal
                    </h3>
                    <Link href={`/drivers?edit=${encodeURIComponent(id)}&focus=work_schedule`} className="text-[11px] font-medium text-primary hover:underline">
                      Editar escala
                    </Link>
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {weekGrid.map((d) => (
                      <div
                        key={d.dia}
                        className={cn(
                          'rounded-md border p-2 text-center',
                          d.turno === 'Folga' ? 'border-border/50 bg-muted/30' : 'border-border bg-background'
                        )}
                      >
                        <div className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">{d.dia}</div>
                        <div className={cn('mt-1 font-mono text-[10px]', d.turno === 'Folga' ? 'text-subtle-foreground' : 'text-foreground')}>{d.turno}</div>
                      </div>
                    ))}
                  </div>
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
                {leader?.id ? (
                  <section className="rounded-xl border border-border bg-surface p-5">
                    <h3 className="mb-3 text-sm font-semibold">Líder responsável</h3>
                    <Link
                      href={`/leaders/${leader.id}`}
                      className="group flex items-center gap-3 rounded-lg border border-border bg-background p-3 hover:border-primary/40 hover:bg-sidebar-accent/40"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-warning/20 text-warning">
                        <Crown className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium">{leader.name}</div>
                        <div className="text-[10px] text-subtle-foreground">Ver ficha do líder</div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    </Link>
                  </section>
                ) : null}

                {/* Indicadores não mapeados no projeto (veículo / métricas gerais) */}
                <section className="hidden rounded-xl border border-border bg-surface p-5">
                  <h3 className="mb-3 text-sm font-semibold">Veículo</h3>
                </section>
                <section className="hidden rounded-xl border border-border bg-surface p-5">
                  <h3 className="mb-3 text-sm font-semibold">Métricas gerais</h3>
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
