'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { FileKey2, Pencil, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/Switch';
import { BillingEntityBadge } from '@/components/billing/BillingEntityBadge';
import { BillingDialogContent, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import {
  fetchNfseConfig,
  saveNfseCertificateMetadata,
  saveNfseIssuer,
  saveNfseProfile,
  type BillingNfseCertificatePublic,
  type BillingNfseIssuerConfig,
  type BillingNfseServiceProfile,
} from '@/lib/billing/billingApi';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <BillingField label={label} className={className}>
      {children}
    </BillingField>
  );
}

function revenueLineLabel(line: string): string {
  if (line === 'delivery') return 'Delivery';
  if (line === 'saas_monthly') return 'SaaS mensal';
  if (line === 'saas_per_delivery') return 'SaaS por entrega';
  return line;
}

function isSaasLine(line: string): boolean {
  return line === 'saas_monthly' || line === 'saas_per_delivery';
}

function formatCertStatus(cert: BillingNfseCertificatePublic | undefined): string {
  if (!cert) return 'Sem metadados';
  const bits = [
    cert.has_secret_ref ? 'secret_ref ok' : 'sem secret_ref',
    cert.subject_cn ? `CN: ${cert.subject_cn}` : null,
    cert.valid_until ? `válido até ${String(cert.valid_until).slice(0, 10)}` : null,
  ].filter(Boolean);
  return bits.join(' · ') || 'Metadados incompletos';
}

type IssuerEdit = Partial<BillingNfseIssuerConfig> & { entity_type: 'coop' | 'flux' };
type ProfileEdit = BillingNfseServiceProfile;
type CertEdit = {
  entity_type: 'coop' | 'flux';
  secret_ref: string;
  thumbprint: string;
  subject_cn: string;
  valid_from: string;
  valid_until: string;
  active: boolean;
};

