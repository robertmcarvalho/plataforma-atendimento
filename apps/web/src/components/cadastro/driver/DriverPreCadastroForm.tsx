'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Mail, MapPin, Phone, Plus, Truck, User, FileText } from 'lucide-react';
import { CadastroField } from '@/components/cadastro/CadastroPrimitives';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { BrCpfInput, BrPhoneInput } from '@/components/form/BrInputs';
import {
  FormControl,
  formControlSizes,
  formTextareaClassName,
} from '@/components/form/FormControl';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { FormSelect } from '@/components/form/FormSelect';
import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';
import { cn } from '@/lib/utils';

type ApiState = { code: string; name: string };
type ApiCity = { name: string };

export function DriverPreCadastroForm({
  leaderId,
  onLeaderIdChange,
  leaders,
  showLeaderPicker,
  name,
  onNameChange,
  cpf,
  onCpfChange,
  phone,
  onPhoneChange,
  email,
  onEmailChange,
  city,
  onCityChange,
  state,
  onStateChange,
  driverType,
  onDriverTypeChange,
  pharmacyIds,
  onPharmacyIdsChange,
  primaryPharmacyId,
  onPrimaryPharmacyIdChange,
  pharmacyToAdd,
  onPharmacyToAddChange,
  pharmacies,
  pharmaciesLoading,
  notes,
  onNotesChange,
}: {
  leaderId: string;
  onLeaderIdChange: (v: string) => void;
  leaders: Array<{ id: string; name: string }>;
  showLeaderPicker?: boolean;
  name: string;
  onNameChange: (v: string) => void;
  cpf: string;
  onCpfChange: (v: string) => void;
  phone: string;
  onPhoneChange: (v: string) => void;
  email: string;
  onEmailChange: (v: string) => void;
  city: string;
  onCityChange: (v: string) => void;
  state: string;
  onStateChange: (v: string) => void;
  driverType: 'fixed' | 'daily';
  onDriverTypeChange: (v: 'fixed' | 'daily') => void;
  pharmacyIds: string[];
  onPharmacyIdsChange: (v: string[]) => void;
  primaryPharmacyId: string;
  onPrimaryPharmacyIdChange: (v: string) => void;
  pharmacyToAdd: string;
  onPharmacyToAddChange: (v: string) => void;
  pharmacies: Array<{ id: string; trade_name: string }>;
  pharmaciesLoading?: boolean;
  notes: string;
  onNotesChange: (v: string) => void;
}) {
  const selectedPharmacies = pharmacies.filter((p) => pharmacyIds.includes(p.id));

  const statesQuery = useQuery({
    queryKey: ['geo', 'states'],
    queryFn: async () => (await cadastroPageApi.fetchGeoStates()) as ApiState[],
  });

  const citiesQuery = useQuery({
    queryKey: ['geo', 'cities', state],
    enabled: Boolean(state),
    queryFn: async () => (await cadastroPageApi.fetchGeoCities(state)) as ApiCity[],
  });

  const cities = citiesQuery.data || [];
  const useCitySelect = Boolean(state) && cities.length > 0 && !citiesQuery.isLoading;
  const canLinkPharmacies = Boolean(leaderId) || showLeaderPicker === false;

  return (
    <div className="space-y-4">
      {showLeaderPicker ? (
        <CadastroField icon={User} label="Líder (em nome de)" required>
          <FormSearchCombobox
            value={leaderId}
            onChange={onLeaderIdChange}
            placeholder="Buscar líder…"
            options={leaders.map((l) => ({ value: l.id, label: l.name }))}
          />
        </CadastroField>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <CadastroField icon={User} label="Nome completo" required>
          <FormControl inputSize="lg" value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="João da Silva" />
        </CadastroField>
        <CadastroField icon={FileText} label="CPF">
          <BrCpfInput value={cpf} onChange={onCpfChange} className={cn(formControlSizes.lg, 'mt-0')} />
        </CadastroField>
        <CadastroField icon={Phone} label="Telefone" required>
          <BrPhoneInput value={phone} onChange={onPhoneChange} className={cn(formControlSizes.lg, 'mt-0')} />
        </CadastroField>
        <CadastroField icon={Mail} label="E-mail">
          <FormControl inputSize="lg" type="email" value={email} onChange={(e) => onEmailChange(e.target.value)} />
        </CadastroField>
        <CadastroField icon={MapPin} label="Estado">
          <FormSelect
            value={state}
            onChange={(v) => {
              onStateChange(v);
              onCityChange('');
            }}
            size="lg"
            options={[
              { value: '', label: 'Selecione…' },
              ...(statesQuery.data || []).map((s) => ({ value: s.code, label: `${s.name} (${s.code})` })),
            ]}
          />
        </CadastroField>
        <CadastroField icon={MapPin} label="Cidade">
          {useCitySelect ? (
            <FormSelect
              value={city}
              onChange={onCityChange}
              disabled={!state}
              size="lg"
              placeholder={state ? 'Selecione…' : 'Selecione o estado primeiro'}
              options={[
                { value: '', label: state ? 'Selecione…' : 'Selecione o estado primeiro' },
                ...cities.map((c) => ({ value: c.name, label: c.name })),
              ]}
            />
          ) : (
            <FormControl
              inputSize="lg"
              value={city}
              onChange={(e) => onCityChange(e.target.value)}
              disabled={!state}
              placeholder={state ? (citiesQuery.isLoading ? 'Carregando cidades…' : 'Digite a cidade') : 'Selecione o estado primeiro'}
            />
          )}
        </CadastroField>
        <CadastroField icon={Truck} label="Tipo" required>
          <SegmentedControl
            stretch
            variant="primary"
            value={driverType}
            onChange={onDriverTypeChange}
            items={[
              { id: 'fixed', label: 'Fixo' },
              { id: 'daily', label: 'Diarista' },
            ]}
          />
        </CadastroField>
        <CadastroField icon={Building2} label="Adicionar farmácia">
          <div className="flex gap-2">
            <FormSearchCombobox
              value={pharmacyToAdd}
              onChange={onPharmacyToAddChange}
              inputSize="lg"
              className="min-w-0 flex-1"
              disabled={pharmaciesLoading || !canLinkPharmacies}
              placeholder={
                showLeaderPicker && !leaderId
                  ? 'Selecione o líder primeiro'
                  : pharmaciesLoading
                    ? 'Carregando…'
                    : 'Buscar farmácia…'
              }
              options={pharmacies
                .filter((p) => !pharmacyIds.includes(p.id))
                .map((p) => ({ value: p.id, label: p.trade_name }))}
            />
            <button
              type="button"
              onClick={() => {
                if (!pharmacyToAdd) return;
                onPharmacyIdsChange(pharmacyIds.includes(pharmacyToAdd) ? pharmacyIds : [...pharmacyIds, pharmacyToAdd]);
                if (!primaryPharmacyId) onPrimaryPharmacyIdChange(pharmacyToAdd);
                onPharmacyToAddChange('');
              }}
              disabled={!canLinkPharmacies}
              className="inline-flex h-10 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Vincular
            </button>
          </div>
        </CadastroField>
      </div>
      {selectedPharmacies.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {selectedPharmacies.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-md border border-border px-2 py-1.5">
              <span>{p.trade_name}</span>
              <button
                type="button"
                className="text-destructive"
                onClick={() => {
                  const next = pharmacyIds.filter((id) => id !== p.id);
                  onPharmacyIdsChange(next);
                  if (primaryPharmacyId === p.id) onPrimaryPharmacyIdChange(next[0] || '');
                }}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {canLinkPharmacies ? 'Vincule ao menos uma farmácia do líder.' : 'Selecione o líder para vincular farmácias.'}
        </p>
      )}
      <CadastroField icon={FileText} label="Observações">
        <textarea value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={2} className={formTextareaClassName} />
      </CadastroField>
    </div>
  );
}
