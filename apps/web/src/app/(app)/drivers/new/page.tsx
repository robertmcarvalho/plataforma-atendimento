'use client';

import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';
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
  Car,
  Link2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Switch } from '@/components/ui/Switch';
import { BrCnpjInput, BrCpfInput, BrPhoneInput } from '@/components/form/BrInputs';
import {
  FormControl,
  formControlSizes,
} from '@/components/form/FormControl';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { FormSelect } from '@/components/form/FormSelect';
import { serializeWorkScheduleForApi } from '@/components/settings/BusinessHoursEditor';
import {
  CadastroField,
  CadastroPageScroll,
  CadastroSection,
  cadastroSwitchRowClassName,
} from '@/components/cadastro/CadastroPrimitives';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Button } from '@/components/ui/button';
import { DriverWorkScheduleEditor } from '@/components/cadastro/DriverWorkScheduleEditor';
import { DriverAddressFields } from '@/components/cadastro/driver/DriverAddressFields';
import { onlyDigits, normalizeBrazilPhone } from '@/lib/brFormat';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { useAuth } from '@/store/auth';
import { canManageCadastro } from '@/lib/cadastroPermissions';
import { apiErrorMessage, apiErrorPayload } from '@/lib/apiErrorMessage';

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
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  status: DriverStatus;
  driver_type: DriverType;
  pix_key: string | null;
  pix_key_type: string | null;
  birth_date: string | null;
  cnh_number: string | null;
  cnh_expires_at: string | null;
  address_cep: string | null;
  address_street: string | null;
  address_number: string | null;
  address_neighborhood: string | null;
  address_complement: string | null;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_renavam: string | null;
  vehicle_model_year: string | null;
  flux_delivery_driver_id: string | null;
  flux_delivery_synced_at: string | null;
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

  const sectorsQuery = useQuery({
    queryKey: ['sectors', 'cadastro-perms'],
    enabled: canFetch,
    queryFn: async () => (await cadastroPageApi.fetchSectors()) as Array<{ id: string; name: string }>,
  });

  const analystSectorNames = useMemo(() => {
    const ids = [
      ...(user?.sector_ids || []),
      ...(user?.sector_id ? [user.sector_id] : []),
    ].filter(Boolean) as string[];
    const byId = new Map((sectorsQuery.data || []).map((s) => [s.id, s.name]));
    return ids.map((id) => byId.get(id)).filter((n): n is string => Boolean(n));
  }, [sectorsQuery.data, user?.sector_id, user?.sector_ids]);

  const canEdit = canManageCadastro(user?.role, hasPermission, 'drivers', {
    sectorNames: analystSectorNames,
  });

  const editId = (searchParams.get('id') || '').trim();
  const isEditing = Boolean(editId);

  const [savingError, setSavingError] = useState<string | null>(null);
  const [duplicateDriverId, setDuplicateDriverId] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formCpf, setFormCpf] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formState, setFormState] = useState('');
  const [formStatus, setFormStatus] = useState<DriverStatus>('active');
  const [formDriverType, setFormDriverType] = useState<DriverType>('fixed');
  const [formPixKey, setFormPixKey] = useState('');
  const [formPixKeyType, setFormPixKeyType] = useState('');
  const [formWhatsapp, setFormWhatsapp] = useState('');
  const [formBirthDate, setFormBirthDate] = useState('');
  const [formCnh, setFormCnh] = useState('');
  const [formCnhExpires, setFormCnhExpires] = useState('');
  const [formCep, setFormCep] = useState('');
  const [formStreet, setFormStreet] = useState('');
  const [formNumber, setFormNumber] = useState('');
  const [formNeighborhood, setFormNeighborhood] = useState('');
  const [formComplement, setFormComplement] = useState('');
  const [formPlate, setFormPlate] = useState('');
  const [formVehicleModel, setFormVehicleModel] = useState('');
  const [formVehicleColor, setFormVehicleColor] = useState('');
  const [formRenavam, setFormRenavam] = useState('');
  const [formVehicleYear, setFormVehicleYear] = useState('');
  const [formFluxId, setFormFluxId] = useState('');
  const [formFluxSyncedAt, setFormFluxSyncedAt] = useState('');
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
    queryFn: async () => await cadastroPageApi.fetchGeoStates() as ApiState[],
  });

  const citiesQuery = useQuery({
    queryKey: ['geo', 'cities', formState],
    enabled: canFetch && canEdit && Boolean(formState),
    queryFn: async () => await cadastroPageApi.fetchGeoCities(formState) as ApiCity[],
  });

  const pharmaciesQuery = useQuery({
    queryKey: ['drivers', 'pharmacies'],
    enabled: canFetch && canEdit,
    queryFn: async () => await cadastroPageApi.fetchPharmacies({ status: 'active' }) as ApiPharmacy[],
  });

  const driverQuery = useQuery<ApiDriverDetail>({
    queryKey: ['drivers', 'edit', editId],
    enabled: canFetch && canEdit && isEditing,
    queryFn: async () => await cadastroPageApi.fetchDriver(editId) as ApiDriverDetail,
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
    setFormPixKeyType(d.pix_key_type || '');
    setFormWhatsapp(d.whatsapp || '');
    setFormBirthDate(d.birth_date || '');
    setFormCnh(d.cnh_number || '');
    setFormCnhExpires(d.cnh_expires_at || '');
    setFormCep(d.address_cep || '');
    setFormStreet(d.address_street || '');
    setFormNumber(d.address_number || '');
    setFormNeighborhood(d.address_neighborhood || '');
    setFormComplement(d.address_complement || '');
    setFormPlate(d.vehicle_plate || '');
    setFormVehicleModel(d.vehicle_model || '');
    setFormVehicleColor(d.vehicle_color || '');
    setFormRenavam(d.vehicle_renavam || '');
    setFormVehicleYear(d.vehicle_model_year || '');
    setFormFluxId(d.flux_delivery_driver_id || '');
    setFormFluxSyncedAt(d.flux_delivery_synced_at || '');
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
      setDuplicateDriverId(null);
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
        pix_key_type: formPixKeyType.trim() || null,
        whatsapp: (() => {
          const w = normalizeBrazilPhone(formWhatsapp);
          return w && w !== phoneDigits ? w : null;
        })(),
        birth_date: formBirthDate.trim() || null,
        cnh_number: formCnh.trim() || null,
        cnh_expires_at: formCnhExpires.trim() || null,
        address_cep: onlyDigits(formCep) || null,
        address_street: formStreet.trim() || null,
        address_number: formNumber.trim() || null,
        address_neighborhood: formNeighborhood.trim() || null,
        address_complement: formComplement.trim() || null,
        vehicle_plate: formPlate.trim() || null,
        vehicle_model: formVehicleModel.trim() || null,
        vehicle_color: formVehicleColor.trim() || null,
        vehicle_renavam: formRenavam.trim() || null,
        vehicle_model_year: formVehicleYear.trim() || null,
        is_leader: formIsLeader,
        is_mei: formIsMei,
        mei_cnpj: formIsMei ? onlyDigits(formMeiCnpj) : null,
        has_digital_certificate: formHasCert,
        digital_certificate_expires_at: formHasCert ? (String(formCertExpiresAt || '').trim() || null) : null,
        work_schedule: serializeWorkScheduleForApi(formWorkSchedule),
      };

      const saved = isEditing ? (await cadastroPageApi.updateDriver(editId, payload) as ApiDriver) : (await cadastroPageApi.createDriver(payload) as ApiDriver);

      const currentActive = (driverQuery.data?.driver_pharmacy_links || [])
        .filter((l) => l.is_active && l.pharmacies?.id)
        .map((l) => l.pharmacies!.id);

      const toRemove = isEditing ? currentActive.filter((pid) => !uniqueLinks.includes(pid)) : [];
      for (const pid of toRemove) {
        await cadastroPageApi.unlinkDriverPharmacy(saved.id, pid).catch(() => undefined);
      }

      if (primary) {
        await cadastroPageApi.linkDriverPharmacy(saved.id, { pharmacy_id: primary, is_primary: true }).catch(() => undefined);
      }
      const secondary = uniqueLinks.filter((id) => id !== primary);
      for (const pid of secondary) {
        await cadastroPageApi.linkDriverPharmacy(saved.id, { pharmacy_id: pid, is_primary: false }).catch(() => undefined);
      }

      return saved;
    },
    onSuccess: (saved) => {
      router.push(`/drivers/${saved.id}`);
    },
    onError: (err: unknown) => {
      const payload = apiErrorPayload(err);
      setSavingError(apiErrorMessage(err, 'Falha ao salvar entregador.'));
      setDuplicateDriverId(
        typeof payload?.existing_driver_id === 'string' && payload.existing_driver_id ? payload.existing_driver_id : null
      );
    },
  });

  if (user && !canEdit) {
    return (
      <CadastroPageScroll maxWidthClassName="max-w-5xl">
        <PageHeader eyebrow="Acesso" title="Novo entregador" description="Você não tem permissão para cadastrar entregadores." compact />
        <Link className={buttonVariants({ variant: 'secondary' })} href="/drivers">
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
        icon={Truck}
        eyebrow="Operação · Cadastro"
        title={isEditing ? 'Editar entregador' : 'Novo entregador'}
        description={isEditing ? 'Atualize as informações e vínculos do entregador.' : 'Preencha as informações para vincular o entregador às farmácias.'}
        actions={
          <div className="flex gap-2">
            <Link href={backHref} className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60">
              Cancelar
            </Link>
            <button
              type="button"
              onClick={() => void saveMutation.mutateAsync()}
              disabled={saveMutation.isPending}
              className={cn(
                'flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/80 transition-colors',
                saveMutation.isPending && 'opacity-50 pointer-events-none'
              )}
            >
              <Save className="h-3.5 w-3.5" /> Salvar entregador
            </button>
          </div>
        }
      />

      {savingError ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p>{savingError}</p>
          {duplicateDriverId ? (
            <Link href={`/drivers/${duplicateDriverId}`} className="mt-2 inline-block text-xs font-medium underline">
              Abrir cadastro existente
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 space-y-5">
        {formFluxId ? (
          <CadastroSection title="Integração Flux Delivery" desc="Atualizado pela sincronização com a gestão de entregas.">
            <div className="grid gap-4 md:grid-cols-3">
              <CadastroField icon={Link2} label="ID Flux">
                <FormControl inputSize="lg" value={formFluxId} readOnly className="bg-muted/40" />
              </CadastroField>
              <CadastroField icon={Link2} label="Última sincronização">
                <FormControl
                  inputSize="lg"
                  value={formFluxSyncedAt ? new Date(formFluxSyncedAt).toLocaleString('pt-BR') : '—'}
                  readOnly
                  className="bg-muted/40"
                />
              </CadastroField>
            </div>
          </CadastroSection>
        ) : null}

        <CadastroSection title="Dados pessoais" desc="Informações básicas do entregador.">
          <div className="grid gap-4 md:grid-cols-2">
            <CadastroField icon={User} label="Nome completo" required>
              <FormControl
                inputSize="lg"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="João da Silva"
              />
            </CadastroField>
            <CadastroField icon={FileText} label="CPF">
              <BrCpfInput value={formCpf} onChange={setFormCpf} className="w-full" placeholder="000.000.000-00" />
            </CadastroField>
            <CadastroField icon={Phone} label="Telefone" required>
              <BrPhoneInput value={formPhone} onChange={setFormPhone} className="w-full" placeholder="(11) 99000-0000" />
            </CadastroField>
            <CadastroField icon={Mail} label="E-mail">
              <FormControl
                inputSize="lg"
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="entregador@email.com"
              />
            </CadastroField>
            <CadastroField icon={Phone} label="WhatsApp">
              <BrPhoneInput value={formWhatsapp} onChange={setFormWhatsapp} className="w-full" placeholder="Opcional se diferente do celular" />
            </CadastroField>
            <CadastroField icon={CalendarRange} label="Data de nascimento">
              <FormControl inputSize="lg" type="date" value={formBirthDate} onChange={(e) => setFormBirthDate(e.target.value)} />
            </CadastroField>
          </div>
        </CadastroSection>

        <CadastroSection title="CNH e habilitação" desc="Documentação de habilitação do entregador.">
          <div className="grid gap-4 md:grid-cols-2">
            <CadastroField icon={FileText} label="Número da CNH">
              <FormControl inputSize="lg" value={formCnh} onChange={(e) => setFormCnh(e.target.value)} />
            </CadastroField>
            <CadastroField icon={CalendarRange} label="Validade da CNH">
              <FormControl inputSize="lg" type="date" value={formCnhExpires} onChange={(e) => setFormCnhExpires(e.target.value)} />
            </CadastroField>
          </div>
        </CadastroSection>

        <CadastroSection title="Tipo & vínculo">
          <div className="grid gap-4 md:grid-cols-3">
            <CadastroField icon={Truck} label="Tipo de entregador" required>
              <SegmentedControl
                stretch
                variant="primary"
                value={formDriverType}
                onChange={setFormDriverType}
                items={[
                  { id: 'fixed', label: 'Fixo' },
                  { id: 'daily', label: 'Diarista' },
                ]}
              />
            </CadastroField>

            <CadastroField icon={Crown} label="É líder?">
              <label className={cadastroSwitchRowClassName}>
                <span className="text-xs text-muted-foreground">{formIsLeader ? 'Sim · acesso ao painel do líder' : 'Não'}</span>
                <Switch checked={formIsLeader} onCheckedChange={setFormIsLeader} />
              </label>
            </CadastroField>

            <CadastroField icon={User} label="Status">
              <FormSelect
                value={formStatus}
                onChange={(v) => setFormStatus(v as DriverStatus)}
                disabled={!canEdit}
                size="lg"
                options={[
                  { value: 'active', label: 'Ativo' },
                  { value: 'inactive', label: 'Inativo' },
                  { value: 'blocked', label: 'Bloqueado' },
                ]}
              />
            </CadastroField>

          </div>
        </CadastroSection>

        <CadastroSection title="Pagamento">
          <div className="grid gap-4 md:grid-cols-2">
            <CadastroField icon={KeyRound} label="Tipo da chave PIX">
              <FormSelect
                value={formPixKeyType}
                onChange={setFormPixKeyType}
                size="lg"
                options={[
                  { value: '', label: 'Selecione…' },
                  { value: 'CPF', label: 'CPF' },
                  { value: 'EMAIL', label: 'E-mail' },
                  { value: 'PHONE', label: 'Telefone' },
                  { value: 'RANDOM', label: 'Aleatória' },
                ]}
              />
            </CadastroField>
            <CadastroField icon={KeyRound} label="Chave PIX">
              <FormControl
                inputSize="lg"
                value={formPixKey}
                onChange={(e) => setFormPixKey(e.target.value)}
                placeholder="CPF, e-mail, telefone ou aleatória"
              />
            </CadastroField>
          </div>
        </CadastroSection>

        <CadastroSection title="Documentação fiscal">
          <div className="grid gap-4 md:grid-cols-2">
            <CadastroField icon={Briefcase} label="Possui MEI?">
              <label className={cadastroSwitchRowClassName}>
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
              <label className={cadastroSwitchRowClassName}>
                <span className="text-xs text-muted-foreground">{formHasCert ? 'Sim' : 'Não'}</span>
                <Switch checked={formHasCert} onCheckedChange={setFormHasCert} />
              </label>
            </CadastroField>
            {formHasCert ? (
              <CadastroField icon={CalendarRange} label="Data de expiração" required>
                <FormControl inputSize="lg" type="date" value={formCertExpiresAt} onChange={(e) => setFormCertExpiresAt(e.target.value)} />
              </CadastroField>
            ) : (
              <div />
            )}
          </div>
        </CadastroSection>

        <CadastroSection title="Endereço" desc="Endereço residencial e cidade de atuação.">
          <DriverAddressFields
            values={{
              cep: formCep,
              street: formStreet,
              number: formNumber,
              neighborhood: formNeighborhood,
              complement: formComplement,
              city: formCity,
              state: formState,
            }}
            onChange={(patch) => {
              if (patch.cep !== undefined) setFormCep(patch.cep);
              if (patch.street !== undefined) setFormStreet(patch.street);
              if (patch.number !== undefined) setFormNumber(patch.number);
              if (patch.neighborhood !== undefined) setFormNeighborhood(patch.neighborhood);
              if (patch.complement !== undefined) setFormComplement(patch.complement);
              if (patch.city !== undefined) setFormCity(patch.city);
              if (patch.state !== undefined) setFormState(patch.state);
            }}
            statesQuery={statesQuery}
            citiesQuery={citiesQuery}
            disabled={!canEdit}
          />
        </CadastroSection>

        <CadastroSection title="Veículo" desc="Veículo utilizado nas entregas.">
          <div className="grid gap-4 md:grid-cols-3">
            <CadastroField icon={Car} label="Placa">
              <FormControl inputSize="lg" value={formPlate} onChange={(e) => setFormPlate(e.target.value)} className="uppercase" />
            </CadastroField>
            <CadastroField icon={Car} label="Modelo">
              <FormControl inputSize="lg" value={formVehicleModel} onChange={(e) => setFormVehicleModel(e.target.value)} />
            </CadastroField>
            <CadastroField icon={Car} label="Cor">
              <FormControl inputSize="lg" value={formVehicleColor} onChange={(e) => setFormVehicleColor(e.target.value)} />
            </CadastroField>
            <CadastroField icon={FileText} label="RENAVAM">
              <FormControl inputSize="lg" value={formRenavam} onChange={(e) => setFormRenavam(e.target.value)} />
            </CadastroField>
            <CadastroField icon={CalendarRange} label="Ano modelo">
              <FormControl inputSize="lg" value={formVehicleYear} onChange={(e) => setFormVehicleYear(e.target.value)} />
            </CadastroField>
          </div>
        </CadastroSection>

        <CadastroSection title="Farmácias vinculadas" desc="É possível vincular múltiplas unidades.">
          <div className="flex gap-2">
            <FormSearchCombobox
              className="flex-1"
              value={pharmacyToAdd}
              onChange={setPharmacyToAdd}
              placeholder="Buscar farmácia…"
              options={(pharmaciesQuery.data || [])
                .filter((p) => !linkedPharmacyIds.includes(p.id))
                .map((p) => ({ value: p.id, label: p.trade_name }))}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (!pharmacyToAdd) return;
                setLinkedPharmacyIds((curr) => (curr.includes(pharmacyToAdd) ? curr : [...curr, pharmacyToAdd]));
                if (!primaryPharmacyId) setPrimaryPharmacyId(pharmacyToAdd);
                setPharmacyToAdd('');
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Vincular
            </Button>
          </div>
          {selectedPharmacies.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 rounded-md border border-dashed border-border bg-background/40 p-3">
              {selectedPharmacies.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs"
                >
                  <Building2 className="h-3 w-3 text-primary" /> {p.trade_name}
                  <button
                    type="button"
                    onClick={() => {
                      setLinkedPharmacyIds((curr) => curr.filter((x) => x !== p.id));
                      if (primaryPharmacyId === p.id) setPrimaryPharmacyId('');
                    }}
                    className="ml-1 text-muted-foreground hover:text-destructive"
                    aria-label="Remover vínculo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </CadastroSection>

        <CadastroSection title="Escala de trabalho" desc="Defina turnos por dia, feriados e exceções.">
          <DriverWorkScheduleEditor value={formWorkSchedule} onChange={setFormWorkSchedule} disabled={!canEdit} />
        </CadastroSection>
      </div>
    </CadastroPageScroll>
  );
}
