'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Plus, Pencil, Wallet } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { BillingDialogContent, BillingEmptyState, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { createProviderAdvance, fetchInternalProviders, fetchProviderAccounts } from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';

const initialAdvance = {
  provider_id: '',
  description: 'Adiantamento',
  total_cents: 0,
  installment_count: 1,
  start_date: new Date().toISOString().slice(0, 10),
  frequency: 'monthly' as const,
  legal_entity_type: 'coop' as const,
};

export function BillingInternalProvidersPanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advance, setAdvance] = useState(initialAdvance);
  const listQuery = useQuery({ queryKey: ['billing', 'internal-providers'], queryFn: () => fetchInternalProviders(false) });
  const accountsQuery = useQuery({ queryKey: ['billing', 'provider-accounts'], queryFn: () => fetchProviderAccounts() });
  const accounts = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (accountsQuery.data || []).filter((account) => {
      if (!term) return true;
      return (account.billing_internal_providers?.legal_name || '').toLowerCase().includes(term);
    });
  }, [accountsQuery.data, filter]);
  const accountsPagination = useClientPagination(accounts);
  const providers = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (listQuery.data || []).filter((p) => !term || p.legal_name.toLowerCase().includes(term));
  }, [listQuery.data, filter]);
  const providersPagination = useClientPagination(providers);

  useEffect(() => {
    accountsPagination.resetPage();
    providersPagination.resetPage();
  }, [filter]);
  const totals = useMemo(() => {
    return accounts.reduce(
      (acc, account) => {
        acc.open += account.advance_open_cents || 0;
        acc.service += account.service_credit_cents || 0;
        acc.compensated += account.compensated_cents || 0;
        acc.balance += account.balance_cents || 0;
        return acc;
      },
      { open: 0, service: 0, compensated: 0, balance: 0 }
    );
  }, [accounts]);
  const advanceMut = useMutation({
    mutationFn: createProviderAdvance,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'provider-accounts'] });
      setAdvanceOpen(false);
      setAdvance(initialAdvance);
    },
  });

  return (
    <div className="space-y-4">
      <BillingSection
        title="Conta corrente de prestadores"
        desc="Adiantamentos, compensações futuras e saldo líquido por prestador interno."
        icon={Wallet}
        action={
          <div className="flex flex-wrap gap-2">
            <Input className="h-9 w-64" placeholder="Filtrar prestador..." value={filter} onChange={(e) => setFilter(e.target.value)} />
            <Button size="sm" variant="outline" onClick={() => setAdvanceOpen(true)}>
              Novo adiantamento
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-border bg-muted/25 p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Adiantado em aberto</div>
            <div className="mt-1 font-mono text-lg font-semibold">{formatBrlCents(totals.open)}</div>
          </div>
          <div className="rounded-2xl border border-border bg-muted/25 p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Créditos de serviço</div>
            <div className="mt-1 font-mono text-lg font-semibold">{formatBrlCents(totals.service)}</div>
          </div>
          <div className="rounded-2xl border border-border bg-muted/25 p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Compensado</div>
            <div className="mt-1 font-mono text-lg font-semibold">{formatBrlCents(totals.compensated)}</div>
          </div>
          <div className="rounded-2xl border border-border bg-muted/25 p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Saldo líquido</div>
            <div className="mt-1 font-mono text-lg font-semibold">{formatBrlCents(totals.balance)}</div>
          </div>
        </div>
        <div className={billingTableShellClassName + ' mt-4'}>
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
              <tr>
                <th className="px-4 py-3">Prestador</th>
                <th className="px-4 py-3 text-right">Adiantado aberto</th>
                <th className="px-4 py-3 text-right">Serviços</th>
                <th className="px-4 py-3 text-right">Compensado</th>
                <th className="px-4 py-3 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {accountsPagination.pageItems.map((account) => (
                <tr key={account.id} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-2.5 font-medium">{account.billing_internal_providers?.legal_name || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(account.advance_open_cents || 0)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(account.service_credit_cents || 0)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(account.compensated_cents || 0)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold">{formatBrlCents(account.balance_cents || 0)}</td>
                </tr>
              ))}
              {!accounts.length && (
                <tr>
                  <td colSpan={5} className="p-4">
                    <BillingEmptyState>Nenhuma movimentação de prestador registrada.</BillingEmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {accountsPagination.totalItems > accountsPagination.pageSize ? (
            <PaginationControls
              className="px-4 pb-3"
              page={accountsPagination.page}
              pageSize={accountsPagination.pageSize}
              totalItems={accountsPagination.totalItems}
              onPageChange={accountsPagination.setPage}
              itemLabel="contas"
            />
          ) : null}
        </div>
      </BillingSection>

      <BillingSection
        title="Prestadores"
        desc="Cadastros usados para pagamentos administrativos, centros de custo e DRE."
        icon={BriefcaseBusiness}
        action={
          <Link href="/billing/cadastro/prestadores/new" className={buttonVariants({ size: 'sm' })}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Novo prestador
          </Link>
        }
      >
      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">CPF/CNPJ</th>
              <th className="px-4 py-3">Cargo</th>
              <th className="px-4 py-3">Entidade</th>
              <th className="px-4 py-3">Mensal</th>
              <th className="px-4 py-3">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {providersPagination.pageItems.map((p) => (
              <tr key={p.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 font-medium">{p.legal_name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{p.cpf_cnpj || '—'}</td>
                <td className="px-4 py-2.5 text-xs">{p.role_title || '—'}</td>
                <td className="px-4 py-2.5 text-xs uppercase">{p.default_entity}</td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {p.default_monthly_cents ? formatBrlCents(p.default_monthly_cents) : '—'}
                </td>
                <td className="px-4 py-2.5 text-xs">{p.active ? 'Ativo' : 'Inativo'}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/billing/cadastro/prestadores/${p.id}`}
                    className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'px-2')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
            {!providers.length && !listQuery.isLoading ? (
              <tr>
                <td colSpan={7} className="p-4">
                  <BillingEmptyState>Nenhum prestador cadastrado.</BillingEmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {providersPagination.totalItems > providersPagination.pageSize ? (
          <PaginationControls
            className="px-4 pb-3"
            page={providersPagination.page}
            pageSize={providersPagination.pageSize}
            totalItems={providersPagination.totalItems}
            onPageChange={providersPagination.setPage}
            itemLabel="prestadores"
          />
        ) : null}
      </div>
      </BillingSection>

      <Dialog open={advanceOpen} onOpenChange={setAdvanceOpen}>
        <DialogContent className="max-w-3xl border-0 bg-transparent p-0 shadow-none">
          <BillingDialogContent
            title="Novo adiantamento"
            description="Registre o valor adiantado e a agenda de compensação futura."
            footer={
              <>
                <Button variant="outline" onClick={() => setAdvanceOpen(false)}>Cancelar</Button>
                <Button
                  onClick={() => advanceMut.mutate(advance)}
                  disabled={!advance.provider_id || advance.total_cents <= 0 || advanceMut.isPending}
                >
                  Salvar adiantamento
                </Button>
              </>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <BillingField label="Prestador">
                <FormSelect
                  value={advance.provider_id}
                  onChange={(provider_id) => setAdvance({ ...advance, provider_id })}
                  options={(listQuery.data || []).flatMap((p) => (p.id ? [{ value: p.id, label: p.legal_name }] : []))}
                  placeholder="Selecione"
                />
              </BillingField>
              <BillingField label="Descrição">
                <FormControl value={advance.description} onChange={(e) => setAdvance({ ...advance, description: e.target.value })} />
              </BillingField>
              <BillingField label="Valor total">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={advance.total_cents ? String(advance.total_cents / 100) : ''}
                  onChange={(e) => setAdvance({ ...advance, total_cents: Math.round(Number(e.target.value || 0) * 100) })}
                />
              </BillingField>
              <BillingField label="Parcelas">
                <Input
                  type="number"
                  min={1}
                  value={advance.installment_count}
                  onChange={(e) => setAdvance({ ...advance, installment_count: Math.max(1, Number(e.target.value || 1)) })}
                />
              </BillingField>
              <BillingField label="Início do desconto">
                <Input type="date" value={advance.start_date} onChange={(e) => setAdvance({ ...advance, start_date: e.target.value })} />
              </BillingField>
              <BillingField label="Frequência">
                <FormSelect
                  value={advance.frequency}
                  onChange={(frequency) => setAdvance({ ...advance, frequency: frequency as typeof advance.frequency })}
                  options={[
                    { value: 'weekly', label: 'Semanal' },
                    { value: 'biweekly', label: 'Quinzenal' },
                    { value: 'monthly', label: 'Mensal' },
                  ]}
                />
              </BillingField>
            </div>
          </BillingDialogContent>
        </DialogContent>
      </Dialog>
    </div>
  );
}
