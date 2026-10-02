'use client';

import { CreditCard, MapPin, ShieldCheck, Car, FileText } from 'lucide-react';
import { formatCep, formatCnpj } from '@/lib/brFormat';
import { cn } from '@/lib/utils';
import {
  DriverDocumentHeaderBadge,
  DriverDocumentStatusBadge,
  useDriverDocumentStates,
} from '@/components/cadastro/driver/DriverDocumentStatusBadge';

export type DriverDocumentationFields = {
  cnh_number?: string | null;
  cnh_expires_at?: string | null;
  has_digital_certificate?: boolean | null;
  digital_certificate_expires_at?: string | null;
  is_mei?: boolean | null;
  mei_cnpj?: string | null;
  pix_key?: string | null;
  pix_key_type?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  address_neighborhood?: string | null;
  address_cep?: string | null;
  city?: string | null;
  state?: string | null;
  vehicle_plate?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  vehicle_renavam?: string | null;
  vehicle_model_year?: string | null;
};

/** Layout Revive `EntregadorFicha` — Documentação fiscal. */
export function DriverDocumentationSection({ driver }: { driver: DriverDocumentationFields }) {
  const { cnhState, certState } = useDriverDocumentStates(driver);
  const showExtras = driver.pix_key || driver.address_street || driver.vehicle_plate;

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h3 className="mb-3 text-sm font-semibold">Documentação fiscal</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium">MEI</span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium',
                driver.is_mei ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
              )}
            >
              {driver.is_mei ? 'Sim' : 'Não'}
            </span>
          </div>
          {driver.is_mei && driver.mei_cnpj ? (
            <div className="font-mono text-xs text-muted-foreground">CNPJ · {formatCnpj(driver.mei_cnpj) || driver.mei_cnpj}</div>
          ) : null}
        </div>

        <div className="rounded-lg border border-border bg-background p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheck className="h-3.5 w-3.5" /> Certificado digital
            </span>
            {driver.has_digital_certificate ? (
              <DriverDocumentStatusBadge state={certState} expiresAt={driver.digital_certificate_expires_at} />
            ) : (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Não</span>
            )}
          </div>
          {driver.has_digital_certificate && driver.digital_certificate_expires_at ? (
            <div className="text-xs text-muted-foreground">
              Expira em <span className="font-mono text-foreground">{driver.digital_certificate_expires_at}</span>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-border bg-background p-3 md:col-span-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
              <FileText className="h-3.5 w-3.5" /> CNH
            </span>
            <DriverDocumentStatusBadge state={cnhState} expiresAt={driver.cnh_expires_at} />
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            {driver.cnh_number || '—'}
            {driver.cnh_expires_at ? ` · val. ${driver.cnh_expires_at}` : ''}
          </div>
        </div>

        {driver.pix_key ? (
          <div className="rounded-lg border border-border bg-background p-3 md:col-span-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
              <CreditCard className="h-3.5 w-3.5" /> Chave PIX
            </div>
            <div className="font-mono text-xs text-muted-foreground">
              {driver.pix_key_type || 'Chave'} · {driver.pix_key}
            </div>
          </div>
        ) : null}
      </div>

      {showExtras ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2 border-t border-border pt-4">
          {driver.address_street ? (
            <div className="rounded-lg border border-border bg-background p-3 md:col-span-2">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                <MapPin className="h-3.5 w-3.5" /> Endereço
              </div>
              <div className="text-xs text-muted-foreground">
                {driver.address_street}
                {driver.address_number ? `, ${driver.address_number}` : ''}
                {driver.address_complement ? ` — ${driver.address_complement}` : ''}
                {driver.address_neighborhood ? ` · ${driver.address_neighborhood}` : ''}
                <br />
                {driver.address_cep ? `CEP ${formatCep(driver.address_cep)} · ` : ''}
                {driver.city && driver.state ? `${driver.city}/${driver.state}` : driver.city || driver.state || ''}
              </div>
            </div>
          ) : null}
          {driver.vehicle_plate ? (
            <div className="rounded-lg border border-border bg-background p-3 md:col-span-2">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                <Car className="h-3.5 w-3.5" /> Veículo
              </div>
              <div className="text-xs text-muted-foreground">
                {driver.vehicle_model || '—'} · {driver.vehicle_color || '—'} · Placa {driver.vehicle_plate}
                {driver.vehicle_renavam ? ` · RENAVAM ${driver.vehicle_renavam}` : ''}
                {driver.vehicle_model_year ? ` · ${driver.vehicle_model_year}` : ''}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
