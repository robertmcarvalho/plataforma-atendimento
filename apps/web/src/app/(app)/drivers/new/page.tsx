'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Briefcase,
  Building2,
  CalendarRange,
  Crown,
  FileCheck,
  FileText,
  KeyRound,
  Mail,
  MapPin,
  Phone,
  Plus,
  Save,
  Truck,
  User,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Switch } from '@/components/ui/Switch';
import { BrCnpjInput, BrCpfInput, BrPhoneInput } from '@/components/form/BrInputs';
import { serializeWorkScheduleForApi } from '@/components/settings/BusinessHoursEditor';
import { CadastroField, CadastroPageScroll, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import { DriverWorkScheduleEditor } from '@/components/cadastro/DriverWorkScheduleEditor';
import { onlyDigits, normalizeBrazilPhone } from '@/lib/brFormat';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { canManageCadastro } from '@/lib/cadastroPermissions';

type DriverStatus = 'active' | 'inactive' | 'blocked';
type DriverType = 'fixed' | 'daily';

type ApiState = { code: string; name: string };
type ApiCity = { name: string };
type ApiPharmacy = { id: string; trade_name: string };
type ApiDriver = { id: string };

type ApiDriverPharmacyLink = {
  id: string;
  is_primary: boolean;
  is_active: boolean;
  pharmacies: { id: string; trade_name: string } | null;
};

type ApiDriverDetail = {
  id: string;
  name: string;
  cpf: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  status: DriverStatus;
  driver_type: DriverType;
  pix_key: string | null;
  is_leader: boolean;
  is_mei: boolean;
  mei_cnpj: string | null;
  has_digital_certificate: boolean;
  digital_certificate_expires_at: string | null;
  work_schedule: unknown | null;
  primary_pharmacy: { id: string; trade_name: string } | null;
  driver_pharmacy_links: ApiDriverPharmacyLink[];
};

function titleCase(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

export default function DriverNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const user = useAuth((s) => s.user);
  const hasPermission = useAuth((s) => s.hasPermission);
  const canFetch = hasHydrated && isAuthenticated;

  const canEdit = canManageCadastro(user?.role, hasPermission, 'drivers');

  const editId = (searchParams.get('id') || '').trim();
  const isEditing = Boolean(editId);

  const [savingError, setSavingError] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formCpf, setFormCpf] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formState, setFormState] = useState('');
  const [formStatus, setFormStatus] = useState<DriverStatus>('active');
  const [formDriverType, setFormDriverType] = useState<DriverType>('fixed');
  const [formPixKey, setFormPixKey] = useState('');
  const [formIsLeader, setFormIsLeader] = useState(false);

  const [formIsMei, setFormIsMei] = useState(false);
  const [formMeiCnpj, setFormMeiCnpj] = useState('');
  const [formHasCert, setFormHasCert] = useState(false);
  const [formCertExpiresAt, setFormCertExpiresAt] = useState('');

  const [formWorkSchedule, setFormWorkSchedule] = useState<Record<string, unknown>>({});

  const [linkedPharmacyIds, setLinkedPharmacyIds] = useState<string[]>([]);
  const [primaryPharmacyId, setPrimaryPharmacyId] = useState<string>('');
  const [pharmacyToAdd, setPharmacyToAdd] = useState<string>('');

  const statesQuery = useQuery({
    queryKey: ['geo', 'states'],
    enabled: canFetch && canEdit,
    queryFn: async () => (await api.get('/api/geo/states')).data as ApiState[],
  });

  const citiesQuery = useQuery({
    queryKey: ['geo', 'cities', formState],
    enabled: canFetch && canEdit && Boolean(formState),
    queryFn: async () => (await api.get(`/api/geo/states/${encodeURIComponent(formState)}/cities`)).data as ApiCity[],
  });

  const pharmaciesQuery = useQuery({
    queryKey: ['drivers', 'pharmacies'],
    enabled: canFetch && canEdit,
    queryFn: async () => (await api.get('/api/pharmacies')).data as ApiPharmacy[],
  });

  const driverQuery = useQuery<ApiDriverDetail>({
    queryKey: ['drivers', 'edit', editId],
    enabled: canFetch && canEdit && isEditing,
    queryFn: async () => (await api.get(`/api/drivers/${editId}`)).data as ApiDriverDetail,
  });

  const hasPrefilled = useRef(false);
  useEffect(() => {
    hasPrefilled.current = false;
  }, [editId]);
  useEffect(() => {
    if (!isEditing) {
      hasPrefilled.current = false;
      return;
    }
    const d = driverQuery.data;
    if (!d || hasPrefilled.current) return;
    hasPrefilled.current = true;

    setFormName(d.name || '');
    setFormCpf(d.cpf || '');
    setFormPhone(d.phone || '');
    setFormEmail(d.email || '');
    setFormCity(d.city || '');
    setFormState(d.state || '');
    setFormStatus(d.status || 'active');
    setFormDriverType(d.driver_type || 'fixed');
    setFormPixKey(d.pix_key || '');
    setFormIsLeader(Boolean(d.is_leader));

    setFormIsMei(Boolean(d.is_mei));
    setFormMeiCnpj(d.mei_cnpj || '');
    setFormHasCert(Boolean(d.has_digital_certificate));
    setFormCertExpiresAt(d.digital_certificate_expires_at || '');

    setFormWorkSchedule(
      (d.work_schedule && typeof d.work_schedule === 'object' ? (d.work_schedule as Record<string, unknown>) : {}) as Record<string, unknown>
    );

    const activeLinks = (d.driver_pharmacy_links || []).filter((l) => l.is_active && l.pharmacies?.id);
    const linkedIds = Array.from(new Set(activeLinks.map((l) => l.pharmacies!.id)));
    setLinkedPharmacyIds(linkedIds);
    const primary = d.primary_pharmacy?.id || activeLinks.find((l) => l.is_primary)?.pharmacies?.id || linkedIds[0] || '';
    setPrimaryPharmacyId(primary);
  }, [driverQuery.data, isEditing]);

  const selectedPharmacies = useMemo(() => {
    const all = pharmaciesQuery.data || [];
    const byId = new Map(all.map((p) => [p.id, p]));
    return linkedPharmacyIds.map((id) => byId.get(id)).filter(Boolean) as ApiPharmacy[];
  }, [linkedPharmacyIds, pharmaciesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      setSavingError(null);
      const cpfDigits = onlyDigits(formCpf);
      if (!formName.trim()) throw new Error('Informe o nome completo.');
      if (cpfDigits && cpfDigits.length !== 11) throw new Error('CPF inválido (use 11 dígitos).');
      const phoneDigits = normalizeBrazilPhone(formPhone);
      if (!phoneDigits || phoneDigits.length < 12) throw new Error('Telefone inválido (inclua DDD).');
      const email = formEmail.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
      if (formIsMei) {
        const meiCnpjDigits = onlyDigits(formMeiCnpj);
        if (meiCnpjDigits.length !== 14) throw new Error('CNPJ do MEI inválido (use 14 dígitos).');
      }
      if (formHasCert && !String(formCertExpiresAt || '').trim()) throw new Error('Informe a data de expiração do certificado digital.');

      const uniqueLinks = Array.from(new Set(linkedPharmacyIds.filter(Boolean)));
      const primary = primaryPharmacyId || uniqueLinks[0] || null;

      const payload = {
        name: titleCase(formName),
        cpf: cpfDigits || undefined,
        phone: phoneDigits,
        email: email || null,
        city: formCity.trim() || undefined,
        state: formState.trim() || undefined,
        status: formStatus,
        driver_type: formDriverType,
        primary_pharmacy_id: primary,
        pix_key: formPixKey.trim() || null,
        is_leader: formIsLeader,
        is_mei: formIsMei,
        mei_cnpj: formIsMei ? onlyDigits(formMeiCnpj) : null,
        has_digital_certificate: formHasCert,
        digital_certificate_expires_at: formHasCert ? (String(formCertExpiresAt || '').trim() || null) : null,
        work_schedule: serializeWorkScheduleForApi(formWorkSchedule),
      };

      const saved = isEditing ? ((await api.put(`/api/drivers/${editId}`, payload)).data as ApiDriver) : ((await api.post('/api/drivers', payload)).data as ApiDriver);

      const currentActive = (driverQuery.data?.driver_pharmacy_links || [])
        .filter((l) => l.is_active && l.pharmacies?.id)
        .map((l) => l.pharmacies!.id);

      const toRemove = isEditing ? currentActive.filter((pid) => !uniqueLinks.includes(pid)) : [];
      for (const pid of toRemove) {
        await api.delete(`/api/drivers/${saved.id}/pharmacies/${pid}`).catch(() => undefined);
      }

      if (primary) {
        await api.post(`/api/drivers/${saved.id}/pharmacies`, { pharmacy_id: primary, is_primary: true }).catch(() => undefined);
      }
      const secondary = uniqueLinks.filter((id) => id !== primary);
      for (const pid of secondary) {
        await api.post(`/api/drivers/${saved.id}/pharmacies`, { pharmacy_id: pid, is_primary: false }).catch(() => undefined);
      }

      return saved;
    },
    onSuccess: (saved) => {
      router.push(`/drivers/${saved.id}`);
    },
    onError: (err: unknown) => {
      const msg = (err as Error)?.message || (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSavingError(msg || 'Falha ao salvar entregador.');
    },
  });

  if (user && !canEdit) {
    return (
      <CadastroPageScroll maxWidthClassName="max-w-5xl">
        <PageHeader eyebrow="Acesso" title="Novo entregador" description="Você não tem permissão para cadastrar entregadores." compact />
        <Link className="button-secondary" href="/drivers">
          Voltar
        </Link>
      </CadastroPageScroll>
    );
  }

  const backHref = isEditing ? `/drivers/${encodeURIComponent(editId)}` : '/drivers';

  return (
    <CadastroPageScroll maxWidthClassName="max-w-5xl">
      <Link href={backHref} className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Voltar para entregadores
      </Link>

      <PageHeader
        eyebrow="Operação · Cadastro"
        title={isEditing ? 'Editar entregador' : 'Novo entregador'}
        description={isEditing ? 'Atualize as informações e vínculos do entregador.' : 'Preencha as informações para vincular o entregador às farmácias.'}
        actions={
          <div className="flex gap-2">
            <Link href={backHref} className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-surface-hover">
              Cancelar
            </Link>
            <button
              type="button"
              onClick={() => void saveMutation.mutateAsync()}
              disabled={saveMutation.isPending}
              className={cn(
                'flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors',
                saveMutation.isPending && 'opacity-50 pointer-events-none'
              )}
            >
              <Save className="h-3.5 w-3.5" /> Salvar entregador
            </button>
          </div>
        }
      />

      {savingError ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{savingError}</div>
      ) : null}

      <div className="mt-6 space-y-5">
        <CadastroSection title="Dados pessoais" desc="Informações básicas do entregador.">
          <div className="grid gap-4 md:grid-cols-2">
            <CadastroField icon={User} label="Nome completo" required>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="João da Silva"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
              />
            </CadastroField>
            <CadastroField icon={FileText} label="CPF">
              <BrCpfInput value={formCpf} onChange={setFormCpf} className="w-full" placeholder="000.000.000-00" />
            </CadastroField>
            <CadastroField icon={Phone} label="Telefone" required>
              <BrPhoneInput value={formPhone} onChange={setFormPhone} className="w-full" placeholder="(11) 99000-0000" />
            </CadastroField>
            <CadastroField icon={Mail} label="E-mail">
              <input
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                type="email"
                placeholder="entregador@email.com"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
              />
            </CadastroField>
          </div>
        </CadastroSection>

        <CadastroSection title="Tipo & vínculo">
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
                    onClick={() => setFormDriverType(t.k)}
                    className={cn(
                      'flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors',
                      formDriverType === t.k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </CadastroField>

            <CadastroField icon={Crown} label="É líder?">
              <label className="flex h-10 items-center justify-between rounded-md border border-border bg-background px-3">
                <span className="text-xs text-muted-foreground">{formIsLeader ? 'Sim · acesso ao painel do líder' : 'Não'}</span>
                <Switch checked={formIsLeader} onCheckedChange={setFormIsLeader} />
              </label>
            </CadastroField>

            <CadastroField icon={KeyRound} label="Chave PIX">
              <input
                value={formPixKey}
                onChange={(e) => setFormPixKey(e.target.value)}
                placeholder="CPF, e-mail, telefone ou aleatória"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
              />
            </CadastroField>
          </div>
        </CadastroSection>

        <CadastroSection title="Documentação fiscal">
          <div className="grid gap-4 md:grid-cols-2">
            <CadastroField icon={Briefcase} label="Possui MEI?">
              <label className="flex h-10 items-center justify-between rounded-md border border-border bg-background px-3">
                <span className="text-xs text-muted-foreground">{formIsMei ? 'Sim' : 'Não'}</span>
                <Switch checked={formIsMei} onCheckedChange={setFormIsMei} />
              </label>
            </CadastroField>
            {formIsMei ? (
              <CadastroField icon={FileText} label="CNPJ do MEI" required>
                <BrCnpjInput value={formMeiCnpj} onChange={setFormMeiCnpj} className="w-full" placeholder="00.000.000/0000-00" />
              </CadastroField>
            ) : (
              <div />
            )}

            <CadastroField icon={FileCheck} label="Possui certificado digital?">
              <label className="flex h-10 items-center justify-between rounded-md border border-border bg-background px-3">
                <span className="text-xs text-muted-foreground">{formHasCert ? 'Sim' : 'Não'}</span>
                <Switch checked={formHasCert} onCheckedChange={setFormHasCert} />
              </label>
            </CadastroField>
            {formHasCert ? (
              <CadastroField icon={CalendarRange} label="Data de expiração" required>
                <input
                  type="date"
                  value={formCertExpiresAt}
                  onChange={(e) => setFormCertExpiresAt(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
                />
              </CadastroField>
            ) : (
              <div />
            )}
          </div>
        </CadastroSection>

        <CadastroSection title="Localização" desc="Selecione o estado e a cidade de atuação.">
          <div className="grid gap-4 md:grid-cols-2">
            <CadastroField icon={MapPin} label="Estado" required>
              <select
                value={formState}
                onChange={(e) => setFormState(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
              >
                <option value="">Selecione…</option>
                {(statesQuery.data || []).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </CadastroField>
            <CadastroField icon={MapPin} label="Cidade" required>
              <select
                value={formCity}
                onChange={(e) => setFormCity(e.target.value)}
                disabled={!formState}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 disabled:opacity-50"
              >
                <option value="">{formState ? 'Selecione…' : 'Selecione o estado primeiro'}</option>
                {(citiesQuery.data || []).map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </CadastroField>
          </div>
        </CadastroSection>

        <CadastroSection
          title="Farmácias vinculadas"
          desc="É possível vincular múltiplas unidades."
          action={
            <div className="flex items-center gap-2">
              <select
                value={pharmacyToAdd}
                onChange={(e) => setPharmacyToAdd(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-3 text-xs outline-none"
              >
                <option value="">Selecione…</option>
                {(pharmaciesQuery.data || [])
                  .filter((p) => !linkedPharmacyIds.includes(p.id))
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
                  setLinkedPharmacyIds((curr) => (curr.includes(pharmacyToAdd) ? curr : [...curr, pharmacyToAdd]));
                  if (!primaryPharmacyId) setPrimaryPharmacyId(pharmacyToAdd);
                  setPharmacyToAdd('');
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-glow"
              >
                <Plus className="h-3.5 w-3.5" /> Vincular
              </button>
            </div>
          }
        >
          {selectedPharmacies.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhuma farmácia selecionada.</div>
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
                        <button
                          type="button"
                          onClick={() => setPrimaryPharmacyId(p.id)}
                          className={cn('mt-0.5 text-[10px] font-medium hover:underline', isPrimary ? 'text-success' : 'text-primary')}
                        >
                          {isPrimary ? 'Primária' : 'Definir como primária'}
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setLinkedPharmacyIds((curr) => curr.filter((x) => x !== p.id));
                        if (primaryPharmacyId === p.id) setPrimaryPharmacyId('');
                      }}
                      className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2 py-1 text-muted-foreground hover:text-destructive hover:bg-surface-hover"
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
            <DriverWorkScheduleEditor value={formWorkSchedule} onChange={setFormWorkSchedule} disabled={!canEdit} />
          </div>
        </CadastroSection>
      </div>
    </CadastroPageScroll>
  );
}
