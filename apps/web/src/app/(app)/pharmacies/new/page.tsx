'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Calendar,
  Crown,
  Headphones,
  MapPin,
  Phone,
  Save,
  Truck,
  Users,
} from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Switch } from '@/components/ui/Switch';
import { BrCepInput, BrCnpjInput, BrPhoneInput } from '@/components/form/BrInputs';
import { CadastroField, CadastroPageScroll, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import { onlyDigits, normalizeBrazilPhone } from '@/lib/brFormat';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { canManageCadastro } from '@/lib/cadastroPermissions';
import { formatWorkScheduleSummary, hasConfiguredWorkSchedule } from '@/components/settings/BusinessHoursEditor';
import { PharmacyAddressFields } from '@/components/cadastro/pharmacy/PharmacyAddressFields';
import {
  parsePharmacyDeliveryScheduleForEdit,
  serializePharmacyDeliveryScheduleForApi,
  validatePharmacyDeliverySchedule,
} from '@/lib/pharmacyDeliverySchedule';
import { PharmacyCommercialTermsFields } from '@/components/cadastro/pharmacy/PharmacyCommercialTermsFields';
import { PharmacyDeliveryScheduleSection } from '@/components/cadastro/pharmacy/PharmacyDeliveryScheduleSection';
import { PharmacyLinkedAttendantsSection } from '@/components/cadastro/pharmacy/PharmacyLinkedAttendantsSection';
import {
  EMPTY_PHARMACY_COMMERCIAL,
  validateCommercialPayoutWarning,
  type PharmacyCommercialForm,
} from '@/lib/pharmacyCommercial';

type ApiLeader = { id: string; name: string; phone?: string | null; status?: string | null };
type ApiAttendant = { id: string; name: string };
type ApiSector = { id: string; name: string; is_active?: boolean | null };
type ApiState = { code: string; name: string };
type ApiCity = { name: string };
type ApiDriver = { id: string; name: string; phone: string; status?: string | null; work_schedule?: unknown | null };
type ApiPharmacyDetail = {
  id: string;
  trade_name: string;
  legal_name: string;
  cnpj?: string | null;
  address_cep?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_complement?: string | null;
  contact_expedition_name?: string | null;
  contact_expedition_phone?: string | null;
  contact_expedition_email?: string | null;
  contact_financial_name?: string | null;
  contact_financial_phone?: string | null;
  contact_financial_email?: string | null;
  contact_manager_name?: string | null;
  contact_manager_phone?: string | null;
  contact_manager_email?: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  status: 'active' | 'inactive';
  leader?: { id: string; name: string; phone?: string | null } | null;
  primary_attendant?: { id: string; name: string } | null;
  secondary_attendant?: { id: string; name: string } | null;
  pharmacy_sector_attendants?: Array<{
    sector_id: string;
    attendant_id: string | null;
    sector?: { id: string; name: string } | null;
    attendant?: { id: string; name: string } | null;
  }>;
  driver_pharmacy_links?: Array<{
    id: string;
    is_primary: boolean;
    is_active: boolean;
    started_at: string | null;
    drivers?: ApiDriver | null;
  }>;
  delivery_fee_cents?: number | null;
  delivery_fee_driver_payout_cents?: number | null;
  minimum_guaranteed_cents?: number | null;
  minimum_guaranteed_driver_payout_cents?: number | null;
  delivery_schedule?: Record<string, unknown> | null;
};

export default function PharmacyNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const user = useAuth((s) => s.user);
  const hasPermission = useAuth((s) => s.hasPermission);
  const canFetch = hasHydrated && isAuthenticated;
  const canEdit = canManageCadastro(user?.role, hasPermission, 'pharmacies');
  const editId = (searchParams.get('id') || '').trim();
  const isEditing = Boolean(editId);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string>('');
  const [linkDriverId, setLinkDriverId] = useState('');
  const [linkPrimary, setLinkPrimary] = useState(false);
  const activePharmacyId = editId || createdId;

  const [formTrade, setFormTrade] = useState('');
  const [formLegal, setFormLegal] = useState('');
  const [formCnpj, setFormCnpj] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formStatus, setFormStatus] = useState<'active' | 'inactive'>('active');
  const [formCity, setFormCity] = useState('');
  const [formState, setFormState] = useState('');

  const [formCep, setFormCep] = useState('');
  const [formStreet, setFormStreet] = useState('');
  const [formNumber, setFormNumber] = useState('');
  const [formNeighborhood, setFormNeighborhood] = useState('');
  const [formComplement, setFormComplement] = useState('');

  const [formLeaderId, setFormLeaderId] = useState('');
  const [formPrimaryAttendantId, setFormPrimaryAttendantId] = useState('');
  const [formSecondaryAttendantId, setFormSecondaryAttendantId] = useState('');

  const [formExpName, setFormExpName] = useState('');
  const [formExpPhone, setFormExpPhone] = useState('');
  const [formExpEmail, setFormExpEmail] = useState('');

  const [formFinName, setFormFinName] = useState('');
  const [formFinPhone, setFormFinPhone] = useState('');
  const [formFinEmail, setFormFinEmail] = useState('');

  const [formMgrName, setFormMgrName] = useState('');
  const [formMgrPhone, setFormMgrPhone] = useState('');
  const [formMgrEmail, setFormMgrEmail] = useState('');

  const [sectorAttendantMap, setSectorAttendantMap] = useState<Record<string, string>>({});
  const [commercial, setCommercial] = useState<PharmacyCommercialForm>(EMPTY_PHARMACY_COMMERCIAL);
  const [deliverySchedule, setDeliverySchedule] = useState<Record<string, unknown>>({});

  const leadersQuery = useQuery({
    queryKey: ['pharmacies', 'leaders'],
    enabled: canFetch && canEdit,
    queryFn: async () => (await api.get('/api/leaders', { params: { status: 'active' } })).data as ApiLeader[],
  });

  const attendantsQuery = useQuery({
    queryKey: ['pharmacies', 'attendants', 'workspace'],
    enabled: canFetch && canEdit,
    queryFn: async () =>
      (
        await api.get('/api/users/attendants', {
          params: { scope: 'workspace', include_supervisors: '1' },
        })
      ).data as ApiAttendant[],
  });

  const sectorsQuery = useQuery({
    queryKey: ['pharmacies', 'sectors'],
    enabled: canFetch && canEdit,
    queryFn: async () => (await api.get('/api/sectors')).data as ApiSector[],
  });

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

  const activeSectors = useMemo(() => (sectorsQuery.data || []).filter((s) => s.is_active !== false), [sectorsQuery.data]);

  const driversQuery = useQuery({
    queryKey: ['drivers', 'options'],
    enabled: canFetch && canEdit && Boolean(activePharmacyId),
    queryFn: async () => (await api.get('/api/drivers')).data as ApiDriver[],
  });

  const detailQuery = useQuery({
    queryKey: ['pharmacies', 'detail', activePharmacyId],
    enabled: canFetch && canEdit && Boolean(activePharmacyId),
    queryFn: async () => (await api.get(`/api/pharmacies/${activePharmacyId}`)).data as ApiPharmacyDetail,
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
    const data = detailQuery.data;
    if (!data || hasPrefilled.current) return;
    hasPrefilled.current = true;

    setFormTrade(data.trade_name || '');
    setFormLegal(data.legal_name || '');
    setFormCnpj(data.cnpj || '');
    setFormPhone(data.phone || '');
    setFormStatus(data.status || 'active');
    setFormCity(data.city || '');
    setFormState(data.state || '');
    setFormCep(data.address_cep || '');
    setFormStreet(data.address_street || '');
    setFormNumber(data.address_number || '');
    setFormNeighborhood(data.address_neighborhood || '');
    setFormComplement(data.address_complement || '');
    setFormLeaderId(data.leader?.id || '');
    setFormPrimaryAttendantId(data.primary_attendant?.id || '');
    setFormSecondaryAttendantId(data.secondary_attendant?.id || '');
    setFormExpName(data.contact_expedition_name || '');
    setFormExpPhone(data.contact_expedition_phone || '');
    setFormExpEmail(data.contact_expedition_email || '');
    setFormFinName(data.contact_financial_name || '');
    setFormFinPhone(data.contact_financial_phone || '');
    setFormFinEmail(data.contact_financial_email || '');
    setFormMgrName(data.contact_manager_name || '');
    setFormMgrPhone(data.contact_manager_phone || '');
    setFormMgrEmail(data.contact_manager_email || '');
    setSectorAttendantMap(
      Object.fromEntries((data.pharmacy_sector_attendants || []).filter((row) => row.attendant_id).map((row) => [row.sector_id, String(row.attendant_id)]))
    );
    setCommercial({
      delivery_fee_cents: data.delivery_fee_cents ?? null,
      delivery_fee_driver_payout_cents: data.delivery_fee_driver_payout_cents ?? null,
      minimum_guaranteed_cents: data.minimum_guaranteed_cents ?? null,
      minimum_guaranteed_driver_payout_cents: data.minimum_guaranteed_driver_payout_cents ?? null,
    });
    setDeliverySchedule(parsePharmacyDeliveryScheduleForEdit(data.delivery_schedule));
  }, [detailQuery.data, isEditing]);

  const addressValues = useMemo(
    () => ({
      cep: formCep,
      street: formStreet,
      number: formNumber,
      neighborhood: formNeighborhood,
      complement: formComplement,
      city: formCity,
      state: formState,
    }),
    [formCep, formStreet, formNumber, formNeighborhood, formComplement, formCity, formState]
  );

  const patchAddress = (patch: Partial<typeof addressValues>) => {
    if (patch.cep !== undefined) setFormCep(patch.cep);
    if (patch.street !== undefined) setFormStreet(patch.street);
    if (patch.number !== undefined) setFormNumber(patch.number);
    if (patch.neighborhood !== undefined) setFormNeighborhood(patch.neighborhood);
    if (patch.complement !== undefined) setFormComplement(patch.complement);
    if (patch.city !== undefined) setFormCity(patch.city);
    if (patch.state !== undefined) setFormState(patch.state);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      setSaveError(null);
      if (!formTrade.trim() || !formLegal.trim()) throw new Error('Informe Nome fantasia e Razão social.');
      const cnpjDigits = onlyDigits(formCnpj);
      if (!cnpjDigits || cnpjDigits.length !== 14) throw new Error('CNPJ inválido (use 14 dígitos).');
      const cepDigits = onlyDigits(formCep);
      if (cepDigits && cepDigits.length !== 8) throw new Error('CEP inválido (use 8 dígitos).');

      const emails = [formExpEmail.trim(), formFinEmail.trim(), formMgrEmail.trim()].filter(Boolean);
      if (emails.some((mail) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail))) throw new Error('E-mail de contato inválido.');

      const expPhone = normalizeBrazilPhone(formExpPhone);
      const finPhone = normalizeBrazilPhone(formFinPhone);
      const mgrPhone = normalizeBrazilPhone(formMgrPhone);
      if (formExpPhone.trim() && (!expPhone || expPhone.length < 12)) throw new Error('Telefone do contato (Expedição) inválido.');
      if (formFinPhone.trim() && (!finPhone || finPhone.length < 12)) throw new Error('Telefone do contato (Financeiro) inválido.');
      if (formMgrPhone.trim() && (!mgrPhone || mgrPhone.length < 12)) throw new Error('Telefone do contato (Gestor) inválido.');

      const feeWarn = validateCommercialPayoutWarning(
        commercial.delivery_fee_cents,
        commercial.delivery_fee_driver_payout_cents,
      );
      if (feeWarn) throw new Error(feeWarn);
      const minWarn = validateCommercialPayoutWarning(
        commercial.minimum_guaranteed_cents,
        commercial.minimum_guaranteed_driver_payout_cents,
      );
      if (minWarn) throw new Error(minWarn);

      const scheduleErr = validatePharmacyDeliverySchedule(deliverySchedule);
      if (scheduleErr) throw new Error(scheduleErr);

      const sector_attendants = activeSectors.map((s) => ({
        sector_id: s.id,
        attendant_id: (sectorAttendantMap[s.id] || '').trim() || null,
      }));

      const payload = {
        trade_name: formTrade.trim(),
        legal_name: formLegal.trim(),
        cnpj: cnpjDigits,
        address_cep: cepDigits || null,
        address_street: formStreet.trim() || null,
        address_number: formNumber.trim() || null,
        address_neighborhood: formNeighborhood.trim() || null,
        address_complement: formComplement.trim() || null,
        contact_expedition_name: formExpName.trim() || null,
        contact_expedition_phone: expPhone || null,
        contact_expedition_email: formExpEmail.trim() || null,
        contact_financial_name: formFinName.trim() || null,
        contact_financial_phone: finPhone || null,
        contact_financial_email: formFinEmail.trim() || null,
        contact_manager_name: formMgrName.trim() || null,
        contact_manager_phone: mgrPhone || null,
        contact_manager_email: formMgrEmail.trim() || null,
        city: formCity.trim() || undefined,
        state: formState.trim() || undefined,
        phone: normalizeBrazilPhone(formPhone) || undefined,
        status: formStatus,
        leader_id: formLeaderId || null,
        primary_attendant_id: formPrimaryAttendantId.trim() || null,
        secondary_attendant_id: formSecondaryAttendantId.trim() || null,
        sector_attendants,
        delivery_fee_cents: commercial.delivery_fee_cents,
        delivery_fee_driver_payout_cents: commercial.delivery_fee_driver_payout_cents,
        minimum_guaranteed_cents: commercial.minimum_guaranteed_cents,
        minimum_guaranteed_driver_payout_cents: commercial.minimum_guaranteed_driver_payout_cents,
        delivery_schedule: serializePharmacyDeliveryScheduleForApi(deliverySchedule),
      };

      if (isEditing) {
        await api.put(`/api/pharmacies/${editId}`, payload);
        return editId;
      }

      const created = (await api.post('/api/pharmacies', payload)).data as { id?: string };
      const id = String(created?.id || '');
      if (!id) throw new Error('Pharmacy created, but the API did not return an id.');
      return id;
    },
    onSuccess: (id: string) => {
      if (isEditing) {
        router.push(`/pharmacies/${encodeURIComponent(id)}`);
        return;
      }
      setCreatedId(id);
      setLinkDriverId('');
      setLinkPrimary(false);
    },
    onError: (err: unknown) => {
      const apiMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSaveError(apiMsg || (err as Error)?.message || 'Falha ao salvar farmácia.');
    },
  });

  const linkedDrivers = useMemo(() => {
    const links = (detailQuery.data?.driver_pharmacy_links || []).filter((l) => l.is_active && l.drivers?.id);
    return links.map((l) => ({ link: l, driver: l.drivers! }));
  }, [detailQuery.data?.driver_pharmacy_links]);

  const linkDriver = async () => {
    if (!activePharmacyId || !linkDriverId) return;
    setSaveError(null);
    try {
      await api.post(`/api/drivers/${linkDriverId}/pharmacies`, { pharmacy_id: activePharmacyId, is_primary: Boolean(linkPrimary) });
      setLinkDriverId('');
      setLinkPrimary(false);
      await detailQuery.refetch();
    } catch {
      setSaveError('Falha ao vincular entregador.');
    }
  };

  const unlinkDriver = async (driverId: string) => {
    if (!activePharmacyId || !driverId) return;
    try {
      await api.delete(`/api/drivers/${driverId}/pharmacies/${activePharmacyId}`);
      await detailQuery.refetch();
    } catch {
      // ignore
    }
  };

  if (user && !canEdit) {
    return (
      <CadastroPageScroll maxWidthClassName="max-w-5xl">
        <PageHeader eyebrow="Acesso" title={isEditing ? 'Editar farmácia' : 'Nova farmácia'} description="Você não tem permissão para cadastrar farmácias." />
        <Link className="button-secondary" href="/pharmacies">
          Voltar
        </Link>
      </CadastroPageScroll>
    );
  }

  const backHref = isEditing ? `/pharmacies/${encodeURIComponent(editId)}` : '/pharmacies';

  return (
    <CadastroPageScroll maxWidthClassName="max-w-5xl">
      <Link href={backHref} className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Voltar para farmácias
      </Link>

      <PageHeader
        eyebrow="Operação · Cadastro"
        title={isEditing ? 'Editar farmácia' : 'Nova farmácia'}
        description={isEditing ? 'Atualize os dados, contatos e vínculos da unidade.' : 'Cadastre uma unidade parceira e configure atendimento.'}
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
              <Save className="h-3.5 w-3.5" /> Salvar farmácia
            </button>
          </div>
        }
      />

      {saveError ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{saveError}</div>
      ) : null}

      {createdId && !isEditing ? (
        <div className="mt-4 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          Farmacia criada. Agora voce pode vincular entregadores abaixo.
        </div>
      ) : null}

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!createdId) void saveMutation.mutateAsync();
        }}
        className="mt-6 space-y-5"
      >
        <CadastroSection title="Dados da empresa">
          <div className="grid gap-4 md:grid-cols-2">
            <CadastroField icon={Building2} label="Nome fantasia" required>
              <input
                value={formTrade}
                onChange={(e) => setFormTrade(e.target.value)}
                placeholder="Farmácia Central"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
              />
            </CadastroField>
            <CadastroField icon={Building2} label="Razão social" required>
              <input
                value={formLegal}
                onChange={(e) => setFormLegal(e.target.value)}
                placeholder="Farmácia Central LTDA"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
              />
            </CadastroField>
            <CadastroField icon={Users} label="Status">
              <label className="flex h-10 items-center justify-between rounded-md border border-border bg-background px-3">
                <span className="text-xs text-muted-foreground">{formStatus === 'active' ? 'Ativa' : 'Inativa'}</span>
                <Switch checked={formStatus === 'active'} onCheckedChange={(c) => setFormStatus(c ? 'active' : 'inactive')} disabled={!canEdit} />
              </label>
            </CadastroField>
            <CadastroField icon={Phone} label="Telefone da farmácia" required>
              <BrPhoneInput value={formPhone} onChange={setFormPhone} className="w-full" placeholder="(11) 3000-0000" />
            </CadastroField>
            <CadastroField icon={Building2} label="CNPJ" required>
              <BrCnpjInput value={formCnpj} onChange={setFormCnpj} className="w-full" placeholder="00.000.000/0000-00" />
            </CadastroField>
          </div>
        </CadastroSection>

        <CadastroSection title="Localização" desc="Busca de CEP preenchendo endereço automaticamente.">
          <PharmacyAddressFields
            values={addressValues}
            onChange={patchAddress}
            statesQuery={statesQuery}
            citiesQuery={citiesQuery}
            disabled={!canEdit}
          />
        </CadastroSection>

        <CadastroSection title="Vínculos" desc="Líder de operação responsável pela unidade.">
          <CadastroField icon={Crown} label="Líder responsável" required>
            <select
              value={formLeaderId}
              onChange={(e) => setFormLeaderId(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
            >
              <option value="">Selecione…</option>
              {(leadersQuery.data || []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </CadastroField>
        </CadastroSection>

        <CadastroSection title="Contatos por perfil" desc="Expedição, financeiro e gestor na farmácia (sem atendentes da plataforma).">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="text-xs font-semibold text-foreground">Expedição</div>
              <div className="mt-3 space-y-2">
                <input value={formExpName} onChange={(e) => setFormExpName(e.target.value)} placeholder="Nome" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50" />
                <BrPhoneInput value={formExpPhone} onChange={setFormExpPhone} className="w-full" placeholder="Telefone" />
                <input value={formExpEmail} onChange={(e) => setFormExpEmail(e.target.value)} placeholder="E-mail" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50" />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="text-xs font-semibold text-foreground">Financeiro</div>
              <div className="mt-3 space-y-2">
                <input value={formFinName} onChange={(e) => setFormFinName(e.target.value)} placeholder="Nome" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50" />
                <BrPhoneInput value={formFinPhone} onChange={setFormFinPhone} className="w-full" placeholder="Telefone" />
                <input value={formFinEmail} onChange={(e) => setFormFinEmail(e.target.value)} placeholder="E-mail" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50" />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="text-xs font-semibold text-foreground">Gestor</div>
              <div className="mt-3 space-y-2">
                <input value={formMgrName} onChange={(e) => setFormMgrName(e.target.value)} placeholder="Nome" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50" />
                <BrPhoneInput value={formMgrPhone} onChange={setFormMgrPhone} className="w-full" placeholder="Telefone" />
                <input value={formMgrEmail} onChange={(e) => setFormMgrEmail(e.target.value)} placeholder="E-mail" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50" />
              </div>
            </div>
          </div>
        </CadastroSection>

        <CadastroSection title="Condições comerciais" desc="Valores cobrados da farmácia e repasses ao entregador.">
          <PharmacyCommercialTermsFields value={commercial} onChange={setCommercial} disabled={!canEdit} />
        </CadastroSection>

        <CadastroSection
          title="Horário de funcionamento do delivery"
          desc="Grade semanal e feriados no formato canônico de horário comercial."
        >
          <PharmacyDeliveryScheduleSection value={deliverySchedule} onChange={setDeliverySchedule} disabled={!canEdit} />
        </CadastroSection>

        <CadastroSection title="Atendentes vinculados" desc="Fila padrão, backup e atendente opcional por setor.">
          <PharmacyLinkedAttendantsSection
            attendants={attendantsQuery.data || []}
            sectors={activeSectors}
            primaryId={formPrimaryAttendantId}
            secondaryId={formSecondaryAttendantId}
            sectorMap={sectorAttendantMap}
            onPrimaryChange={setFormPrimaryAttendantId}
            onSecondaryChange={setFormSecondaryAttendantId}
            onSectorChange={(sectorId, attendantId) =>
              setSectorAttendantMap((curr) => ({ ...curr, [sectorId]: attendantId }))
            }
            disabled={!canEdit}
          />
        </CadastroSection>

        <CadastroSection title="Entregadores vinculados" desc="Visualize a escala de cada entregador da unidade.">
          {!activePharmacyId ? (
            <div className="text-sm text-muted-foreground">Salve a farmácia para vincular entregadores.</div>
          ) : (
            <>
              <div className="overflow-hidden rounded-md border border-border bg-background">
                <table className="w-full text-xs">
                  <thead className="bg-background">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
                      <th className="px-3 py-2">Entregador</th>
                      <th className="px-3 py-2">
                        <Calendar className="inline h-3 w-3" /> Escala
                      </th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {linkedDrivers.length === 0 ? (
                      <tr className="border-t border-border/60">
                        <td colSpan={4} className="px-3 py-3 text-xs text-muted-foreground">
                          Nenhum entregador vinculado.
                        </td>
                      </tr>
                    ) : (
                      linkedDrivers.map(({ driver }) => {
                        const schedule = hasConfiguredWorkSchedule(driver.work_schedule) ? formatWorkScheduleSummary(driver.work_schedule) : '—';
                        const status = String(driver.status || '').toLowerCase();
                        const statusLabel = status === 'active' ? 'Disponível' : status === 'blocked' ? 'Em rota' : 'Offline';
                        return (
                          <tr key={driver.id} className="border-t border-border/60">
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-channel-whatsapp/40 to-primary/40 text-[10px] font-semibold">
                                  {(driver.name || '?')
                                    .trim()
                                    .split(/\\s+/)
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .map((w) => w[0]?.toUpperCase())
                                    .join('') || '??'}
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate font-medium">{driver.name}</div>
                                  <div className="font-mono text-[10px] text-muted-foreground">{driver.phone}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{schedule}</td>
                            <td className="px-3 py-2">
                              <span
                                className={cn(
                                  'rounded px-2 py-0.5 text-[10px] font-medium',
                                  status === 'active' && 'bg-success/15 text-success',
                                  status === 'blocked' && 'bg-warning/15 text-warning',
                                  status !== 'active' && status !== 'blocked' && 'bg-muted text-muted-foreground'
                                )}
                              >
                                {statusLabel}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => void unlinkDriver(driver.id)}
                                className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-destructive hover:bg-surface-hover"
                              >
                                Remover
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                <select
                  value={linkDriverId}
                  onChange={(e) => setLinkDriverId(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
                >
                  <option value="">Selecione um entregador…</option>
                  {(driversQuery.data || []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>

                <label className="flex h-9 items-center justify-between gap-3 rounded-md border border-border bg-background px-3">
                  <span className="text-xs text-muted-foreground">Primário</span>
                  <Switch checked={linkPrimary} onCheckedChange={(c) => setLinkPrimary(Boolean(c))} />
                </label>

                <button
                  type="button"
                  onClick={() => void linkDriver()}
                  disabled={!linkDriverId}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-surface-hover disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Truck className="h-3.5 w-3.5" /> Vincular entregador existente
                </button>
              </div>
            </>
          )}
        </CadastroSection>

        <button type="submit" className="hidden" />
      </form>
    </CadastroPageScroll>
  );
}
