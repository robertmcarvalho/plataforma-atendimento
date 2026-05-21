'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, ChevronDown, Crown, Mail, MapPin, Phone, Save, User } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { BrPhoneInput } from '@/components/form/BrInputs';
import { CadastroField, CadastroPageScroll, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import { formatBrazilPhone, normalizeBrazilPhone } from '@/lib/brFormat';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { canManageCadastro } from '@/lib/cadastroPermissions';

type LeaderStatus = 'active' | 'inactive';

type LeaderDetail = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  status: LeaderStatus;
  leader_pharmacy_links?: Array<{
    id: string;
    is_active: boolean;
    pharmacies?: { id: string; trade_name: string; city: string | null } | null;
  }>;
  pharmacies_with_drivers?: Array<{
    pharmacy_id: string;
    trade_name: string;
    city: string | null;
    drivers: Array<{ id: string; name: string; phone: string; is_primary: boolean }>;
  }>;
};

type SavedLeader = { id: string };

export default function LeaderNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuth((s) => s.user);
  const hasPermission = useAuth((s) => s.hasPermission);
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const canFetch = hasHydrated && isAuthenticated;
  const canEdit = canManageCadastro(user?.role, hasPermission, 'leaders');

  const editId = (searchParams.get('id') || '').trim();
  const isEditing = Boolean(editId);
  const hasPrefilled = useRef(false);

  const [savingError, setSavingError] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formStatus, setFormStatus] = useState<LeaderStatus>('active');

  const leaderQuery = useQuery<LeaderDetail>({
    queryKey: ['leaders', 'edit', editId],
    enabled: canFetch && canEdit && isEditing,
    queryFn: async () => (await api.get(`/api/leaders/${editId}`)).data as LeaderDetail,
  });

  useEffect(() => {
    hasPrefilled.current = false;
  }, [editId]);

  useEffect(() => {
    if (!isEditing) {
      hasPrefilled.current = false;
      return;
    }
    const leader = leaderQuery.data;
    if (!leader || hasPrefilled.current) return;
    hasPrefilled.current = true;
    setFormName(leader.name || '');
    setFormPhone(leader.phone || '');
    setFormEmail(leader.email || '');
    setFormCity(leader.city || '');
    setFormStatus(leader.status || 'active');
  }, [isEditing, leaderQuery.data]);

  const activePharmacies = useMemo(() => {
    const links = leaderQuery.data?.leader_pharmacy_links || [];
    return links.filter((l) => l.is_active && l.pharmacies?.id).map((l) => l.pharmacies!);
  }, [leaderQuery.data?.leader_pharmacy_links]);

  const pharmacyDriverRows = leaderQuery.data?.pharmacies_with_drivers || [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      setSavingError(null);
      if (!formName.trim()) throw new Error('Informe o nome do líder.');
      const phoneDigits = normalizeBrazilPhone(formPhone);
      if (!phoneDigits || phoneDigits.length < 12) throw new Error('Telefone inválido (inclua DDD).');
      const email = formEmail.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');

      const payload = {
        name: formName.trim(),
        phone: phoneDigits,
        email: email || null,
        city: formCity.trim() || null,
        status: formStatus,
      };

      return isEditing
        ? ((await api.put(`/api/leaders/${editId}`, payload)).data as SavedLeader)
        : ((await api.post('/api/leaders', payload)).data as SavedLeader);
    },
    onSuccess: (saved) => {
      router.push(`/leaders/${saved.id}`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || (err as Error)?.message;
      setSavingError(msg || 'Falha ao salvar líder.');
    },
  });

  const backHref = isEditing ? `/leaders/${encodeURIComponent(editId)}` : '/leaders';

  if (user && !canEdit) {
    return (
      <CadastroPageScroll maxWidthClassName="max-w-5xl">
        <PageHeader eyebrow="Acesso" title="Líder" description="Você não tem permissão para editar líderes." compact />
        <Link className="button-secondary" href="/leaders">
          Voltar
        </Link>
      </CadastroPageScroll>
    );
  }

  return (
    <CadastroPageScroll maxWidthClassName="max-w-5xl">
      <Link href={backHref} className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Voltar para líderes
      </Link>

      <PageHeader
        eyebrow="Operação · Cadastro"
        title={isEditing ? 'Editar líder' : 'Novo líder'}
        description={isEditing ? 'Atualize as informações e vínculos do líder.' : 'Preencha as informações para cadastrar o líder.'}
        actions={
          <div className="flex gap-2">
            <Link href={backHref} className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground">
              Cancelar
            </Link>
            <button
              type="button"
              onClick={() => void saveMutation.mutateAsync()}
              disabled={saveMutation.isPending}
              className={cn(
                'flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-glow',
                saveMutation.isPending && 'pointer-events-none opacity-50'
              )}
            >
              <Save className="h-3.5 w-3.5" /> Salvar líder
            </button>
          </div>
        }
      />

      {savingError ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{savingError}</div>
      ) : null}

      {leaderQuery.isLoading ? <div className="mt-4 text-sm text-muted-foreground">Carregando líder…</div> : null}
      {leaderQuery.isError ? <div className="mt-4 text-sm text-destructive">Não foi possível carregar o líder.</div> : null}

      <div className="mt-6 space-y-5">
        <CadastroSection title="Dados pessoais" desc="Informações básicas do líder.">
          <div className="grid gap-4 md:grid-cols-2">
            <CadastroField icon={User} label="Nome" required>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nome completo"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
              />
            </CadastroField>
            <CadastroField icon={Phone} label="Telefone" required>
              <BrPhoneInput value={formPhone} onChange={setFormPhone} className="w-full" placeholder="(11) 99999-9999" />
            </CadastroField>
            <CadastroField icon={Mail} label="E-mail">
              <input
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                type="email"
                placeholder="lider@email.com"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
              />
            </CadastroField>
            <CadastroField icon={MapPin} label="Cidade">
              <input
                value={formCity}
                onChange={(e) => setFormCity(e.target.value)}
                placeholder="Cidade"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
              />
            </CadastroField>
          </div>
        </CadastroSection>

        <CadastroSection title="Status & vínculo" desc="Situação operacional e farmácias geridas.">
          <div className="grid gap-4 md:grid-cols-2">
            <CadastroField icon={Crown} label="Status">
              <select
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as LeaderStatus)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
              >
                <option value="active">Ativo</option>
                <option value="inactive">Inativo</option>
              </select>
            </CadastroField>
            <CadastroField icon={Building2} label="Farmácias vinculadas">
              <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2">
                {isEditing && activePharmacies.length ? (
                  activePharmacies.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-0.5 text-[10px] text-foreground">
                      <Building2 className="h-2.5 w-2.5 text-muted-foreground" />
                      {p.trade_name}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">{isEditing ? 'Nenhuma farmácia vinculada.' : 'Vincule farmácias após salvar o líder.'}</span>
                )}
              </div>
            </CadastroField>
          </div>
          <Link href="/pharmacies" className="inline-flex text-[11px] font-medium text-primary hover:underline">
            Abrir em Farmácias →
          </Link>
        </CadastroSection>

        {isEditing ? (
          <CadastroSection title="Farmácias e equipe" desc="Detalhes (leitura) do que está vinculado ao líder.">
            {pharmacyDriverRows.length ? (
              <div className="space-y-2">
                {pharmacyDriverRows.map((row) => (
                  <details key={row.pharmacy_id} className="group rounded-lg border border-border bg-background/40">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium">
                      <span className="flex min-w-0 items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {row.trade_name}
                          {row.city ? <span className="text-muted-foreground"> — {row.city}</span> : null}
                        </span>
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-border px-3 py-2">
                      {row.drivers.length ? (
                        <ul className="space-y-1.5">
                          {row.drivers.map((driver) => (
                            <li key={driver.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                              <span className="font-medium text-foreground">{driver.name}</span>
                              <span className="font-mono text-muted-foreground">{formatBrazilPhone(driver.phone) || driver.phone}</span>
                              {driver.is_primary ? <span className="rounded bg-primary/15 px-1.5 py-0 text-[10px] text-primary">Primário</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Nenhum entregador ativo nesta farmácia.</span>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Nenhuma informação de equipe disponível.</div>
            )}
          </CadastroSection>
        ) : null}
      </div>
    </CadastroPageScroll>
  );
}
