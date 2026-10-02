'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- builder de fluxo; tipar nós incrementalmente */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/store/auth';
import {
  addBlocoToBranch,
  countBlocos,
  novoBloco,
  removeBloco,
  toggleCollapse,
  updateBlocoConfig,
  type Bloco,
  type BlocoTipo,
} from '@/lib/conversation-flow/fluxo';
import {
  buildEscalacaoPorSlaPreset,
  buildForaHorarioPreset,
  buildTriagemPerfilAutomationPreset,
} from '@/lib/conversation-flow/automationPresets';
import { resolveSetoresPorPerfilForPreset } from '@/lib/conversation-flow/triagemPorPerfilPreset';
import { DEFAULT_OUT_OF_HOURS_MESSAGE } from '@plataforma/channel-runtime';
import {
  parseChannelOperationalConfig,
  serializeChannelOperationalConfig,
  updateChannel,
  type WorkspaceChannel,
} from '@/lib/integrations/channelsApi';
import { fetchChannelOperationalCatalog, fetchMessagingWebhookSectors } from '@/lib/integrations/useSectorsFromMessagingWebhooks';
import {
  bindingPayloadFromWizard,
  bindingPriorityFromTier,
  buildWizardMeta,
  decodeWizardFromGraphAndBinding,
  formatChannelOption,
  formatFilterPreviewLine,
  groupWorkspaceChannelsByType,
  newCfFilterRow,
  priorityTierFromBinding,
  revivePreviewNumberedLines,
  type CfFilterRow,
  type CfTrigger,
} from '@/lib/conversation-flow/wizardConversationFlow';
import type {
  ApiTemplate,
  Attendant,
  AutomationRulePayload,
  BotFlowPayload,
  KindKey,
  RoutingRulePayload,
  Step,
} from '@/lib/automations/wizardTypes';
import { inferKindFromModel, parseCsv, safeJsonParse, slugifyFlowName } from '@/lib/automations/wizardUtils';

