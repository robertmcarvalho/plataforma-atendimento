'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, Building2, Calendar, Crown, Mail, MapPin, Phone, Shield, Truck } from 'lucide-react';
import api from '@/lib/api';
import { DriverWorkScheduleEditor } from '@/components/cadastro/DriverWorkScheduleEditor';
import { serializeWorkScheduleForApi } from '@/components/settings/BusinessHoursEditor';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatBrazilPhone, formatCnpj, formatCpf } from '@/lib/brFormat';
import { DriverDocumentationSection } from '@/components/cadastro/driver/DriverDocumentationSection';
import { DriverDocumentHeaderBadge } from '@/components/cadastro/driver/DriverDocumentStatusBadge';
import { LeaderDetailField } from '@/components/leader/LeaderDetailField';

type DriverStatus = 'active' | 'inactive' | 'blocked';
type DriverType = 'fixed' | 'daily';

type ApiDriverPharmacyLink = {
  is_primary: boolean;
  is_active: boolean;
  pharmacies: { id: string; trade_name: string; city: string | null } | null;
};

export type LeaderDriverDetail = {
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
  is_leader: boolean;
  cnh_number: string | null;
  cnh_expires_at: string | null;
  pix_key_type: string | null;
  work_schedule: Record<string, unknown> | null;
  primary_pharmacy: { id: string; trade_name: string; city: string | null } | null;
  driver_pharmacy_links: ApiDriverPharmacyLink[];
  vehicle_model?: string | null;
  vehicle_plate?: string | null;
};

const STATUS_LABEL: Record<DriverStatus, string> = {
  active: 'ativo',
  blocked: 'bloqueado',
  inactive: 'inativo',
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

function cnhLabel(expiresAt: string | null | undefined) {
  if (!expiresAt) return 'Não informada';
  const dt = new Date(expiresAt);
  if (Number.isNaN(dt.getTime())) return 'Não informada';
  const days = Math.ceil((dt.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'Vencida';
  if (days <= 30) return `Vence em ${days} dias`;
  return 'Válida';
}

type Props = {
  driverId: string | null;
};

export function LeaderDriverDetailPanel({ driverId }: Props) {
  const queryClient = useQueryClient();
  const [scheduleDraft, setScheduleDraft] = useState<Record<string, unknown> | null>(null);

  const detailQuery = useQuery<LeaderDriverDetail>({
    queryKey: ['leader-portal', 'driver-detail', driverId],
    enabled: Boolean(driverId),
    queryFn: async () => (await api.get(`/api/leader-portal/drivers/${driverId}`)).data as LeaderDriverDetail,
  });

  const driver = detailQuery.data ?? null;

  useEffect(() => {
    setScheduleDraft(driver?.work_schedule ?? null);
  }, [driver?.id, driver?.work_schedule]);

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

  const saveScheduleMutation = useMutation({
    mutationFn: async (payload: { driverId: string; work_schedule: Record<string, unknown> }) => {
      const res = await api.patch(`/api/leader-portal/drivers/${payload.driverId}/schedule`, {
        work_schedule: payload.work_schedule,
      });
      return res.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['leader-portal', 'drivers'] });
      await queryClient.invalidateQueries({ queryKey: ['leader-portal', 'driver-detail', driverId] });
    },
  });

  if (!driverId) {
    return <div className="p-6 text-sm text-muted-foreground">Selecione um entregador…</div>;
  }

  if (detailQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando ficha…</div>;
  }

  if (detailQuery.isError || !driver) {
    return <div className="p-6 text-sm text-destructive">Não foi possível carregar a ficha.</div>;
  }

  const vehicleLabel = [driver.vehicle_model, driver.vehicle_plate].filter(Boolean).join(' · ') || null;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-channel-instagram text-base font-semibold text-primary-foreground">
              {initials(driver.name)}
            </div>
            {driver.is_leader ? (
              <div className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-warning text-warning-foreground">
                <Crown className="h-3.5 w-3.5" />
              </div>
            ) : null}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{driver.name}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{driver.primary_pharmacy?.trade_name || 'Sem farmácia primária'}</span>
              <DriverDocumentHeaderBadge
                cnhExpiresAt={driver.cnh_expires_at}
                hasDigitalCertificate={driver.has_digital_certificate}
                digitalCertificateExpiresAt={driver.digital_certificate_expires_at}
              />
            </div>
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
            driver.status === 'active'
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-border bg-background/40 text-muted-foreground'
          )}
        >
          {STATUS_LABEL[driver.status]}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <LeaderDetailField icon={Phone} label="Telefone" value={formatBrazilPhone(driver.phone) || driver.phone} />
        <LeaderDetailField icon={Mail} label="E-mail" value={driver.email} />
        <LeaderDetailField icon={Bike} label="Veículo" value={vehicleLabel || driver.vehicle_model} />
        <LeaderDetailField icon={MapPin} label="Placa" value={driver.vehicle_plate} />
        <LeaderDetailField icon={Shield} label="CNH" value={cnhLabel(driver.cnh_expires_at)} />
        <LeaderDetailField icon={Truck} label="Vínculo" value={driver.primary_pharmacy?.trade_name} />
        {driver.cpf ? <LeaderDetailField icon={Shield} label="CPF" value={formatCpf(driver.cpf) || driver.cpf} /> : null}
        {driver.mei_cnpj ? <LeaderDetailField icon={Building2} label="CNPJ MEI" value={formatCnpj(driver.mei_cnpj) || driver.mei_cnpj} /> : null}
      </div>

      <div className="border-t border-border pt-5">
        <DriverDocumentationSection driver={driver} />
      </div>

      {pharmacies.length > 0 ? (
        <div className="border-t border-border pt-5">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Farmácias vinculadas</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {pharmacies.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.trade_name}</div>
                  <div className="font-mono text-[10px] text-subtle-foreground">{p.city || '—'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="border-t border-border pt-5">
        <div className="mb-3 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Escala (rodízio semanal)</h4>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">
          Você pode ajustar apenas a escala deste entregador. Demais dados da ficha são mantidos pelo time de cadastro.
        </p>
        <DriverWorkScheduleEditor value={scheduleDraft || driver.work_schedule || {}} onChange={setScheduleDraft} />
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            disabled={saveScheduleMutation.isPending}
            onClick={() => {
              void saveScheduleMutation.mutateAsync({
                driverId: driver.id,
                work_schedule: serializeWorkScheduleForApi(scheduleDraft || driver.work_schedule || {}),
              });
            }}
          >
            {saveScheduleMutation.isPending ? 'Salvando…' : 'Salvar escala'}
          </Button>
        </div>
      </div>
    </div>
  );
}
