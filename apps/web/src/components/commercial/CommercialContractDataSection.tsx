'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Link2 } from 'lucide-react';
import { CommercialContractLeadSummary } from '@/components/commercial/CommercialContractLeadSummary';
import { CommercialContractSellerForm } from '@/components/commercial/CommercialContractSellerForm';
import { useCreateLeadDataRequest } from '@/lib/commercial/useCommercialQueries';
import { whatsAppContractDataSnippet } from '@/lib/commercial/commercialContractSnippets';
import {
  contractOnboardingStatusLabel,
  hasSubmittedContractForm,
} from '@/lib/commercial/contractOnboardingDisplay';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { buttonVariants } from '@/components/ui/button';
import type { CommercialLead } from '@/lib/commercial/types';

type Props = {
  lead: CommercialLead;
};

export function CommercialContractDataSection({ lead }: Props) {
  const createLink = useCreateLeadDataRequest();
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onboarding = lead.contract_onboarding;
  const statusLabel = contractOnboardingStatusLabel(onboarding?.status);
  const leadSubmitted = hasSubmittedContractForm(lead);
  const complete = lead.contract_onboarding_complete;

  const handleGenerate = async () => {
    setErr(null);
    setCopyMsg(null);
    try {
      const res = await createLink.mutateAsync(lead.id);
      setLastUrl(res.url);
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(label);
      setTimeout(() => setCopyMsg(null), 2500);
    } catch {
      setCopyMsg('Não foi possível copiar');
    }
  };

  const snippet =
    lastUrl &&
    whatsAppContractDataSnippet({
      contactName: lead.contact_name ?? '',
      tradeName: lead.trade_name,
      link: lastUrl,
    });

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Dados para contrato</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              O lead preenche representante, CNPJ, endereço e contatos. Você complementa cadastro, financeiro,
              coleta e horários após o envio.
            </p>
          </div>
          {complete ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2 py-1 text-xs font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Completo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-1 text-xs font-medium text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              {statusLabel}
            </span>
          )}
        </div>

        {!leadSubmitted ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={createLink.isPending}
              className={buttonVariants()}
            >
              <Link2 className="h-4 w-4" />
              {createLink.isPending ? 'Gerando…' : 'Gerar link de preenchimento'}
            </button>
            {lastUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => void copyText(lastUrl, 'Link copiado')}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  <Copy className="h-4 w-4" />
                  Copiar link
                </button>
                {snippet ? (
                  <button
                    type="button"
                    onClick={() => void copyText(snippet, 'Mensagem copiada')}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    <Copy className="h-4 w-4" />
                    Copiar WhatsApp
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {lastUrl ? (
          <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{lastUrl}</p>
        ) : null}
        {copyMsg ? <p className="mt-1 text-xs text-success">{copyMsg}</p> : null}
        {err ? <p className="mt-1 text-xs text-destructive">{err}</p> : null}
      </section>

      {leadSubmitted ? <CommercialContractLeadSummary lead={lead} /> : null}
      <CommercialContractSellerForm lead={lead} />
    </div>
  );
}
