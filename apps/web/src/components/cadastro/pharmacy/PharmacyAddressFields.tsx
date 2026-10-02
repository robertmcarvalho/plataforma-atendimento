'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { UseQueryResult } from '@tanstack/react-query';
import api from '@/lib/api';
import { BrCepInput } from '@/components/form/BrInputs';
import { CadastroField } from '@/components/cadastro/CadastroPrimitives';
import { FormControl, formControlSizes } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { onlyDigits } from '@/lib/brFormat';
import {
  cityMatchesIbge,
  resolveCityIbgeCode,
  type ApiCity,
  type CepLookupResult,
} from '@/lib/pharmacyAddress';
import { cn } from '@/lib/utils';

type ApiState = { code: string; name: string };

export type PharmacyAddressValues = {
  cep: string;
  street: string;
  number: string;
  neighborhood: string;
  complement: string;
  city: string;
  state: string;
  /** Preenchido automaticamente via ViaCEP / catálogo IBGE (UF+cidade). */
  ibge_city_code?: string;
};

type Props = {
  values: PharmacyAddressValues;
  onChange: (patch: Partial<PharmacyAddressValues>) => void;
  statesQuery: UseQueryResult<ApiState[]>;
  citiesQuery: UseQueryResult<ApiCity[]>;
  disabled?: boolean;
  onLookupMessage?: (msg: string | null) => void;
};

function normalizeIbge(raw: string | null | undefined): string {
  const digits = onlyDigits(raw || '').slice(0, 7);
  return digits.length === 7 ? digits : '';
}