export function BillingNfseConfigPanel() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['billing', 'nfse-config'], queryFn: fetchNfseConfig });
  const [issuerEdit, setIssuerEdit] = useState<IssuerEdit | null>(null);
  const [profileEdit, setProfileEdit] = useState<ProfileEdit | null>(null);
  const [certEdit, setCertEdit] = useState<CertEdit | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [certHint, setCertHint] = useState<string | null>(null);

  const issuersByType = useMemo(() => {
    const map = new Map<'coop' | 'flux', BillingNfseIssuerConfig>();
    for (const row of query.data?.issuers || []) map.set(row.entity_type, row);
    return map;
  }, [query.data?.issuers]);

  const certByIssuerId = useMemo(() => {
    const map = new Map<string, BillingNfseCertificatePublic>();
    for (const row of query.data?.certificates || []) map.set(row.issuer_config_id, row);
    return map;
  }, [query.data?.certificates]);

  const profilesByIssuer = useMemo(() => {
    const map = new Map<string, BillingNfseServiceProfile[]>();
    for (const row of query.data?.profiles || []) {
      const list = map.get(row.issuer_config_id) || [];
      list.push(row);
      map.set(row.issuer_config_id, list);
    }
    return map;
  }, [query.data?.profiles]);

  useEffect(() => {
    setFormError(null);
  }, [issuerEdit, profileEdit, certEdit]);

  const saveIssuerMut = useMutation({
    mutationFn: async (row: IssuerEdit) =>
      saveNfseIssuer(row.entity_type, {
        environment: row.environment,
        auto_emit_on_approve: row.auto_emit_on_approve,
        municipal_registration: row.municipal_registration || null,
        ibge_city_code: row.ibge_city_code,
        tax_regime: row.tax_regime || null,
        simples_nacional: row.simples_nacional,
        dps_series: row.dps_series || null,
        dps_next_number: row.dps_next_number ?? null,
        active: row.active,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'nfse-config'] });
      setIssuerEdit(null);
    },
    onError: (err) => setFormError(apiErrorMessage(err, 'Falha ao salvar emitente.')),
  });

  const saveProfileMut = useMutation({
    mutationFn: async (row: ProfileEdit) =>
      saveNfseProfile(row.id, {
        ctn: row.ctn,
        nbs: row.nbs,
        iss_rate_pct: row.iss_rate_pct,
        description_template: row.description_template,
        active: row.active,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'nfse-config'] });
      setProfileEdit(null);
    },
    onError: (err) => setFormError(apiErrorMessage(err, 'Falha ao salvar perfil.')),
  });

  const saveCertMut = useMutation({
    mutationFn: async (row: CertEdit) =>
      saveNfseCertificateMetadata(row.entity_type, {
        secret_ref: row.secret_ref.trim() || null,
        thumbprint: row.thumbprint.trim() || null,
        subject_cn: row.subject_cn.trim() || null,
        valid_from: row.valid_from.trim() || null,
        valid_until: row.valid_until.trim() || null,
        active: row.active,
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'nfse-config'] });
      setCertHint(res.hint || null);
      setCertEdit(null);
    },
    onError: (err) => setFormError(apiErrorMessage(err, 'Falha ao salvar certificado.')),
  });

  const flags = query.data?.flags;
  const cards: Array<'coop' | 'flux'> = ['coop', 'flux'];
  const setIssuer = <K extends keyof IssuerEdit>(key: K, value: IssuerEdit[K]) => {
    setIssuerEdit((current) => (current ? { ...current, [key]: value } : current));
  };
  const setProfile = <K extends keyof ProfileEdit>(key: K, value: ProfileEdit[K]) => {
    setProfileEdit((current) => (current ? { ...current, [key]: value } : current));
  };

  return (
    <BillingSection
      title="NFS-e (Sefin Nacional)"
      desc="Configuração de emitentes Coop/Flux, perfis de serviço (delivery + SaaS) e metadados de certificado A1."
      icon={Receipt}
    >
      <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-md border border-border bg-background px-2 py-1 text-muted-foreground">
          BILLING_NFSE_ENABLED: {flags?.nfse_enabled ? 'on' : 'off (default)'}
        </span>
        <span className="rounded-md border border-border bg-background px-2 py-1 text-muted-foreground">
          BILLING_NFSE_SAAS_ENABLED: {flags?.saas_enabled ? 'on' : 'off (default)'}
        </span>
        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-200">
          Ambiente padrão: produção restrita — sem chamadas Sefin de produção
        </span>
      </div>

      {query.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
      {query.isError ? (
        <p className="text-sm text-destructive">{apiErrorMessage(query.error, 'Falha ao carregar config NFS-e.')}</p>
      ) : null}
      {certHint ? (
        <p className="mb-3 rounded-md border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
          {certHint}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((type) => {
          const issuer = issuersByType.get(type);
          const cert = issuer ? certByIssuerId.get(issuer.id) : undefined;
          const profiles = issuer ? profilesByIssuer.get(issuer.id) || [] : [];
          const delivery = profiles.find((p) => p.revenue_line === 'delivery');
          const saasProfiles = profiles.filter((p) => isSaasLine(p.revenue_line));

          return (
            <div key={type} className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between gap-2">
                <BillingEntityBadge entity={type} />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() =>
                      setCertEdit({
                        entity_type: type,
                        secret_ref: `billing-nfse-${type}-pfx`,
                        thumbprint: cert?.thumbprint || '',
                        subject_cn: cert?.subject_cn || '',
                        valid_from: cert?.valid_from ? String(cert.valid_from).slice(0, 10) : '',
                        valid_until: cert?.valid_until ? String(cert.valid_until).slice(0, 10) : '',
                        active: cert?.active !== false,
                      })
                    }
                  >
                    <FileKey2 className="mr-1 inline h-3 w-3" /> Certificado
                  </button>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() =>
                      setIssuerEdit(
                        issuer
                          ? { ...issuer }
                          : {
                              entity_type: type,
                              environment: 'producao_restrita',
                              auto_emit_on_approve: true,
                              municipal_registration: '',
                              ibge_city_code: '3170206',
                              tax_regime: '',
                              simples_nacional: type === 'flux',
                              dps_series: '',
                              dps_next_number: null,
                              active: true,
                            }
                      )
                    }
                  >
                    <Pencil className="mr-1 inline h-3 w-3" /> Editar
                  </button>
                </div>
              </div>

              {issuer ? (
                <>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <dt className="text-muted-foreground">Ambiente</dt>
                    <dd className="font-mono">{issuer.environment}</dd>
                    <dt className="text-muted-foreground">Auto-emit</dt>
                    <dd>{issuer.auto_emit_on_approve ? 'sim' : 'não'}</dd>
                    <dt className="text-muted-foreground">IBGE</dt>
                    <dd className="font-mono">{issuer.ibge_city_code}</dd>
                    <dt className="text-muted-foreground">IM</dt>
                    <dd className="font-mono">{issuer.municipal_registration || '—'}</dd>
                    <dt className="text-muted-foreground">Simples</dt>
                    <dd>{issuer.simples_nacional ? 'sim' : 'não'}</dd>
                    <dt className="text-muted-foreground">Série DPS</dt>
                    <dd className="font-mono">
                      {issuer.dps_series || '—'}
                      {issuer.dps_next_number != null ? ` · #${issuer.dps_next_number}` : ''}
                    </dd>
                    <dt className="text-muted-foreground">Certificado</dt>
                    <dd>{formatCertStatus(cert)}</dd>
                  </dl>

                  <div className="mt-4 space-y-2">
                    <p className="text-[11px] font-semibold text-foreground">Perfis</p>
                    {delivery ? (
                      <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">Delivery {delivery.active ? '(ativo)' : '(inativo)'}</span>
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={() => setProfileEdit({ ...delivery })}
                          >
                            Editar
                          </button>
                        </div>
                        <p className="mt-1 font-mono text-muted-foreground">
                          CTN {delivery.ctn} · NBS {delivery.nbs}
                          {delivery.iss_rate_pct != null ? ` · ISS ${delivery.iss_rate_pct}%` : ' · ISS SN'}
                        </p>
                      </div>
                    ) : null}
                    {saasProfiles.map((p) => {
                      const saasEditable = Boolean(flags?.saas_enabled);
                      return (
                        <div
                          key={p.id}
                          className={
                            saasEditable
                              ? 'rounded-lg border border-border bg-background/40 px-3 py-2 text-[11px]'
                              : 'rounded-lg border border-dashed border-border bg-background/20 px-3 py-2 text-[11px] opacity-80'
                          }
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={saasEditable ? 'font-medium' : undefined}>
                              {revenueLineLabel(p.revenue_line)}{' '}
                              {saasEditable ? (
                                <span className="text-muted-foreground">
                                  {p.active ? '(ativo)' : '(inativo)'}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">(SaaS — flag off)</span>
                              )}
                            </span>
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() => setProfileEdit({ ...p })}
                            >
                              {saasEditable ? 'Editar' : 'Ver'}
                            </button>
                          </div>
                          <p className="mt-1 font-mono text-muted-foreground">
                            CTN {p.ctn} · NBS {p.nbs}
                            {p.iss_rate_pct != null ? ` · ISS ${p.iss_rate_pct}%` : ' · ISS SN'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  Ainda sem seed — abra e salve para criar defaults a partir das entidades jurídicas.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {issuerEdit ? (
        <Dialog open onOpenChange={(v) => !v && setIssuerEdit(null)}>
          <BillingDialogContent
            title={`Emitente NFS-e — ${issuerEdit.entity_type === 'coop' ? 'CoopMob' : 'Flux Farma'}`}
            description="Ambiente, IM, série DPS e regime. Emissão Sefin entra na Sprint 2."
            className="sm:max-w-2xl"
            footer={
              <>
                <Button variant="outline" className="flex-1" onClick={() => setIssuerEdit(null)}>
                  Cancelar
                </Button>
                <Button
                  className="flex-1 shadow-md"
                  disabled={saveIssuerMut.isPending || !issuerEdit.ibge_city_code}
                  onClick={() => saveIssuerMut.mutate(issuerEdit)}
                >
                  Salvar
                </Button>
              </>
            }
          >
            {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ambiente">
                <FormSelect
                  value={issuerEdit.environment || 'producao_restrita'}
                  onChange={(v) => setIssuer('environment', v as BillingNfseIssuerConfig['environment'])}
                  options={[
                    { value: 'producao_restrita', label: 'Produção restrita (homologação)' },
                    { value: 'producao', label: 'Produção (não usar no piloto)' },
                  ]}
                />
              </Field>
              <Field label="Código IBGE (município ISS)">
                <FormControl
                  value={issuerEdit.ibge_city_code || ''}
                  onChange={(e) => setIssuer('ibge_city_code', e.target.value.replace(/\D/g, '').slice(0, 7))}
                  placeholder="3170206"
                  className="font-mono"
                />
              </Field>
              <Field label="Inscrição municipal">
                <FormControl
                  value={issuerEdit.municipal_registration || ''}
                  onChange={(e) => setIssuer('municipal_registration', e.target.value)}
                />
              </Field>
              <Field label="Regime tributário">
                <FormControl
                  value={issuerEdit.tax_regime || ''}
                  onChange={(e) => setIssuer('tax_regime', e.target.value)}
                />
              </Field>
              <Field label="Série DPS">
                <FormControl
                  value={issuerEdit.dps_series || ''}
                  onChange={(e) => setIssuer('dps_series', e.target.value)}
                  placeholder="ex.: 1"
                  className="font-mono"
                />
              </Field>
              <Field label="Próximo número DPS">
                <FormControl
                  type="number"
                  min={1}
                  value={issuerEdit.dps_next_number ?? ''}
                  onChange={(e) =>
                    setIssuer('dps_next_number', e.target.value === '' ? null : Number(e.target.value))
                  }
                  className="font-mono"
                />
              </Field>
              <label className="col-span-2 flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="text-sm">Simples Nacional</span>
                <Switch
                  checked={Boolean(issuerEdit.simples_nacional)}
                  onCheckedChange={(v) => setIssuer('simples_nacional', v)}
                />
              </label>
              <label className="col-span-2 flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="text-sm">Auto-emitir ao aprovar fatura</span>
                <Switch
                  checked={issuerEdit.auto_emit_on_approve !== false}
                  onCheckedChange={(v) => setIssuer('auto_emit_on_approve', v)}
                />
              </label>
              <label className="col-span-2 flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="text-sm">Emitente ativo</span>
                <Switch
                  checked={issuerEdit.active !== false}
                  onCheckedChange={(v) => setIssuer('active', v)}
                />
              </label>
            </div>
          </BillingDialogContent>
        </Dialog>
      ) : null}

      {profileEdit ? (
        <Dialog open onOpenChange={(v) => !v && setProfileEdit(null)}>
          <BillingDialogContent
            title={`Perfil — ${revenueLineLabel(profileEdit.revenue_line)}`}
            description={
              isSaasLine(profileEdit.revenue_line)
                ? flags?.saas_enabled
                  ? 'SaaS: CTN/NBS/template e ativação. Emitente típico Flux; Coop também tem perfil seed.'
                  : 'SaaS somente leitura enquanto BILLING_NFSE_SAAS_ENABLED estiver off (requer também BILLING_NFSE_ENABLED).'
                : 'CTN, NBS, alíquota ISS e template de descrição da DPS.'
            }
            className="sm:max-w-2xl"
            footer={
              <>
                <Button variant="outline" className="flex-1" onClick={() => setProfileEdit(null)}>
                  {isSaasLine(profileEdit.revenue_line) && !flags?.saas_enabled ? 'Fechar' : 'Cancelar'}
                </Button>
                {!(isSaasLine(profileEdit.revenue_line) && !flags?.saas_enabled) ? (
                  <Button
                    className="flex-1 shadow-md"
                    disabled={saveProfileMut.isPending || !profileEdit.ctn || !profileEdit.nbs}
                    onClick={() => saveProfileMut.mutate(profileEdit)}
                  >
                    Salvar
                  </Button>
                ) : null}
              </>
            }
          >
            {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="CTN">
                <FormControl
                  value={profileEdit.ctn}
                  onChange={(e) => setProfile('ctn', e.target.value)}
                  className="font-mono"
                  disabled={isSaasLine(profileEdit.revenue_line) && !flags?.saas_enabled}
                />
              </Field>
              <Field label="NBS">
                <FormControl
                  value={profileEdit.nbs}
                  onChange={(e) => setProfile('nbs', e.target.value)}
                  className="font-mono"
                  disabled={isSaasLine(profileEdit.revenue_line) && !flags?.saas_enabled}
                />
              </Field>
              <Field label="Alíquota ISS (%)">
                <FormControl
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={profileEdit.iss_rate_pct ?? ''}
                  onChange={(e) =>
                    setProfile('iss_rate_pct', e.target.value === '' ? null : Number(e.target.value))
                  }
                  disabled={isSaasLine(profileEdit.revenue_line) && !flags?.saas_enabled}
                />
              </Field>
              <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="text-sm">
                  Ativo
                  {isSaasLine(profileEdit.revenue_line) && !flags?.saas_enabled ? (
                    <span className="block text-[10px] text-muted-foreground">Bloqueado sem flag SaaS</span>
                  ) : null}
                </span>
                <Switch
                  checked={profileEdit.active}
                  onCheckedChange={(v) => setProfile('active', v)}
                  disabled={isSaasLine(profileEdit.revenue_line) && !flags?.saas_enabled}
                />
              </label>
              <Field label="Template de descrição" className="col-span-2">
                <FormControl
                  value={profileEdit.description_template}
                  onChange={(e) => setProfile('description_template', e.target.value)}
                  disabled={isSaasLine(profileEdit.revenue_line) && !flags?.saas_enabled}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Placeholders: {'{{cycle_start}}'} {'{{cycle_end}}'} {'{{pharmacy}}'}
                </p>
              </Field>
            </div>
          </BillingDialogContent>
        </Dialog>
      ) : null}

      {certEdit ? (
        <Dialog open onOpenChange={(v) => !v && setCertEdit(null)}>
          <BillingDialogContent
            title={`Certificado A1 — ${certEdit.entity_type === 'coop' ? 'CoopMob' : 'Flux Farma'}`}
            description="Só metadados. Coloque o PFX em .secrets/<secret_ref> (gitignore). Sem PEM na API."
            className="sm:max-w-xl"
            footer={
              <>
                <Button variant="outline" className="flex-1" onClick={() => setCertEdit(null)}>
                  Cancelar
                </Button>
                <Button
                  className="flex-1 shadow-md"
                  disabled={saveCertMut.isPending}
                  onClick={() => saveCertMut.mutate(certEdit)}
                >
                  Salvar metadados
                </Button>
              </>
            }
          >
            {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="secret_ref" className="col-span-2">
                <FormControl
                  value={certEdit.secret_ref}
                  onChange={(e) => setCertEdit({ ...certEdit, secret_ref: e.target.value })}
                  className="font-mono"
                  placeholder={`billing-nfse-${certEdit.entity_type}-pfx`}
                />
              </Field>
              <Field label="Subject CN" className="col-span-2">
                <FormControl
                  value={certEdit.subject_cn}
                  onChange={(e) => setCertEdit({ ...certEdit, subject_cn: e.target.value })}
                />
              </Field>
              <Field label="Thumbprint">
                <FormControl
                  value={certEdit.thumbprint}
                  onChange={(e) => setCertEdit({ ...certEdit, thumbprint: e.target.value })}
                  className="font-mono"
                />
              </Field>
              <Field label="Ativo">
                <div className="flex h-10 items-center">
                  <Switch
                    checked={certEdit.active}
                    onCheckedChange={(v) => setCertEdit({ ...certEdit, active: v })}
                  />
                </div>
              </Field>
              <Field label="Válido de">
                <FormControl
                  type="date"
                  value={certEdit.valid_from}
                  onChange={(e) => setCertEdit({ ...certEdit, valid_from: e.target.value })}
                />
              </Field>
              <Field label="Válido até">
                <FormControl
                  type="date"
                  value={certEdit.valid_until}
                  onChange={(e) => setCertEdit({ ...certEdit, valid_until: e.target.value })}
                />
              </Field>
            </div>
          </BillingDialogContent>
        </Dialog>
      ) : null}
    </BillingSection>
  );
}
