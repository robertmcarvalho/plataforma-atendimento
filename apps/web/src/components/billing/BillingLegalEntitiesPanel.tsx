'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Landmark, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { Dialog } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BillingEntityBadge } from '@/components/billing/BillingEntityBadge';
import { BillingDialogContent, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import {
  fetchLegalEntities,
  saveLegalEntity,
  type BillingLegalEntity,
} from '@/lib/billing/billingApi';

function emptyFor(type: 'coop' | 'flux'): Partial<BillingLegalEntity> {
  return {
    entity_type: type,
    legal_name: '',
    trade_name: '',
    cnpj: '',
    address_cep: '',
    address_street: '',
    address_number: '',
    address_neighborhood: '',
    address_city: '',
    address_state: '',
    financial_email: '',
    commercial_email: '',
    phone: '',
    bank_code: '',
    bank_name: '',
    branch_number: '',
    account_number: '',
    account_digit: '',
    account_type: 'checking',
    pix_key: '',
    pix_key_type: 'cnpj',
    default_split_coop_pct: 70,
    default_split_flux_pct: 30,
    flux_service_margin_pct: 0,
    invoice_header_notes: '',
    invoice_footer_notes: '',
  };
}

const nullableStringFields: Array<keyof BillingLegalEntity> = [
  'cnpj',
  'state_registration',
  'municipal_registration',
  'tax_regime',
  'address_cep',
  'address_street',
  'address_number',
  'address_neighborhood',
  'address_city',
  'address_state',
  'financial_email',
  'commercial_email',
  'phone',
  'bank_code',
  'bank_name',
  'branch_number',
  'account_number',
  'account_digit',
  'pix_key',
  'pix_key_type',
  'invoice_header_notes',
  'invoice_footer_notes',
];

function cleanEntityPayload(row: Partial<BillingLegalEntity>): Partial<BillingLegalEntity> {
  const payload = { ...row };
  nullableStringFields.forEach((field) => {
    const value = payload[field];
    if (typeof value === 'string' && !value.trim()) {
      (payload as Record<string, unknown>)[field] = null;
    }
  });
  return payload;
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <BillingField label={label} className={className}>
      {children}
    </BillingField>
  );
}

