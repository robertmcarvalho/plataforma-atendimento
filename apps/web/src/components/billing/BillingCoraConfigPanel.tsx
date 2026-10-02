'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { FileKey2, Landmark, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/Switch';
import { BillingEntityBadge } from '@/components/billing/BillingEntityBadge';
import { BillingDialogContent, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import {
  fetchCoraConfig,
  saveCoraConfig,
  uploadCoraMtlsMaterial,
  type BillingCoraConfig,
  type BillingCoraFineMode,
} from '@/lib/billing/billingApi';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

type ConfigEdit = {
  entity_type: 'flux';
  environment: 'stage' | 'production';
  client_id: string;
  mtls_secret_ref: string;
  enabled: boolean;
  fine_mode: BillingCoraFineMode;
  fine_rate: string;
  fine_amount_cents: string;
  interest_rate: string;
  pix_qr_enabled: boolean;
  service_name_template: string;
  service_description_template: string;
};

type MtlsEdit = {
  entity_type: 'flux';
  certificate_pem: string;
  private_key_pem: string;
  mtls_secret_ref: string;
};

function parseOptionalNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

export function BillingCoraConfigPanel() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['billing', 'cora-config'], queryFn: fetchCoraConfig });
  const [edit, setEdit] = useState<ConfigEdit | null>(null);
  const [mtlsEdit, setMtlsEdit] = useState<MtlsEdit | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const fluxConfig = useMemo(
    () => query.data?.configs.find((c) => c.entity_type === 'flux') || null,
    [query.data?.configs]
  );

  useEffect(() => {
    setFormError(null);
  }, [edit, mtlsEdit]);

  const saveMut = useMutation({
    mutationFn: async (row: ConfigEdit) => {
      const fineRate = parseOptionalNumber(row.fine_rate);
      const interestRate = parseOptionalNumber(row.interest_rate);
      const fineAmount = parseOptionalNumber(row.fine_amount_cents);
      if (row.fine_mode === 'rate' && (fineRate == null || Number.isNaN(fineRate))) {
        throw new Error('Informe a multa em % (0–100) ou escolha “Sem multa”.');
      }
      if (row.fine_mode === 'amount' && (fineAmount == null || Number.isNaN(fineAmount))) {
        throw new Error('Informe a multa em centavos.');
      }
      if (Number.isNaN(interestRate as number)) {
        throw new Error('Juros inválidos.');
      }
      return saveCoraConfig(row.entity_type, {
        environment: row.environment,
        client_id: row.client_id.trim() || null,
        mtls_secret_ref: row.mtls_secret_ref.trim() || null,
        enabled: row.enabled,
        fine_mode: row.fine_mode,
        fine_rate: row.fine_mode === 'rate' ? fineRate : fineRate ?? null,
        fine_amount_cents:
          row.fine_mode === 'amount' && fineAmount != null ? Math.round(fineAmount) : null,
        interest_rate: interestRate,
        pix_qr_enabled: row.pix_qr_enabled,
        service_name_template: row.service_name_template.trim(),
        service_description_template: row.service_description_template.trim(),
      });
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'cora-config'] });
      setHint(res.hint || null);
      setEdit(null);
    },
    onError: (err) => setFormError(apiErrorMessage(err, 'Falha ao salvar config Cora.')),
  });

  const mtlsMut = useMutation({
    mutationFn: async (row: MtlsEdit) =>
      uploadCoraMtlsMaterial(row.entity_type, {
        certificate_pem: row.certificate_pem,
        private_key_pem: row.private_key_pem,
        mtls_secret_ref: row.mtls_secret_ref.trim() || null,
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'cora-config'] });
      setHint(res.hint || null);
      setMtlsEdit(null);
    },
    onError: (err) => setFormError(apiErrorMessage(err, 'Falha ao gravar certificado mTLS.')),
  });

  const flags = query.data?.flags;

  function openEdit(cfg: BillingCoraConfig) {
    setEdit({
      entity_type: 'flux',
      environment: cfg.environment,
      client_id: cfg.client_id || '',
      mtls_secret_ref: cfg.mtls_secret_ref || 'cora-flux-mtls',
      enabled: cfg.enabled,
      fine_mode: cfg.fine_mode || 'rate',
      fine_rate: cfg.fine_rate != null ? String(cfg.fine_rate) : '2',
      fine_amount_cents: cfg.fine_amount_cents != null ? String(cfg.fine_amount_cents) : '',
      interest_rate: cfg.interest_rate != null ? String(cfg.interest_rate) : '1',
      pix_qr_enabled: cfg.pix_qr_enabled !== false,
      service_name_template: cfg.service_name_template || 'Faturamento Flux Farma — {{cycle}}',
      service_description_template:
        cfg.service_description_template || 'Fatura {{invoice_id}} — ciclo {{cycle}}',
    });
  }

  const descPreviewLen = edit ? edit.service_description_template.trim().length : 0;

  return (
    <BillingSection
      title="Cora / Boletos"
      desc="Integração Direta (mTLS) para emissão manual de boletos Flux. Coop em rodada posterior. Certificado e private key ficam em .secrets — nunca no git."
      icon={Landmark}
    >
      <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-md border border-border bg-background px-2 py-1 text-muted-foreground">
          BILLING_CORA_ENABLED: {flags?.cora_enabled ? 'on' : 'off (default)'}
        </span>
        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-200">
          Comece em Stage — valide token antes de produção
        </span>
      </div>

      {query.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
      {query.isError ? (
        <p className="text-sm text-destructive">{apiErrorMessage(query.error, 'Falha ao carregar config Cora.')}</p>
      ) : null}
      {hint ? (
        <p className="mb-3 rounded-md border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-1 max-w-2xl">
        <div className="rounded-lg border border-border bg-background/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BillingEntityBadge entity="flux" />
              <span className="text-sm font-medium">Flux Farma</span>
            </div>
            {fluxConfig ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(fluxConfig)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setMtlsEdit({
                      entity_type: 'flux',
                      certificate_pem: '',
                      private_key_pem: '',
                      mtls_secret_ref: fluxConfig.mtls_secret_ref || 'cora-flux-mtls',
                    })
                  }
                >
                  <FileKey2 className="mr-1 h-3.5 w-3.5" /> Certificado
                </Button>
              </div>
            ) : null}
          </div>

          {!fluxConfig && !query.isLoading ? (
            <p className="text-xs text-muted-foreground">Config Flux ainda não criada — salve pela UI após migration.</p>
          ) : null}

          {fluxConfig ? (
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Ambiente</dt>
                <dd className="font-medium">{fluxConfig.environment}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Habilitado</dt>
                <dd className="font-medium">{fluxConfig.enabled ? 'sim' : 'não'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Client ID</dt>
                <dd className="font-mono">
                  {fluxConfig.client_id || fluxConfig.client_id_masked || (fluxConfig.has_client_id ? '(definido)' : '—')}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">mTLS (secret_ref)</dt>
                <dd className="font-mono">
                  {fluxConfig.mtls_secret_ref || '—'}
                  {fluxConfig.has_mtls_material ? ' · material ok' : ' · material ausente'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Multa</dt>
                <dd className="font-medium">
                  {fluxConfig.fine_mode === 'none'
                    ? 'nenhuma'
                    : fluxConfig.fine_mode === 'amount'
                      ? `${fluxConfig.fine_amount_cents ?? 0} centavos`
                      : `${fluxConfig.fine_rate ?? 2}%`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Juros (% a.m.)</dt>
                <dd className="font-medium">
                  {fluxConfig.interest_rate != null ? `${fluxConfig.interest_rate}%` : 'nenhum'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">QR PIX no boleto</dt>
                <dd className="font-medium">{fluxConfig.pix_qr_enabled ? 'sim' : 'não'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Descrição (template)</dt>
                <dd className="font-mono text-[11px] break-all">
                  {fluxConfig.service_description_template || '—'}
                </dd>
              </div>
            </dl>
          ) : null}

          <p className="mt-3 text-[11px] text-muted-foreground">
            CoopMob: fora do escopo desta rodada. Coloque o par mTLS em{' '}
            <code className="rounded bg-muted px-1">.secrets/cora-flux-mtls/</code> ou cole o PEM no diálogo
            Certificado. Juros: enviamos <code className="rounded bg-muted px-1">interest.rate</code> à Cora;
            a doc não define o período — tratamos como % a.m.
          </p>
        </div>
      </div>

      <Dialog open={Boolean(edit)} onOpenChange={(open) => !open && !saveMut.isPending && setEdit(null)}>
        {edit ? (
          <BillingDialogContent
            title="Config Cora — Flux"
            description="Client ID, ambiente e condições do boleto (multa/juros/PIX/descrição). Private key nunca vai para o banco."
            footer={
              <>
                <Button variant="outline" disabled={saveMut.isPending} onClick={() => setEdit(null)}>
                  Cancelar
                </Button>
                <Button disabled={saveMut.isPending} onClick={() => saveMut.mutate(edit)}>
                  {saveMut.isPending ? 'Salvando…' : 'Salvar'}
                </Button>
              </>
            }
          >
            {formError ? <p className="mb-2 text-sm text-destructive">{formError}</p> : null}
            <div className="grid gap-3">
              <BillingField label="Ambiente">
                <FormSelect
                  className="mt-1 w-full"
                  size="sm"
                  value={edit.environment}
                  onChange={(v) =>
                    setEdit((c) => (c ? { ...c, environment: v as 'stage' | 'production' } : c))
                  }
                  options={[
                    { value: 'stage', label: 'Stage' },
                    { value: 'production', label: 'Produção' },
                  ]}
                />
              </BillingField>
              <BillingField label="Client ID">
                <FormControl
                  className="mt-1 font-mono text-xs"
                  value={edit.client_id}
                  onChange={(e) => setEdit((c) => (c ? { ...c, client_id: e.target.value } : c))}
                  placeholder="int-…"
                  autoComplete="off"
                />
              </BillingField>
              <BillingField label="mtls_secret_ref (pasta em .secrets)">
                <FormControl
                  className="mt-1 font-mono text-xs"
                  value={edit.mtls_secret_ref}
                  onChange={(e) => setEdit((c) => (c ? { ...c, mtls_secret_ref: e.target.value } : c))}
                  placeholder="cora-flux-mtls"
                />
              </BillingField>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <span className="text-sm">Integração habilitada</span>
                <Switch
                  checked={edit.enabled}
                  onCheckedChange={(v) => setEdit((c) => (c ? { ...c, enabled: v } : c))}
                />
              </div>

              <div className="rounded-md border border-border p-3">
                <p className="mb-2 text-xs font-medium text-foreground">Condições do boleto</p>
                <div className="grid gap-3">
                  <BillingField label="Multa">
                    <FormSelect
                      className="mt-1 w-full"
                      size="sm"
                      value={edit.fine_mode}
                      onChange={(v) =>
                        setEdit((c) => (c ? { ...c, fine_mode: v as BillingCoraFineMode } : c))
                      }
                      options={[
                        { value: 'rate', label: 'Percentual (%)' },
                        { value: 'amount', label: 'Valor fixo (centavos)' },
                        { value: 'none', label: 'Sem multa' },
                      ]}
                    />
                  </BillingField>
                  {edit.fine_mode === 'rate' ? (
                    <BillingField label="Multa (%) — payment_terms.fine.rate">
                      <FormControl
                        className="mt-1"
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={edit.fine_rate}
                        onChange={(e) => setEdit((c) => (c ? { ...c, fine_rate: e.target.value } : c))}
                      />
                    </BillingField>
                  ) : null}
                  {edit.fine_mode === 'amount' ? (
                    <BillingField label="Multa (centavos) — payment_terms.fine.amount">
                      <FormControl
                        className="mt-1"
                        type="number"
                        min={0}
                        step={1}
                        value={edit.fine_amount_cents}
                        onChange={(e) =>
                          setEdit((c) => (c ? { ...c, fine_amount_cents: e.target.value } : c))
                        }
                      />
                    </BillingField>
                  ) : null}
                  <BillingField label="Juros (% a.m.) — payment_terms.interest.rate">
                    <FormControl
                      className="mt-1"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={edit.interest_rate}
                      onChange={(e) => setEdit((c) => (c ? { ...c, interest_rate: e.target.value } : c))}
                      placeholder="1"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Cora aceita 0–100 (2 casas). Unidade temporal não está na doc oficial; usamos % ao mês.
                      Deixe vazio para não enviar juros.
                    </p>
                  </BillingField>
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <div>
                      <span className="text-sm">Incluir QR Code PIX</span>
                      <p className="text-[10px] text-muted-foreground">
                        payment_forms: BANK_SLIP + PIX (exige chave Pix na conta Cora)
                      </p>
                    </div>
                    <Switch
                      checked={edit.pix_qr_enabled}
                      onCheckedChange={(v) => setEdit((c) => (c ? { ...c, pix_qr_enabled: v } : c))}
                    />
                  </div>
                  <BillingField label="Nome no boleto (template, máx. 60 na Cora)">
                    <FormControl
                      className="mt-1 text-xs"
                      value={edit.service_name_template}
                      onChange={(e) =>
                        setEdit((c) => (c ? { ...c, service_name_template: e.target.value } : c))
                      }
                    />
                  </BillingField>
                  <BillingField label={`Descrição no boleto (template, máx. 100 Cora) · ${descPreviewLen}/100`}>
                    <textarea
                      className="mt-1 min-h-[72px] w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
                      value={edit.service_description_template}
                      onChange={(e) =>
                        setEdit((c) =>
                          c ? { ...c, service_description_template: e.target.value } : c
                        )
                      }
                      maxLength={200}
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Placeholders: {'{{cycle}}'}, {'{{invoice_id}}'}, {'{{pharmacy}}'}, {'{{cnpj}}'}. Truncado
                      na emissão.
                    </p>
                  </BillingField>
                </div>
              </div>
            </div>
          </BillingDialogContent>
        ) : null}
      </Dialog>

      <Dialog open={Boolean(mtlsEdit)} onOpenChange={(open) => !open && !mtlsMut.isPending && setMtlsEdit(null)}>
        {mtlsEdit ? (
          <BillingDialogContent
            title="Upload mTLS Cora — Flux"
            description="Cole o conteúdo PEM do certificado e da private key. Serão gravados só em .secrets/ (gitignore). Não commitar."
            footer={
              <>
                <Button variant="outline" disabled={mtlsMut.isPending} onClick={() => setMtlsEdit(null)}>
                  Cancelar
                </Button>
                <Button
                  disabled={
                    mtlsMut.isPending ||
                    !mtlsEdit.certificate_pem.trim() ||
                    !mtlsEdit.private_key_pem.trim()
                  }
                  onClick={() => mtlsMut.mutate(mtlsEdit)}
                >
                  {mtlsMut.isPending ? 'Gravando…' : 'Gravar em .secrets'}
                </Button>
              </>
            }
          >
            {formError ? <p className="mb-2 text-sm text-destructive">{formError}</p> : null}
            <div className="grid gap-3">
              <BillingField label="secret_ref">
                <FormControl
                  className="mt-1 font-mono text-xs"
                  value={mtlsEdit.mtls_secret_ref}
                  onChange={(e) =>
                    setMtlsEdit((c) => (c ? { ...c, mtls_secret_ref: e.target.value } : c))
                  }
                />
              </BillingField>
              <BillingField label="certificate.pem">
                <textarea
                  className="mt-1 min-h-[100px] w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px]"
                  value={mtlsEdit.certificate_pem}
                  onChange={(e) =>
                    setMtlsEdit((c) => (c ? { ...c, certificate_pem: e.target.value } : c))
                  }
                  placeholder="-----BEGIN CERTIFICATE-----"
                  spellCheck={false}
                />
              </BillingField>
              <BillingField label="private-key.key">
                <textarea
                  className="mt-1 min-h-[100px] w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px]"
                  value={mtlsEdit.private_key_pem}
                  onChange={(e) =>
                    setMtlsEdit((c) => (c ? { ...c, private_key_pem: e.target.value } : c))
                  }
                  placeholder="-----BEGIN PRIVATE KEY-----"
                  spellCheck={false}
                />
              </BillingField>
            </div>
          </BillingDialogContent>
        ) : null}
      </Dialog>
    </BillingSection>
  );
}
