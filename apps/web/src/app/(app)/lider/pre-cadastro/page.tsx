'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, FileText, Loader2, Mail, MapPin, Phone, Plus, Save, Truck, User, X } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { BrCpfInput, BrPhoneInput } from '@/components/form/BrInputs';
import { serializeWorkScheduleForApi } from '@/components/settings/BusinessHoursEditor';
import { CadastroField, CadastroPageScroll, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import { DriverWorkScheduleEditor } from '@/components/cadastro/DriverWorkScheduleEditor';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';

type Pharmacy = { id: string; trade_name: string };
type PreRegistration = {
  id: string;
  name: string;
  phone: string;
  driver_type?: 'fixed' | 'daily' | null;
  created_at?: string | null;
};

export default function LiderPreCadastroPage() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [driverType, setDriverType] = useState<'fixed' | 'daily'>('fixed');
  const [pharmacyIds, setPharmacyIds] = useState<string[]>([]);
  const [primaryPharmacyId, setPrimaryPharmacyId] = useState('');
  const [pharmacyToAdd, setPharmacyToAdd] = useState('');
  const [workSchedule, setWorkSchedule] = useState<Record<string, unknown>>({});
  const [notes, setNotes] = useState('');
  const [savingError, setSavingError] = useState<string | null>(null);

  const pharmaciesQuery = useQuery<Pharmacy[]>({
    queryKey: ['leader-portal', 'pharmacies'],
    queryFn: async () => (await api.get('/api/leader-portal/pharmacies')).data as Pharmacy[],
    enabled: user?.role === 'leader',
  });

  const preRegsQuery = useQuery<PreRegistration[]>({
    queryKey: ['leader-portal', 'pre-registrations'],
    queryFn: async () => (await api.get('/api/leader-portal/pre-registrations')).data as PreRegistration[],
    enabled: user?.role === 'leader',
  });

  const createMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      cpf?: string | null;
      phone: string;
      email?: string | null;
      city?: string | null;
      state?: string | null;
      driver_type: 'fixed' | 'daily';
      pharmacy_ids: string[];
      primary_pharmacy_id?: string | null;
      work_schedule?: Record<string, unknown>;
      notes?: string | null;
    }) => (await api.post('/api/leader-portal/pre-registrations', payload)).data,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['leader-portal', 'pre-registrations'] }),
        qc.invalidateQueries({ queryKey: ['leader-portal', 'drivers'] }),
      ]);
      setSavingError(null);
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSavingError(msg || 'Não foi possível enviar o pré-cadastro.');
    },
  });

  const canSubmit = useMemo(() => {
    if (!name.trim()) return false;
    if (!phone.trim()) return false;
    if (!pharmacyIds.length) return false;
    if (createMutation.isPending) return false;
    return true;
  }, [createMutation.isPending, name, phone, pharmacyIds.length]);

  if (user && user.role !== 'leader') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <PageHeader eyebrow="Acesso" title="Pré-cadastro" description="Esta área é exclusiva para perfis de líder." />
        <Link className="button-secondary" href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  const pharmacies = pharmaciesQuery.data || [];
  const selectedPharmacies = pharmacies.filter((p) => pharmacyIds.includes(p.id));

  function resetForm() {
    setName('');
    setCpf('');
    setPhone('');
    setEmail('');
    setCity('');
    setState('');
    setDriverType('fixed');
    setPharmacyIds([]);
    setPrimaryPharmacyId('');
    setPharmacyToAdd('');
    setWorkSchedule({});
    setNotes('');
    setSavingError(null);
  }

  return (
    <CadastroPageScroll maxWidthClassName="max-w-6xl">
      <PageHeader
        eyebrow="Cadastros"
        title="Pré-cadastro de entregador"
        description="Inicie o processo com vínculo, escala e perfil. O Operacional recebe a solicitação para finalizar."
        actions={
          <Link href="/lider" className="button-secondary">
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>
        }
      />

      {savingError ? <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{savingError}</div> : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <CadastroSection title="Dados pessoais" desc="Informações básicas para o Operacional finalizar o cadastro.">
            <div className="grid gap-4 md:grid-cols-2">
              <CadastroField icon={User} label="Nome completo" required>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="João da Silva" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50" />
              </CadastroField>
              <CadastroField icon={FileText} label="CPF">
                <BrCpfInput value={cpf} onChange={setCpf} className="w-full" placeholder="000.000.000-00" />
              </CadastroField>
              <CadastroField icon={Phone} label="Telefone" required>
                <BrPhoneInput value={phone} onChange={setPhone} className="w-full" placeholder="(11) 99000-0000" />
              </CadastroField>
              <CadastroField icon={Mail} label="E-mail">
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="entregador@email.com" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50" />
              </CadastroField>
              <CadastroField icon={MapPin} label="Cidade">
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cidade" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50" />
              </CadastroField>
              <CadastroField icon={MapPin} label="UF">
                <input value={state} onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))} placeholder="SP" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm uppercase outline-none focus:border-primary/50" />
              </CadastroField>
            </div>
          </CadastroSection>

          <CadastroSection title="Tipo & vínculo" desc="Selecione o perfil e as unidades que ficarão vinculadas ao entregador.">
            <div className="grid gap-4 md:grid-cols-3">
              <CadastroField icon={Truck} label="Tipo de entregador" required>
                <div className="flex gap-1.5 rounded-md border border-border bg-background p-1">
                  {(
                    [
                      { k: 'fixed', label: 'Fixo' },
                      { k: 'daily', label: 'Diarista' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.k}
                      type="button"
                      onClick={() => setDriverType(t.k)}
                      className={cn('flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors', driverType === t.k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </CadastroField>

              <CadastroField icon={Building2} label="Adicionar farmácia">
                <div className="flex gap-2">
                  <select value={pharmacyToAdd} onChange={(e) => setPharmacyToAdd(e.target.value)} className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50">
                    <option value="">{pharmaciesQuery.isLoading ? 'Carregando…' : 'Selecione…'}</option>
                    {pharmacies
                      .filter((p) => !pharmacyIds.includes(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.trade_name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (!pharmacyToAdd) return;
                      setPharmacyIds((curr) => (curr.includes(pharmacyToAdd) ? curr : [...curr, pharmacyToAdd]));
                      if (!primaryPharmacyId) setPrimaryPharmacyId(pharmacyToAdd);
                      setPharmacyToAdd('');
                    }}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary-glow"
                  >
                    <Plus className="h-3.5 w-3.5" /> Vincular
                  </button>
                </div>
              </CadastroField>
            </div>

            {selectedPharmacies.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background px-3 py-4 text-sm text-muted-foreground">Nenhuma farmácia selecionada.</div>
            ) : (
              <div className="space-y-2">
                {selectedPharmacies.map((p) => {
                  const isPrimary = primaryPharmacyId === p.id;
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Building2 className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{p.trade_name}</div>
                          <button type="button" onClick={() => setPrimaryPharmacyId(p.id)} className={cn('mt-0.5 text-[10px] font-medium hover:underline', isPrimary ? 'text-success' : 'text-primary')}>
                            {isPrimary ? 'Primária' : 'Definir como primária'}
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPharmacyIds((curr) => curr.filter((x) => x !== p.id));
                          if (primaryPharmacyId === p.id) setPrimaryPharmacyId('');
                        }}
                        className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2 py-1 text-muted-foreground hover:bg-surface-hover hover:text-destructive"
                        aria-label="Remover vínculo"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </CadastroSection>

          <CadastroSection title="Escala de trabalho" desc="Defina turnos por dia, feriados e exceções.">
            <div className="rounded-xl border border-border bg-background p-4">
              <DriverWorkScheduleEditor value={workSchedule} onChange={setWorkSchedule} />
            </div>
          </CadastroSection>

          <CadastroSection title="Observações" desc="Contexto que ajuda o Operacional a finalizar o cadastro.">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Detalhes que o Operacional precisa saber…"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
          </CadastroSection>

          <div className="flex items-center justify-end gap-2">
            <button type="button" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-hover" onClick={resetForm}>
              Limpar
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              className={cn('inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-glow', !canSubmit && 'pointer-events-none opacity-50')}
              onClick={() => {
                const payload = {
                  name: name.trim(),
                  cpf: cpf.trim() ? cpf.trim() : null,
                  phone: phone.trim(),
                  email: email.trim() ? email.trim() : null,
                  city: city.trim() ? city.trim() : null,
                  state: state.trim() ? state.trim() : null,
                  driver_type: driverType,
                  pharmacy_ids: pharmacyIds,
                  primary_pharmacy_id: primaryPharmacyId || pharmacyIds[0] || null,
                  work_schedule: serializeWorkScheduleForApi(workSchedule),
                  notes: notes.trim() ? notes.trim() : null,
                };
                void createMutation.mutateAsync(payload).then(resetForm);
              }}
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enviar para Operacional
            </button>
          </div>
        </div>

        <aside className="overflow-hidden rounded-xl border border-border bg-surface self-start">
          <div className="border-b border-border px-4 py-3">
            <h4 className="text-sm font-semibold">Em andamento</h4>
            <p className="text-[11px] text-muted-foreground">Pré-cadastros com tag “cadastro-pendente”.</p>
          </div>
          <div className="p-4">
            {preRegsQuery.isLoading ? (
              <div className="text-xs text-muted-foreground">Carregando…</div>
            ) : (preRegsQuery.data || []).length === 0 ? (
              <div className="text-xs text-muted-foreground">Nenhum pré-cadastro no momento.</div>
            ) : (
              <div className="space-y-2">
                {(preRegsQuery.data || []).slice(0, 20).map((d) => (
                  <div key={d.id} className="rounded-lg border border-border bg-background/40 px-3 py-2">
                    <div className="text-xs font-medium">{d.name}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center justify-between">
                      <span>{d.driver_type === 'daily' ? 'Diarista' : 'Fixo'}</span>
                      <span className="font-mono">{(d.phone || '').trim() || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </CadastroPageScroll>
  );
}

