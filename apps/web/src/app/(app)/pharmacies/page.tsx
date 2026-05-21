'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Building2, ChevronDown, ChevronRight, Edit3, FileText, Mail, MapPin, MoreHorizontal, Phone, Plus, Search, Truck, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusDot } from '@/components/ui/StatusDot';
import {
  BusinessHoursEditor,
  formatWorkScheduleSummary,
  hasConfiguredWorkSchedule,
} from '@/components/settings/BusinessHoursEditor';
import { PharmacyAddressFields } from '@/components/cadastro/pharmacy/PharmacyAddressFields';
import { PharmacyCommercialTermsFields } from '@/components/cadastro/pharmacy/PharmacyCommercialTermsFields';
import {
  parsePharmacyDeliveryScheduleForEdit,
  serializePharmacyDeliveryScheduleForApi,
  validatePharmacyDeliverySchedule,
} from '@/lib/pharmacyDeliverySchedule';
import { PharmacyDeliveryScheduleSection } from '@/components/cadastro/pharmacy/PharmacyDeliveryScheduleSection';
import { PharmacyLinkedAttendantsSection } from '@/components/cadastro/pharmacy/PharmacyLinkedAttendantsSection';
import {
  EMPTY_PHARMACY_COMMERCIAL,
  validateCommercialPayoutWarning,
  type PharmacyCommercialForm,
} from '@/lib/pharmacyCommercial';
import api from '@/lib/api';
import { useAuth } from '@/store/auth';
import { canManageCadastro } from '@/lib/cadastroPermissions';
import { cn } from '@/lib/utils';
import { CadastroImportTrigger } from '@/components/cadastros/CadastroImportModal';
import { BrCepInput, BrCnpjInput, BrPhoneInput } from '@/components/form/BrInputs';
import { onlyDigits, normalizeBrazilPhone, formatBrazilPhone, formatCnpj, formatCep } from '@/lib/brFormat';
import { CadastroField, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import { DEFAULT_LIST_PAGE_SIZE, PaginationControls } from '@/components/ui/PaginationControls';
import { reviveHeaderPrimaryActionClass, reviveInlineTextActionClass, revivePrimarySmActionClass } from '@/components/ui/reviveActionButtonStyles';

type ApiLeader = { id: string; name: string; phone: string; status: string };
type ApiDriver = { id: string; name: string; phone: string; status: string };
type ApiState = { code: string; name: string };
type ApiCity = { name: string };

type ApiPharmacySummary = {
  id: string;
  trade_name: string;
  legal_name: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  status: 'active' | 'inactive';
  leader?: { id: string; name: string } | null;
  drivers_count: number;
  open_conversations: number;
  sla_percent: number;
  sla_days: number;
};

type ApiSector = { id: string; name: string; is_active?: boolean | null };

type ApiPharmacyDetail = {
  id: string;
  trade_name: string;
  legal_name: string;
  primary_attendant_id?: string | null;
  secondary_attendant_id?: string | null;
  primary_attendant?: { id: string; name: string; email?: string | null } | null;
  secondary_attendant?: { id: string; name: string; email?: string | null } | null;
  pharmacy_sector_attendants?: Array<{
    sector_id: string;
    attendant_id: string;
    sector?: { id: string; name: string } | null;
    attendant?: { id: string; name: string } | null;
  }>;
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
  leader_id?: string | null;
  leader?: { id: string; name: string; phone?: string | null } | null;
  delivery_fee_cents?: number | null;
  delivery_fee_driver_payout_cents?: number | null;
  minimum_guaranteed_cents?: number | null;
  minimum_guaranteed_driver_payout_cents?: number | null;
  delivery_schedule?: Record<string, unknown> | null;
  driver_pharmacy_links?: Array<{
    id: string;
    is_primary: boolean;
    is_active: boolean;
    started_at: string | null;
    drivers?: { id: string; name: string; phone: string; status: string; work_schedule?: Record<string, unknown> | null } | null;
  }>;
};

function displayCity(city: string | null, state: string | null) {
  const c = (city || '').trim();
  const s = (state || '').trim();
  if (!c && !s) return '—';
  if (c && s) return `${c} / ${s}`;
  return c || s;
}

function normText(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function statusToDot(status: 'active' | 'inactive') {
  return status === 'active' ? 'online' : 'offline';
}

function Modal({
  open,
  title,
  children,
  onClose,
  headerActions,
  maxWidthClassName = 'max-w-2xl',
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  headerActions?: React.ReactNode;
  maxWidthClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm p-4">
      <div className={cn('flex w-full flex-col max-h-[90vh] rounded-2xl border border-border bg-surface-elevated shadow-glow', maxWidthClassName)}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="text-sm font-semibold tracking-tight">{title}</div>
          <div className="flex items-center gap-2">
            {headerActions}
            <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground">
              Fechar
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function PharmacyDriversTeamSection({
  pharmacyId,
  detail,
  isLoading,
  driversOptions,
  linkDriverId,
  setLinkDriverId,
  linkPrimary,
  setLinkPrimary,
  onLink,
  onUnlink,
  expandedScheduleLinkId,
  setExpandedScheduleLinkId,
}: {
  pharmacyId: string;
  detail: ApiPharmacyDetail | undefined;
  isLoading?: boolean;
  driversOptions: ApiDriver[];
  linkDriverId: string;
  setLinkDriverId: (v: string) => void;
  linkPrimary: boolean;
  setLinkPrimary: (v: boolean) => void;
  onLink: () => void | Promise<void>;
  onUnlink: (driverId: string) => void | Promise<void>;
  expandedScheduleLinkId: string | null;
  setExpandedScheduleLinkId: (id: string | null) => void;
}) {
  if (!pharmacyId) return null;
  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando…</div>;
  if (!detail) return null;

  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-subtle-foreground">Entregadores vinculados</div>
      <div className="mt-2 space-y-2">
        {(detail.driver_pharmacy_links || []).filter((l) => l.is_active).length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhum vínculo ativo.</div>
        ) : (
          (detail.driver_pharmacy_links || [])
            .filter((l) => l.is_active)
            .slice(0, 30)
            .map((l) => {
              const ws = l.drivers?.work_schedule;
              const summary = ws != null ? formatWorkScheduleSummary(ws) : '';
              const has = hasConfiguredWorkSchedule(ws);
              const expanded = expandedScheduleLinkId === l.id;
              return (
                <div key={l.id} className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-3 min-w-0">
                    <div className="truncate text-foreground">{l.drivers?.name || '—'}</div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-[10px] text-subtle-foreground">{l.is_primary ? 'Primário' : 'Secundário'}</div>
                      {l.drivers?.id ? (
                        <button
                          type="button"
                          onClick={() => void onUnlink(l.drivers!.id)}
                          className="rounded border border-border bg-background/40 px-2 py-1 text-[10px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                        >
                          Remover
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">{formatBrazilPhone(l.drivers?.phone || '') || '—'}</div>
                  {has ? (
                    <div className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-subtle-foreground">Escala: </span>
                      {summary}
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">
                      Sem escala cadastrada.{' '}
                      <Link href="/drivers" className="font-medium text-primary hover:underline">
                        Cadastrar no entregador
                      </Link>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedScheduleLinkId(expanded ? null : l.id)}
                    className="mt-0.5 flex items-center gap-1 text-left text-[10px] font-medium text-primary hover:underline"
                  >
                    {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    {expanded ? 'Ocultar escala completa' : 'Ver escala completa'}
                  </button>
                  {expanded ? (
                    <div className="mt-1 border-t border-border/50 pt-2">
                      <BusinessHoursEditor
                        value={(ws && typeof ws === 'object' ? ws : {}) as Record<string, unknown>}
                        onChange={() => {}}
                        readonly
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
        )}
      </div>

      <div className="mt-3 rounded-xl border border-border bg-background/30 p-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground">Adicionar entregador</div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={linkDriverId}
            onChange={(e) => setLinkDriverId(e.target.value)}
            className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-xs outline-none"
          >
            <option value="">Selecione...</option>
            {driversOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({formatBrazilPhone(d.phone) || d.phone})
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={linkPrimary} onChange={(e) => setLinkPrimary(e.target.checked)} className="rounded border-border bg-background" />
            Primário
          </label>
          <button
            type="button"
            onClick={() => void onLink()}
            disabled={!linkDriverId}
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-glow disabled:opacity-60"
          >
            Vincular
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PharmaciesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const user = useAuth((s) => s.user);
  const hasPermission = useAuth((s) => s.hasPermission);
  const canManage = canManageCadastro(user?.role, hasPermission, 'pharmacies');
  const canBulkImport = user?.role === 'admin' || user?.role === 'supervisor';
  const canFetch = hasHydrated && isAuthenticated;

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [leaderFilter, setLeaderFilter] = useState<string>('all');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  // Mantido para compatibilidade com o layout existente (modal de detalhes não é mais o fluxo principal).
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeDetailId, setActiveDetailId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [formTrade, setFormTrade] = useState('');
  const [formLegal, setFormLegal] = useState('');
  const [formCnpj, setFormCnpj] = useState('');
  const [formCep, setFormCep] = useState('');
  const [formStreet, setFormStreet] = useState('');
  const [formNumber, setFormNumber] = useState('');
  const [formNeighborhood, setFormNeighborhood] = useState('');
  const [formComplement, setFormComplement] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formState, setFormState] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formStatus, setFormStatus] = useState<'active' | 'inactive'>('active');
  const [formLeaderId, setFormLeaderId] = useState('');
  const [formPrimaryAttendantId, setFormPrimaryAttendantId] = useState('');
  const [formSecondaryAttendantId, setFormSecondaryAttendantId] = useState('');
  const [sectorAttendantMap, setSectorAttendantMap] = useState<Record<string, string>>({});
  const [commercial, setCommercial] = useState<PharmacyCommercialForm>(EMPTY_PHARMACY_COMMERCIAL);
  const [deliverySchedule, setDeliverySchedule] = useState<Record<string, unknown>>({});

  const [formExpName, setFormExpName] = useState('');
  const [formExpPhone, setFormExpPhone] = useState('');
  const [formExpEmail, setFormExpEmail] = useState('');
  const [formFinName, setFormFinName] = useState('');
  const [formFinPhone, setFormFinPhone] = useState('');
  const [formFinEmail, setFormFinEmail] = useState('');
  const [formMgrName, setFormMgrName] = useState('');
  const [formMgrPhone, setFormMgrPhone] = useState('');
  const [formMgrEmail, setFormMgrEmail] = useState('');

  const [linkDriverId, setLinkDriverId] = useState('');
  const [linkPrimary, setLinkPrimary] = useState(false);
  const [expandedScheduleLinkId, setExpandedScheduleLinkId] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['pharmacies', 'summary'],
    enabled: canFetch,
    queryFn: async () => (await api.get('/api/pharmacies/summary')).data as ApiPharmacySummary[],
  });

  const leadersQuery = useQuery({
    queryKey: ['pharmacies', 'leaders'],
    enabled: canFetch,
    queryFn: async () => (await api.get('/api/leaders', { params: { status: 'active' } })).data as ApiLeader[],
  });

  const sectorsQuery = useQuery({
    queryKey: ['pharmacies', 'sectors'],
    enabled: canFetch && editorOpen,
    queryFn: async () => (await api.get('/api/sectors')).data as ApiSector[],
  });

  const attendantsQuery = useQuery({
    queryKey: ['pharmacies', 'attendants', 'workspace'],
    enabled: canFetch && editorOpen && canManage,
    queryFn: async () =>
      (
        await api.get('/api/users/attendants', {
          params: { scope: 'workspace', include_supervisors: '1' },
        })
      ).data as Array<{ id: string; name: string }>,
  });

  const driversQuery = useQuery({
    queryKey: ['pharmacies', 'drivers'],
    enabled: canFetch && editorOpen && Boolean(editingId),
    queryFn: async () => (await api.get('/api/drivers')).data as ApiDriver[],
  });

  const statesQuery = useQuery({
    queryKey: ['geo', 'states'],
    enabled: canFetch && editorOpen,
    queryFn: async () => (await api.get('/api/geo/states')).data as ApiState[],
  });

  const citiesQuery = useQuery({
    queryKey: ['geo', 'cities', formState],
    enabled: canFetch && editorOpen && Boolean(formState),
    queryFn: async () => (await api.get(`/api/geo/states/${encodeURIComponent(formState)}/cities`)).data as ApiCity[],
  });

  const editDetailQuery = useQuery({
    queryKey: ['pharmacies', 'edit', editingId],
    enabled: canFetch && editorOpen && Boolean(editingId),
    queryFn: async () => (await api.get(`/api/pharmacies/${editingId}`)).data as ApiPharmacyDetail,
  });

  const detailQuery = useQuery({
    queryKey: ['pharmacies', 'detail', activeDetailId],
    enabled: canFetch && detailOpen && Boolean(activeDetailId),
    queryFn: async () => (await api.get(`/api/pharmacies/${activeDetailId}`)).data as ApiPharmacyDetail,
  });

  useEffect(() => {
    if (!menuId) return;
    const onClick = (e: MouseEvent) => {
      const el = menuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setMenuId(null);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuId]);

  useEffect(() => {
    setExpandedScheduleLinkId(null);
  }, [activeDetailId, editingId]);

  useEffect(() => {
    if (!editorOpen || !editingId) return;
    const d = editDetailQuery.data;
    if (!d) return;
    setFormTrade(d.trade_name || '');
    setFormLegal(d.legal_name || d.trade_name || '');
    setFormCnpj(onlyDigits(d.cnpj || ''));
    setFormCep(onlyDigits(d.address_cep || ''));
    setFormStreet(d.address_street || '');
    setFormNumber(d.address_number || '');
    setFormNeighborhood(d.address_neighborhood || '');
    setFormComplement(d.address_complement || '');
    setFormCity(d.city || '');
    setFormState(d.state || '');
    setFormPhone(d.phone || '');
    setFormStatus(d.status || 'active');
    setFormLeaderId(d.leader_id || d.leader?.id || '');
    setFormPrimaryAttendantId(d.primary_attendant_id || d.primary_attendant?.id || '');
    setFormSecondaryAttendantId(d.secondary_attendant_id || d.secondary_attendant?.id || '');
    const m: Record<string, string> = {};
    for (const row of d.pharmacy_sector_attendants || []) {
      if (row.sector_id && row.attendant_id) m[row.sector_id] = row.attendant_id;
    }
    setSectorAttendantMap(m);
    setFormExpName(d.contact_expedition_name || '');
    setFormExpPhone(d.contact_expedition_phone || '');
    setFormExpEmail(d.contact_expedition_email || '');
    setFormFinName(d.contact_financial_name || '');
    setFormFinPhone(d.contact_financial_phone || '');
    setFormFinEmail(d.contact_financial_email || '');
    setFormMgrName(d.contact_manager_name || '');
    setFormMgrPhone(d.contact_manager_phone || '');
    setFormMgrEmail(d.contact_manager_email || '');
    setCommercial({
      delivery_fee_cents: d.delivery_fee_cents ?? null,
      delivery_fee_driver_payout_cents: d.delivery_fee_driver_payout_cents ?? null,
      minimum_guaranteed_cents: d.minimum_guaranteed_cents ?? null,
      minimum_guaranteed_driver_payout_cents: d.minimum_guaranteed_driver_payout_cents ?? null,
    });
    setDeliverySchedule(parsePharmacyDeliveryScheduleForEdit(d.delivery_schedule));
  }, [editorOpen, editingId, editDetailQuery.data]);

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

  const items = useMemo(() => {
    const all = summaryQuery.data || [];
    const needle = q.trim().toLowerCase();
    return all.filter((p) => {
      if (needle && !(p.trade_name || '').toLowerCase().includes(needle) && !(p.legal_name || '').toLowerCase().includes(needle)) {
        return false;
      }
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (leaderFilter !== 'all' && String(p.leader?.id || '') !== leaderFilter) return false;
      if (cityFilter !== 'all' && normText(p.city) !== normText(cityFilter)) return false;
      if (stateFilter !== 'all' && normText(p.state) !== normText(stateFilter)) return false;
      return true;
    });
  }, [summaryQuery.data, q, statusFilter, leaderFilter, cityFilter, stateFilter]);

  const cityOptions = useMemo(() => {
    const source = (summaryQuery.data || []).filter(
      (p) => stateFilter === 'all' || normText(p.state) === normText(stateFilter)
    );
    return Array.from(new Set(source.map((p) => String(p.city || '').trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR')
    );
  }, [summaryQuery.data, stateFilter]);
  const stateOptions = useMemo(() => {
    const source = (summaryQuery.data || []).filter(
      (p) => cityFilter === 'all' || normText(p.city) === normText(cityFilter)
    );
    return Array.from(new Set(source.map((p) => String(p.state || '').trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR')
    );
  }, [summaryQuery.data, cityFilter]);

  const stats = useMemo(() => {
    const active = items.filter((p) => p.status === 'active').length;
    const driversTotal = items.reduce((acc, p) => acc + Number(p.drivers_count || 0), 0);
    const slaAvg = items.length > 0 ? Math.round((items.reduce((acc, p) => acc + Number(p.sla_percent || 0), 0) / items.length) * 10) / 10 : 0;
    return { active, driversTotal, slaAvg };
  }, [items]);

  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * DEFAULT_LIST_PAGE_SIZE;
    return items.slice(start, start + DEFAULT_LIST_PAGE_SIZE);
  }, [currentPage, items]);

  useEffect(() => {
    setCurrentPage(1);
  }, [q, statusFilter, leaderFilter, cityFilter, stateFilter]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(items.length / DEFAULT_LIST_PAGE_SIZE));
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, items.length]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formTrade.trim() || !formLegal.trim()) return;
    const cnpjDigits = onlyDigits(formCnpj);
    if (!cnpjDigits || cnpjDigits.length !== 14) {
      setSaveError('CNPJ inválido (use 14 dígitos).');
      return;
    }
    const cepDigits = onlyDigits(formCep);
    if (cepDigits && cepDigits.length !== 8) {
      setSaveError('CEP inválido (use 8 dígitos).');
      return;
    }

    const emails = [formExpEmail.trim(), formFinEmail.trim(), formMgrEmail.trim()].filter(Boolean);
    if (emails.some((mail) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail))) {
      setSaveError('E-mail de contato inválido.');
      return;
    }

    const expPhone = normalizeBrazilPhone(formExpPhone);
    const finPhone = normalizeBrazilPhone(formFinPhone);
    const mgrPhone = normalizeBrazilPhone(formMgrPhone);
    if (formExpPhone.trim() && (!expPhone || expPhone.length < 12)) {
      setSaveError('Telefone do contato (Expedição) inválido.');
      return;
    }
    if (formFinPhone.trim() && (!finPhone || finPhone.length < 12)) {
      setSaveError('Telefone do contato (Financeiro) inválido.');
      return;
    }
    if (formMgrPhone.trim() && (!mgrPhone || mgrPhone.length < 12)) {
      setSaveError('Telefone do contato (Gestor) inválido.');
      return;
    }

    const feeWarn = validateCommercialPayoutWarning(
      commercial.delivery_fee_cents,
      commercial.delivery_fee_driver_payout_cents,
    );
    if (feeWarn) {
      setSaveError(feeWarn);
      return;
    }
    const minWarn = validateCommercialPayoutWarning(
      commercial.minimum_guaranteed_cents,
      commercial.minimum_guaranteed_driver_payout_cents,
    );
    if (minWarn) {
      setSaveError(minWarn);
      return;
    }

    const scheduleErr = validatePharmacyDeliverySchedule(deliverySchedule);
    if (scheduleErr) {
      setSaveError(scheduleErr);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const activeSectors = (sectorsQuery.data || []).filter((s) => s.is_active !== false);
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

      if (editingId) await api.put(`/api/pharmacies/${editingId}`, payload);
      else await api.post('/api/pharmacies', payload);

      setEditorOpen(false);
      setEditingId(null);
      await summaryQuery.refetch();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSaveError(msg || 'Falha ao salvar farmácia.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: ApiPharmacySummary) => {
    const ok = window.confirm(`Excluir a farmácia "${p.trade_name}"?`);
    if (!ok) return;
    try {
      await api.delete(`/api/pharmacies/${p.id}`);
      await summaryQuery.refetch();
    } catch {
      // ignore
    }
  };

  const linkDriver = async (pharmacyId: string) => {
    if (!pharmacyId || !linkDriverId) return;
    try {
      await api.post(`/api/drivers/${linkDriverId}/pharmacies`, { pharmacy_id: pharmacyId, is_primary: linkPrimary });
      setLinkDriverId('');
      setLinkPrimary(false);
      await Promise.all([summaryQuery.refetch(), editDetailQuery.refetch()]);
    } catch {
      // ignore
    }
  };

  const unlinkDriver = async (pharmacyId: string, driverId: string) => {
    if (!pharmacyId || !driverId) return;
    try {
      await api.delete(`/api/drivers/${driverId}/pharmacies/${pharmacyId}`);
      await Promise.all([summaryQuery.refetch(), editDetailQuery.refetch()]);
    } catch {
      // ignore
    }
  };

  const clearEditQueryParam = () => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('edit')) return;
    url.searchParams.delete('edit');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const clearFilters = () => {
    setQ('');
    setStatusFilter('all');
    setLeaderFilter('all');
    setCityFilter('all');
    setStateFilter('all');
  };

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) return;
    router.replace(`/pharmacies/new?id=${encodeURIComponent(editId)}`);
  }, [router, searchParams]);

  useEffect(() => {
    if (cityFilter !== 'all' && !cityOptions.some((c) => normText(c) === normText(cityFilter))) {
      setCityFilter('all');
    }
  }, [cityFilter, cityOptions]);

  useEffect(() => {
    if (stateFilter !== 'all' && !stateOptions.some((s) => normText(s) === normText(stateFilter))) {
      setStateFilter('all');
    }
  }, [stateFilter, stateOptions]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <PageHeader
          eyebrow="Operação"
          title="Farmácias"
          description="Unidades parceiras conectadas à plataforma."
          actions={
            <>
              <CadastroImportTrigger
                canImport={Boolean(canBulkImport)}
                templatePath="/api/pharmacies/import/template"
                importPath="/api/pharmacies/import"
                entityLabel="farmácias"
                onImported={() => void summaryQuery.refetch()}
              />
              {canManage ? (
                <Link href="/pharmacies/new" className={reviveHeaderPrimaryActionClass}>
                  <Plus className="h-3.5 w-3.5" /> Nova farmácia
                </Link>
              ) : null}
            </>
          }
        />

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Farmácias ativas', value: String(stats.active), icon: Building2 },
            { label: 'Online agora', value: String(stats.active), accent: stats.active ? 'text-success' : undefined, icon: Users },
            { label: 'Entregadores totais', value: String(stats.driversTotal), icon: Truck },
            { label: 'SLA médio', value: `${stats.slaAvg.toFixed(1)}%`, accent: stats.slaAvg > 0 ? 'text-success' : undefined, icon: Users },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
              <div className={cn('text-xl font-semibold tracking-tight', s.accent)}>{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar farmácia por nome..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground outline-none"
          >
            <option value="all">Status</option>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>
          <select
            value={leaderFilter}
            onChange={(e) => setLeaderFilter(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground outline-none"
          >
            <option value="all">Líder</option>
            {(leadersQuery.data || []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground outline-none"
          >
            <option value="all">Cidade</option>
            {cityOptions.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground outline-none"
          >
            <option value="all">Estado</option>
            {stateOptions.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            Limpar filtros
          </button>
        </div>

        {summaryQuery.isError ? <div className="mb-3 text-xs text-destructive">Falha ao carregar farmácias.</div> : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {summaryQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Carregando…</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhuma farmácia encontrada.</div>
          ) : (
            pagedItems.map((p) => (
              <div key={p.id} data-pharmacy-id={p.id} className="group rounded-xl border border-border bg-surface p-5 hover:bg-surface-elevated transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
                      <Building2 className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{p.trade_name}</div>
                      <div className="font-mono text-[10px] text-subtle-foreground">{p.id.slice(0, 8)}</div>
                    </div>
                  </div>

                  <div className="relative">
                    <button
                      onClick={() => setMenuId((v) => (v === p.id ? null : p.id))}
                      className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-surface-hover"
                      title="Ações"
                    >
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </button>
                    {menuId === p.id ? (
                      <div ref={menuRef} className="absolute right-0 top-8 z-30 w-40 rounded-xl border border-border bg-surface-elevated p-1 shadow-glow">
                        {canManage ? (
                          <Link
                            href={`/pharmacies/new?id=${encodeURIComponent(p.id)}`}
                            onClick={() => setMenuId(null)}
                            className={`${revivePrimarySmActionClass} flex w-full justify-start`}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            Editar
                          </Link>
                        ) : null}
                        <button
                          onClick={() => {
                            setMenuId(null);
                            void remove(p);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-destructive hover:bg-surface-hover"
                        >
                          Excluir
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 space-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {displayCity(p.city, p.state)}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground font-mono">
                    <Phone className="h-3 w-3" /> {formatBrazilPhone(p.phone || '') || '—'}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Users className="h-3 w-3" /> Líder: <span className="text-foreground">{p.leader?.name || '—'}</span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3">
                  <div>
                    <div className="font-mono text-sm font-semibold">{p.drivers_count}</div>
                    <div className="text-[10px] text-subtle-foreground">Entregadores</div>
                  </div>
                  <div>
                    <div className="font-mono text-sm font-semibold">{p.open_conversations}</div>
                    <div className="text-[10px] text-subtle-foreground">Conv. abertas</div>
                  </div>
                  <div>
                    <div className={cn('font-mono text-sm font-semibold', p.sla_percent > 0 ? 'text-success' : 'text-muted-foreground')}>
                      {Number(p.sla_percent || 0).toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-subtle-foreground">SLA ({p.sla_days}d)</div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={statusToDot(p.status)} pulse={p.status === 'active'} />
                    <span className="text-[10px] capitalize text-muted-foreground">{p.status === 'active' ? 'online' : 'offline'}</span>
                  </div>
                  <Link href={`/pharmacies/${encodeURIComponent(p.id)}`} className={reviveInlineTextActionClass}>
                    Detalhes →
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
        <PaginationControls page={currentPage} totalItems={items.length} onPageChange={setCurrentPage} itemLabel="farmácias" />
      </div>

      <Modal
        open={editorOpen}
        title={editingId ? 'Editar farmácia' : 'Nova farmácia'}
        onClose={() => {
          if (saving) return;
          clearEditQueryParam();
          setEditorOpen(false);
        }}
        maxWidthClassName="max-w-3xl"
      >
        <form onSubmit={submit} className="space-y-4">
          {saveError ? <div className="text-xs text-destructive">{saveError}</div> : null}
          <CadastroSection title="Identificação" desc="Dados principais da farmácia">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <CadastroField icon={Building2} label="Nome fantasia" required>
                  <input value={formTrade} onChange={(e) => setFormTrade(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none" required />
                </CadastroField>
              </div>
              <div className="sm:col-span-2">
                <CadastroField icon={Building2} label="Razão social" required>
                  <input value={formLegal} onChange={(e) => setFormLegal(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none" required />
                </CadastroField>
              </div>
              <div className="sm:col-span-2">
                <CadastroField icon={FileText} label="CNPJ" required>
                  <BrCnpjInput value={onlyDigits(formCnpj)} onChange={(digits) => setFormCnpj(digits)} className="bg-surface font-mono" placeholder="00.000.000/0000-00" required />
                </CadastroField>
              </div>
              <div className="sm:col-span-2">
                <CadastroField icon={Phone} label="Telefone">
                  <BrPhoneInput value={formPhone} onChange={setFormPhone} className="bg-surface font-mono" placeholder="(11) 99999-9999" />
                </CadastroField>
              </div>
              <div className="sm:col-span-2">
                <CadastroField icon={Users} label="Líder">
                  <select value={formLeaderId} onChange={(e) => setFormLeaderId(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none">
                    <option value="">—</option>
                    {(leadersQuery.data || [])
                      .filter((l) => l.status === 'active')
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </CadastroField>
              </div>
              <div className="sm:col-span-2">
                <CadastroField icon={StatusDot as unknown as typeof Building2} label="Status">
                  <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as 'active' | 'inactive')} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none">
                    <option value="active">Ativa</option>
                    <option value="inactive">Inativa</option>
                  </select>
                </CadastroField>
              </div>
            </div>
          </CadastroSection>

          <CadastroSection title="Endereço">
            <PharmacyAddressFields
              values={addressValues}
              onChange={patchAddress}
              statesQuery={statesQuery}
              citiesQuery={citiesQuery}
            />
          </CadastroSection>

          <CadastroSection title="Contatos por perfil" desc="Opcional">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 text-[11px] font-semibold text-foreground">Expedição</div>
              <CadastroField icon={Users} label="Nome">
                <input value={formExpName} onChange={(e) => setFormExpName(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none" placeholder="Opcional" />
              </CadastroField>
              <CadastroField icon={Phone} label="Telefone">
                <BrPhoneInput value={formExpPhone} onChange={setFormExpPhone} className="bg-surface font-mono" placeholder="(11) 99999-9999" />
              </CadastroField>
              <div className="sm:col-span-2">
                <CadastroField icon={Mail} label="E-mail">
                  <input value={formExpEmail} onChange={(e) => setFormExpEmail(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none" placeholder="Opcional" type="email" />
                </CadastroField>
              </div>

              <div className="sm:col-span-2 pt-1 text-[11px] font-semibold text-foreground">Financeiro</div>
              <CadastroField icon={Users} label="Nome">
                <input value={formFinName} onChange={(e) => setFormFinName(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none" placeholder="Opcional" />
              </CadastroField>
              <CadastroField icon={Phone} label="Telefone">
                <BrPhoneInput value={formFinPhone} onChange={setFormFinPhone} className="bg-surface font-mono" placeholder="(11) 99999-9999" />
              </CadastroField>
              <div className="sm:col-span-2">
                <CadastroField icon={Mail} label="E-mail">
                  <input value={formFinEmail} onChange={(e) => setFormFinEmail(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none" placeholder="Opcional" type="email" />
                </CadastroField>
              </div>

              <div className="sm:col-span-2 pt-1 text-[11px] font-semibold text-foreground">Gestor</div>
              <CadastroField icon={Users} label="Nome">
                <input value={formMgrName} onChange={(e) => setFormMgrName(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none" placeholder="Opcional" />
              </CadastroField>
              <CadastroField icon={Phone} label="Telefone">
                <BrPhoneInput value={formMgrPhone} onChange={setFormMgrPhone} className="bg-surface font-mono" placeholder="(11) 99999-9999" />
              </CadastroField>
              <div className="sm:col-span-2">
                <CadastroField icon={Mail} label="E-mail">
                  <input value={formMgrEmail} onChange={(e) => setFormMgrEmail(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none" placeholder="Opcional" type="email" />
                </CadastroField>
              </div>
            </div>
          </CadastroSection>

          <CadastroSection title="Condições comerciais" desc="Taxas e repasses em BRL.">
            <PharmacyCommercialTermsFields value={commercial} onChange={setCommercial} />
          </CadastroSection>

          <CadastroSection title="Horário de funcionamento do delivery">
            <PharmacyDeliveryScheduleSection value={deliverySchedule} onChange={setDeliverySchedule} />
          </CadastroSection>

          <CadastroSection title="Atendentes vinculados" desc="Fila padrão, backup e atendente opcional por setor.">
            <PharmacyLinkedAttendantsSection
              attendants={attendantsQuery.data || []}
              sectors={(sectorsQuery.data || []).filter((s) => s.is_active !== false)}
              primaryId={formPrimaryAttendantId}
              secondaryId={formSecondaryAttendantId}
              sectorMap={sectorAttendantMap}
              onPrimaryChange={setFormPrimaryAttendantId}
              onSecondaryChange={setFormSecondaryAttendantId}
              onSectorChange={(sectorId, attendantId) =>
                setSectorAttendantMap((prev) => ({ ...prev, [sectorId]: attendantId }))
              }
            />
          </CadastroSection>

          {editingId ? (
            <CadastroSection title="Equipe de entregadores" desc="Vínculos, primária e escala por vínculo">
              <PharmacyDriversTeamSection
                pharmacyId={editingId}
                detail={editDetailQuery.data}
                isLoading={editDetailQuery.isLoading}
                driversOptions={driversQuery.data || []}
                linkDriverId={linkDriverId}
                setLinkDriverId={setLinkDriverId}
                linkPrimary={linkPrimary}
                setLinkPrimary={setLinkPrimary}
                onLink={() => void linkDriver(editingId!)}
                onUnlink={(driverId) => void unlinkDriver(editingId!, driverId)}
                expandedScheduleLinkId={expandedScheduleLinkId}
                setExpandedScheduleLinkId={setExpandedScheduleLinkId}
              />
            </CadastroSection>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                clearEditQueryParam();
                setEditorOpen(false);
              }}
              disabled={saving}
              className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-glow disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={detailOpen}
        title="Detalhes da farmácia"
        headerActions={
          activeDetailId && canManage ? (
            <Link
              href={`/pharmacies/new?id=${encodeURIComponent(activeDetailId)}`}
              onClick={() => {
                setDetailOpen(false);
                setActiveDetailId(null);
              }}
              className={revivePrimarySmActionClass}
            >
              <Edit3 className="h-3.5 w-3.5" /> Editar
            </Link>
          ) : null
        }
        onClose={() => {
          setDetailOpen(false);
          setActiveDetailId(null);
        }}
      >
        {detailQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : detailQuery.isError || !detailQuery.data ? (
          <div className="text-sm text-muted-foreground">Falha ao carregar detalhes.</div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-background/40 p-4">
              <div className="text-sm font-semibold">{detailQuery.data.trade_name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{detailQuery.data.legal_name}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="text-muted-foreground">
                  CNPJ: <span className="font-mono text-foreground">{formatCnpj(detailQuery.data.cnpj || '') || '—'}</span>
                </div>
                <div className="text-muted-foreground">
                  Telefone: <span className="font-mono text-foreground">{formatBrazilPhone(detailQuery.data.phone || '') || '—'}</span>
                </div>
                <div className="text-muted-foreground">
                  Cidade: <span className="text-foreground">{displayCity(detailQuery.data.city, detailQuery.data.state)}</span>
                </div>
                <div className="text-muted-foreground">
                  Líder: <span className="text-foreground">{detailQuery.data.leader?.name || '—'}</span>
                </div>
                <div className="col-span-2 text-muted-foreground">
                  Atendente principal:{' '}
                  <span className="text-foreground">{detailQuery.data.primary_attendant?.name || '—'}</span>
                  {detailQuery.data.secondary_attendant?.name ? (
                    <>
                      {' '}
                      · Secundário: <span className="text-foreground">{detailQuery.data.secondary_attendant.name}</span>
                    </>
                  ) : null}
                </div>
                <div className="text-muted-foreground">
                  CEP: <span className="font-mono text-foreground">{formatCep(detailQuery.data.address_cep || '') || '—'}</span>
                </div>
                <div className="text-muted-foreground">
                  Endereço:{' '}
                  <span className="text-foreground">
                    {[detailQuery.data.address_street, detailQuery.data.address_number].filter(Boolean).join(', ') || '—'}
                  </span>
                </div>
                <div className="col-span-2 text-muted-foreground">
                  Bairro/Compl.:{' '}
                  <span className="text-foreground">
                    {[detailQuery.data.address_neighborhood, detailQuery.data.address_complement].filter(Boolean).join(' · ') || '—'}
                  </span>
                </div>
              </div>
            </div>

            {(detailQuery.data.pharmacy_sector_attendants || []).filter((r) => r.attendant_id).length > 0 ? (
              <div className="rounded-xl border border-border bg-background/40 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground">Atendentes por setor</div>
                <div className="mt-2 space-y-1 text-xs">
                  {(detailQuery.data.pharmacy_sector_attendants || [])
                    .filter((r) => r.attendant_id)
                    .map((r) => (
                      <div key={r.sector_id} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{r.sector?.name || r.sector_id}</span>
                        <span className="text-foreground">{r.attendant?.name || r.attendant_id}</span>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-border bg-background/40 p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground">Contatos por perfil</div>
              <div className="mt-3 grid grid-cols-1 gap-3 text-xs">
                {[
                  { label: 'Expedição', name: detailQuery.data.contact_expedition_name, phone: detailQuery.data.contact_expedition_phone, email: detailQuery.data.contact_expedition_email },
                  { label: 'Financeiro', name: detailQuery.data.contact_financial_name, phone: detailQuery.data.contact_financial_phone, email: detailQuery.data.contact_financial_email },
                  { label: 'Gestor', name: detailQuery.data.contact_manager_name, phone: detailQuery.data.contact_manager_phone, email: detailQuery.data.contact_manager_email },
                ].map((c) => (
                  <div key={c.label} className="rounded-lg border border-border bg-surface px-3 py-2">
                    <div className="text-[11px] font-semibold text-foreground">{c.label}</div>
                    <div className="mt-1 text-muted-foreground">
                      {c.name ? <span className="text-foreground">{c.name}</span> : '—'}
                      {c.phone ? <span className="ml-2 font-mono text-foreground">{formatBrazilPhone(c.phone)}</span> : null}
                      {c.email ? <span className="ml-2 text-foreground">{c.email}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <PharmacyDriversTeamSection
              pharmacyId={activeDetailId!}
              detail={detailQuery.data}
              driversOptions={driversQuery.data || []}
              linkDriverId={linkDriverId}
              setLinkDriverId={setLinkDriverId}
              linkPrimary={linkPrimary}
              setLinkPrimary={setLinkPrimary}
              onLink={() => void linkDriver(activeDetailId!)}
              onUnlink={(driverId) => void unlinkDriver(activeDetailId!, driverId)}
              expandedScheduleLinkId={expandedScheduleLinkId}
              setExpandedScheduleLinkId={setExpandedScheduleLinkId}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
