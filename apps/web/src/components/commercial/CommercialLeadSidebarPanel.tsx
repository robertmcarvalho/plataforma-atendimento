'use client';

import Link from 'next/link';
import { ArrowRight, MessageCircle, Trophy, X } from 'lucide-react';
import { CommercialReviveField, CommercialReviveIconButton } from '@/components/commercial/CommercialRevivePrimitives';
import { CommercialConvertWizard } from '@/components/commercial/CommercialConvertWizard';
import { CommercialLossModal } from '@/components/commercial/CommercialLossModal';
import { ownerName } from '@/lib/commercial/commercialOwners';
import { commercialSourceLabel, maskCnpj } from '@/lib/commercial/commercialFormat';
import { formatBrazilPhone } from '@/lib/brFormat';
import {
  useCommercialOwners,
  useConvertLead,
  useFieldDefinitions,
  useLead,
  useLossReasons,
  useLoseLead,
  usePipelineStages,
} from '@/lib/commercial/useCommercialQueries';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { useState } from 'react';
import { CommercialProspeccaoModal } from '@/components/commercial/CommercialProspeccaoModal';
import { cn } from '@/lib/utils';

type Props = {
  leadId: string;
  onOpenChat?: () => void;
};

export function CommercialLeadSidebarPanel({ leadId, onOpenChat }: Props) {
  const { data: lead } = useLead(leadId);
  const { data: stages = [] } = usePipelineStages();
  const { data: owners = [] } = useCommercialOwners();
  const { data: lossReasons = [] } = useLossReasons();
  const { data: fieldDefinitions = [] } = useFieldDefinitions();
  const convertLead = useConvertLead();
  const loseLead = useLoseLead();

  const [convertOpen, setConvertOpen] = useState(false);
  const [lossOpen, setLossOpen] = useState(false);
  const [prospeccaoOpen, setProspeccaoOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!lead) {
    return <div className="text-xs text-muted-foreground">Carregando…</div>;
  }

  const stage = stages.find((s) => s.id === lead.stage_id);
  const isTerminal = stage?.is_won || stage?.is_lost;

  const openWhatsApp = () => {
    if (onOpenChat) {
      onOpenChat();
      return;
    }
    if (!lead.phone?.trim()) {
      setActionError('Lead sem telefone cadastrado para WhatsApp.');
      return;
    }
    setActionError(null);
    setProspeccaoOpen(true);
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">
              {lead.city}/{lead.state}
            </div>
            <h2 className="text-lg font-semibold tracking-tight">{lead.trade_name}</h2>
          </div>
          <Link
            href={`/commercial/leads/${lead.id}`}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-[11px] transition-colors hover:bg-sidebar-accent/60',
            )}
          >
            Abrir ficha <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <CommercialReviveField label="Decisor" value={lead.contact_name ?? '—'} />
          <CommercialReviveField label="WhatsApp" value={formatBrazilPhone(lead.phone)} mono />
          <CommercialReviveField label="Estágio" value={stage?.name ?? '—'} />
          <CommercialReviveField label="Owner" value={ownerName(lead.owner_id, owners)} />
          {lead.monthly_deliveries ? (
            <CommercialReviveField label="Entregas/mês" value={String(lead.monthly_deliveries)} mono />
          ) : null}
          {lead.drivers_count ? (
            <CommercialReviveField label="Entregadores" value={String(lead.drivers_count)} mono />
          ) : null}
          {lead.cnpj ? (
            <CommercialReviveField label="CNPJ" value={maskCnpj(lead.cnpj)} mono className="col-span-2" />
          ) : null}
          <CommercialReviveField label="Origem" value={commercialSourceLabel(lead.source)} />
        </div>

        {lead.notes ? (
          <div className="mt-4 rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground">
            {lead.notes}
          </div>
        ) : null}

        {actionError ? <p className="mt-3 text-xs text-destructive">{actionError}</p> : null}

        <div className="mt-auto pt-5">
          <div className="grid grid-cols-3 gap-2">
            <CommercialReviveIconButton icon={MessageCircle} variant="primary" onClick={() => void openWhatsApp()}>
              WhatsApp
            </CommercialReviveIconButton>
            {!isTerminal ? (
              <>
                <CommercialReviveIconButton icon={Trophy} variant="success" onClick={() => setConvertOpen(true)}>
                  Ganho
                </CommercialReviveIconButton>
                <CommercialReviveIconButton icon={X} variant="destructive" onClick={() => setLossOpen(true)}>
                  Perdido
                </CommercialReviveIconButton>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <CommercialConvertWizard
        lead={lead}
        fieldDefinitions={fieldDefinitions}
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        onConfirm={async () => {
          const res = await convertLead.mutateAsync(leadId);
          return res.pharmacy_id;
        }}
      />
      <CommercialLossModal
        open={lossOpen}
        reasons={lossReasons}
        onClose={() => setLossOpen(false)}
        onConfirm={(reasonId, notes) => {
          void loseLead.mutateAsync({ id: leadId, loss_reason_id: reasonId, notes });
        }}
      />
      <CommercialProspeccaoModal
        open={prospeccaoOpen}
        onClose={() => setProspeccaoOpen(false)}
        leadId={leadId}
        tradeName={lead.trade_name}
        contactName={lead.contact_name}
        phone={lead.phone}
      />
    </>
  );
}
