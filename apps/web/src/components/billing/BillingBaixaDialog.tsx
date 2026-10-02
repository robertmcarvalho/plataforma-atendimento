'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { BillingDialogContent, BillingField } from '@/components/billing/BillingPrimitives';
import { fetchBankAccounts, fetchLegalEntities } from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  balanceCents: number;
  defaultEntityType?: 'coop' | 'flux';
  costCenterName?: string | null;
  onConfirm: (input: {
    amount_cents: number;
    legal_entity_id: string | null;
    payment_method: string;
    bank_account_id?: string | null;
    card_last_four?: string | null;
    card_brand?: string | null;
  }) => void;
  loading?: boolean;
};

export function BillingBaixaDialog({
  open,
  onOpenChange,
  title,
  balanceCents,
  defaultEntityType = 'coop',
  costCenterName,
  onConfirm,
  loading,
}: Props) {
  const [amount, setAmount] = useState(String((balanceCents / 100).toFixed(2)));
  const [method, setMethod] = useState('pix');
  const [entityId, setEntityId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [cardLastFour, setCardLastFour] = useState('');
  const [cardBrand, setCardBrand] = useState('');

  const entitiesQuery = useQuery({
    queryKey: ['billing', 'legal-entities'],
    queryFn: fetchLegalEntities,
    enabled: open,
  });
  const accountsQuery = useQuery({
    queryKey: ['billing', 'bank-accounts', entityId],
    queryFn: () => fetchBankAccounts({ active: true, legal_entity_id: entityId || undefined }),
    enabled: open && !!entityId,
  });

  const entities = entitiesQuery.data || [];
  const accounts = accountsQuery.data || [];
  const defaultEntity = entities.find((e) => e.entity_type === defaultEntityType);

  const handleOpen = (v: boolean) => {
    if (v) {
      setAmount(String((balanceCents / 100).toFixed(2)));
      const entId = defaultEntity?.id || entities[0]?.id || '';
      setEntityId(entId);
      setBankAccountId('');
      setMethod('pix');
      setCardLastFour('');
      setCardBrand('');
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <BillingDialogContent
        title={title}
        description="Confirme valor, forma de pagamento, entidade e conta bancária."
        className="sm:max-w-md"
        footer={
          <Button
            className="w-full shadow-md"
            onClick={() =>
              onConfirm({
                amount_cents: Math.round(Number(amount.replace(',', '.')) * 100),
                legal_entity_id: entityId || null,
                payment_method: method,
                bank_account_id: bankAccountId || null,
                card_last_four: method === 'credit_card' ? cardLastFour || null : null,
                card_brand: method === 'credit_card' ? cardBrand || null : null,
              })
            }
            disabled={loading || !amount}
          >
            Confirmar baixa
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
            <div className="text-muted-foreground">Saldo em aberto</div>
            <div className="font-mono text-sm font-semibold">{formatBrlCents(balanceCents)}</div>
            <div className="mt-2 border-t border-border/60 pt-2">
              <div className="text-muted-foreground">Centro de custo</div>
              <div className="font-medium">{costCenterName || 'Sem centro de custo informado'}</div>
            </div>
          </div>
          <BillingField label="Valor">
            <FormControl
              type="number"
              inputSize="md"
              step="0.01"
              className="mt-1 w-full"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </BillingField>
          <BillingField label="Forma">
            <FormSelect
              className="mt-1 w-full"
              value={method}
              onChange={setMethod}
              options={[
                { value: 'pix', label: 'PIX' },
                { value: 'transfer', label: 'Transferência' },
                { value: 'credit_card', label: 'Cartão de crédito' },
                { value: 'cash', label: 'Dinheiro' },
                { value: 'other', label: 'Outro' },
              ]}
            />
          </BillingField>
          <BillingField label="Entidade">
            <FormSelect
              className="mt-1 w-full"
              value={entityId}
              onChange={(value) => {
                setEntityId(value);
                setBankAccountId('');
              }}
              options={[
                { value: '', label: '—' },
                ...entities.map((e) => ({
                  value: e.id,
                  label: `${e.entity_type === 'coop' ? 'CoopMob' : 'Flux Farma'} — ${e.trade_name || e.legal_name}`,
                })),
              ]}
            />
          </BillingField>
          {entityId ? (
            <BillingField label="Conta bancária">
              <FormSelect
                className="mt-1 w-full"
                value={bankAccountId}
                onChange={setBankAccountId}
                options={[
                  { value: '', label: 'Conta da entidade (legado)' },
                  ...accounts
                    .filter((a) => Boolean(a.id))
                    .map((a) => ({
                      value: String(a.id),
                      label: `${a.name}${a.is_default ? ' (padrão)' : ''}`,
                    })),
                ]}
              />
            </BillingField>
          ) : null}
          {method === 'credit_card' ? (
            <div className="grid grid-cols-2 gap-2">
              <BillingField label="Últimos 4 dígitos">
                <FormControl
                  className="mt-1 w-full"
                  maxLength={4}
                  value={cardLastFour}
                  onChange={(e) => setCardLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </BillingField>
              <BillingField label="Bandeira">
                <FormControl className="mt-1 w-full" value={cardBrand} onChange={(e) => setCardBrand(e.target.value)} />
              </BillingField>
            </div>
          ) : null}
        </div>
      </BillingDialogContent>
    </Dialog>
  );
}
