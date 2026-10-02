'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import {
  BillingDialogContent,
  BillingEmptyState,
  BillingField,
  BillingSection,
  BillingSwitchRow,
} from '@/components/billing/BillingPrimitives';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import { PaginationControls } from '@/components/ui/PaginationControls';
import {
  fetchBillingSuppliers,
  saveBillingSupplier,
  type BillingSupplier,
} from '@/lib/billing/billingApi';

type EditState = Partial<BillingSupplier> & { name: string };

const empty: EditState = {
  name: '',
  cpf_cnpj: '',
  pix_key: '',
  pix_key_type: 'cpf',
  category: '',
  active: true,
};

export function BillingSuppliersPanel() {
  const qc = useQueryClient();
  const listQuery = useQuery({ queryKey: ['billing', 'suppliers'], queryFn: fetchBillingSuppliers });
  const [edit, setEdit] = useState<EditState | null>(null);

  const saveMut = useMutation({
    mutationFn: (row: EditState) => saveBillingSupplier(row),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'suppliers'] });
      setEdit(null);
    },
  });

  const rows = listQuery.data || [];
  const pagination = useClientPagination(rows);

  return (
    <BillingSection
      title="Fornecedores"
      desc="Fornecedores para contas a pagar e beneficiários externos."
      icon={Truck}
      action={
        <Button size="sm" onClick={() => setEdit({ ...empty })}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Novo fornecedor
        </Button>
      }
    >

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">CPF/CNPJ</th>
              <th className="px-4 py-3">PIX</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((s) => (
              <tr key={s.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 font-medium">{s.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{s.cpf_cnpj || '—'}</td>
                <td className="px-4 py-2.5 text-xs">{s.pix_key || '—'}</td>
                <td className="px-4 py-2.5 text-xs">{s.category || '—'}</td>
                <td className="px-4 py-2.5 text-xs">{s.active ? 'Ativo' : 'Inativo'}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ ...s })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="p-4">
                  <BillingEmptyState>Nenhum fornecedor cadastrado.</BillingEmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {pagination.totalItems > pagination.pageSize ? (
          <PaginationControls
            className="px-4 pb-3"
            page={pagination.page}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
            onPageChange={pagination.setPage}
            itemLabel="fornecedores"
          />
        ) : null}
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <BillingDialogContent
          title={edit?.id ? 'Editar fornecedor' : 'Novo fornecedor'}
          description="Cadastre dados de pagamento para contas a pagar e beneficiários externos."
          footer={
            <>
              <Button variant="outline" className="flex-1" onClick={() => setEdit(null)}>
                Cancelar
              </Button>
              <Button className="flex-1 shadow-md" onClick={() => edit && saveMut.mutate(edit)} disabled={!edit?.name?.trim() || saveMut.isPending}>
                Salvar
              </Button>
            </>
          }
        >
          {edit ? (
            <div className="space-y-4">
              <BillingField label="Nome">
                <FormControl className="mt-1 w-full" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </BillingField>
              <div className="grid grid-cols-2 gap-3">
                <BillingField label="CPF/CNPJ">
                  <FormControl
                    className="mt-1 w-full"
                    value={edit.cpf_cnpj || ''}
                    onChange={(e) => setEdit({ ...edit, cpf_cnpj: e.target.value })}
                  />
                </BillingField>
                <BillingField label="Categoria">
                  <FormControl
                    className="mt-1 w-full"
                    value={edit.category || ''}
                    onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                  />
                </BillingField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <BillingField label="Chave PIX">
                  <FormControl
                    className="mt-1 w-full"
                    value={edit.pix_key || ''}
                    onChange={(e) => setEdit({ ...edit, pix_key: e.target.value })}
                  />
                </BillingField>
                <BillingField label="Tipo PIX">
                  <FormSelect
                    className="mt-1 w-full"
                    value={edit.pix_key_type || 'cpf'}
                    onChange={(value) => setEdit({ ...edit, pix_key_type: value })}
                    options={[
                      { value: 'cpf', label: 'CPF' },
                      { value: 'cnpj', label: 'CNPJ' },
                      { value: 'email', label: 'E-mail' },
                      { value: 'phone', label: 'Telefone' },
                      { value: 'random', label: 'Aleatória' },
                    ]}
                  />
                </BillingField>
              </div>
              <BillingSwitchRow
                checked={edit.active !== false}
                onChange={(checked) => setEdit({ ...edit, active: checked })}
                label="Fornecedor ativo"
              />
            </div>
          ) : null}
        </BillingDialogContent>
      </Dialog>
    </BillingSection>
  );
}
