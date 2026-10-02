'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Edit3,
  ExternalLink,
  FileText,
  MessageCircle,
  MoreHorizontal,
  Send,
  Sparkles,
  Trophy,
  X,
  XCircle,
} from 'lucide-react';
import { MessageBubble } from '@/components/ui/MessageBubble';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  CommercialReviveField,
  CommercialReviveIconButton,
  CommercialReviveTabs,
  commercialReviveMetaPillClassName,
  commercialRevivePrimaryButtonClassName,
  commercialReviveSectionClassName,
} from '@/components/commercial/CommercialRevivePrimitives';
import { ownerName } from '@/lib/commercial/commercialOwners';
import {
  useCheckLeadViability,
  useConfirmLeadDimensioning,
  useSaveLeadPropostaComercial,
  useSelectLeadDimensioningScenario,
  useCommercialOwners,
  useConvertLead,
  useCreateProposal,
  useFieldDefinitions,
  useLead,
  useLeadActivities,
  useLeadConversation,
  useLeadScoring,
  useLossReasons,
  useLoseLead,
  useMoveLeadStage,
  usePatchLead,
  useCommercialProposalsEnabled,
  usePipelineStages,
  useProposal,
  useSendProposal,
} from '@/lib/commercial/useCommercialQueries';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { CommercialListSkeleton } from '@/components/commercial/CommercialSkeleton';
import { CommercialChatDrawer } from '@/components/commercial/CommercialChatDrawer';
import { CommercialProspeccaoModal } from '@/components/commercial/CommercialProspeccaoModal';
import {
  commercialSourceLabel,
  formatDealValueCents,
  formatRelativeDate,
  maskCnpj,
} from '@/lib/commercial/commercialFormat';
import { CommercialContractDataSection } from '@/components/commercial/CommercialContractDataSection';
import { CommercialContractLeadSummary } from '@/components/commercial/CommercialContractLeadSummary';
import { hasSubmittedContractForm } from '@/lib/commercial/contractOnboardingDisplay';
import { CommercialConvertWizard } from '@/components/commercial/CommercialConvertWizard';
import { CommercialCopilotDrawer } from '@/components/commercial/CommercialCopilotDrawer';
import { CommercialLossModal } from '@/components/commercial/CommercialLossModal';
import { CommercialDimensioningPreview } from '@/components/commercial/CommercialDimensioningPreview';
import { CommercialGenerateProposalModal } from '@/components/commercial/CommercialGenerateProposalModal';
import { CommercialTemperatureBadge } from '@/components/commercial/CommercialTemperatureBadge';
import { isStagnantLead } from '@/lib/commercial/commercialScoring';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { commercialKeys } from '@/lib/commercial/commercialKeys';
import { hasPersistedAiScore } from '@/lib/commercial/commercialScoring';
import { CommercialAiScoreChip } from '@/components/commercial/CommercialAiScoreChip';
import { createPortal } from 'react-dom';
import type { OperationalDimensioningResult, PropostaComercialSnapshot, ViabilityResult } from '@/lib/commercial/types';
import { formatBrazilPhone } from '@/lib/brFormat';
import { formatDateTimeBr } from '@/lib/datetimeBr';
import {
  canAccessViabilityActions,
  hasOperationalSnapshot,
  visibleTabsForLead,
  type LeadDetailTab,
} from '@/lib/commercial/commercialStageRules';
import {
  assessLeadOperationalReadiness,
  COMMERCIAL_OPERATION_MANAGED_SLUGS,
} from '@/lib/commercial/leadOperationalReadiness';
import { normalizeDimensionamentoDisplay } from '@/lib/commercial/commercialFinanceDisplay';
import { commercialSelectScenarioErrorMessage } from '@/lib/commercial/commercialApiErrors';
import {
  commercialDebugLog,
  commercialDebugError,
  isCommercialDebugEnabled,
} from '@/lib/commercial/commercialDebugLog';
import { leadDealValueCents } from '@/lib/commercial/commercialLeadDisplay';
import { resolveApiBaseUrl } from '@/lib/api';

type Tab = LeadDetailTab;

