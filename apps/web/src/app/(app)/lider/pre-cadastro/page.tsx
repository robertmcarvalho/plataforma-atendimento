'use client';

import { leaderPortalPageApi } from '@/lib/leaderPortal/leaderPortalPageApi';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { serializeWorkScheduleForApi } from '@/components/settings/BusinessHoursEditor';
import { CadastroPageScroll, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import { DriverWorkScheduleEditor } from '@/components/cadastro/DriverWorkScheduleEditor';
import { DriverPreCadastroForm } from '@/components/cadastro/driver/DriverPreCadastroForm';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { useAuth } from '@/store/auth';

type Pharmacy = { id: string; trade_name: string };
type LeaderMe = { leader: { id: string; name: string } };
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
    queryFn: async () => await leaderPortalPageApi.fetchPharmacies() as Pharmacy[],
    enabled: user?.role === 'leader',
  });

  const meQuery = useQuery<LeaderMe>({
    queryKey: ['leader-portal', 'me'],
    queryFn: async () => await leaderPortalPageApi.fetchMe() as LeaderMe,
    enabled: user?.role === 'leader',
  });

  const leaderId = meQuery.data?.leader?.id ?? '';

  const preRegsQuery = useQuery<PreRegistration[]>({
    queryKey: ['leader-portal', 'pre-registrations'],
    queryFn: async () => await leaderPortalPageApi.fetchPreRegistrations() as PreRegistration[],
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
    }) => await leaderPortalPageApi.createPreRegistration(payload),
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
        <Link className={buttonVariants({ variant: 'secondary' })} href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  const pharmacies = pharmaciesQuery.data || [];

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
        icon={UserPlus}
        eyebrow="Cadastros"
        title="Pré-cadastro de entregador"
        description="Inicie o processo com vínculo, escala e perfil. O Operacional recebe a solicitação para finalizar."
        actions={
          <Link href="/lider" className={buttonVariants({ variant: 'secondary' })}>
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>
        }
      />

      {savingError ? <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{savingError}</div> : null}

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        <div className="order-1 space-y-5 lg:order-none">
          <CadastroSection title="Dados do entregador" desc="Informações básicas e vínculos para o Operacional finalizar o cadastro.">
            <DriverPreCadastroForm
              leaderId={leaderId}
              onLeaderIdChange={() => {}}
              leaders={[]}
              showLeaderPicker={false}
              name={name}
              onNameChange={setName}
              cpf={cpf}
              onCpfChange={setCpf}
              phone={phone}
              onPhoneChange={setPhone}
              email={email}
              onEmailChange={setEmail}
              city={city}
              onCityChange={setCity}
              state={state}
              onStateChange={setState}
              driverType={driverType}
              onDriverTypeChange={setDriverType}
              pharmacyIds={pharmacyIds}
              onPharmacyIdsChange={setPharmacyIds}
              primaryPharmacyId={primaryPharmacyId}
              onPrimaryPharmacyIdChange={setPrimaryPharmacyId}
              pharmacyToAdd={pharmacyToAdd}
              onPharmacyToAddChange={setPharmacyToAdd}
              pharmacies={pharmacies}
              pharmaciesLoading={pharmaciesQuery.isLoading}
              notes={notes}
              onNotesChange={setNotes}
            />
          </CadastroSection>

          <CadastroSection title="Escala de trabalho" desc="Defina turnos por dia, feriados e exceções.">
            <div className="rounded-xl border border-border bg-background p-4">
              <DriverWorkScheduleEditor value={workSchedule} onChange={setWorkSchedule} />
            </div>
          </CadastroSection>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetForm}>
              Limpar
            </Button>
            <Button
              type="button"
              disabled={!canSubmit}
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
            </Button>
          </div>
        </div>

        <aside className="order-2 overflow-hidden rounded-xl border border-border bg-card lg:order-none lg:self-start">
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
                  <div key={d.id} className="rounded-lg border border-border bg-card px-3 py-2">
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

