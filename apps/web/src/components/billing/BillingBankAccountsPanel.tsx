'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { BillingEmptyState, BillingField, BillingSection, BillingSwitchRow } from '@/components/billing/BillingPrimitives';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import {
  fetchBankAccounts,
  fetchLegalEntities,
  saveBankAccount,
  type BillingBankAccount,
} from '@/lib/billing/billingApi';

const emptyAccount = (legalEntityId: string): BillingBankAccount => ({
  legal_entity_id: legalEntityId,
  name: '',
  bank_code: '',
  bank_name: '',
  branch_number: '',
  account_number: '',
  account_digit: '',
  account_type: 'checking',
  pix_key: '',
  pix_key_type: '',
  is_default: false,
  active: true,
  pix_export_template: 'generic',
  notes: '',
});

function entityLabel(entityType: string | undefined) {
  if (entityType === 'coop') return 'CoopMob';
  if (entityType === 'flux') return 'Flux Farma';
  return entityType || '—';
}

export function BillingBankAccountsPanel() {
  const qc = useQueryClient();
  const entitiesQuery = useQuery({ queryKey: ['billing', 'legal-entities'], queryFn: fetchLegalEntities });
  const accountsQuery = useQuery({ queryKey: ['billing', 'bank-accounts'], queryFn: () => fetchBankAccounts() });
  const [editing, setEditing] = useState<BillingBankAccount | null>(null);

  const saveMut = useMutation({
    mutationFn: () => saveBankAccount(editing!),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'bank-accounts'] });
      setEditing(null);
    },
  });

  const entities = entitiesQuery.data || [];
  const accounts = accountsQuery.data || [];
  const pagination = useClientPagination(accounts);
  const hasEntities = entities.length > 0;
  const entitiesLoading = entitiesQuery.isLoading;
  const isEdit = Boolean(editing?.id);

  return (
    <BillingSection
      title="Contas bancárias"
      desc="Contas usadas para exportação PIX e liquidação de pagamentos."
      icon={Banknote}
      action={
        <Button
          size="sm"
          disabled={!hasEntities || entitiesLoading}
          title={!hasEntities && !entitiesLoading ? 'Cadastre uma entidade (CoopMob ou Flux Farma) antes de criar contas.' : undefined}
          onClick={() => setEditing(emptyAccount(entities[0]?.id || ''))}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Nova conta
        </Button>
      }
    >
      {!entitiesLoading && !hasEntities ? (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
          Cadastre primeiro uma entidade em{' '}
          <Link href="/billing/config?tab=entidades" className="font-medium underline underline-offset-2">
            Configurações → Entidades
          </Link>{' '}
          (CoopMob e/ou Flux Farma). Sem entidade vinculada, não é possível criar contas bancárias.
        </div>
      ) : null}

      {entitiesQuery.isError ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Não foi possível carregar as entidades. Verifique sua conexão e permissões, depois recarregue a página.
        </div>
      ) : null}

      {editing ? (
        <div className="mb-4 rounded-xl border border-border bg-background/50 p-4">
          <div className="mb-3 text-sm font-semibold">{isEdit ? 'Editar conta bancária' : 'Nova conta bancária'}</div>
          <div className="grid gap-3 md:grid-cols-2">
            <BillingField label="Entidade">
              <FormSelect
                className="mt-1 w-full"
                value={editing.legal_entity_id}
                onChange={(value) => setEditing({ ...editing, legal_entity_id: value })}
                options={entities.map((e) => ({
                  value: e.id,
                  label: entityLabel(e.entity_type),
                }))}
              />
            </BillingField>
            <BillingField label="Nome da conta" required>
              <FormControl
                className="mt-1 w-full"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </BillingField>
            <BillingField label="Código do banco">
              <FormControl
                className="mt-1 w-full"
                value={editing.bank_code || ''}
                onChange={(e) => setEditing({ ...editing, bank_code: e.target.value })}
                placeholder="Ex.: 104"
              />
            </BillingField>
            <BillingField label="Nome do banco">
              <FormControl
                className="mt-1 w-full"
                value={editing.bank_name || ''}
                onChange={(e) => setEditing({ ...editing, bank_name: e.target.value })}
              />
            </BillingField>
            <BillingField label="Agência">
              <FormControl
                className="mt-1 w-full"
                value={editing.branch_number || ''}
                onChange={(e) => setEditing({ ...editing, branch_number: e.target.value })}
              />
            </BillingField>
            <BillingField label="Conta">
              <FormControl
                className="mt-1 w-full"
                value={editing.account_number || ''}
                onChange={(e) => setEditing({ ...editing, account_number: e.target.value })}
              />
            </BillingField>
            <BillingField label="Dígito">
              <FormControl
                className="mt-1 w-full"
                value={editing.account_digit || ''}
                onChange={(e) => setEditing({ ...editing, account_digit: e.target.value })}
              />
            </BillingField>
            <BillingField label="Tipo de conta">
              <FormSelect
                className="mt-1 w-full"
                value={editing.account_type || 'checking'}
                onChange={(value) =>
                  setEditing({ ...editing, account_type: value as BillingBankAccount['account_type'] })
                }
                options={[
                  { value: 'checking', label: 'Corrente' },
                  { value: 'savings', label: 'Poupança' },
                ]}
              />
            </BillingField>
            <BillingField label="Chave PIX">
              <FormControl
                className="mt-1 w-full"
                value={editing.pix_key || ''}
                onChange={(e) => setEditing({ ...editing, pix_key: e.target.value })}
              />
            </BillingField>
            <BillingField label="Tipo da chave PIX">
              <FormControl
                className="mt-1 w-full"
                value={editing.pix_key_type || ''}
                onChange={(e) => setEditing({ ...editing, pix_key_type: e.target.value })}
                placeholder="cnpj, email, phone, random…"
              />
            </BillingField>
            <BillingField label="Template export PIX">
              <FormSelect
                className="mt-1 w-full"
                value={editing.pix_export_template}
                onChange={(value) =>
                  setEditing({ ...editing, pix_export_template: value as BillingBankAccount['pix_export_template'] })
                }
                options={[
                  { value: 'generic', label: 'Genérico (CSV)' },
                  { value: 'itau', label: 'Itaú' },
                  { value: 'bradesco', label: 'Bradesco' },
                  { value: 'santander', label: 'Santander' },
                  { value: 'bb', label: 'Banco do Brasil' },
                  { value: 'inter', label: 'Inter' },
                  { value: 'nubank', label: 'Nubank' },
                  { value: 'c6', label: 'C6 Bank (XLSX — PIX chave)' },
                ]}
              />
            </BillingField>
            <BillingField label="Observações">
              <FormControl
                className="mt-1 w-full"
                value={editing.notes || ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
            </BillingField>
            <div className="grid gap-2 md:col-span-2 md:grid-cols-2">
              <BillingSwitchRow
                checked={editing.is_default}
                onChange={(checked) => setEditing({ ...editing, is_default: checked })}
                label="Conta padrão"
              />
              <BillingSwitchRow
                checked={editing.active}
                onChange={(checked) => setEditing({ ...editing, active: checked })}
                label="Conta ativa"
              />
            </div>
          </div>
          {saveMut.isError ? (
            <p className="mt-3 text-sm text-destructive">
              {(saveMut.error as Error)?.message || 'Não foi possível salvar a conta bancária.'}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => saveMut.mutate()}
              disabled={!editing.name.trim() || !editing.legal_entity_id || saveMut.isPending}
            >
              {saveMut.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      ) : null}

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Conta</th>
              <th className="px-4 py-3">Entidade</th>
              <th className="px-4 py-3">Banco</th>
              <th className="px-4 py-3">Agência / Conta</th>
              <th className="px-4 py-3">Template PIX</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((a) => (
              <tr key={a.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 font-medium">
                  {a.name}
                  {a.is_default ? <span className="ml-1 text-[10px] text-primary">padrão</span> : null}
                </td>
                <td className="px-4 py-2.5 text-xs">{entityLabel(a.legal_entity?.entity_type)}</td>
                <td className="px-4 py-2.5 text-xs">{a.bank_name || a.bank_code || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {[a.branch_number, [a.account_number, a.account_digit].filter(Boolean).join('-')]
                    .filter(Boolean)
                    .join(' / ') || '—'}
                </td>
                <td className="px-4 py-2.5 text-xs">{a.pix_export_template}</td>
                <td className="px-4 py-2.5 text-xs">{a.active ? 'Ativa' : 'Inativa'}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Editar conta"
                    onClick={() => setEditing({ ...a })}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Editar
                  </Button>
                </td>
              </tr>
            ))}
            {!accounts.length && !accountsQuery.isLoading ? (
              <tr>
                <td colSpan={7} className="p-4">
                  <BillingEmptyState>
                    {hasEntities
                      ? 'Nenhuma conta cadastrada. Use “Nova conta” ou os dados bancários da entidade.'
                      : 'Nenhuma conta cadastrada. Cadastre uma entidade antes de criar contas bancárias.'}
                  </BillingEmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {pagination.totalItems > pagination.pageSize ? (
          <PaginationControls
            className="px-4 pb-3"
            page={pagination.page}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
            onPageChange={pagination.setPage}
            itemLabel="contas"
          />
        ) : null}
      </div>
    </BillingSection>
  );
}
