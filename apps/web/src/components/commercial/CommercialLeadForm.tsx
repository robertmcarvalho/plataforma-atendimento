'use client';

import Link from 'next/link';
import { CadastroField, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import { BrCnpjInput, BrDateInput, BrPhoneInput } from '@/components/form/BrInputs';
import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { FormSelect } from '@/components/form/FormSelect';
import {
  CommercialLeadDeliveryHoursEditor,
  deliveryHoursFromCustomFields,
  deliveryHoursToCustomFields,
  type CommercialDeliveryHoursValue,
} from '@/components/commercial/CommercialLeadDeliveryHoursEditor';
import { COMMERCIAL_TAGS } from '@/lib/commercial/commercialTags';
import type { CommercialOwner } from '@/lib/commercial/commercialApi';
import { COMMERCIAL_OPERATION_MANAGED_SLUGS } from '@/lib/commercial/leadOperationalReadiness';
import { useErpOptions } from '@/lib/commercial/useCommercialQueries';
import { validateLeadInput, type LeadInput } from '@/lib/commercial/leadInput';
import type { CommercialLead, CommercialLeadSource, FieldDefinition } from '@/lib/commercial/types';
import { onlyDigits } from '@/lib/brFormat';
import { formatDateBr } from '@/lib/datetimeBr';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useMemo, useRef, useState, type FormEvent } from 'react';

type ApiState = { code: string; name: string };
type ApiCity = { name: string };

export function leadToFormState(lead: CommercialLead) {
  const custom: Record<string, string> = {};
  if (lead.custom_fields) {
    for (const [k, v] of Object.entries(lead.custom_fields)) {
      custom[k] = String(v);
    }
  }
  return {
    tradeName: lead.trade_name,
    phone: lead.phone,
    city: lead.city,
    state: lead.state,
    contactName: lead.contact_name ?? '',
    contactEmail: lead.contact_email ?? '',
    contactRole: lead.contact_role ?? '',
    legalName: lead.legal_name ?? '',
    cnpj: lead.cnpj ?? '',
    ownerId: lead.owner_id ?? '',
    source: lead.source,
    campaign: lead.campaign ?? '',
    monthlyDeliveries: lead.monthly_deliveries?.toString() ?? '',
    driversCount: lead.drivers_count?.toString() ?? '',
    erp: lead.erp ?? '',
    notes: lead.notes ?? '',
    customFields: custom,
    tags: lead.tags ?? [],
    perfilCidade: String(lead.custom_fields?.perfil_cidade ?? ''),
    deliveryHours: deliveryHoursFromCustomFields(lead.custom_fields),
    expectedCloseAt: lead.expected_close_at?.slice(0, 10) ?? '',
  };
}

type Props = {
  mode: 'create' | 'edit';
  fieldDefinitions: FieldDefinition[];
  owners: CommercialOwner[];
  initial?: CommercialLead;
  cancelHref: string;
  onSubmit: (input: LeadInput) => void | Promise<void>;
  submitError?: string | null;
  isSubmitting?: boolean;
};