export function BillingLegalEntitiesPanel() {
  const qc = useQueryClient();
  const listQuery = useQuery({ queryKey: ['billing', 'legal-entities'], queryFn: fetchLegalEntities });
  const [edit, setEdit] = useState<Partial<BillingLegalEntity> | null>(null);

  const saveMut = useMutation({
    mutationFn: async (row: Partial<BillingLegalEntity>) => {
      const type = row.entity_type as 'coop' | 'flux';
      return saveLegalEntity(type, cleanEntityPayload(row));
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'legal-entities'] });
      setEdit(null);
    },
  });

  const byType = new Map((listQuery.data || []).map((e) => [e.entity_type, e]));
  const cards: Array<'coop' | 'flux'> = ['coop', 'flux'];
  const set = <K extends keyof BillingLegalEntity>(key: K, value: BillingLegalEntity[K]) => {
    setEdit((current) => (current ? { ...current, [key]: value } : current));
  };

  return (
    <BillingSection
      title="Entidades jurídicas"
      desc="Cadastre as duas entidades jurídicas que faturam: CoopMob e Flux Farma."
      icon={Landmark}
      action={
          <Button size="sm" onClick={() => setEdit(emptyFor('coop'))}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Nova entidade
          </Button>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((type) => {
          const e = byType.get(type);
          return (
            <div key={type} className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between">
                <BillingEntityBadge entity={type} />
                <button
                  type="button"
                  onClick={() => setEdit(e ? { ...e } : emptyFor(type))}
                  className="text-xs text-primary hover:underline"
                >
                  <Pencil className="mr-1 inline h-3 w-3" /> Editar
                </button>
              </div>
              {e ? (
                <>
                  <h3 className="mt-3 text-sm font-semibold">{e.trade_name || e.legal_name || '—'}</h3>
                  <p className="text-xs text-muted-foreground">{e.legal_name || '—'}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <dt className="text-muted-foreground">CNPJ</dt>
                    <dd className="font-mono">{e.cnpj || '—'}</dd>
                    <dt className="text-muted-foreground">Banco</dt>
                    <dd className="font-mono">
                      {e.bank_name
                        ? `${e.bank_name} ag ${e.branch_number || '—'} · cc ${e.account_number || '—'}-${e.account_digit || '—'}`
                        : '—'}
                    </dd>
                    <dt className="text-muted-foreground">PIX</dt>
                    <dd className="font-mono">{e.pix_key || '—'}</dd>
                    <dt className="text-muted-foreground">Financeiro</dt>
                    <dd className="truncate">{e.financial_email || '—'}</dd>
                    <dt className="text-muted-foreground">Split default</dt>
                    <dd>
                      {e.default_split_coop_pct ?? '—'}% Coop · {e.default_split_flux_pct ?? '—'}% Flux
                    </dd>
                  </dl>
                </>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">Ainda não cadastrada.</p>
              )}
            </div>
          );
        })}
      </div>

      {edit && (
        <Dialog open onOpenChange={(v) => !v && setEdit(null)}>
          <BillingDialogContent
            title={`${edit.id ? 'Editar' : 'Nova'} entidade jurídica`}
            description="Preencha dados fiscais, bancários e comerciais da entidade."
            className="sm:max-w-3xl"
            footer={
              <>
                <Button variant="outline" className="flex-1" onClick={() => setEdit(null)}>
                  Cancelar
                </Button>
                <Button className="flex-1 shadow-md" disabled={!edit.legal_name || !edit.cnpj || saveMut.isPending} onClick={() => saveMut.mutate(edit)}>
                  Salvar
                </Button>
              </>
            }
          >
            <Tabs defaultValue="ident">
              <TabsList>
                <TabsTrigger value="ident">Identificação</TabsTrigger>
                <TabsTrigger value="end">Endereço</TabsTrigger>
                <TabsTrigger value="bank">Bancário</TabsTrigger>
                <TabsTrigger value="com">Comercial</TabsTrigger>
              </TabsList>

              <TabsContent value="ident" className="mt-4 grid grid-cols-2 gap-3">
                <Field label="Tipo">
                  <FormSelect
                    value={edit.entity_type || 'coop'}
                    onChange={(value) => set('entity_type', value as 'coop' | 'flux')}
                    options={[
                      { value: 'coop', label: 'Cooperativa' },
                      { value: 'flux', label: 'Flux Farma' },
                    ]}
                  />
                </Field>
                <Field label="CNPJ">
                  <FormControl value={edit.cnpj || ''} onChange={(e) => set('cnpj', e.target.value)} />
                </Field>
                <Field label="Razão social">
                  <FormControl value={edit.legal_name || ''} onChange={(e) => set('legal_name', e.target.value)} />
                </Field>
                <Field label="Nome fantasia">
                  <FormControl value={edit.trade_name || ''} onChange={(e) => set('trade_name', e.target.value)} />
                </Field>
                <Field label="Inscrição estadual">
                  <FormControl
                    value={edit.state_registration || ''}
                    onChange={(e) => set('state_registration', e.target.value)}
                  />
                </Field>
                <Field label="Inscrição municipal">
                  <FormControl
                    value={edit.municipal_registration || ''}
                    onChange={(e) => set('municipal_registration', e.target.value)}
                  />
                </Field>
                <Field label="Regime tributário">
                  <FormControl value={edit.tax_regime || ''} onChange={(e) => set('tax_regime', e.target.value)} />
                </Field>
                <Field label="Telefone">
                  <FormControl value={edit.phone || ''} onChange={(e) => set('phone', e.target.value)} />
                </Field>
                <Field label="E-mail financeiro">
                  <FormControl
                    value={edit.financial_email || ''}
                    onChange={(e) => set('financial_email', e.target.value)}
                  />
                </Field>
                <Field label="E-mail comercial">
                  <FormControl
                    value={edit.commercial_email || ''}
                    onChange={(e) => set('commercial_email', e.target.value)}
                  />
                </Field>
              </TabsContent>

              <TabsContent value="end" className="mt-4 grid grid-cols-3 gap-3">
                <Field label="CEP">
                  <FormControl value={edit.address_cep || ''} onChange={(e) => set('address_cep', e.target.value)} />
                </Field>
                <Field label="Logradouro" className="col-span-2">
                  <FormControl
                    value={edit.address_street || ''}
                    onChange={(e) => set('address_street', e.target.value)}
                  />
                </Field>
                <Field label="Número">
                  <FormControl
                    value={edit.address_number || ''}
                    onChange={(e) => set('address_number', e.target.value)}
                  />
                </Field>
                <Field label="Bairro">
                  <FormControl
                    value={edit.address_neighborhood || ''}
                    onChange={(e) => set('address_neighborhood', e.target.value)}
                  />
                </Field>
                <Field label="Cidade">
                  <FormControl value={edit.address_city || ''} onChange={(e) => set('address_city', e.target.value)} />
                </Field>
                <Field label="UF">
                  <FormControl
                    value={edit.address_state || ''}
                    onChange={(e) => set('address_state', e.target.value.toUpperCase().slice(0, 2))}
                  />
                </Field>
              </TabsContent>

              <TabsContent value="bank" className="mt-4 grid grid-cols-2 gap-3">
                <Field label="Código banco">
                  <FormControl value={edit.bank_code || ''} onChange={(e) => set('bank_code', e.target.value)} />
                </Field>
                <Field label="Nome banco">
                  <FormControl value={edit.bank_name || ''} onChange={(e) => set('bank_name', e.target.value)} />
                </Field>
                <Field label="Agência">
                  <FormControl value={edit.branch_number || ''} onChange={(e) => set('branch_number', e.target.value)} />
                </Field>
                <div className="grid grid-cols-[1fr_60px] gap-2">
                  <Field label="Conta">
                    <FormControl
                      value={edit.account_number || ''}
                      onChange={(e) => set('account_number', e.target.value)}
                    />
                  </Field>
                  <Field label="Dígito">
                    <FormControl
                      value={edit.account_digit || ''}
                      onChange={(e) => set('account_digit', e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Tipo">
                  <FormSelect
                    value={edit.account_type || 'checking'}
                    onChange={(value) => set('account_type', value as 'checking' | 'savings')}
                    options={[
                      { value: 'checking', label: 'Corrente' },
                      { value: 'savings', label: 'Poupança' },
                    ]}
                  />
                </Field>
                <Field label="Tipo chave PIX">
                  <FormSelect
                    value={edit.pix_key_type || 'cnpj'}
                    onChange={(value) => set('pix_key_type', value)}
                    options={[
                      { value: 'cpf', label: 'CPF' },
                      { value: 'cnpj', label: 'CNPJ' },
                      { value: 'email', label: 'E-mail' },
                      { value: 'telefone', label: 'Telefone' },
                      { value: 'aleatoria', label: 'Aleatória' },
                    ]}
                  />
                </Field>
                <Field label="Chave PIX" className="col-span-2">
                  <FormControl value={edit.pix_key || ''} onChange={(e) => set('pix_key', e.target.value)} />
                </Field>
              </TabsContent>

              <TabsContent value="com" className="mt-4 grid grid-cols-2 gap-3">
                <Field label="% Coop padrão (split)">
                  <FormControl
                    type="number"
                    value={edit.default_split_coop_pct ?? 70}
                    onChange={(e) => set('default_split_coop_pct', Number(e.target.value))}
                  />
                </Field>
                <Field label="% Flux padrão (split)">
                  <FormControl
                    type="number"
                    value={edit.default_split_flux_pct ?? 30}
                    onChange={(e) => set('default_split_flux_pct', Number(e.target.value))}
                  />
                </Field>
                <Field label="Margem de serviço Flux (%)">
                  <FormControl
                    type="number"
                    value={edit.flux_service_margin_pct ?? 0}
                    onChange={(e) => set('flux_service_margin_pct', Number(e.target.value))}
                  />
                </Field>
                <Field label="Cabeçalho fatura" className="col-span-2">
                  <FormControl
                    value={edit.invoice_header_notes || ''}
                    onChange={(e) => set('invoice_header_notes', e.target.value)}
                  />
                </Field>
                <Field label="Rodapé fatura" className="col-span-2">
                  <FormControl
                    value={edit.invoice_footer_notes || ''}
                    onChange={(e) => set('invoice_footer_notes', e.target.value)}
                  />
                </Field>
              </TabsContent>
            </Tabs>
          </BillingDialogContent>
        </Dialog>
      )}
    </BillingSection>
  );
}
