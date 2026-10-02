'use client';

import Link from 'next/link';
import { Clock, ClipboardList, MapPin, MessageCircle, User } from 'lucide-react';
import { ownerInitials, ownerName } from '@/lib/commercial/commercialOwners';
import type { CommercialOwner } from '@/lib/commercial/commercialApi';
import { CommercialTemperatureBadge } from '@/components/commercial/CommercialTemperatureBadge';
import { CommercialAiScoreChip } from '@/components/commercial/CommercialAiScoreChip';
import { commercialSourceLabel, daysInStage, formatDealValueCents, formatShortDate } from '@/lib/commercial/commercialFormat';
import { isStagnantLead } from '@/lib/commercial/commercialScoring';
import { hasOperationalSnapshot } from '@/lib/commercial/commercialStageRules';
import { leadDealValueCents } from '@/lib/commercial/commercialLeadDisplay';
import {
  contractOnboardingStatusLabel,
  hasSubmittedContractForm,
} from '@/lib/commercial/contractOnboardingDisplay';
import type { CommercialLead, CommercialStage } from '@/lib/commercial/types';
import { cn } from '@/lib/utils';

type Props = {
  lead: CommercialLead;
  owners?: CommercialOwner[];
  stage?: CommercialStage;
  allStages?: CommercialStage[];
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

function slaTone(lastMessageAt?: string) {
  if (!lastMessageAt) return null;
  const hours = (Date.now() - new Date(lastMessageAt).getTime()) / 3600000;
  if (hours < 24) return { label: 'SLA OK', className: 'text-success' };
  if (hours < 72) return { label: 'Follow-up', className: 'text-warning' };
  return { label: 'Atrasado', className: 'text-destructive' };
}

export function CommercialLeadCard({ lead, owners = [], stage, allStages, compact, draggable, onDragStart, onDragEnd }: Props) {
  const owner = ownerName(lead.owner_id, owners);
  const initials = ownerInitials(lead.owner_id, owners);
  const sla = slaTone(lead.last_message_at);
  const stagnant = allStages ? isStagnantLead(lead, allStages) : false;
  const contractSubmitted = hasSubmittedContractForm(lead) && !stage?.is_lost;

  return (
    <Link
      href={`/commercial/leads/${lead.id}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', lead.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'block rounded-lg border border-border bg-surface-elevated p-3 transition-colors hover:bg-sidebar-accent/60',
        draggable && 'cursor-grab active:cursor-grabbing',
        compact && 'p-2.5',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-foreground">{lead.trade_name}</p>
          {lead.contact_name ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{lead.contact_name}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <CommercialTemperatureBadge lead={lead} stage={stage} />
          <CommercialAiScoreChip lead={lead} stage={stage} />
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary"
            title={owner}
          >
            {initials}
          </span>
        </div>
      </div>

      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
          <span>
            {lead.city}/{lead.state}
          </span>
        </div>
        {hasOperationalSnapshot(lead) && leadDealValueCents(lead) ? (
          <p className="text-foreground">
            <span className="text-muted-foreground">Valor lead (12m): </span>
            <span className="font-medium">{formatDealValueCents(leadDealValueCents(lead))}</span>
          </p>
        ) : null}
        {lead.expected_close_at ? (
          <p>Fecha {formatShortDate(lead.expected_close_at)}</p>
        ) : null}
        {lead.monthly_deliveries ? (
          <p>{lead.monthly_deliveries.toLocaleString('pt-BR')} entregas/mês</p>
        ) : null}
        <div className="flex items-center gap-1.5">
          <User className="h-3 w-3 shrink-0" aria-hidden />
          <span>{owner}</span>
        </div>
        {lead.last_message_at ? (
          <div className="flex items-center gap-1.5 text-primary">
            <MessageCircle className="h-3 w-3 shrink-0" aria-hidden />
            <span>Msg recente</span>
          </div>
        ) : null}
        {sla ? (
          <div className={cn('flex items-center gap-1.5', sla.className)}>
            <Clock className="h-3 w-3 shrink-0" aria-hidden />
            <span>{sla.label}</span>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {commercialSourceLabel(lead.source)}
        </span>
        <span className="text-[10px] text-muted-foreground">{daysInStage(lead.updated_at)} no estágio</span>
        {stagnant ? (
          <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">Estagnado</span>
        ) : null}
        {contractSubmitted ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
              lead.contract_onboarding_complete ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary',
            )}
            title="Formulário de contrato"
          >
            <ClipboardList className="h-3 w-3" aria-hidden />
            {lead.contract_onboarding_complete ? 'Contrato OK' : contractOnboardingStatusLabel(lead.contract_onboarding?.status)}
          </span>
        ) : null}
        {lead.tags?.map((tag) => (
          <span key={tag} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {tag}
          </span>
        ))}
        {stage?.is_won ? (
          <span className="rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">Ganho</span>
        ) : null}
        {stage?.is_lost ? (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Perdido</span>
        ) : null}
      </div>
    </Link>
  );
}
