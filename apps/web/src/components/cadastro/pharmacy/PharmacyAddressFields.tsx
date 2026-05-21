'use client';

import { useCallback, useEffect, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { UseQueryResult } from '@tanstack/react-query';
import api from '@/lib/api';
import { BrCepInput } from '@/components/form/BrInputs';
import { CadastroField } from '@/components/cadastro/CadastroPrimitives';
import { onlyDigits } from '@/lib/brFormat';
import {
  cityMatchesIbge,
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
};

type Props = {
  values: PharmacyAddressValues;
  onChange: (patch: Partial<PharmacyAddressValues>) => void;
  statesQuery: UseQueryResult<ApiState[]>;
  citiesQuery: UseQueryResult<ApiCity[]>;
  disabled?: boolean;
  onLookupMessage?: (msg: string | null) => void;
};

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

  const cities = citiesQuery.data || [];
  const useCitySelect =
    !addressManualMode && Boolean(values.state) && cities.length > 0 && cityMatchesIbge(values.city, cities);

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
      onChange(patch);

      const nextState = patch.state || values.state;
      const nextCity = patch.city || values.city;
      if (!nextCity?.trim()) {
        enableManual('CEP sem cidade no cadastro. Preencha o endereço manualmente.');
        return;
      }

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
          return;
        }
      }

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

  const inputClass =
    'h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 disabled:opacity-50';

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <CadastroField icon={MapPin} label="CEP">
        <div className="flex gap-2">
          <BrCepInput
            value={values.cep}
            onChange={(digits) => onChange({ cep: digits })}
            className="w-full"
            placeholder="00000-000"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() => void lookupCep()}
            disabled={disabled || cepLoading}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-hover',
              (disabled || cepLoading) && 'opacity-50 pointer-events-none'
            )}
          >
            <Search className="h-3.5 w-3.5" /> {cepLoading ? '...' : 'Buscar'}
          </button>
        </div>
      </CadastroField>
      <div />
      {addressHint ? (
        <div className="md:col-span-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {addressHint}
        </div>
      ) : null}
      <CadastroField icon={MapPin} label="Logradouro">
        <input
          value={values.street}
          onChange={(e) => onChange({ street: e.target.value })}
          disabled={disabled}
          className={inputClass}
        />
      </CadastroField>
      <CadastroField icon={MapPin} label="Número">
        <input
          value={values.number}
          onChange={(e) => onChange({ number: e.target.value })}
          disabled={disabled}
          className={inputClass}
        />
      </CadastroField>
      <CadastroField icon={MapPin} label="Bairro">
        <input
          value={values.neighborhood}
          onChange={(e) => onChange({ neighborhood: e.target.value })}
          disabled={disabled}
          className={inputClass}
        />
      </CadastroField>
      <CadastroField icon={MapPin} label="Complemento">
        <input
          value={values.complement}
          onChange={(e) => onChange({ complement: e.target.value })}
          disabled={disabled}
          className={inputClass}
        />
      </CadastroField>
      <CadastroField icon={MapPin} label="Estado">
        <select
          value={values.state}
          onChange={(e) => {
            onChange({ state: e.target.value, city: '' });
            setAddressManualMode(false);
            setAddressHint(null);
          }}
          disabled={disabled}
          className={inputClass}
        >
          <option value="">Selecione…</option>
          {(statesQuery.data || []).map((s) => (
            <option key={s.code} value={s.code}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
      </CadastroField>
      <CadastroField icon={MapPin} label="Cidade">
        {useCitySelect ? (
          <select
            value={values.city}
            onChange={(e) => onChange({ city: e.target.value })}
            disabled={disabled || !values.state}
            className={inputClass}
          >
            <option value="">{values.state ? 'Selecione…' : 'Selecione o estado primeiro'}</option>
            {cities.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={values.city}
            onChange={(e) => onChange({ city: e.target.value })}
            disabled={disabled || (!values.state && !addressManualMode)}
            placeholder={
              values.state
                ? citiesQuery.isLoading
                  ? 'Carregando cidades...'
                  : 'Digite a cidade'
                : 'Selecione o estado ou use busca CEP'
            }
            className={inputClass}
          />
        )}
      </CadastroField>
    </div>
  );
}
