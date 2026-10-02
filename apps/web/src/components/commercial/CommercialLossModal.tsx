'use client';

import { useState } from 'react';
import { formTextareaClassName } from '@/components/form/FormControl';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import type { LossReason } from '@/lib/commercial/types';
import {
  commercialReviveOutlineButtonClassName,
  commercialReviveDestructiveButtonClassName,
} from '@/components/commercial/CommercialRevivePrimitives';

type Props = {
  open: boolean;
  reasons: LossReason[];
  onClose: () => void;
  onConfirm: (reasonId: string, notes: string) => void;
};

export function CommercialLossModal({ open, reasons, onClose, onConfirm }: Props) {
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? '');
  const [notes, setNotes] = useState('');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loss-modal-title"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id="loss-modal-title" className="text-sm font-semibold">
            Marcar como perdido
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Selecione o motivo e registre o contexto.</p>
        </div>
        <div className="space-y-4 p-5">
          <div className="space-y-1.5">
            <label htmlFor="loss-reason" className="text-xs font-medium text-muted-foreground">
              Motivo
            </label>
            <FormSearchCombobox
              value={reasonId}
              onChange={setReasonId}
              placeholder="Buscar motivo…"
              options={reasons.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="loss-notes" className="text-xs font-medium text-muted-foreground">
              Observações
            </label>
            <textarea
              id="loss-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={formTextareaClassName}
              placeholder="Contexto adicional para o time comercial..."
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className={commercialReviveOutlineButtonClassName}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={!reasonId}
              onClick={() => {
                onConfirm(reasonId, notes);
                setNotes('');
                onClose();
              }}
              className={commercialReviveDestructiveButtonClassName}
            >
              Confirmar perda
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
