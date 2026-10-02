'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BrCepInput, BrCnpjInput, BrCpfInput, BrPhoneInput } from '@/components/form/BrInputs';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { CadastroField, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import {
  fetchPublicCep,
  fetchPublicCommercialCities,
  fetchPublicCommercialStates,
  fetchPublicDataRequest,
  submitPublicDataRequest,
  type PublicDataRequestSubmit,
} from '@/lib/commercial/commercialPublicApi';
import { onlyDigits } from '@/lib/brFormat';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

export default function CommercialPublicFillPage() {
  const params = useParams();
  const token = String(params?.token || '');

  const metaQuery = useQuery({
    queryKey: ['public', 'commercial', 'data-request', token],
    enabled: Boolean(token),
    queryFn: () => fetchPublicDataRequest(token),
    retry: false,
  });

  const [legalName, setLegalName] = useState('');
  const [legalCpf, setLegalCpf] = useState('');
  const [legalEmail, setLegalEmail] = useState('');
  const [legalPhone, setLegalPhone] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [cep, setCep] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [complement, setComplement] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('MG');
  const [expName, setExpName] = useState('');
  const [expPhone, setExpPhone] = useState('');
  const [finName, setFinName] = useState('');
  const [finPhone, setFinPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const meta = metaQuery.data;

  useEffect(() => {
    if (!meta?.current) return;
    const c = meta.current;
    setLegalName(String(c.legal_representative_name || ''));
    setLegalCpf(String(c.legal_representative_cpf || ''));
    setLegalEmail(String(c.legal_representative_email || ''));
    setLegalPhone(String(c.legal_representative_phone || ''));
    setCnpj(String(c.cnpj || ''));
    setCep(String(c.address_cep || ''));
    setStreet(String(c.address_street || ''));
    setNumber(String(c.address_number || ''));
    setNeighborhood(String(c.address_neighborhood || ''));
    setComplement(String(c.address_complement || ''));
    setCity(meta.lead.city || '');
    setState(meta.lead.state || 'MG');
    setExpName(String(c.contact_expedition_name || ''));
    setExpPhone(String(c.contact_expedition_phone || ''));
    setFinName(String(c.contact_financial_name || ''));
    setFinPhone(String(c.contact_financial_phone || ''));
  }, [meta]);

  const statesQuery = useQuery({
    queryKey: ['public', 'geo', 'states'],
    queryFn: fetchPublicCommercialStates,
  });

  const citiesQuery = useQuery({
    queryKey: ['public', 'geo', 'cities', state],
    enabled: Boolean(state),
    queryFn: () => fetchPublicCommercialCities(state),
  });

  const submitMut = useMutation({
    mutationFn: (body: PublicDataRequestSubmit) => submitPublicDataRequest(token, body),
    onSuccess: () => setSubmitted(true),
  });

  const lookupCep = async () => {
    const digits = onlyDigits(cep);
    if (digits.length !== 8) return;
    const data = await fetchPublicCep(digits);
    if (data.not_found) return;
    if (data.street) setStreet(data.street);
    if (data.neighborhood) setNeighborhood(data.neighborhood);
    if (data.city) setCity(data.city);
    if (data.state) setState(data.state);
  };

  const title = useMemo(() => meta?.lead?.trade_name || 'Farmácia', [meta]);

  if (!token) {
    return <Shell message="Link inválido." />;
  }

  if (metaQuery.isLoading) {
    return <Shell message="Carregando formulário…" />;
  }

  if (metaQuery.isError || !meta) {
    return <Shell message="Link inválido, expirado ou já utilizado." />;
  }

  if (meta.status === 'submitted' || submitted) {
    return (
      <Shell
        title={title}
        message="Obrigado! Seus dados foram recebidos. Nossa equipe comercial dará sequência ao contrato."
      />
    );
  }

  if (meta.status === 'expired' || meta.status === 'cancelled') {
    return <Shell title={title} message="Este link não está mais disponível. Solicite um novo link ao vendedor." />;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const body: PublicDataRequestSubmit = {
      legal_representative_name: legalName.trim(),
      legal_representative_cpf: onlyDigits(legalCpf),
      legal_representative_email: legalEmail.trim(),
      legal_representative_phone: onlyDigits(legalPhone),
      cnpj: onlyDigits(cnpj),
      address_cep: onlyDigits(cep),
      address_street: street.trim(),
      address_number: number.trim(),
      address_neighborhood: neighborhood.trim(),
      address_complement: complement.trim() || undefined,
      city: city.trim(),
      state: state.trim().toUpperCase().slice(0, 2),
      contact_expedition_name: expName.trim(),
      contact_expedition_phone: onlyDigits(expPhone),
      contact_financial_name: finName.trim(),
      contact_financial_phone: onlyDigits(finPhone),
    };
    if (body.legal_representative_cpf.length !== 11) {
      setFormError('CPF inválido.');
      return;
    }
    if (body.cnpj.length !== 14) {
      setFormError('CNPJ inválido.');
      return;
    }
    if (body.address_cep.length !== 8) {
      setFormError('CEP inválido.');
      return;
    }
    submitMut.mutate(body, {
      onError: (err) => setFormError(apiErrorMessage(err)),
    });
  };

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-background p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aethera · Dados para contrato</p>
        <h1 className="mt-1 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Preencha os dados da farmácia para contrato. Razão social e nome fantasia serão confirmados pela nossa equipe
          com base no CNPJ informado.
        </p>

        {(meta.lead.legal_name || meta.lead.trade_name) ? (
          <div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {meta.lead.legal_name ? <p>Razão social (referência): {meta.lead.legal_name}</p> : null}
            {meta.lead.trade_name ? <p>Nome fantasia (referência): {meta.lead.trade_name}</p> : null}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <CadastroSection title="Representante legal">
            <CadastroField label="Nome completo" required>
              <FormControl required value={legalName} onChange={(e) => setLegalName(e.target.value)} />
            </CadastroField>
            <CadastroField label="CPF" required>
              <BrCpfInput value={legalCpf} onChange={setLegalCpf} required />
            </CadastroField>
            <CadastroField label="E-mail" required>
              <FormControl type="email" required value={legalEmail} onChange={(e) => setLegalEmail(e.target.value)} />
            </CadastroField>
            <CadastroField label="Telefone" required>
              <BrPhoneInput value={legalPhone} onChange={setLegalPhone} required />
            </CadastroField>
          </CadastroSection>

          <CadastroSection title="CNPJ">
            <CadastroField label="CNPJ da farmácia" required>
              <BrCnpjInput value={cnpj} onChange={setCnpj} required />
            </CadastroField>
          </CadastroSection>

          <CadastroSection title="Endereço da farmácia">
            <CadastroField label="CEP" required>
              <div className="flex gap-2">
                <BrCepInput value={cep} onChange={setCep} required className="flex-1" />
                <button
                  type="button"
                  onClick={() => void lookupCep()}
                  className="h-9 shrink-0 rounded-md border border-input px-3 text-xs"
                >
                  Buscar
                </button>
              </div>
            </CadastroField>
            <CadastroField label="Logradouro" required>
              <FormControl required value={street} onChange={(e) => setStreet(e.target.value)} />
            </CadastroField>
            <div className="grid gap-4 sm:grid-cols-2">
              <CadastroField label="Número" required>
                <FormControl required value={number} onChange={(e) => setNumber(e.target.value)} />
              </CadastroField>
              <CadastroField label="Bairro" required>
                <FormControl required value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
              </CadastroField>
            </div>
            <CadastroField label="Complemento">
              <FormControl value={complement} onChange={(e) => setComplement(e.target.value)} />
            </CadastroField>
            <div className="grid gap-4 sm:grid-cols-2">
              <CadastroField label="UF" required>
                <FormSelect
                  value={state}
                  onChange={(v) => {
                    setState(v);
                    setCity('');
                  }}
                  options={(statesQuery.data || []).map((s) => ({ value: s.code, label: s.code }))}
                />
              </CadastroField>
              <CadastroField label="Cidade" required>
                <FormSelect
                  value={city}
                  onChange={setCity}
                  placeholder="Selecione"
                  options={(citiesQuery.data || []).map((c) => ({ value: c.name, label: c.name }))}
                />
              </CadastroField>
            </div>
          </CadastroSection>

          <CadastroSection title="Contato expedição">
            <CadastroField label="Nome" required>
              <FormControl required value={expName} onChange={(e) => setExpName(e.target.value)} />
            </CadastroField>
            <CadastroField label="Telefone" required>
              <BrPhoneInput value={expPhone} onChange={setExpPhone} required />
            </CadastroField>
          </CadastroSection>

          <CadastroSection title="Contato financeiro">
            <CadastroField label="Nome" required>
              <FormControl required value={finName} onChange={(e) => setFinName(e.target.value)} />
            </CadastroField>
            <CadastroField label="Telefone" required>
              <BrPhoneInput value={finPhone} onChange={setFinPhone} required />
            </CadastroField>
          </CadastroSection>

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          {submitMut.isError ? <p className="text-sm text-destructive">{apiErrorMessage(submitMut.error)}</p> : null}

          <button
            type="submit"
            disabled={submitMut.isPending}
            className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {submitMut.isPending ? 'Enviando…' : 'Enviar dados'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Shell({ title, message }: { title?: string; message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="max-w-md rounded-xl border border-border bg-background p-8 text-center shadow-sm">
        {title ? <h1 className="text-lg font-semibold">{title}</h1> : null}
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
