'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, X } from 'lucide-react';
import { iconButtonHover } from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import type { CommercialLead } from '@/lib/commercial/types';
import type { FieldDefinition } from '@/lib/commercial/types';
import { prefillDisplayRows, mapLeadToPharmacyPrefill } from '@/lib/commercial/pharmacyPrefill';
import { buttonVariants } from '@/components/ui/button';
import {
  commercialReviveFieldClassName,
  commercialReviveOutlineButtonClassName,
  commercialRevivePrimaryButtonClassName,
  commercialReviveSuccessButtonClassName,
} from '@/components/commercial/CommercialRevivePrimitives';

type Props = {
  lead: CommercialLead;
  fieldDefinitions: FieldDefinition[];
  open: boolean;
  onClose: () => void;
  onConfirm: () => string | Promise<string>;
};

export function CommercialConvertWizard({ lead, fieldDefinitions, open, onClose, onConfirm }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [pharmacyId, setPharmacyId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  if (!open) return null;

  const previewPrefill = mapLeadToPharmacyPrefill(lead, 'preview', fieldDefinitions);
  const rows = prefillDisplayRows(previewPrefill);
  const onboardingBlocked = !lead.contract_onboarding_complete;

  const handleConfirm = async () => {
    setConfirmError(null);
    if (onboardingBlocked) {
      setConfirmError(
        'Complete o onboarding de contrato na aba Resumo (dados do lead e complemento do vendedor) antes de marcar como ganho.',
      );
      return;
    }
    try {
      const id = await onConfirm();
      setPharmacyId(id);
      setStep(2);
    } catch (e) {
      setConfirmError(apiErrorMessage(e, 'Não foi possível converter o lead.'));
    }
  };

  const handleClose = () => {
    setStep(1);
    setPharmacyId(null);
    setConfirmError(null);
    onClose();
  };

  const openPharmacyForm = () => {
    const id = pharmacyId;
    handleClose();
    if (id && id !== 'preview') {
      router.push(`/pharmacies/${id}`);
    } else {
      router.push('/pharmacies/new?from_commercial=1');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-xs text-muted-foreground">Conversão comercial</p>
            <h2 className="text-lg font-semibold">Marcar como ganho</h2>
          </div>
          <button type="button" onClick={handleClose} className={iconButtonHover} aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 1 ? (
          <div className="space-y-4 px-5 py-5">
            <p className="text-sm text-muted-foreground">
              O cadastro operacional da farmácia será criado automaticamente com os dados abaixo (mapeados do lead).
              Você poderá complementar líder, taxas e horários em seguida.
            </p>
            <dl className={cn('grid gap-2 text-sm', commercialReviveFieldClassName, 'p-4')}>
              {rows.map((row) => (
                <div key={row.label} className="grid gap-0.5 sm:grid-cols-[140px_1fr]">
                  <dt className="text-xs text-muted-foreground">{row.label}</dt>
                  <dd className="font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
            {onboardingBlocked ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
                Onboarding de contrato incompleto. Preencha os dados na ficha do lead (aba Resumo → Contrato) e salve o
                complemento do vendedor.
              </div>
            ) : null}
            {confirmError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {confirmError}
              </div>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" onClick={handleClose} className={commercialReviveOutlineButtonClassName}>
                Cancelar
              </button>
              <button type="button" onClick={() => void handleConfirm()} className={commercialReviveSuccessButtonClassName}>
                Confirmar conversão
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
            <div>
              <h3 className="text-lg font-semibold">Farmácia criada automaticamente</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                ID simulado: {pharmacyId}. Formulário operacional abrirá com campos pré-preenchidos.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button type="button" onClick={openPharmacyForm} className={commercialRevivePrimaryButtonClassName}>
                Completar cadastro operacional
              </button>
              <Link href={`/commercial/leads/${lead.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Voltar à ficha
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