export function useAutomationWizard() {
  const router = useRouter();

  const searchParams = useSearchParams();

  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const userRole = useAuth((s) => s.user?.role || '');
  const isAdmin = String(userRole || '').toLowerCase() === 'admin';
  const isSupervisor = String(userRole || '').toLowerCase() === 'supervisor';
  const canFetch = hasHydrated && isAuthenticated;

  const editKind = (searchParams.get('kind') || '').trim() as KindKey | '';
  const editId = (searchParams.get('id') || '').trim();
  const isEditing = Boolean(editKind && editId);

  const cloneFromKind = (searchParams.get('cloneFromKind') || '').trim() as KindKey | '';
  const cloneFromId = (searchParams.get('cloneFromId') || '').trim();
  const isCloning = Boolean(cloneFromKind && cloneFromId);

  const [step, setStep] = useState<Step>(1);
  const [model, setModel] = useState<ModelKey>('blank');
  const kind = inferKindFromModel(model);

  const routingRulesQuery = useQuery({
    queryKey: ['settings-automations-wizard', 'routing-rules'],
    enabled: canFetch && (isEditing || isCloning),
    queryFn: async () => (await api.get('/api/bot/routing-rules')).data as any[],
  });

  const botFlowsQuery = useQuery({
    queryKey: ['settings-automations-wizard', 'bot-flows'],
    enabled: canFetch && (isEditing || isCloning),
    queryFn: async () => (await api.get('/api/bot/flows')).data as any[],
  });

  const automationRulesQuery = useQuery({
    queryKey: ['settings-automations-wizard', 'automation-rules'],
    enabled: canFetch && (isEditing || isCloning),
    queryFn: async () => (await api.get('/api/automations')).data as any[],
  });

  const webhookSectorsQuery = useQuery({
    queryKey: ['sectors-from-messaging-webhooks'],
    enabled: canFetch,
    queryFn: fetchMessagingWebhookSectors,
  });

  const templatesQuery = useQuery({
    queryKey: ['settings-automations-wizard', 'templates-approved'],
    enabled: canFetch && kind === 'automation_rule',
    queryFn: async () => (await api.get('/api/templates/list/approved')).data as ApiTemplate[],
  });

  const outOfHoursQuery = useQuery({
    queryKey: ['settings-automations-wizard', 'out-of-hours-from-webhooks'],
    enabled: canFetch,
    retry: false,
    queryFn: async () => {
      try {
        const catalog = await fetchChannelOperationalCatalog();
        return catalog.messages.find((m) => m.out_of_hours)?.out_of_hours || '';
      } catch {
        return '';
      }
    },
  });

  const operationalCatalogQuery = useQuery({
    queryKey: ['settings-automations-wizard', 'operational-catalog-from-webhooks'],
    enabled: canFetch,
    retry: false,
    queryFn: fetchChannelOperationalCatalog,
  });

  const attendantsQuery = useQuery({
    queryKey: ['settings-automations-wizard', 'attendants'],
    enabled: canFetch,
    queryFn: async () => (await api.get('/api/users/attendants')).data as Attendant[],
  });

  const channelsQuery = useQuery({
    queryKey: ['settings-automations-wizard', 'channels'],
    enabled:
      canFetch &&
      (model === 'triagem_perfil' ||
        model === 'csat' ||
        model === 'out_of_hours' ||
        model === 'sla_escalation' ||
        editKind === 'conversation_flow' ||
        cloneFromKind === 'conversation_flow'),
    queryFn: async () => (await api.get<{ items: WorkspaceChannel[] }>('/api/integrations/channels')).data.items || [],
  });

  const cfSourceId = useMemo(() => {
    if (editKind === 'conversation_flow' && editId) return editId;
    if (cloneFromKind === 'conversation_flow' && cloneFromId) return cloneFromId;
    return '';
  }, [editKind, editId, cloneFromKind, cloneFromId]);

  const conversationFlowDetailQuery = useQuery({
    queryKey: ['settings-automations-wizard', 'conversation-flow-detail', cfSourceId],
    enabled:
      canFetch &&
      Boolean(cfSourceId) &&
      (editKind === 'conversation_flow' || cloneFromKind === 'conversation_flow'),
    queryFn: async () => {
      const id = cfSourceId;
      const [versionsRes, bindingsRes, defsRes] = await Promise.all([
        api.get(`/api/conversation-flows/definitions/${id}/versions`),
        api.get(`/api/conversation-flows/definitions/${id}/bindings`).catch(() => ({ data: [] as unknown[] })),
        api.get('/api/conversation-flows/definitions'),
      ]);
      const defs = (defsRes.data || []) as Array<{ id: string; name: string; is_active?: boolean; description?: string | null }>;
      const def = defs.find((d) => d.id === id) || null;
      return {
        def,
        versions: versionsRes.data as Array<{
          id: string;
          version_number: number;
          status: string;
          graph?: Record<string, unknown>;
        }>,
        bindings: (bindingsRes.data || []) as Array<{
          id: string;
          workspace_channel_id?: string | null;
          keywords?: string[];
          trigger_type?: string;
          priority?: number;
          is_active?: boolean;
        }>,
      };
    },
  });

  const [draftName, setDraftName] = useState('Sem título');
  const [enabled, setEnabled] = useState(true);

  // Routing rule fields
  const [rrProfile, setRrProfile] = useState<RoutingRulePayload['profile_type']>(null);
  const [rrIntentSectorId, setRrIntentSectorId] = useState('');
  const [rrIntent, setRrIntent] = useState('');
  const [rrKeywordsAny, setRrKeywordsAny] = useState('');
  const [rrKeywordsAll, setRrKeywordsAll] = useState('');
  const [rrRequiresContextPharmacy, setRrRequiresContextPharmacy] = useState(false);
  const [rrRouteTo, setRrRouteTo] = useState<RoutingRulePayload['route_to']>('sector');
  const [rrPriority, setRrPriority] = useState(0);
  const [rrTargetSectorId, setRrTargetSectorId] = useState('');
  const [rrTargetAttendantId, setRrTargetAttendantId] = useState('');

  // Bot flow fields
  const [bfName, setBfName] = useState('triage_intro');
  const [bfTriggerKeywords, setBfTriggerKeywords] = useState('');
  const [bfMessage, setBfMessage] = useState('Olá! Como posso te ajudar?');

  // Out-of-hours
  const [oohMessage, setOohMessage] = useState(DEFAULT_OUT_OF_HOURS_MESSAGE);

  // Automation rule fields
  const [arTriggerType, setArTriggerType] = useState<AutomationRulePayload['trigger_type']>('event');
  const [arEventType, setArEventType] = useState('installment_due_weekly');
  const [arEventTypeCustom, setArEventTypeCustom] = useState('');
  const [arCron, setArCron] = useState('0 8 * * 1');
  const [arAudience, setArAudience] = useState('drivers');
  const [arTemplateId, setArTemplateId] = useState('');
  const [arRequireApproval, setArRequireApproval] = useState(false);
  const [arNotes, setArNotes] = useState('');
  const [arAudienceFiltersJson, setArAudienceFiltersJson] = useState(() => JSON.stringify({}, null, 2));
  const [arVariablesMappingJson, setArVariablesMappingJson] = useState(() => JSON.stringify({}, null, 2));
  const [arDispatchConfigJson, setArDispatchConfigJson] = useState(() =>
    JSON.stringify(
      {
        batch_size: 10,
        pause_between_messages_ms: 1500,
        pause_between_batches_ms: 60000,
        max_per_hour: 200,
        jitter_ms: 500,
        retry_on_failure: true,
        max_retries: 3,
        retry_backoff_ms: 30000,
      },
      null,
      2
    )
  );

  /** Fluxo conversacional (preset triagem por perfil): gatilho inbound + árvore `revive_blocos`. */
  const [cfTrigger, setCfTrigger] = useState<CfTrigger>('message_received');
  const [cfFilters, setCfFilters] = useState<CfFilterRow[]>([]);
  const [cfPriorityTier, setCfPriorityTier] = useState<'low' | 'medium' | 'high'>('medium');
  const [cfDescription, setCfDescription] = useState('');
  const [cfEditVersionId, setCfEditVersionId] = useState<string | null>(null);
  const [cfEditBindingId, setCfEditBindingId] = useState<string | null>(null);
  const [triageBlocos, setTriageBlocos] = useState<Bloco[]>([]);
  const cfDetailLoadedKey = useRef<string | null>(null);
  const csatFilterSeededRef = useRef(false);

  const [jsonErrors, setJsonErrors] = useState<{ audience?: string | null; variables?: string | null; dispatch?: string | null } | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSectors = useMemo(() => {
    return (webhookSectorsQuery.data || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [webhookSectorsQuery.data]);

  const attendants = useMemo(() => {
    return (attendantsQuery.data || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [attendantsQuery.data]);

  useEffect(() => {
    cfDetailLoadedKey.current = null;
  }, [cfSourceId]);

  useEffect(() => {
    if (!cfSourceId) return;
    if (editKind !== 'conversation_flow' && cloneFromKind !== 'conversation_flow') return;
    const d = conversationFlowDetailQuery.data;
    if (!d || conversationFlowDetailQuery.isLoading) return;
    const loadKey = `${isCloning ? 'clone' : 'edit'}:${cfSourceId}`;
    if (cfDetailLoadedKey.current === loadKey) return;

    const versions = [...(d.versions || [])].sort((a, b) => b.version_number - a.version_number);
    const draft = versions.find((v) => v.status === 'draft') || versions[0];
    if (!draft?.id) return;

    const graph = (draft.graph || {}) as Record<string, unknown>;
    const binding = (d.bindings || [])[0] || null;
    const decoded = decodeWizardFromGraphAndBinding(graph, binding);

    setCfTrigger(decoded.trigger);
    setCfFilters(decoded.filters);
    setCfPriorityTier(priorityTierFromBinding(decoded.bindingPriority));
    setCfDescription(String(d.def?.description || '').trim() ? String(d.def?.description) : '');
    setTriageBlocos(Array.isArray(graph.revive_blocos) ? (graph.revive_blocos as Bloco[]) : []);

    const wm = (graph.wizard_meta || {}) as Record<string, unknown>;
    const preset = String(wm.preset || 'triagem_perfil');
    setModel(
      preset === 'csat'
        ? 'csat'
        : preset === 'out_of_hours'
          ? 'out_of_hours'
          : preset === 'sla_escalation'
            ? 'sla_escalation'
            : 'triagem_perfil'
    );

    if (isCloning && cloneFromKind === 'conversation_flow') {
      setDraftName(`${String(d.def?.name || 'Fluxo')} (cópia)`);
      setCfEditVersionId(null);
      setCfEditBindingId(null);
      setEnabled(true);
    } else {
      setDraftName(String(d.def?.name || 'Fluxo'));
      setCfEditVersionId(draft.id);
      setCfEditBindingId(binding?.id || null);
      setEnabled(Boolean(d.def?.is_active ?? true));
    }

    cfDetailLoadedKey.current = loadKey;
  }, [
    cfSourceId,
    editKind,
    cloneFromKind,
    isCloning,
    conversationFlowDetailQuery.data,
    conversationFlowDetailQuery.isLoading,
  ]);

  useEffect(() => {
    if (isEditing) return;
    if (isCloning && cloneFromKind === 'conversation_flow') return;
    if (model !== 'triagem_perfil') return;
    const pools = resolveSetoresPorPerfilForPreset(activeSectors.map((s) => ({ id: s.id, name: s.name })));
    setTriageBlocos(buildTriagemPerfilAutomationPreset({ setoresPorPerfil: pools, catalog: operationalCatalogQuery.data || null }));
  }, [isEditing, isCloning, cloneFromKind, model, activeSectors, operationalCatalogQuery.data]);

  useEffect(() => {
    // Apply model presets (only when not editing).
    if (isEditing) return;
    if (isCloning) return;
    if (model === 'triagem_perfil') {
      setDraftName('Triagem por perfil');
      setCfTrigger('message_received');
      setCfFilters([]);
      setCfPriorityTier('medium');
      setCfDescription('');
      setCfEditVersionId(null);
      setCfEditBindingId(null);
      return;
    }
    if (model === 'triage_bot') {
      setDraftName('Triagem inicial - Bot');
      setBfName('driver_greeting_list');
      setBfMessage('Olá! Como posso te ajudar? Toque em Ver setores e escolha o tipo de atendimento:');
      return;
    }
    if (model === 'keyword_routing') {
      setDraftName('Roteamento por palavra-chave');
      setRrProfile(null);
      setRrKeywordsAny('atraso, falta, cobertura');
      return;
    }
    if (model === 'out_of_hours') {
      setDraftName('Auto-resposta fora do horário');
      setCfTrigger('conversation_started');
      setCfFilters([]);
      setCfPriorityTier('high');
      setCfDescription('Fluxo automático para atendimento recebido fora do horário operacional configurado no webhook.');
      setCfEditVersionId(null);
      setCfEditBindingId(null);
      const preset = buildForaHorarioPreset({ catalog: operationalCatalogQuery.data || null });
      setTriageBlocos(preset);
      const firstMessage = preset.find((b) => b.tipo === 'enviar-mensagem')?.config?.texto;
      setOohMessage(typeof firstMessage === 'string' ? firstMessage : '');
      return;
    }
    if (model === 'csat') {
      setDraftName('Pesquisa CSAT');
      setCfTrigger('conversation_resolved');
      setCfFilters([]);
      setCfPriorityTier('medium');
      setCfDescription('');
      setCfEditVersionId(null);
      setCfEditBindingId(null);
      const b = novoBloco('csat');
      setTriageBlocos([{ ...b, collapsed: false }]);
      return;
    }
    if (model === 'sla_escalation') {
      setDraftName('Escalação por SLA crítico');
      setCfTrigger('message_received');
      setCfFilters([newCfFilterRow({ field: 'message_text', op: 'contains', textValue: 'sla_critical' })]);
      setCfPriorityTier('high');
      setCfDescription('Fluxo de priorização e escalonamento baseado no SLA configurado no webhook.');
      setCfEditVersionId(null);
      setCfEditBindingId(null);
      setTriageBlocos(buildEscalacaoPorSlaPreset({ catalog: operationalCatalogQuery.data || null }));
      return;
    }
  }, [isEditing, isCloning, model, operationalCatalogQuery.data]);

  useEffect(() => {
    if (model !== 'csat') csatFilterSeededRef.current = false;
  }, [model]);

  useEffect(() => {
    if (isEditing) return;
    if (isCloning && cloneFromKind === 'conversation_flow') return;
    if (model !== 'csat') return;
    if (csatFilterSeededRef.current) return;
    const wa = (channelsQuery.data || []).find((c) => c.channel_type === 'whatsapp');
    if (!wa) return;
    setCfFilters([newCfFilterRow({ field: 'channel', op: 'eq', channelId: wa.id })]);
    csatFilterSeededRef.current = true;
  }, [isEditing, isCloning, cloneFromKind, model, channelsQuery.data]);

  useEffect(() => {
    // Prefer first approved template as default selection.
    if (kind !== 'automation_rule') return;
    if (arTemplateId) return;
    const first = (templatesQuery.data || [])[0];
    if (first?.id) setArTemplateId(first.id);
  }, [kind, templatesQuery.data, arTemplateId]);

  useEffect(() => {
    // Load existing out-of-hours message when editing.
    if (!isEditing) return;
    if (editKind !== 'out_of_hours') return;
    setModel('out_of_hours');
    setDraftName('Auto-resposta fora do horário');
    setEnabled(Boolean(String(outOfHoursQuery.data || '').trim().length));
    if (typeof outOfHoursQuery.data === 'string') setOohMessage(outOfHoursQuery.data || '');
  }, [isEditing, editKind, outOfHoursQuery.data]);

  useEffect(() => {
    // Prefill when editing/cloning using list endpoints.
    const sourceKind = isEditing ? editKind : isCloning ? cloneFromKind : '';
    const sourceId = isEditing ? editId : isCloning ? cloneFromId : '';
    if (!sourceKind || !sourceId) return;

    if (sourceKind === 'routing_rule') {
      const rule = (routingRulesQuery.data || []).find((x: any) => x.id === sourceId);
      if (!rule) return;
      setModel('keyword_routing');
      setDraftName(isCloning ? `${String(rule.name || '')} (cópia)` : String(rule.name || ''));
      setEnabled(Boolean(rule.is_active));
      setRrPriority(Number(rule.priority || 0));
      setRrProfile((rule.profile_type || null) as any);
      setRrIntentSectorId(String(rule.intent_sector_id || ''));
      setRrIntent(String(rule.intent || ''));
      setRrKeywordsAny(Array.isArray(rule.keywords_any) ? rule.keywords_any.join(', ') : '');
      setRrKeywordsAll(Array.isArray(rule.keywords_all) ? rule.keywords_all.join(', ') : '');
      setRrRequiresContextPharmacy(Boolean(rule.requires_context_pharmacy));
      setRrRouteTo((rule.route_to || 'sector') as any);
      if ((rule.route_to || 'sector') === 'attendant') {
        setRrTargetAttendantId(String(rule.target_id || ''));
        setRrTargetSectorId('');
      } else if ((rule.route_to || 'sector') === 'sector') {
        setRrTargetSectorId(String(rule.target_id || ''));
        setRrTargetAttendantId('');
      } else {
        setRrTargetAttendantId('');
        setRrTargetSectorId('');
      }
    }

    if (sourceKind === 'bot_flow') {
      const flow = (botFlowsQuery.data || []).find((x: any) => x.id === sourceId);
      if (!flow) return;
      setModel('triage_bot');
      setDraftName(isCloning ? `${String(flow.name || '')} (cópia)` : String(flow.name || ''));
      setEnabled(Boolean(flow.is_active));
      setBfName(isCloning ? `${String(flow.name || '')}_copy` : String(flow.name || ''));
      setBfTriggerKeywords(Array.isArray(flow.trigger_keywords) ? flow.trigger_keywords.join(', ') : '');
      setBfMessage(String(flow.message || ''));
    }

    if (sourceKind === 'automation_rule') {
      const ar = (automationRulesQuery.data || []).find((x: any) => x.id === sourceId);
      if (!ar) return;
      setModel('blank');
      setDraftName(isCloning ? `${String(ar.name || '')} (cópia)` : String(ar.name || ''));
      setEnabled(Boolean(ar.is_active));
      setArTriggerType((ar.trigger_type || 'event') as any);
      setArCron(String(ar.cron_expression || '0 8 * * 1'));
      setArEventType(String(ar.event_type || 'custom'));
      setArEventTypeCustom(String(ar.event_type || ''));
      setArAudience(String(ar.audience_type || 'drivers'));
      setArTemplateId(String(ar.template_id || ''));
      setArRequireApproval(Boolean(ar.require_approval));
      setArNotes(String(ar.notes || ''));
      setArAudienceFiltersJson(JSON.stringify(ar.audience_filters || {}, null, 2));
      setArVariablesMappingJson(JSON.stringify(ar.variables_mapping || {}, null, 2));
      setArDispatchConfigJson(JSON.stringify(ar.dispatch_config || {}, null, 2));
    }
  }, [isEditing, isCloning, editKind, editId, cloneFromKind, cloneFromId, routingRulesQuery.data, botFlowsQuery.data, automationRulesQuery.data]);

  useEffect(() => {
    if (kind !== 'routing_rule') return;
    if (rrRouteTo === 'sector') {
      if (rrTargetAttendantId) setRrTargetAttendantId('');
    } else if (rrRouteTo === 'attendant') {
      if (rrTargetSectorId) setRrTargetSectorId('');
    } else {
      if (rrTargetSectorId) setRrTargetSectorId('');
      if (rrTargetAttendantId) setRrTargetAttendantId('');
    }
  }, [kind, rrRouteTo, rrTargetSectorId, rrTargetAttendantId]);

  const canNext = useMemo(() => {
    if (step === 1) return Boolean(model);
    if (step === 2) {
      if (kind === 'routing_rule') {
        return (
          parseCsv(rrKeywordsAny).length > 0 ||
          parseCsv(rrKeywordsAll).length > 0 ||
          Boolean(rrIntentSectorId) ||
          rrIntent.trim().length > 0
        );
      }
      if (kind === 'bot_flow') return bfName.trim().length >= 2;
      if (kind === 'out_of_hours') return oohMessage.trim().length >= 5;
      if (kind === 'conversation_flow') return true;
      if (kind === 'automation_rule') {
        if (arTriggerType === 'schedule') return arCron.trim().length >= 4;
        if (arEventType === 'custom') return arEventTypeCustom.trim().length >= 2;
        return arEventType.trim().length >= 2;
      }
    }
    if (step === 3) {
      if (kind === 'routing_rule') {
        if (rrRouteTo === 'pharmacy_attendant') return true;
        if (rrRouteTo === 'attendant') return Boolean(rrTargetAttendantId);
        return Boolean(rrTargetSectorId);
      }
      if (kind === 'bot_flow') return bfMessage.trim().length >= 2;
      if (kind === 'out_of_hours') return oohMessage.trim().length >= 5;
      if (kind === 'conversation_flow')
        return model === 'csat' ? countBlocos(triageBlocos) >= 1 : countBlocos(triageBlocos) >= 2;
      if (kind === 'automation_rule') return Boolean(arTemplateId) && Boolean(arAudience);
    }
    return true;
  }, [
    step,
    model,
    kind,
    rrKeywordsAny,
    rrKeywordsAll,
    rrIntentSectorId,
    rrIntent,
    bfName,
    oohMessage,
    arTriggerType,
    arCron,
    arEventType,
    arEventTypeCustom,
    rrRouteTo,
    rrTargetSectorId,
    rrTargetAttendantId,
    bfMessage,
    triageBlocos,
    arTemplateId,
    arAudience,
  ]);

  const canSave = useMemo(() => {
    const canWrite =
      kind === 'automation_rule' || kind === 'conversation_flow'
        ? isAdmin || isSupervisor
        : isAdmin; // routing/bot/settings precisam admin
    if (!canWrite) return false;
    if (kind === 'routing_rule') return draftName.trim().length >= 2 && canNext;
    if (kind === 'bot_flow') return draftName.trim().length >= 2 && bfName.trim().length >= 2 && bfMessage.trim().length >= 2 && canNext;
    if (kind === 'out_of_hours') return draftName.trim().length >= 2 && oohMessage.trim().length >= 2 && canNext;
    if (kind === 'conversation_flow')
      return (
        draftName.trim().length >= 2 &&
        (model === 'csat' ? countBlocos(triageBlocos) >= 1 : countBlocos(triageBlocos) >= 2) &&
        canNext &&
        (!isEditing || editKind !== 'conversation_flow' || Boolean(cfEditVersionId))
      );
    return draftName.trim().length >= 2 && Boolean(arTemplateId) && canNext;
  }, [
    kind,
    isAdmin,
    isSupervisor,
    draftName,
    canNext,
    bfName,
    bfMessage,
    oohMessage,
    arTemplateId,
    triageBlocos,
    model,
    isEditing,
    editKind,
    cfEditVersionId,
  ]);

  const previewLines = useMemo(() => {
    const lines: string[] = [];
    if (kind === 'routing_rule') {
      lines.push('quando mensagem recebida');
      const hint =
        parseCsv(rrKeywordsAny).length > 0
          ? `"${parseCsv(rrKeywordsAny)[0]}"…`
          : parseCsv(rrKeywordsAll).length > 0
            ? `"${parseCsv(rrKeywordsAll)[0]}"…`
            : rrIntentSectorId
              ? `"intent = ${activeSectors.find((s) => s.id === rrIntentSectorId)?.name || '—'}"`
              : rrIntent.trim()
                ? `"intent = ${rrIntent.trim()}"`
                : 'condições';
      lines.push(`  e mensagem corresponde a ${hint}`);
      lines.push('então:');
      if (rrRouteTo === 'attendant') {
        lines.push(`  encaminhar para atendente "${attendants.find((a) => a.id === rrTargetAttendantId)?.name || '—'}"`);
      } else if (rrRouteTo === 'pharmacy_attendant') {
        lines.push('  encaminhar para atendente vinculado à farmácia');
      } else {
        lines.push(`  encaminhar para fila "${activeSectors.find((s) => s.id === rrTargetSectorId)?.name || '—'}"`);
      }
      return lines;
    }
    if (kind === 'bot_flow') {
      lines.push('quando conversa inicia ou keywords configuradas');
      lines.push('então:');
      lines.push('  enviar mensagem');
      return lines;
    }
    if (kind === 'conversation_flow') {
      const whenPt =
        cfTrigger === 'conversation_started'
          ? 'Nova conversa'
          : cfTrigger === 'conversation_resolved'
            ? 'Conversa resolvida'
            : 'Mensagem recebida';
      lines.push(`quando ${whenPt}`);
      const chans = channelsQuery.data || [];
      for (const f of cfFilters) {
        const pl = formatFilterPreviewLine(f, chans);
        if (pl) lines.push(`  e ${pl}`);
      }
      lines.push('então:');
      if (step >= 3) {
        for (const ln of revivePreviewNumberedLines(triageBlocos, 14)) {
          lines.push(`  ${ln}`);
        }
      } else {
        lines.push(
          `  executar fluxo versionado (${countBlocos(triageBlocos)} bloco(s)) · ${model === 'csat' ? 'pesquisa CSAT' : 'triagem por perfil'}`
        );
      }
      return lines;
    }
    if (kind === 'out_of_hours') {
      lines.push('quando setor está fora do horário');
      lines.push('então:');
      lines.push('  enviar auto-resposta');
      return lines;
    }
    lines.push(arTriggerType === 'schedule' ? 'quando agendamento (cron)' : 'quando evento');
    if (arTriggerType === 'schedule') {
      lines.push(`  e cron = "${arCron || '—'}"`);
    } else {
      const ev = arEventType === 'custom' ? arEventTypeCustom : arEventType;
      lines.push(`  e evento = "${ev || '—'}"`);
    }
    lines.push('então:');
    lines.push(`  disparar campanha para "${arAudience}"`);
    return lines;
  }, [
    kind,
    step,
    rrKeywordsAny,
    rrKeywordsAll,
    rrIntentSectorId,
    rrIntent,
    rrRouteTo,
    rrTargetSectorId,
    rrTargetAttendantId,
    activeSectors,
    attendants,
    arTriggerType,
    arCron,
    arEventType,
    arEventTypeCustom,
    arAudience,
    cfTrigger,
    cfFilters,
    triageBlocos,
    channelsQuery.data,
    model,
  ]);

  const resumoCanais = useMemo(() => {
    if (kind !== 'conversation_flow') {
      if (kind === 'routing_rule' || kind === 'bot_flow') return 'Mensagem (workspace)';
      if (kind === 'out_of_hours') return '—';
      return '—';
    }
    const chans = channelsQuery.data || [];
    const names: string[] = [];
    for (const f of cfFilters) {
      if (f.field !== 'channel' || f.op !== 'eq' || !f.channelId.trim()) continue;
      const ch = chans.find((c) => c.id === f.channelId);
      names.push(ch ? formatChannelOption(ch) : 'Canal');
    }
    const hasText = cfFilters.some((f) => f.field === 'message_text' && f.textValue.trim());
    if (hasText && names.length === 0) return 'Filtro por texto (+ todos os canais)';
    return names.length ? names.join(', ') : 'Todos os canais';
  }, [kind, cfFilters, channelsQuery.data]);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const parsedAudience = kind === 'automation_rule' ? safeJsonParse(arAudienceFiltersJson) : null;
      const parsedVariables = kind === 'automation_rule' ? safeJsonParse(arVariablesMappingJson) : null;
      const parsedDispatch = kind === 'automation_rule' ? safeJsonParse(arDispatchConfigJson) : null;
      if (kind === 'automation_rule') {
        const nextErrors = {
          audience: parsedAudience?.ok ? null : parsedAudience?.error,
          variables: parsedVariables?.ok ? null : parsedVariables?.error,
          dispatch: parsedDispatch?.ok ? null : parsedDispatch?.error,
        };
        if (!parsedAudience?.ok || !parsedVariables?.ok || !parsedDispatch?.ok) {
          setJsonErrors(nextErrors);
          setSaving(false);
          return;
        }
        setJsonErrors(null);
      }

      if (kind === 'routing_rule') {
        const target =
          rrRouteTo === 'sector'
            ? activeSectors.find((s) => s.id === rrTargetSectorId)
            : rrRouteTo === 'attendant'
              ? attendants.find((a) => a.id === rrTargetAttendantId)
              : null;
        const payload: RoutingRulePayload = {
          name: draftName.trim(),
          priority: rrPriority,
          profile_type: rrProfile,
          intent_sector_id: rrIntentSectorId ? rrIntentSectorId : null,
          intent: rrIntent.trim() ? rrIntent.trim() : null,
          keywords_any: parseCsv(rrKeywordsAny),
          keywords_all: parseCsv(rrKeywordsAll),
          requires_context_pharmacy: Boolean(rrRequiresContextPharmacy),
          route_to: rrRouteTo,
          target_id:
            rrRouteTo === 'sector'
              ? rrTargetSectorId
              : rrRouteTo === 'attendant'
                ? rrTargetAttendantId
                : null,
          target_name: target?.name || null,
          is_active: enabled,
        };
        if (isEditing && editKind === 'routing_rule') await api.put(`/api/bot/routing-rules/${editId}`, payload);
        else await api.post('/api/bot/routing-rules', payload);
      } else if (kind === 'bot_flow') {
        const payload: BotFlowPayload = {
          name: bfName.trim(),
          trigger_keywords: parseCsv(bfTriggerKeywords),
          message: bfMessage,
          is_active: enabled,
        };
        if (isEditing && editKind === 'bot_flow') await api.put(`/api/bot/flows/${editId}`, payload);
        else await api.post('/api/bot/flows', payload);
      } else if (kind === 'out_of_hours') {
        const channels = (await api.get<{ items: WorkspaceChannel[] }>('/api/integrations/channels')).data.items || [];
        const target = channels.find((ch) => ['whatsapp', 'instagram', 'email'].includes(ch.channel_type));
        if (!target) throw new Error('Configure um webhook em Configurações > Canais para salvar mensagem fora de horário.');
        const operational = parseChannelOperationalConfig(target.config);
        operational.messages.out_of_hours = enabled ? oohMessage : '';
        await updateChannel(target.id, {
          config: serializeChannelOperationalConfig(target.config || {}, operational),
        });
      } else if (kind === 'conversation_flow') {
        const initialGraph: Record<string, unknown> = {
          revive_blocos: triageBlocos,
          wizard_meta: buildWizardMeta(
            model === 'csat'
              ? 'csat'
              : model === 'out_of_hours'
                ? 'out_of_hours'
                : model === 'sla_escalation'
                  ? 'sla_escalation'
                  : 'triagem_perfil',
            cfTrigger,
            cfFilters,
            bindingPriorityFromTier(cfPriorityTier)
          ),
        };
        const bindBody = bindingPayloadFromWizard(cfTrigger, cfFilters, bindingPriorityFromTier(cfPriorityTier), enabled);

        if (isEditing && editKind === 'conversation_flow' && editId && cfEditVersionId) {
          await api.patch(`/api/conversation-flows/definitions/${editId}`, {
            name: draftName.trim(),
            is_active: enabled,
            description: cfDescription.trim() ? cfDescription.trim() : null,
          });
          await api.put(`/api/conversation-flows/versions/${cfEditVersionId}`, { graph: initialGraph });
          try {
            if (cfEditBindingId) {
              await api.patch(`/api/conversation-flows/bindings/${cfEditBindingId}`, bindBody);
            } else {
              await api.post(`/api/conversation-flows/definitions/${editId}/bindings`, bindBody);
            }
          } catch {
            /* migration 030 opcional */
          }
        } else {
          const slug = `${slugifyFlowName(draftName)}-${Math.random().toString(36).slice(2, 8)}`;
          const created = await api.post('/api/conversation-flows/definitions', {
            name: draftName.trim(),
            slug,
            description: cfDescription.trim() ? cfDescription.trim() : null,
            initial_graph: initialGraph,
          });
          const defId = String(created.data?.definition?.id || '');
          if (!defId) throw new Error('Resposta inválida ao criar fluxo.');
          try {
            await api.post(`/api/conversation-flows/definitions/${defId}/bindings`, bindBody);
          } catch {
            /* migration 030 opcional */
          }
          router.push(`/automacoes/nova?kind=conversation_flow&id=${defId}`);
          return;
        }
      } else {
        const ev = arTriggerType === 'event' ? (arEventType === 'custom' ? arEventTypeCustom : arEventType) : null;
        const payload: AutomationRulePayload = {
          name: draftName.trim(),
          trigger_type: arTriggerType,
          cron_expression: arTriggerType === 'schedule' ? (arCron.trim() || null) : null,
          event_type: arTriggerType === 'event' ? (ev?.trim() || null) : null,
          audience_type: arAudience,
          audience_filters: (parsedAudience && parsedAudience.ok ? parsedAudience.value : {}) as Record<string, unknown>,
          template_id: arTemplateId || null,
          variables_mapping: (parsedVariables && parsedVariables.ok ? parsedVariables.value : {}) as Record<string, unknown>,
          dispatch_config: (parsedDispatch && parsedDispatch.ok ? parsedDispatch.value : {}) as Record<string, unknown>,
          is_active: enabled,
          require_approval: Boolean(arRequireApproval),
          notes: arNotes.trim() ? arNotes.trim() : null,
        };
        if (isEditing && editKind === 'automation_rule') await api.put(`/api/automations/${editId}`, payload);
        else await api.post('/api/automations', payload);
      }

      router.push('/automacoes');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Falha ao salvar automação.');
    } finally {
      setSaving(false);
    }
  };

  const [testOpen, setTestOpen] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<{ status: 'ok' | 'fail'; logs: string[] } | null>(null);

  const canTest = kind === 'conversation_flow' && Boolean(cfEditVersionId) && (isAdmin || isSupervisor);
  const runTest = async () => {
    if (!canTest) return;
    setTestRunning(true);
    setTestResult(null);
    try {
      if (kind === 'conversation_flow' && cfEditVersionId) {
        const { data } = await api.post<{
          ok: boolean;
          validation?: { valid?: boolean; issues?: string[]; format?: string };
          trace?: string[];
          format?: string;
        }>('/api/conversation-flows/simulate', {
          version_id: cfEditVersionId,
          input: {},
        });
        const trace = Array.isArray(data.trace) ? data.trace : [];
        const logs = [
          `[API] formato: ${String(data.format || data.validation?.format || '—')}`,
          `[API] ok: ${String(data.ok)} · valid: ${String(data.validation?.valid ?? '—')}`,
          ...(data.validation?.issues?.length ? [`issues: ${data.validation!.issues!.join('; ')}`] : []),
          ...trace.map((t) => `  ${t}`),
        ];
        setTestResult({ status: data.ok !== false ? 'ok' : 'fail', logs });
        return;
      }
      setTestResult({
        status: 'fail',
        logs: [
          'Não há simulação via API para este tipo de automação.',
          'Salve a automação e valide com execuções reais ou fluxos de teste suportados.',
        ],
      });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Falha na simulação.';
      setTestResult({ status: 'fail', logs: [String(msg)] });
    } finally {
      setTestRunning(false);
    }
  };


  return {
    router,
    searchParams,
    isAuthenticated,
    hasHydrated,
    userRole,
    isAdmin,
    isSupervisor,
    canFetch,
    editKind,
    editId,
    isEditing,
    cloneFromKind,
    cloneFromId,
    isCloning,
    step,
    setStep,
    model,
    setModel,
    kind,
    routingRulesQuery,
    botFlowsQuery,
    automationRulesQuery,
    webhookSectorsQuery,
    templatesQuery,
    outOfHoursQuery,
    operationalCatalogQuery,
    attendantsQuery,
    channelsQuery,
    cfSourceId,
    conversationFlowDetailQuery,
    draftName,
    setDraftName,
    enabled,
    setEnabled,
    rrProfile,
    setRrProfile,
    rrIntentSectorId,
    setRrIntentSectorId,
    rrIntent,
    setRrIntent,
    rrKeywordsAny,
    setRrKeywordsAny,
    rrKeywordsAll,
    setRrKeywordsAll,
    rrRequiresContextPharmacy,
    setRrRequiresContextPharmacy,
    rrRouteTo,
    setRrRouteTo,
    rrPriority,
    setRrPriority,
    rrTargetSectorId,
    setRrTargetSectorId,
    rrTargetAttendantId,
    setRrTargetAttendantId,
    bfName,
    setBfName,
    bfTriggerKeywords,
    setBfTriggerKeywords,
    bfMessage,
    setBfMessage,
    oohMessage,
    setOohMessage,
    arTriggerType,
    setArTriggerType,
    arEventType,
    setArEventType,
    arEventTypeCustom,
    setArEventTypeCustom,
    arCron,
    setArCron,
    arAudience,
    setArAudience,
    arTemplateId,
    setArTemplateId,
    arRequireApproval,
    setArRequireApproval,
    arNotes,
    setArNotes,
    arAudienceFiltersJson,
    setArAudienceFiltersJson,
    arVariablesMappingJson,
    setArVariablesMappingJson,
    arDispatchConfigJson,
    setArDispatchConfigJson,
    cfTrigger,
    setCfTrigger,
    cfFilters,
    setCfFilters,
    cfPriorityTier,
    setCfPriorityTier,
    cfDescription,
    setCfDescription,
    cfEditVersionId,
    cfEditBindingId,
    triageBlocos,
    setTriageBlocos,
    jsonErrors,
    setJsonErrors,
    saving,
    setSaving,
    error,
    setError,
    activeSectors,
    attendants,
    canNext,
    canSave,
    previewLines,
    resumoCanais,
    save,
    testOpen,
    setTestOpen,
    testRunning,
    setTestRunning,
    testResult,
    setTestResult,
    canTest,
    runTest,
  };
}

export type AutomationWizardState = ReturnType<typeof useAutomationWizard>;