function LeadCompactActionsMenu({
  viabilityAllowed,
  dimensionamentoConfirmed,
  hasLatestProposal,
  isTerminal,
  convertedPharmacyId,
  onGenerateProposal,
  onGoToViability,
  onConvert,
  onLoss,
}: {
  viabilityAllowed: boolean;
  dimensionamentoConfirmed: boolean;
  hasLatestProposal: boolean;
  isTerminal: boolean;
  convertedPharmacyId?: string | null;
  onGenerateProposal: () => void;
  onGoToViability: () => void;
  onConvert: () => void;
  onLoss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    updatePosition();
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  const pdfLabel = dimensionamentoConfirmed
    ? hasLatestProposal
      ? 'Gerar PDF (nova versão)'
      : 'Gerar PDF da proposta'
    : 'Revisar viabilidade';

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
        aria-label="Mais ações"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && menuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={ref}
              style={{ top: menuPosition.top, right: menuPosition.right }}
              className="fixed z-[100] w-52 rounded-md border border-border bg-popover py-1 text-left shadow-lg"
            >
              {viabilityAllowed ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (dimensionamentoConfirmed) onGenerateProposal();
                    else onGoToViability();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-sidebar-accent/60"
                >
                  <FileText className="h-3.5 w-3.5" />
                  {pdfLabel}
                </button>
              ) : null}
              {!isTerminal ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onConvert();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-sidebar-accent/60"
                  >
                    <Trophy className="h-3.5 w-3.5" />
                    Ganho
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onLoss();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-sidebar-accent/60"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Perdido
                  </button>
                </>
              ) : null}
              {convertedPharmacyId ? (
                <Link
                  href={`/pharmacies/${convertedPharmacyId}`}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-sidebar-accent/60"
                  onClick={() => setOpen(false)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Ver cadastro farmácia
                </Link>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

type Props = {
  leadId: string;
  variant?: 'default' | 'ficha' | 'sidebar';
  initialTab?: Tab;
};

export function CommercialLeadDetailPanel({ leadId, variant: variantProp, initialTab }: Props) {
  const variant = variantProp ?? 'default';
  const isFicha = variant === 'ficha' || variant === 'default';
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'Resumo');
  const [convertOpen, setConvertOpen] = useState(false);
  const [lossOpen, setLossOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [prospeccaoOpen, setProspeccaoOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  const { data: lead, isLoading: leadLoading } = useLead(leadId);
  const { data: stages = [] } = usePipelineStages();
  const { data: leadActivities = [] } = useLeadActivities(leadId);
  const { data: lossReasons = [] } = useLossReasons();
  const { data: fieldDefinitions = [] } = useFieldDefinitions();
  const { data: owners = [] } = useCommercialOwners();
  const { data: scoring } = useLeadScoring(leadId, true);
  const qc = useQueryClient();

  useEffect(() => {
    if (scoring?.status === 'ready') {
      void qc.invalidateQueries({ queryKey: commercialKeys.lead(leadId) });
      void qc.invalidateQueries({ queryKey: commercialKeys.leads() });
    }
  }, [scoring?.status, leadId, qc]);
  const { data: convData } = useLeadConversation(leadId, tab === 'Conversa' || chatOpen);
  const moveStage = useMoveLeadStage();
  const patchLeadMut = usePatchLead();
  const loseLead = useLoseLead();
  const convertLead = useConvertLead();
  const createProposal = useCreateProposal();
  const sendProposalMut = useSendProposal();
  const checkLeadViabilityMut = useCheckLeadViability();
  const confirmDimensioningMut = useConfirmLeadDimensioning();
  const selectScenarioMut = useSelectLeadDimensioningScenario();
  const savePropostaComercialMut = useSaveLeadPropostaComercial();
  const [viability, setViability] = useState<ViabilityResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [proposalModalOpen, setProposalModalOpen] = useState(false);
  const [propostaDraft, setPropostaDraft] = useState<PropostaComercialSnapshot>({
    setup_cents: 0,
    package_name: 'Pacote padrão',
    setup_pagamento: 'a_vista',
    cenario_a_domingo_aberto: false,
  });
  const [minimoGarantidoOverrideLocal, setMinimoGarantidoOverrideLocal] = useState<number | null>(null);
  const [taxaEntregaOverrideLocal, setTaxaEntregaOverrideLocal] = useState<number | null>(null);
  const financeOverridesLeadKeyRef = useRef<string | null>(null);

  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  const dimensionamento = useMemo((): OperationalDimensioningResult | null => {
    const raw =
      viability?.dimensionamento ?? (lead?.operational_snapshot as OperationalDimensioningResult | null) ?? null;
    return raw ? normalizeDimensionamentoDisplay(raw) : null;
  }, [viability, lead?.operational_snapshot]);

  const dimensionamentoConfirmed = Boolean(
    lead?.dimensionamento_confirmed ??
      (lead?.operational_snapshot as OperationalDimensioningResult | undefined)?.confirmed_at,
  );

  const displayViability = useMemo((): ViabilityResult | null => {
    if (viability) return viability;
    if (!lead || !dimensionamento) return null;
    const fin =
      dimensionamento.classificacao_viabilidade === 'nao_viavel'
        ? 'inviavel'
        : dimensionamento.classificacao_viabilidade === 'viavel_com_restricoes'
          ? 'atencao'
          : 'viavel';
    return {
      city: lead.city,
      state: lead.state,
      volume: lead.monthly_deliveries ?? dimensionamento.entregas_media_mes ?? 0,
      status: fin as ViabilityResult['status'],
      summary: dimensionamento.sugestao_comercial,
      leader_available: true,
      estimated_drivers: dimensionamento.quantidade_entregadores_recomendada,
      dimensionamento,
      valor_lead_anual_cents: dimensionamento.valor_lead_anual_cents,
      dimensionamento_confirmed: dimensionamentoConfirmed,
    };
  }, [viability, lead, dimensionamento, dimensionamentoConfirmed]);

  const latestProposalId = useMemo(() => {
    for (const a of leadActivities) {
      const pid = a.metadata?.proposal_id;
      if (a.type === 'proposal' && typeof pid === 'string') return pid;
    }
    return null;
  }, [leadActivities]);

  const { data: latestProposal } = useProposal(latestProposalId ?? undefined);

  const messages = useMemo(
    () =>
      (convData?.messages || []).map((m) => ({
        id: m.id,
        lead_id: leadId,
        direction: m.direction,
        content: m.content || '',
        created_at: m.created_at,
        status: m.status as 'sent' | 'delivered' | 'read' | undefined,
      })),
    [convData?.messages, leadId],
  );

  const stage = stages.find((s) => s.id === lead?.stage_id);
  const viabilityAllowed = useMemo(
    () => (lead ? canAccessViabilityActions(lead.stage_id, stages) : false),
    [lead, stages],
  );
  const { data: proposalsEnabled = false } = useCommercialProposalsEnabled();
  const visibleTabs = useMemo(
    () => (lead ? visibleTabsForLead(lead.stage_id, stages, { proposalsEnabled }) : []),
    [lead, stages, proposalsEnabled],
  );
  const operationalReadiness = useMemo(
    () => (lead ? assessLeadOperationalReadiness(lead) : { ready: false, missing: [] }),
    [lead],
  );

  const displayDealValueCents = useMemo(
    () => (lead ? leadDealValueCents(lead) : null),
    [lead],
  );

  useEffect(() => {
    const pc = (lead?.operational_snapshot as OperationalDimensioningResult | undefined)?.proposta_comercial;
    if (pc) {
      setPropostaDraft({
        setup_cents: pc.setup_cents ?? 0,
        package_name: pc.package_name ?? 'Pacote padrão',
        setup_observacao: pc.setup_observacao ?? '',
        sem_setup: pc.sem_setup ?? false,
        setup_pagamento: pc.setup_pagamento ?? 'a_vista',
        setup_parcelas: pc.setup_parcelas ?? null,
        cenario_a_domingo_aberto: pc.cenario_a_domingo_aberto ?? false,
        valor_lead_override_cents: pc.valor_lead_override_cents ?? null,
        override_motivo: pc.override_motivo ?? '',
      });
    }
  }, [lead?.operational_snapshot]);

  useEffect(() => {
    if (!lead) return;
    const syncKey = `${lead.id}:${String(lead.updated_at ?? '')}:${String(lead.custom_fields?.minimo_garantido_semanal_informado ?? '')}:${String(lead.custom_fields?.valor_entrega_informado ?? '')}`;
    if (financeOverridesLeadKeyRef.current === syncKey) return;
    financeOverridesLeadKeyRef.current = syncKey;
    setMinimoGarantidoOverrideLocal(
      typeof lead.custom_fields?.minimo_garantido_semanal_informado === 'number'
        ? lead.custom_fields.minimo_garantido_semanal_informado
        : null,
    );
    setTaxaEntregaOverrideLocal(
      typeof lead.custom_fields?.valor_entrega_informado === 'number'
        ? lead.custom_fields.valor_entrega_informado
        : null,
    );
  }, [lead]);

  async function persistFinanceOverrides(patch: {
    minimo_garantido_semanal_informado?: number | null;
    valor_entrega_informado?: number | null;
  }) {
    if (!lead) return;
    const nextCustom = { ...(lead.custom_fields || {}) };
    if ('minimo_garantido_semanal_informado' in patch) {
      if (patch.minimo_garantido_semanal_informado == null) {
        delete nextCustom.minimo_garantido_semanal_informado;
      } else {
        nextCustom.minimo_garantido_semanal_informado = patch.minimo_garantido_semanal_informado;
      }
    }
    if ('valor_entrega_informado' in patch) {
      if (patch.valor_entrega_informado == null) {
        delete nextCustom.valor_entrega_informado;
      } else {
        nextCustom.valor_entrega_informado = patch.valor_entrega_informado;
      }
    }
    try {
      await patchLeadMut.mutateAsync({
        id: leadId,
        patch: { custom_fields: nextCustom },
      });
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  useEffect(() => {
    commercialDebugLog('panel:env', {
      leadId,
      apiBase: resolveApiBaseUrl(),
      host: typeof window !== 'undefined' ? window.location.host : undefined,
    });
  }, [leadId]);

  useEffect(() => {
    if (tab === 'Viabilidade' && lead && !viabilityAllowed) {
      setTab('Resumo');
    }
  }, [tab, lead, viabilityAllowed]);

  const isContractStage = stage?.name?.trim().toLowerCase() === 'contrato';
  const contractFormSubmitted = lead ? hasSubmittedContractForm(lead) : false;
  const showContractPanel = !stage?.is_lost && (isContractStage || contractFormSubmitted);
  const leadForScoring = useMemo(() => {
    if (!lead) return lead;
    if (hasPersistedAiScore(lead)) return lead;
    if (scoring?.status === 'ready' && scoring.ai_score != null) {
      return {
        ...lead,
        ai_score: scoring.ai_score,
        lead_temperature: scoring.lead_temperature ?? lead.lead_temperature,
        ai_score_set_at: lead.ai_score_set_at ?? new Date().toISOString(),
        ai_score_explanation: scoring.explanation ?? lead.ai_score_explanation,
      };
    }
    return lead;
  }, [lead, scoring]);

  const customFieldRows = useMemo(() => {
    if (!lead) return [];
    return fieldDefinitions
      .filter((def) => !COMMERCIAL_OPERATION_MANAGED_SLUGS.has(def.slug))
      .map((def) => {
        const raw = lead.custom_fields?.[def.slug];
        if (raw === undefined || raw === '') return null;
        return { label: def.label, value: String(raw) };
      })
      .filter(Boolean) as { label: string; value: string }[];
  }, [lead, fieldDefinitions]);

  if (leadLoading) {
    return <CommercialListSkeleton rows={6} />;
  }

  if (!lead) {
    return <p className="p-6 text-sm text-muted-foreground">Lead não encontrado.</p>;
  }

  const isTerminal = stage?.is_won || stage?.is_lost;

  const openWhatsApp = () => {
    if (!lead.phone?.trim()) {
      setActionError('Lead sem telefone cadastrado para WhatsApp.');
      return;
    }
    setActionError(null);
    setProspeccaoOpen(true);
  };

  const handleGenerateProposal = async (payload?: {
    package_name: string;
    setup_cents: number;
    setup_pagamento?: 'a_vista' | 'parcelado';
    setup_parcelas?: number | null;
    notes?: string;
  }) => {
    if (!dimensionamento) {
      setActionError('Calcule o dimensionamento na aba Viabilidade antes de gerar a proposta.');
      setTab('Viabilidade');
      return;
    }
    if (!dimensionamentoConfirmed) {
      setActionError('Aprove a análise operacional na aba Viabilidade antes de gerar o PDF.');
      setTab('Viabilidade');
      return;
    }
    setActionError(null);
    try {
      const prop = await createProposal.mutateAsync({
        lead_id: leadId,
        package_name: payload?.package_name ?? propostaDraft.package_name ?? 'Pacote padrão',
        setup_cents: payload?.setup_cents ?? propostaDraft.setup_cents ?? 0,
        setup_pagamento: payload?.setup_pagamento ?? propostaDraft.setup_pagamento ?? 'a_vista',
        setup_parcelas:
          (payload?.setup_pagamento ?? propostaDraft.setup_pagamento) === 'parcelado'
            ? payload?.setup_parcelas ?? propostaDraft.setup_parcelas ?? 2
            : undefined,
        notes: payload?.notes ?? propostaDraft.setup_observacao ?? undefined,
      });
      setProposalModalOpen(false);
      setTab('Proposta');
      if (prop.pdf_warning) {
        setActionError(
          `${prop.pdf_warning} A proposta foi criada; abra a tela e use «Regenerar proposta» após subir o Gotenberg (npm run gotenberg:up).`,
        );
      }
      router.push(`/commercial/proposals/${prop.id}`);
    } catch (e) {
      setActionError(apiErrorMessage(e));
    }
  };

  const openGenerateProposalModal = () => {
    if (!dimensionamentoConfirmed) {
      setActionError('Aprove a análise operacional na aba Viabilidade antes de gerar o PDF.');
      setTab('Viabilidade');
      return;
    }
    setProposalModalOpen(true);
  };

  const handleSavePropostaComercial = async () => {
    setActionError(null);
    try {
      const { operational_snapshot } = await savePropostaComercialMut.mutateAsync({
        leadId,
        payload: propostaDraft,
      });
      const snap = normalizeDimensionamentoDisplay(operational_snapshot);
      setViability((prev) =>
        prev
          ? {
              ...prev,
              dimensionamento: snap,
              valor_lead_anual_cents: snap.valor_lead_anual_cents,
              estimated_drivers: snap.quantidade_entregadores_recomendada,
              dimensionamento_confirmed: Boolean(snap.confirmed_at),
            }
          : prev,
      );
    } catch (e) {
      setActionError(apiErrorMessage(e));
    }
  };

  const handleGoToViability = () => {
    setActionError(null);
    if (!viabilityAllowed) {
      setActionError('Avance o lead para o estágio Diagnóstico para acessar a viabilidade.');
      return;
    }
    setTab('Viabilidade');
  };

  const handleStageChange = async (stageId: string) => {
    const target = stages.find((s) => s.id === stageId);
    if (!target) return;
    if (target.is_won) {
      setConvertOpen(true);
      return;
    }
    if (target.is_lost) {
      setLossOpen(true);
      return;
    }
    setActionError(null);
    try {
      await moveStage.mutateAsync({ id: leadId, stage_id: stageId });
    } catch (e) {
      setActionError(apiErrorMessage(e));
    }
  };

  const runViabilityCheck = async () => {
    setActionError(null);
    commercialDebugLog('viability:start', { leadId });
    try {
      const res = await checkLeadViabilityMut.mutateAsync(leadId);
      commercialDebugLog('viability:ok', {
        leadId,
        cenario_selecionado: res.dimensionamento?.cenario_selecionado,
        entregadores: res.dimensionamento?.quantidade_entregadores_recomendada,
        valor_lead_cents: res.valor_lead_anual_cents,
        cenarios: res.dimensionamento?.cenarios_alternativos?.map((c) => ({
          id: c.id,
          entregadores: c.quantidade_entregadores_recomendada,
          margem: c.margem_flux_semana,
          valor_lead: c.valor_lead_anual_cents,
        })),
      });
      setViability({
        ...res,
        dimensionamento: normalizeDimensionamentoDisplay(res.dimensionamento!),
      });
      if (isCommercialDebugEnabled()) {
        setDebugInfo(`Viabilidade OK · cenários=${res.dimensionamento?.cenarios_alternativos?.length ?? 0}`);
      }
    } catch (e) {
      commercialDebugError('viability:fail', { leadId }, e);
      setActionError(apiErrorMessage(e));
    }
  };

  const handleConfirmDimensioning = async () => {
    setActionError(null);
    try {
      const { operational_snapshot } = await confirmDimensioningMut.mutateAsync(leadId);
      const snap = normalizeDimensionamentoDisplay(operational_snapshot);
      setViability((prev) => {
        const fin =
          snap.classificacao_viabilidade === 'nao_viavel'
            ? 'inviavel'
            : snap.classificacao_viabilidade === 'viavel_com_restricoes'
              ? 'atencao'
              : 'viavel';
        const base = prev ?? {
          city: lead!.city,
          state: lead!.state,
          volume: lead!.monthly_deliveries ?? snap.entregas_media_mes ?? 0,
          status: fin as ViabilityResult['status'],
          summary: snap.sugestao_comercial,
          leader_available: true,
          estimated_drivers: snap.quantidade_entregadores_recomendada,
          dimensionamento: snap,
          valor_lead_anual_cents: snap.valor_lead_anual_cents,
          dimensionamento_confirmed: true,
        };
        return {
          ...base,
          dimensionamento: snap,
          dimensionamento_confirmed: true,
          valor_lead_anual_cents: snap.valor_lead_anual_cents,
          estimated_drivers: snap.quantidade_entregadores_recomendada,
        };
      });
    } catch (e) {
      setActionError(apiErrorMessage(e));
    }
  };

  const handleSelectScenario = async (cenarioId: 'enxuto' | 'enxuto_domingo' | 'integral') => {
    if (!lead || !dimensionamento) return;
    setActionError(null);

    commercialDebugLog('select:start', {
      leadId,
      cenarioId,
      currentSelected: dimensionamento.cenario_selecionado,
      cenariosCount: dimensionamento.cenarios_alternativos?.length,
      cenarioIds: dimensionamento.cenarios_alternativos?.map((c) => c.id),
    });

    const optimistic = normalizeDimensionamentoDisplay(dimensionamento, { cenarioId });
    const buildViability = (snap: OperationalDimensioningResult): ViabilityResult => {
      const fin =
        snap.classificacao_viabilidade === 'nao_viavel'
          ? 'inviavel'
          : snap.classificacao_viabilidade === 'viavel_com_restricoes'
            ? 'atencao'
            : 'viavel';
      return {
        city: lead.city,
        state: lead.state,
        volume: lead.monthly_deliveries ?? snap.entregas_media_mes ?? 0,
        status: fin as ViabilityResult['status'],
        summary: snap.sugestao_comercial,
        leader_available: viability?.leader_available ?? true,
        leaders_in_city: viability?.leaders_in_city,
        aethera_drivers_in_city: viability?.aethera_drivers_in_city,
        estimated_drivers: snap.quantidade_entregadores_recomendada,
        dimensionamento: snap,
        valor_lead_anual_cents: snap.valor_lead_anual_cents,
        dimensionamento_confirmed: false,
      };
    };

    setViability(buildViability(optimistic));
    if (isCommercialDebugEnabled()) {
      setDebugInfo(
        `Optimistic ${cenarioId} · ${optimistic.quantidade_entregadores_recomendada} entreg. · R$ ${((optimistic.valor_lead_anual_cents ?? 0) / 100).toLocaleString('pt-BR')}`,
      );
    }

    try {
      const { operational_snapshot } = await selectScenarioMut.mutateAsync({
        leadId,
        cenarioId,
      });
      const snap = normalizeDimensionamentoDisplay(operational_snapshot);
      commercialDebugLog('select:ok', {
        leadId,
        cenarioId,
        selected: snap.cenario_selecionado,
        entregadores: snap.quantidade_entregadores_recomendada,
        custo_farmacia: snap.custo_farmacia_semana,
        valor_lead_cents: snap.valor_lead_anual_cents,
      });
      setViability((prev) => ({
        ...buildViability(snap),
        leader_available: prev?.leader_available ?? true,
        leaders_in_city: prev?.leaders_in_city,
        aethera_drivers_in_city: prev?.aethera_drivers_in_city,
      }));
      if (isCommercialDebugEnabled()) {
        setDebugInfo(`API OK · ${snap.cenario_selecionado} · ${snap.quantidade_entregadores_recomendada} entreg.`);
      }
    } catch (e) {
      commercialDebugError('select:fail', { leadId, cenarioId }, e);
      setActionError(commercialSelectScenarioErrorMessage(e));
      const fallbackRaw =
        (lead.operational_snapshot as OperationalDimensioningResult | null) ?? dimensionamento;
      setViability((prev) =>
        prev
          ? {
              ...prev,
              dimensionamento: normalizeDimensionamentoDisplay(fallbackRaw),
            }
          : null,
      );
      if (isCommercialDebugEnabled()) {
        setDebugInfo(`API FAIL · ${commercialSelectScenarioErrorMessage(e)}`);
      }
    }
  };

  const needsScenarioSelection =
    Boolean((dimensionamento?.cenarios_alternativos?.length ?? 0) >= 2) &&
    !dimensionamento?.cenario_selecionado;

  const actionButtons = (
    <>
      <CommercialReviveIconButton icon={MessageCircle} variant="outline" onClick={() => void openWhatsApp()}>
        WhatsApp
      </CommercialReviveIconButton>
      <CommercialReviveIconButton icon={Sparkles} variant="outline" onClick={() => setCopilotOpen(true)}>
        Copiloto
      </CommercialReviveIconButton>
      {viabilityAllowed && proposalsEnabled ? (
        <CommercialReviveIconButton
          icon={FileText}
          variant="outline"
          onClick={dimensionamentoConfirmed ? openGenerateProposalModal : handleGoToViability}
        >
          Gerar proposta
        </CommercialReviveIconButton>
      ) : null}
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
      <Link href={`/commercial/leads/${leadId}/edit`} className={commercialRevivePrimaryButtonClassName}>
        <Edit3 className="h-3.5 w-3.5" /> Editar
      </Link>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {isFicha ? (
        <>
          <PageHeader
            icon={Briefcase}
            eyebrow="Comercial"
            title={lead.trade_name}
            description={`${lead.city}/${lead.state} · ${lead.contact_name ?? 'Sem decisor'}`}
            actions={actionButtons}
          />
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {stage ? (
              <FormSearchCombobox
                inputSize="sm"
                value={lead.stage_id}
                onChange={(v) => void handleStageChange(v)}
                disabled={Boolean(isTerminal)}
                className="w-auto min-w-[9rem] text-xs font-medium"
                placeholder="Buscar estágio…"
                options={stages.map((s) => ({ value: s.id, label: s.name }))}
              />
            ) : null}
            <span className={commercialReviveMetaPillClassName}>
              Origem: <span className="text-foreground">{commercialSourceLabel(lead.source)}</span>
            </span>
            <span className={commercialReviveMetaPillClassName}>
              Owner: <span className="text-foreground">{ownerName(lead.owner_id, owners)}</span>
            </span>
            <CommercialTemperatureBadge
              lead={leadForScoring ?? lead}
              stage={stages.find((s) => s.id === lead.stage_id)}
              size="md"
            />
            <CommercialAiScoreChip
              lead={leadForScoring ?? lead}
              stage={stages.find((s) => s.id === lead.stage_id)}
              size="md"
            />
            {scoring?.explanation && scoring.status === 'ready' ? (
              <span className="max-w-xs text-[10px] text-muted-foreground" title={scoring.explanation}>
                {scoring.explanation}
              </span>
            ) : null}
            {isStagnantLead(lead, stages) ? (
              <span className="rounded-md bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">Estagnado</span>
            ) : null}
          </div>
        </>
      ) : null}

      {actionError ? <p className="mb-3 text-xs text-destructive">{actionError}</p> : null}
      {isCommercialDebugEnabled() && debugInfo ? (
        <p className="mb-2 font-mono text-[10px] text-muted-foreground">
          {debugInfo} · API {resolveApiBaseUrl()}
        </p>
      ) : null}

      {lead && !viabilityAllowed ? (
        <div className="mb-3 rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
          Complete a qualificação operacional e avance para <strong>Diagnóstico</strong> para calcular viabilidade
          {proposalsEnabled ? ' e gerar proposta' : ''}.
        </div>
      ) : null}

      {showContractPanel && !lead.contract_onboarding_complete ? (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {contractFormSubmitted
            ? 'Formulário do lead recebido. Complete cadastro, financeiro, coleta e horários para converter.'
            : 'Onboarding de contrato pendente. Gere o link para o lead preencher os dados.'}
        </div>
      ) : null}

      <CommercialReviveTabs
        tabs={visibleTabs.map((t) => ({ id: t, label: t }))}
        value={tab}
        onChange={(v) => setTab(v)}
        className="mb-4"
      />

      <div className={cn('min-h-0 flex-1', isFicha ? '' : 'overflow-y-auto p-4')}>
        {tab === 'Resumo' ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {showContractPanel ? (
              <div className="lg:col-span-3 space-y-4">
                {isContractStage || !lead.contract_onboarding_complete ? (
                  <CommercialContractDataSection lead={lead} />
                ) : (
                  <CommercialContractLeadSummary lead={lead} />
                )}
              </div>
            ) : null}

            <section className={cn(commercialReviveSectionClassName, 'lg:col-span-2')}>
              <h3 className="mb-3 text-sm font-semibold tracking-tight">Dados do lead</h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <CommercialReviveField label="Nome fantasia" value={lead.trade_name} />
                <CommercialReviveField label="Razão social" value={lead.legal_name ?? '—'} />
                <CommercialReviveField label="CNPJ" value={maskCnpj(lead.cnpj) || '—'} mono />
                <CommercialReviveField label="Cidade/UF" value={`${lead.city}/${lead.state}`} />
                <CommercialReviveField label="Decisor" value={lead.contact_name ?? '—'} />
                <CommercialReviveField label="WhatsApp" value={formatBrazilPhone(lead.phone)} mono />
                <CommercialReviveField label="E-mail" value={lead.contact_email ?? '—'} />
                <CommercialReviveField label="Entregas/mês" value={lead.monthly_deliveries?.toLocaleString('pt-BR') ?? '—'} mono />
                <CommercialReviveField label="Nº entregadores" value={lead.drivers_count?.toString() ?? '—'} mono />
                <CommercialReviveField label="ERP" value={lead.erp ?? '—'} />
                <CommercialReviveField
                  label="Horário de pico"
                  value={
                    dimensionamento?.horario_delivery_considerado ??
                    (lead.custom_fields?.delivery_hours_informed ? 'Informados na ficha' : '—')
                  }
                />
                <CommercialReviveField label="Origem" value={commercialSourceLabel(lead.source)} />
                <CommercialReviveField label="Responsável" value={ownerName(lead.owner_id, owners)} />
                {hasOperationalSnapshot(lead) ? (
                  <CommercialReviveField
                    label="Valor lead (12m)"
                    value={formatDealValueCents(displayDealValueCents)}
                    mono
                  />
                ) : null}
              </div>
              {customFieldRows.length > 0 ? (
                <>
                  <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
                    Campos personalizados
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {customFieldRows.map((row) => (
                      <CommercialReviveField key={row.label} label={row.label} value={row.value} />
                    ))}
                  </div>
                </>
              ) : null}
            </section>

            <section className={commercialReviveSectionClassName}>
              <h3 className="mb-2 text-sm font-semibold tracking-tight">Notas</h3>
              <p className="text-xs text-muted-foreground">{lead.notes ?? 'Sem notas registradas.'}</p>
              {lead.tags?.length ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {lead.tags.map((tag) => (
                    <span key={tag} className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {tab === 'Conversa' ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Canal WhatsApp comercial — thread separada do suporte.</p>
            {messages.length === 0 ? (
              <button type="button" onClick={openWhatsApp} className={buttonVariants()}>
                Iniciar conversa comercial
              </button>
            ) : (
              messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  model={{
                    kind: 'message',
                    id: m.id,
                    direction: m.direction,
                    type: 'text',
                    content: m.content,
                    created_at: m.created_at,
                    status: m.status,
                  }}
                />
              ))
            )}
          </div>
        ) : null}

        {tab === 'Atividades' ? (
          <section className={commercialReviveSectionClassName}>
            <h3 className="mb-4 text-sm font-semibold tracking-tight">Linha do tempo</h3>
            <ol className="space-y-3">
              {leadActivities.length === 0 ? (
                <li className="text-xs text-muted-foreground">Sem atividades.</li>
              ) : (
                leadActivities.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <div
                      className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary"
                      style={{ boxShadow: '0 0 6px hsl(var(--primary) / 0.6)' }}
                    />
                    <div className="flex-1 border-b border-border/50 pb-3">
                      <div className="text-sm text-foreground">
                        {a.title}
                        {a.detail ? ` — ${a.detail}` : ''}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-subtle-foreground">
                        {formatDateTimeBr(a.created_at)}
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ol>
          </section>
        ) : null}

        {tab === 'Proposta' && proposalsEnabled ? (
          latestProposal ? (
            <div className={commercialReviveSectionClassName}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    {latestProposal.package_name} — v{latestProposal.version}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {latestProposal.status === 'draft' ? 'Rascunho' : 'Enviada'} ·{' '}
                    {formatRelativeDate(latestProposal.created_at)}
                  </p>
                </div>
                <Link
                  href={`/commercial/proposals/${latestProposal.id}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Abrir preview <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
              <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                <li>Setup: {(latestProposal.setup_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</li>
                <li>
                  Mensalidade:{' '}
                  {(latestProposal.monthly_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </li>
                <li>Taxa entrega: {latestProposal.mdr_pct}%</li>
                <li>Valor lead: {formatDealValueCents(latestProposal.operational_snapshot?.valor_lead_anual_cents)}</li>
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                {dimensionamentoConfirmed ? (
                  <button type="button" onClick={openGenerateProposalModal} className={buttonVariants()}>
                    Gerar nova versão PDF
                  </button>
                ) : (
                  <button type="button" onClick={handleGoToViability} className={buttonVariants()}>
                    Ir para viabilidade
                  </button>
                )}
                {latestProposal.status === 'draft' ? (
                  <button
                    type="button"
                    onClick={() => void sendProposalMut.mutateAsync(latestProposal.id)}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    Enviar no WhatsApp
                  </button>
                ) : null}
                {latestProposal.pdf_url ? (
                  <a
                    href={latestProposal.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    Baixar PDF
                  </a>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">
                {dimensionamentoConfirmed
                  ? 'Análise aprovada — pronto para gerar a proposta (editor + PDF).'
                  : 'Calcule e aprove o dimensionamento na aba Viabilidade antes de gerar a proposta.'}
              </p>
              <button
                type="button"
                onClick={dimensionamentoConfirmed ? openGenerateProposalModal : handleGoToViability}
                className={cn('mt-3', buttonVariants())}
              >
                {dimensionamentoConfirmed ? 'Gerar proposta' : 'Ir para viabilidade'}
              </button>
            </div>
          )
        ) : null}

        {tab === 'Viabilidade' && viabilityAllowed ? (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Fluxo: calcular dimensionamento → revisar análise → aprovar
              {proposalsEnabled ? ' → gerar PDF' : ''}. Dados da operação vêm da Flux Farma (líderes, entregadores e
              taxas cadastradas).
            </p>

            {!operationalReadiness.ready ? (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                <p className="text-sm font-medium text-warning">Ficha operacional incompleta</p>
                <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                  {operationalReadiness.missing.map((m) => (
                    <li key={m.field}>{m.label}</li>
                  ))}
                </ul>
                <Link
                  href={`/commercial/leads/${leadId}/edit`}
                  className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                >
                  Editar lead
                </Link>
              </div>
            ) : null}

            {dimensionamento && displayViability ? (
              <CommercialDimensioningPreview
                viability={displayViability}
                dimensionamento={dimensionamento}
                lead={lead}
                confirmed={dimensionamentoConfirmed}
                confirmedAt={(dimensionamento as OperationalDimensioningResult).confirmed_at}
                onSelectScenario={dimensionamentoConfirmed ? undefined : handleSelectScenario}
                selectingScenario={selectScenarioMut.isPending}
                proposalsEnabled={proposalsEnabled}
                minimoGarantidoOverride={minimoGarantidoOverrideLocal}
                onMinimoGarantidoOverrideChange={setMinimoGarantidoOverrideLocal}
                onMinimoGarantidoOverrideBlur={() =>
                  void persistFinanceOverrides({
                    minimo_garantido_semanal_informado: minimoGarantidoOverrideLocal,
                  })
                }
                taxaEntregaOverride={taxaEntregaOverrideLocal}
                onTaxaEntregaOverrideChange={setTaxaEntregaOverrideLocal}
                onTaxaEntregaOverrideBlur={() =>
                  void persistFinanceOverrides({
                    valor_entrega_informado: taxaEntregaOverrideLocal,
                  })
                }
                propostaComercial={proposalsEnabled ? propostaDraft : undefined}
                onPropostaComercialChange={
                  proposalsEnabled ? (patch) => setPropostaDraft((prev) => ({ ...prev, ...patch })) : undefined
                }
                onSavePropostaComercial={proposalsEnabled ? () => void handleSavePropostaComercial() : undefined}
                savingPropostaComercial={savePropostaComercialMut.isPending}
              />
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runViabilityCheck()}
                disabled={checkLeadViabilityMut.isPending || !operationalReadiness.ready}
                title={
                  !operationalReadiness.ready
                    ? operationalReadiness.missing.map((m) => m.label).join(', ')
                    : undefined
                }
                className={buttonVariants()}
              >
                {dimensionamento ? 'Recalcular dimensionamento' : 'Calcular dimensionamento'}
              </button>
              {dimensionamento && !dimensionamentoConfirmed ? (
                <button
                  type="button"
                  onClick={() => void handleConfirmDimensioning()}
                  disabled={confirmDimensioningMut.isPending || needsScenarioSelection}
                  title={needsScenarioSelection ? 'Selecione um cenário antes de aprovar' : undefined}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Aprovar análise
                </button>
              ) : null}
              {dimensionamentoConfirmed && proposalsEnabled ? (
                <button type="button" onClick={openGenerateProposalModal} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Gerar proposta
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {isFicha ? (
        <div className="mt-6 border-t border-border pt-4">
          <Link
            href="/commercial/pipeline"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Voltar ao pipeline <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ) : null}

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
        onStarted={() => {
          setTab('Conversa');
          setChatOpen(true);
        }}
      />
      {chatOpen ? (
        <CommercialChatDrawer
          leadId={leadId}
          leadName={lead.trade_name}
          open
          onClose={() => setChatOpen(false)}
          onStartProspeccao={() => setProspeccaoOpen(true)}
        />
      ) : null}
      {copilotOpen ? (
        <CommercialCopilotDrawer lead={lead} stage={stage} open onClose={() => setCopilotOpen(false)} />
      ) : null}
      {dimensionamento && proposalsEnabled ? (
        <CommercialGenerateProposalModal
          open={proposalModalOpen}
          onClose={() => setProposalModalOpen(false)}
          onConfirm={(payload) => handleGenerateProposal(payload)}
          dimensionamento={dimensionamento}
          propostaComercial={propostaDraft}
          loading={createProposal.isPending}
        />
      ) : null}
    </div>
  );
}

