'use client';

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { openAppRouteInNewTab } from '@/lib/openAppRoute';
import api from '@/lib/api';
import { formatBrazilPhone, formatCnpj, formatCpf } from '@/lib/brFormat';
import { formatWorkScheduleSummary, hasConfiguredWorkSchedule } from '@/components/settings/BusinessHoursEditor';
import { formatCentsBRL } from '@/lib/pharmacyCommercial';
import type { ContactDetail } from '@/types/contact';
import { ProfileTypeBadge } from '@/components/ui/ProfileTypeBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SectionTitle } from '@/components/ui/SectionTitle';

function initials(input: string) {
  const p = input.trim();
  if (!p) return '?';
  const parts = p.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return p.slice(0, 2).toUpperCase();
}

export function ContactProfileModal({
  open,
  onClose,
  contactId,
  fallbackPhone,
  fallbackName,
}: {
  open: boolean;
  onClose: () => void;
  contactId: string | null;
  fallbackPhone?: string | null;
  fallbackName?: string | null;
}) {
  const q = useQuery({
    queryKey: ['inbox', 'contact', contactId],
    enabled: open && Boolean(contactId),
    queryFn: () => api.get(`/api/contacts/${contactId}`).then((r) => r.data as ContactDetail),
  });
  const c = q.data;

  const driverDetailQ = useQuery({
    queryKey: ['driver', c?.driver?.id],
    enabled: open && Boolean(c?.driver?.id),
    queryFn: () => api.get(`/api/drivers/${c?.driver?.id}`).then((r) => r.data as Record<string, unknown>),
  });

  const pharmacyDetailQ = useQuery({
    queryKey: ['pharmacy', c?.pharmacy?.id],
    enabled: open && Boolean(c?.pharmacy?.id),
    queryFn: () => api.get(`/api/pharmacies/${c?.pharmacy?.id}`).then((r) => r.data as Record<string, unknown>),
  });

  if (!open) return null;
  const display = c?.display_name || fallbackName || '—';
  const phoneRaw = c?.wa_phone || fallbackPhone || '';
  const phoneFmt = formatBrazilPhone(phoneRaw) || phoneRaw || '—';
  const pt = c?.profile_type || 'unknown';
  const cadastroHref =
    pt === 'driver' && c?.driver?.id
      ? `/drivers/${c.driver.id}`
      : pt === 'pharmacy' && c?.pharmacy?.id
      ? `/pharmacies/${c.pharmacy.id}`
      : pt === 'leader' && c?.leader?.id
      ? `/leaders/${c.leader.id}`
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto gap-0 py-4 shadow-md ring-0">
        <CardContent className="px-4 pt-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-channel-whatsapp to-success text-sm font-semibold">
              {initials(display)}
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">{display}</div>
              <div className="mt-1">
                <ProfileTypeBadge type={pt} size="md" />
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="text-muted-foreground"
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-xs text-muted-foreground">Telefone</div>
            <div className="mt-0.5 font-mono text-sm text-foreground">{phoneFmt}</div>
          </div>

          {q.isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando cadastro…</p>
          ) : q.isError ? (
            <p className="text-xs text-destructive">Não foi possível carregar o contato.</p>
          ) : c ? (
            <>
              {pt === 'driver' && c.driver ? (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-xs font-semibold text-foreground">Entregador</div>
                  <div className="mt-2 grid gap-1 text-sm text-foreground">
                    <div>
                      <span className="text-muted-foreground">Nome: </span>
                      {c.driver.name || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status: </span>
                      {c.driver.status || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cidade: </span>
                      {c.driver.city || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">CPF: </span>
                      {formatCpf(String(driverDetailQ.data?.cpf || '')) || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">PIX: </span>
                      {String(driverDetailQ.data?.pix_key || '—')}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Modelo de contratação: </span>
                      {driverDetailQ.data?.driver_type === 'daily'
                        ? 'Diária'
                        : driverDetailQ.data?.driver_type === 'fixed'
                        ? 'Fixo'
                        : '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">MEI: </span>
                      {driverDetailQ.data?.is_mei ? 'Sim' : 'Não'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">CNPJ MEI: </span>
                      {formatCnpj(String(driverDetailQ.data?.mei_cnpj || '')) || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Farmácia principal: </span>
                      {String((driverDetailQ.data?.primary_pharmacy as Record<string, unknown> | undefined)?.trade_name || '—')}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Líder responsável (vínculo direto): </span>
                      {String((driverDetailQ.data?.override_leader as Record<string, unknown> | undefined)?.name || '—')}
                    </div>
                    <div className="rounded border border-border/70 bg-background/40 p-2 text-xs">
                      <SectionTitle>Vínculos com farmácias</SectionTitle>
                      <div className="mt-1 space-y-1">
                        {Array.isArray(driverDetailQ.data?.driver_pharmacy_links) &&
                        (driverDetailQ.data!.driver_pharmacy_links as Array<Record<string, unknown>>).filter((link) => Boolean(link.is_active)).length > 0 ? (
                          (driverDetailQ.data!.driver_pharmacy_links as Array<Record<string, unknown>>)
                            .filter((link) => Boolean(link.is_active))
                            .map((link, idx) => (
                            <div key={String(link.id || idx)} className="text-xs">
                              {String((link.pharmacies as Record<string, unknown> | undefined)?.trade_name || '—')} {' '}
                              <span className="text-muted-foreground">({link.is_primary ? 'primário' : 'secundário'} · ativo)</span>
                            </div>
                            ))
                        ) : (
                          <div className="text-muted-foreground">Sem vínculos cadastrados.</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Escala: </span>
                      {formatWorkScheduleSummary(driverDetailQ.data?.work_schedule) || 'Não configurada'}
                    </div>
                    <div className="font-mono">
                      <span className="text-muted-foreground font-sans">Tel.: </span>
                      {c.driver.phone || '—'}
                    </div>
                  </div>
                </div>
              ) : null}

              {pt === 'pharmacy' && c.pharmacy ? (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-xs font-semibold text-foreground">Farmácia</div>
                  <div className="mt-2 grid gap-1 text-sm text-foreground">
                    <div>
                      <span className="text-muted-foreground">Nome fantasia: </span>
                      {c.pharmacy.trade_name || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status: </span>
                      {c.pharmacy.status || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Local: </span>
                      {[c.pharmacy.city, c.pharmacy.state].filter(Boolean).join(' / ') || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">CNPJ: </span>
                      {formatCnpj(String(pharmacyDetailQ.data?.cnpj || '')) || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Razão social: </span>
                      {String(pharmacyDetailQ.data?.legal_name || '—')}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Endereço: </span>
                      {[
                        pharmacyDetailQ.data?.address_street,
                        pharmacyDetailQ.data?.address_number,
                        pharmacyDetailQ.data?.address_neighborhood,
                      ]
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Contato financeiro: </span>
                      {String(pharmacyDetailQ.data?.contact_financial_name || '—')}
                    </div>
                    <div className="font-mono">
                      <span className="text-muted-foreground font-sans">Tel. financeiro: </span>
                      {formatBrazilPhone(String(pharmacyDetailQ.data?.contact_financial_phone || '')) || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Líder responsável: </span>
                      {String((pharmacyDetailQ.data?.leader as Record<string, unknown> | undefined)?.name || '—')}
                    </div>
                    {pharmacyDetailQ.data?.delivery_fee_cents != null ? (
                      <div>
                        <span className="text-muted-foreground">Taxa de entrega: </span>
                        {formatCentsBRL(pharmacyDetailQ.data.delivery_fee_cents as number)}
                        {pharmacyDetailQ.data.delivery_fee_driver_payout_cents != null ? (
                          <span className="text-muted-foreground">
                            {' '}
                            (repasse {formatCentsBRL(pharmacyDetailQ.data.delivery_fee_driver_payout_cents as number)})
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {pharmacyDetailQ.data?.minimum_guaranteed_cents != null ? (
                      <div>
                        <span className="text-muted-foreground">Mínimo garantido: </span>
                        {formatCentsBRL(pharmacyDetailQ.data.minimum_guaranteed_cents as number)}
                      </div>
                    ) : null}
                    {hasConfiguredWorkSchedule(pharmacyDetailQ.data?.delivery_schedule) && pharmacyDetailQ.data ? (
                      <>
                        <div>
                          <span className="text-muted-foreground">Horário delivery: </span>
                          {String(
                            pharmacyDetailQ.data.delivery_schedule_summary ||
                              formatWorkScheduleSummary(pharmacyDetailQ.data.delivery_schedule),
                          ) || '—'}
                        </div>
                        {pharmacyDetailQ.data.delivery_open_now != null ? (
                          <div>
                            <span className="text-muted-foreground">Delivery agora: </span>
                            {pharmacyDetailQ.data.delivery_open_now ? 'aberto' : 'fechado'}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    <div>
                      <span className="text-muted-foreground">Contato expedição: </span>
                      {String(pharmacyDetailQ.data?.contact_expedition_name || '—')}
                    </div>
                    <div className="font-mono">
                      <span className="text-muted-foreground font-sans">Tel. expedição: </span>
                      {formatBrazilPhone(String(pharmacyDetailQ.data?.contact_expedition_phone || '')) || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Contato gerente: </span>
                      {String(pharmacyDetailQ.data?.contact_manager_name || '—')}
                    </div>
                    <div className="font-mono">
                      <span className="text-muted-foreground font-sans">Tel. gerente: </span>
                      {formatBrazilPhone(String(pharmacyDetailQ.data?.contact_manager_phone || '')) || '—'}
                    </div>
                    <div className="rounded border border-border/70 bg-background/40 p-2 text-xs">
                      <SectionTitle>Entregadores vinculados</SectionTitle>
                      <div className="mt-1 space-y-1">
                        {Array.isArray(pharmacyDetailQ.data?.driver_pharmacy_links) &&
                        (pharmacyDetailQ.data!.driver_pharmacy_links as Array<Record<string, unknown>>).filter((link) => Boolean(link.is_active)).length > 0 ? (
                          (pharmacyDetailQ.data!.driver_pharmacy_links as Array<Record<string, unknown>>)
                            .filter((link) => Boolean(link.is_active))
                            .map((link, idx) => {
                            const drv = link.drivers as Record<string, unknown> | undefined;
                            return (
                              <div key={String(link.id || idx)} className="text-xs">
                                {String(drv?.name || '—')} <span className="text-muted-foreground">({link.is_primary ? 'primário' : 'secundário'} · ativo)</span>
                              </div>
                            );
                            })
                        ) : (
                          <div className="text-muted-foreground">Sem vínculos cadastrados.</div>
                        )}
                      </div>
                    </div>
                    <div className="font-mono">
                      <span className="text-muted-foreground font-sans">Tel.: </span>
                      {c.pharmacy.phone || '—'}
                    </div>
                  </div>
                </div>
              ) : null}

              {pt === 'leader' && c.leader ? (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-xs font-semibold text-foreground">Líder</div>
                  <div className="mt-2 grid gap-1 text-sm text-foreground">
                    <div>
                      <span className="text-muted-foreground">Nome: </span>
                      {c.leader.name || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status: </span>
                      {c.leader.status || '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cidade: </span>
                      {c.leader.city || '—'}
                    </div>
                    <div className="font-mono">
                      <span className="text-muted-foreground font-sans">Tel.: </span>
                      {c.leader.phone || '—'}
                    </div>
                  </div>
                </div>
              ) : null}

              {(c.driver || c.pharmacy || c.leader) && pt === 'unknown' ? (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-xs text-muted-foreground">Vínculos</div>
                  <div className="mt-1 space-y-1 text-sm text-foreground">
                    {c.driver ? <div>Entregador: {c.driver.name || '—'}</div> : null}
                    {c.pharmacy ? <div>Farmácia: {c.pharmacy.trade_name || '—'}</div> : null}
                    {c.leader ? <div>Líder: {c.leader.name || '—'}</div> : null}
                  </div>
                </div>
              ) : null}

              {pt !== 'unknown' && (c.driver || c.pharmacy || c.leader) ? (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-xs text-muted-foreground">Outros vínculos</div>
                  <div className="mt-1 space-y-1 text-sm text-foreground">
                    {pt !== 'driver' && c.driver ? <div>Entregador: {c.driver.name || '—'}</div> : null}
                    {pt !== 'pharmacy' && c.pharmacy ? <div>Farmácia: {c.pharmacy.trade_name || '—'}</div> : null}
                    {pt !== 'leader' && c.leader ? <div>Líder: {c.leader.name || '—'}</div> : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
          {cadastroHref ? (
            <button
              type="button"
              onClick={() => openAppRouteInNewTab(cadastroHref)}
              className="rounded-md border border-border bg-background/60 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors"
              title="Abrir ficha de cadastro (nova aba)"
            >
              Acessar cadastro
            </button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void navigator.clipboard?.writeText(phoneRaw).catch(() => undefined)}
          >
            Copiar telefone
          </Button>
          <Button type="button" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>
        </CardContent>
      </Card>
    </div>
  );
}
