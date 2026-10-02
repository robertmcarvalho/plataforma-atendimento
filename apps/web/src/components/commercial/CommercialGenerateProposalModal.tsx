'use client';

import { useEffect, useState } from 'react';
import { formatDealValueCents } from '@/lib/commercial/commercialFormat';
import {
  custoFarmaciaFromSnapshot,
  isMinimoGarantido,
  margemFluxDisplay,
  valorLeadDisplayCents,
} from '@/lib/commercial/commercialFinanceDisplay';
import type { OperationalDimensioningResult, PropostaComercialSnapshot } from '@/lib/commercial/types';
import { BrCentsInput } from '@/components/form/BrCentsInput';
import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { cn } from '@/lib/utils';
import {
  commercialReviveFieldClassName,
  commercialReviveOutlineButtonClassName,
  commercialRevivePrimaryButtonClassName,
} from '@/components/commercial/CommercialRevivePrimitives';

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    package_name: string;
    setup_cents: number;
    setup_pagamento?: 'a_vista' | 'parcelado';
    setup_parcelas?: number | null;
    notes?: string;
  }) => void | Promise<void>;
  dimensionamento: OperationalDimensioningResult;
  propostaComercial?: PropostaComercialSnapshot | null;
  loading?: boolean;
};

export function CommercialGenerateProposalModal({
  open,
  onClose,
  onConfirm,
  dimensionamento,
  propostaComercial,
  loading,
}: Props) {
  const d = dimensionamento;
  const [packageName, setPackageName] = useState(propostaComercial?.package_name ?? 'Pacote padrão');
  const [setupCents, setSetupCents] = useState<number | null>(propostaComercial?.setup_cents ?? 0);
  const [notes, setNotes] = useState(propostaComercial?.setup_observacao ?? '');

  useEffect(() => {
    if (!open) return;
    setPackageName(propostaComercial?.package_name ?? 'Pacote padrão');
    setSetupCents(propostaComercial?.setup_cents ?? 0);
    setNotes(propostaComercial?.setup_observacao ?? '');
  }, [open, propostaComercial]);

  if (!open) return null;

  const custoFarmacia = custoFarmaciaFromSnapshot(d);
  const isMg = isMinimoGarantido(d.modelo_cobranca);
  const margemSem = margemFluxDisplay(d);
  const valorLead = valorLeadDisplayCents(d);

  const handleSubmit = () => {
    void onConfirm({
      package_name: packageName.trim() || 'Pacote padrão',
      setup_cents: setupCents ?? 0,
      setup_pagamento: propostaComercial?.setup_pagamento ?? 'a_vista',
      setup_parcelas:
        propostaComercial?.setup_pagamento === 'parcelado'
          ? propostaComercial.setup_parcelas ?? 2
          : undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Gerar proposta</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Confira os valores do cenário selecionado. Em seguida você editará o documento e gerará o PDF para o cliente.
          </p>
        </div>

        <div className="space-y-4 p-5">
        <div className={cn(commercialReviveFieldClassName, 'p-3 text-sm')}>
          {d.cenario_selecionado_titulo ? (
            <p className="font-medium">{d.cenario_selecionado_titulo}</p>
          ) : null}
          <dl className="mt-2 space-y-1 text-xs">
            <Row label="Custo farmácia/semana" value={brl(custoFarmacia)} />
            {!isMg ? (
              <Row label="Taxas potenciais/semana" value={brl(d.receita_semanal_estimada)} />
            ) : null}
            <Row label="Margem Flux (30%)" value={brl(margemSem)} />
            <Row label="Valor lead (12m)" value={formatDealValueCents(valorLead)} />
          </dl>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-muted-foreground">Nome do pacote</span>
            <FormControl
              inputSize="md"
              value={packageName}
              onChange={(e) => setPackageName(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Valor setup</span>
            <BrCentsInput
              value={setupCents}
              onChange={setSetupCents}
              className="mt-1"
            />
          </label>
          {propostaComercial?.setup_pagamento === 'parcelado' ? (
            <p className="text-xs text-muted-foreground">
              Pagamento: parcelado em {propostaComercial.setup_parcelas ?? 2}x (definido na viabilidade)
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Pagamento: à vista (definido na viabilidade)</p>
          )}
          <label className="block text-sm">
            <span className="text-muted-foreground">O que inclui o setup (opcional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={cn(formTextareaClassName, 'mt-1')}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className={commercialReviveOutlineButtonClassName} disabled={loading}>
            Cancelar
          </button>
          <button type="button" onClick={handleSubmit} className={commercialRevivePrimaryButtonClassName} disabled={loading}>
            {loading ? 'Criando…' : 'Criar proposta'}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