export function CommercialLeadForm({
  mode,
  fieldDefinitions,
  owners,
  initial,
  cancelHref,
  onSubmit,
  submitError,
  isSubmitting = false,
}: Props) {
  const submittingRef = useRef(false);
  const init = initial ? leadToFormState(initial) : null;
  const { data: erpOptions = [] } = useErpOptions();
  const activeErps = erpOptions.filter((o) => o.active);

  const [tradeName, setTradeName] = useState(init?.tradeName ?? '');
  const [phone, setPhone] = useState(init?.phone ?? '');
  const [city, setCity] = useState(init?.city ?? '');
  const [state, setState] = useState(init?.state ?? 'MG');
  const [contactName, setContactName] = useState(init?.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(init?.contactEmail ?? '');
  const [contactRole, setContactRole] = useState(init?.contactRole ?? '');
  const [legalName, setLegalName] = useState(init?.legalName ?? '');
  const [cnpj, setCnpj] = useState(init?.cnpj ?? '');
  const [ownerId, setOwnerId] = useState(init?.ownerId ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [source, setSource] = useState<CommercialLeadSource>(init?.source ?? 'manual');
  const [campaign, setCampaign] = useState(init?.campaign ?? '');
  const [monthlyDeliveries, setMonthlyDeliveries] = useState(init?.monthlyDeliveries ?? '');
  const [driversCount, setDriversCount] = useState(init?.driversCount ?? '');
  const [erp, setErp] = useState(init?.erp ?? '');
  const erpLegacy = useMemo(
    () =>
      erp && !activeErps.some((o) => o.name.toLowerCase() === erp.toLowerCase()) ? erp : null,
    [erp, activeErps],
  );
  const [notes, setNotes] = useState(init?.notes ?? '');
  const [customFields, setCustomFields] = useState<Record<string, string>>(init?.customFields ?? {});
  const [tags, setTags] = useState<string[]>(init?.tags ?? []);
  const [perfilCidade, setPerfilCidade] = useState(init?.perfilCidade ?? '');
  const [deliveryHours, setDeliveryHours] = useState<CommercialDeliveryHoursValue>(
    init?.deliveryHours ?? deliveryHoursFromCustomFields(undefined),
  );
  const [expectedCloseAt, setExpectedCloseAt] = useState(init?.expectedCloseAt ?? '');

  const dynamicFieldDefinitions = useMemo(
    () => fieldDefinitions.filter((f) => !COMMERCIAL_OPERATION_MANAGED_SLUGS.has(f.slug)),
    [fieldDefinitions],
  );

  const statesQuery = useQuery({
    queryKey: ['geo', 'states'],
    queryFn: async () => (await api.get('/api/geo/states')).data as ApiState[],
  });

  const citiesQuery = useQuery({
    queryKey: ['geo', 'cities', state],
    enabled: Boolean(state),
    queryFn: async () => (await api.get(`/api/geo/states/${encodeURIComponent(state)}/cities`)).data as ApiCity[],
  });

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting || submittingRef.current) return;
    submittingRef.current = true;
    const deliveryCustom = deliveryHoursToCustomFields(deliveryHours);
    const mergedCustom: Record<string, string | number | boolean> = {
      ...Object.fromEntries(Object.entries(customFields).filter(([, v]) => v)),
      ...deliveryCustom,
    };
    if (perfilCidade) mergedCustom.perfil_cidade = perfilCidade;

    const input: LeadInput = {
      trade_name: tradeName.trim() || undefined,
      phone: onlyDigits(phone),
      city: city.trim() || undefined,
      state: state.trim().toUpperCase() || undefined,
      contact_name: contactName.trim() || undefined,
      cnpj: onlyDigits(cnpj) || undefined,
      contact_email: contactEmail.trim() || undefined,
      contact_role: contactRole.trim() || undefined,
      legal_name: legalName.trim() || undefined,
      owner_id: ownerId || undefined,
      source,
      campaign: campaign.trim() || undefined,
      monthly_deliveries: monthlyDeliveries ? Number(monthlyDeliveries) : undefined,
      drivers_count: driversCount ? Number(driversCount) : undefined,
      erp: erp.trim() || undefined,
      notes: notes.trim() || undefined,
      custom_fields: mergedCustom,
      tags: tags.length ? tags : undefined,
      expected_close_at: expectedCloseAt
        ? new Date(`${expectedCloseAt.includes('T') ? expectedCloseAt.slice(0, 10) : expectedCloseAt}T12:00:00`).toISOString()
        : undefined,
    };
    const err = validateLeadInput(input);
    if (err) {
      setFormError(err);
      submittingRef.current = false;
      return;
    }
    setFormError(null);
    void Promise.resolve(onSubmit(input)).finally(() => {
      submittingRef.current = false;
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <CadastroSection title="Identificação" desc="Dados mínimos para abrir o negócio no pipeline.">
        <CadastroField label="Nome fantasia">
          <FormControl
            inputSize="md"
            value={tradeName}
            onChange={(e) => setTradeName(e.target.value)}
          />
        </CadastroField>
        <CadastroField label="Telefone WhatsApp" required>
          <BrPhoneInput value={phone} onChange={setPhone} required />
        </CadastroField>
        <div className="grid gap-4 sm:grid-cols-2">
          <CadastroField label="UF">
            <FormSearchCombobox
              value={state}
              onChange={(v) => {
                setState(v);
                setCity('');
              }}
              placeholder="Buscar UF…"
              options={(statesQuery.data || []).map((s) => ({
                value: s.code,
                label: `${s.code} — ${s.name}`,
              }))}
            />
          </CadastroField>
          <CadastroField label="Cidade">
            <FormSearchCombobox
              value={city}
              onChange={setCity}
              disabled={!state || citiesQuery.isLoading}
              placeholder={citiesQuery.isLoading ? 'Carregando…' : 'Buscar cidade…'}
              options={(citiesQuery.data || []).map((c) => ({ value: c.name, label: c.name }))}
            />
          </CadastroField>
        </div>
        <CadastroField label="Razão social">
          <FormControl inputSize="md" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
        </CadastroField>
        <CadastroField label="CNPJ">
          <BrCnpjInput value={cnpj} onChange={setCnpj} />
        </CadastroField>
      </CadastroSection>

      <CadastroSection title="Contato comercial" desc="Quem responde no WhatsApp e na negociação do dia a dia.">
        <CadastroField label="Nome do decisor">
          <FormControl inputSize="md" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </CadastroField>
        <CadastroField label="E-mail">
          <FormControl
            inputSize="md"
            type="text"
            inputMode="email"
            autoComplete="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </CadastroField>
        <CadastroField label="Cargo">
          <FormControl inputSize="md" value={contactRole} onChange={(e) => setContactRole(e.target.value)} />
        </CadastroField>
      </CadastroSection>

      <CadastroSection
        title="Operação (estimativa)"
        desc="Necessário para viabilidade em Diagnóstico: volume, perfil da cidade e horários de delivery."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <CadastroField label="Entregas/mês">
            <FormControl
              inputSize="md"
              type="number"
              min={0}
              value={monthlyDeliveries}
              onChange={(e) => setMonthlyDeliveries(e.target.value)}
            />
          </CadastroField>
          <CadastroField label="Perfil da cidade">
            <FormSelect
              value={perfilCidade}
              onChange={setPerfilCidade}
              placeholder="Selecione…"
              options={[
                { value: 'pequena', label: 'Pequena' },
                { value: 'media', label: 'Média' },
                { value: 'grande', label: 'Grande' },
              ]}
            />
          </CadastroField>
          <CadastroField label="Nº entregadores">
            <FormControl
              inputSize="md"
              type="number"
              min={0}
              value={driversCount}
              onChange={(e) => setDriversCount(e.target.value)}
            />
          </CadastroField>
        </div>
        <CadastroField label="Horários de delivery">
          <CommercialLeadDeliveryHoursEditor value={deliveryHours} onChange={setDeliveryHours} />
        </CadastroField>
        <CadastroField label="ERP">
          <FormSearchCombobox
            value={erp}
            onChange={setErp}
            placeholder="Buscar ERP…"
            options={[
              ...(erpLegacy ? [{ value: erpLegacy, label: `${erpLegacy} (legado)` }] : []),
              ...activeErps.map((o) => ({ value: o.name, label: o.name })),
            ]}
          />
        </CadastroField>
      </CadastroSection>

      <CadastroSection title="Comercial">
        <div className="grid gap-4 sm:grid-cols-2">
          <CadastroField label="Responsável (owner)">
            <FormSearchCombobox
              value={ownerId}
              onChange={setOwnerId}
              placeholder="Buscar responsável…"
              options={owners.map((o) => ({ value: o.id, label: o.name }))}
            />
          </CadastroField>
          <CadastroField label="Origem">
            <FormSelect
              value={source}
              onChange={(v) => setSource(v as CommercialLeadSource)}
              options={[
                { value: 'manual', label: 'Manual' },
                { value: 'instagram', label: 'Instagram' },
                { value: 'indicacao', label: 'Indicação' },
                { value: 'whatsapp', label: 'WhatsApp' },
                { value: 'campanha', label: 'Campanha' },
              ]}
            />
          </CadastroField>
        </div>
        <CadastroField label="Campanha">
          <FormControl
            inputSize="md"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            placeholder="Ex.: Meta — delivery Q2"
          />
        </CadastroField>
        <CadastroField label="Previsão de fechamento">
          <BrDateInput
            value={expectedCloseAt ? formatDateBr(`${expectedCloseAt}T12:00:00`) : ''}
            onChange={(iso) => setExpectedCloseAt(iso ? iso.slice(0, 10) : '')}
            placeholder="dd/mm/aaaa"
          />
        </CadastroField>
      </CadastroSection>

      <CadastroSection title="Tags">
        <div className="flex flex-wrap gap-2">
          {COMMERCIAL_TAGS.map((tag) => (
            <Button
              key={tag}
              type="button"
              size="xs"
              variant={tags.includes(tag) ? 'default' : 'outline'}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </Button>
          ))}
        </div>
      </CadastroSection>

      <CadastroSection title="Observações">
        <CadastroField label="Notas">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className={formTextareaClassName}
          />
        </CadastroField>
      </CadastroSection>

      {dynamicFieldDefinitions.length > 0 ? (
        <details className="rounded-xl border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium">Campos adicionais</summary>
          <div className="mt-3 space-y-4">
          {dynamicFieldDefinitions.map((field) => (
            <CadastroField key={field.id} label={field.label} required={field.required}>
              {field.type === 'select' ? (
                <FormSearchCombobox
                  value={customFields[field.slug] ?? ''}
                  onChange={(v) => setCustomFields((prev) => ({ ...prev, [field.slug]: v }))}
                  placeholder="Buscar…"
                  options={(field.options ?? []).map((opt) => ({ value: opt, label: opt }))}
                />
              ) : field.type === 'boolean' ? (
                <FormSelect
                  value={customFields[field.slug] ?? ''}
                  onChange={(v) => setCustomFields((prev) => ({ ...prev, [field.slug]: v }))}
                  placeholder="—"
                  options={[
                    { value: 'true', label: 'Sim' },
                    { value: 'false', label: 'Não' },
                  ]}
                />
              ) : (
                <FormControl
                  inputSize="md"
                  value={customFields[field.slug] ?? ''}
                  onChange={(e) => setCustomFields((prev) => ({ ...prev, [field.slug]: e.target.value }))}
                />
              )}
            </CadastroField>
          ))}
          </div>
        </details>
      ) : null}

      {formError || submitError ? (
        <p className="text-sm text-destructive">{formError || submitError}</p>
      ) : null}

      <div className="flex justify-end gap-2 pb-8">
        <Link
          href={cancelHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-sidebar-accent/60"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-glow disabled:pointer-events-none disabled:opacity-60"
        >
          {isSubmitting
            ? mode === 'create'
              ? 'Criando…'
              : 'Salvando…'
            : mode === 'create'
              ? 'Criar lead'
              : 'Salvar alterações'}
        </button>
      </div>
    </form>
  );
}