export function PharmacyAddressFields({
  values,
  onChange,
  statesQuery,
  citiesQuery,
  disabled,
  onLookupMessage,
}: Props) {
  const [cepLoading, setCepLoading] = useState(false);
  const [addressManualMode, setAddressManualMode] = useState(false);
  const [addressHint, setAddressHint] = useState<string | null>(null);

  const cities = useMemo(() => citiesQuery.data || [], [citiesQuery.data]);
  const useCitySelect =
    !addressManualMode &&
    Boolean(values.state) &&
    (!values.city.trim() || cityMatchesIbge(values.city, cities));

  const enableManual = useCallback(
    (hint: string) => {
      setAddressManualMode(true);
      setAddressHint(hint);
      onLookupMessage?.(hint);
    },
    [onLookupMessage]
  );

  const lookupCep = async () => {
    const cepDigits = onlyDigits(values.cep);
    if (!cepDigits || cepDigits.length !== 8) {
      const msg = 'CEP inválido (use 8 dígitos).';
      setAddressHint(msg);
      onLookupMessage?.(msg);
      return;
    }
    setCepLoading(true);
    setAddressHint(null);
    onLookupMessage?.(null);
    try {
      const data = (await api.get(`/api/geo/cep/${cepDigits}`)).data as CepLookupResult;
      if (data?.not_found) {
        enableManual('CEP não encontrado. Preencha o endereço manualmente.');
        return;
      }

      const patch: Partial<PharmacyAddressValues> = {};
      if (data?.street) patch.street = String(data.street);
      if (data?.neighborhood) patch.neighborhood = String(data.neighborhood);
      if (data?.complement) patch.complement = String(data.complement);
      if (data?.state) patch.state = String(data.state);
      if (data?.city) patch.city = String(data.city);

      const nextState = patch.state || values.state;
      const nextCity = patch.city || values.city;
      if (!nextCity?.trim()) {
        enableManual('CEP sem cidade no cadastro. Preencha o endereço manualmente.');
        return;
      }

      let ibge = normalizeIbge(data?.ibge);
      if (nextState) {
        let ibgeCities = cities;
        if (patch.state && patch.state !== values.state) {
          try {
            ibgeCities = (await api.get(`/api/geo/states/${encodeURIComponent(nextState)}/cities`)).data as ApiCity[];
          } catch {
            ibgeCities = [];
          }
        }
        if (!cityMatchesIbge(nextCity, ibgeCities)) {
          enableManual('Cidade do CEP não está no catálogo IBGE. Confirme ou edite o nome da cidade.');
          if (ibge) patch.ibge_city_code = ibge;
          onChange(patch);
          return;
        }
        if (!ibge) ibge = normalizeIbge(resolveCityIbgeCode(nextCity, ibgeCities));
      }
      if (ibge) patch.ibge_city_code = ibge;

      onChange(patch);
      setAddressManualMode(false);
      setAddressHint(null);
      onLookupMessage?.(null);
    } catch {
      const msg = 'Falha ao buscar CEP.';
      setAddressHint(msg);
      onLookupMessage?.(msg);
    } finally {
      setCepLoading(false);
    }
  };

  useEffect(() => {
    if (!values.state || !values.city.trim() || addressManualMode) return;
    if (cities.length > 0 && !cityMatchesIbge(values.city, cities)) {
      setAddressManualMode(true);
      setAddressHint('Cidade fora do catálogo IBGE para este estado. Edite manualmente se necessário.');
    }
  }, [values.state, values.city, cities, addressManualMode]);

  // Backfill IBGE quando a lista da UF chega e o código ainda está vazio (ex.: edição).
  // Não depende de onChange para evitar loop; não regrava se o usuário limpar o campo.
  useEffect(() => {
    if (!values.city.trim() || !cities.length) return;
    if (normalizeIbge(values.ibge_city_code)) return;
    const resolved = normalizeIbge(resolveCityIbgeCode(values.city, cities));
    if (resolved) onChange({ ibge_city_code: resolved });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reagir a cidade/lista IBGE
  }, [values.city, values.ibge_city_code, cities]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <CadastroField icon={MapPin} label="CEP">
        <div className="flex gap-2">
          <BrCepInput
            value={values.cep}
            onChange={(digits) => onChange({ cep: digits })}
            className={cn(formControlSizes.lg, 'w-full')}
            placeholder="00000-000"
            disabled={disabled}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void lookupCep()}
            disabled={disabled || cepLoading}
            className="gap-1.5"
          >
            <Search className="h-3.5 w-3.5" /> {cepLoading ? '...' : 'Buscar'}
          </Button>
        </div>
      </CadastroField>
      <div />
      {addressHint ? (
        <div className="md:col-span-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {addressHint}
        </div>
      ) : null}
      <CadastroField icon={MapPin} label="Logradouro">
        <FormControl inputSize="lg" value={values.street} onChange={(e) => onChange({ street: e.target.value })} disabled={disabled} />
      </CadastroField>
      <CadastroField icon={MapPin} label="Número">
        <FormControl inputSize="lg" value={values.number} onChange={(e) => onChange({ number: e.target.value })} disabled={disabled} />
      </CadastroField>
      <CadastroField icon={MapPin} label="Bairro">
        <FormControl inputSize="lg" value={values.neighborhood} onChange={(e) => onChange({ neighborhood: e.target.value })} disabled={disabled} />
      </CadastroField>
      <CadastroField icon={MapPin} label="Complemento">
        <FormControl inputSize="lg" value={values.complement} onChange={(e) => onChange({ complement: e.target.value })} disabled={disabled} />
      </CadastroField>
      <CadastroField icon={MapPin} label="Estado">
        <FormSelect
          value={values.state}
          onChange={(v) => {
            onChange({ state: v, city: '', ibge_city_code: '' });
            setAddressManualMode(false);
            setAddressHint(null);
          }}
          disabled={disabled}
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
            value={values.city}
            onChange={(v) => {
              const ibge = normalizeIbge(resolveCityIbgeCode(v, cities));
              onChange({ city: v, ibge_city_code: ibge });
            }}
            disabled={disabled || !values.state}
            size="lg"
            placeholder={values.state ? 'Selecione…' : 'Selecione o estado primeiro'}
            options={[
              { value: '', label: values.state ? 'Selecione…' : 'Selecione o estado primeiro' },
              ...cities.map((c) => ({ value: c.name, label: c.name })),
            ]}
          />
        ) : (
          <FormControl
            inputSize="lg"
            value={values.city}
            onChange={(e) => {
              const city = e.target.value;
              const ibge = normalizeIbge(resolveCityIbgeCode(city, cities));
              onChange({ city, ibge_city_code: ibge });
            }}
            disabled={disabled || (!values.state && !addressManualMode)}
            placeholder={
              values.state
                ? citiesQuery.isLoading
                  ? 'Carregando cidades...'
                  : 'Digite a cidade'
                : 'Selecione o estado ou use busca CEP'
            }
          />
        )}
      </CadastroField>
    </div>
  );
}
