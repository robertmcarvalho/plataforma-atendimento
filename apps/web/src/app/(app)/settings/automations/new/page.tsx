'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  CircleCheck,
  Clock,
  GitBranch,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { BlocoCard } from '@/components/conversation-flow/BlocoCard';
import { PaletaBlocos } from '@/components/conversation-flow/PaletaBlocos';
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

type Attendant = { id: string; name: string };
type ApiTemplate = { id: string; name: string };

type RoutingRulePayload = {
  name: string;
  priority: number;
  profile_type: 'driver' | 'pharmacy' | 'leader' | 'unknown' | null;
  intent_sector_id: string | null;
  intent: string | null;
  keywords_any: string[];
  keywords_all: string[];
  requires_context_pharmacy: boolean;
  route_to: 'sector' | 'pharmacy_attendant' | 'attendant';
  target_id: string | null;
  target_name: string | null;
  is_active: boolean;
};

type BotFlowPayload = {
  name: string;
  trigger_keywords: string[];
  message: string;
  is_active: boolean;
};

type AutomationRulePayload = {
  name: string;
  trigger_type: 'event' | 'schedule';
  cron_expression: string | null;
  event_type: string | null;
  audience_type: string | null;
  audience_filters: Record<string, unknown>;
  template_id: string | null;
  variables_mapping: Record<string, unknown>;
  dispatch_config: Record<string, unknown>;
  is_active: boolean;
  require_approval: boolean;
  notes?: string | null;
};

type ModelKey =
  | 'blank'
  | 'triagem_perfil'
  | 'triage_bot'
  | 'keyword_routing'
  | 'out_of_hours'
  | 'csat'
  | 'sla_escalation';
type KindKey = 'automation_rule' | 'routing_rule' | 'bot_flow' | 'out_of_hours' | 'conversation_flow';

type Step = 1 | 2 | 3 | 4;

const stepsMeta = [
  { n: 1, title: 'Modelo' },
  { n: 2, title: 'Gatilho' },
  { n: 3, title: 'Fluxo' },
  { n: 4, title: 'Detalhes' },
] as const;

const templates = [
  { id: 'blank', name: 'Em branco', desc: 'Comece do zero', icon: Sparkles, color: 'text-muted-foreground bg-muted' },
  {
    id: 'triagem_perfil',
    name: 'Triagem por perfil',
    desc: 'Identifica contato, ramifica por perfil e cria pré-cadastro',
    icon: Users,
    color: 'text-primary bg-primary/15',
  },
  { id: 'triage_bot', name: 'Triagem com bot', desc: 'Classifica e roteia conversas', icon: Bot, color: 'text-primary bg-primary/15' },
  { id: 'keyword_routing', name: 'Roteamento por palavra-chave', desc: 'Distribui para filas com base no texto', icon: GitBranch, color: 'text-channel-instagram bg-channel-instagram/15' },
  { id: 'out_of_hours', name: 'Fora do horário', desc: 'Auto-resposta noturna e finais de semana', icon: Clock, color: 'text-warning bg-warning/15' },
  { id: 'csat', name: 'Pesquisa CSAT', desc: 'Envio automático após resolução', icon: MessageSquare, color: 'text-channel-whatsapp bg-channel-whatsapp/15' },
  { id: 'sla_escalation', name: 'Escalação por SLA', desc: 'Aciona supervisor quando o SLA estoura', icon: Zap, color: 'text-destructive bg-destructive/15' },
] as const satisfies ReadonlyArray<{
  id: ModelKey;
  name: string;
  desc: string;
  icon: any;
  color: string;
}>;

const automationRuleTriggers = [
  { id: 'schedule', label: 'Agendamento', desc: 'Recorrência por horário/cron', icon: Clock },
  { id: 'installment_due_weekly', label: 'Desconto semanal', desc: 'Aviso semanal de desconto (seg 08:00)', icon: Clock },
  { id: 'sla_80_alert', label: 'SLA 80% (tickets)', desc: 'Quando o SLA se aproxima do limite', icon: Zap },
  { id: 'sla_escalated', label: 'SLA escalonado (tickets)', desc: 'Quando ocorrer escalonamento de SLA', icon: Zap },
  { id: 'sla_daily_report', label: 'Relatório diário (tickets)', desc: 'Resumo diário de tickets por supervisor', icon: Clock },
  { id: 'csat', label: 'CSAT', desc: 'Pesquisa após conversa resolvida', icon: MessageSquare },
  { id: 'custom', label: 'Personalizado', desc: 'Use um evento customizado do runtime', icon: Sparkles },
] as const;

function parseCsv(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function safeJsonParse(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') return { ok: true as const, value: parsed as Record<string, unknown> };
    return { ok: false as const, error: 'JSON inválido' };
  } catch {
    return { ok: false as const, error: 'JSON inválido' };
  }
}

function slugifyFlowName(name: string): string {
  const base = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return base.length >= 2 ? base : 'fluxo';
}

function JsonTextarea({
  label,
  value,
  onChange,
  hint,
  error,
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string | null;
  id: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="min-h-[120px] rounded-lg border border-border bg-background/40 p-3 font-mono text-[12px] text-foreground outline-none focus:ring-2 focus:ring-primary/40"
      />
      {hint ? <span className="text-[11px] text-subtle-foreground">{hint}</span> : null}
      {error ? <span className="text-[11px] font-semibold text-destructive">{error}</span> : null}
    </label>
  );
}

function stepLabel(step: number, kind: KindKey) {
  if (step === 1) return 'Modelo';
  if (step === 2) return 'Gatilho';
  if (step === 3) return kind === 'conversation_flow' ? 'Fluxo' : 'Ações';
  return 'Detalhes';
}

function inferKindFromModel(model: ModelKey): KindKey {
  if (model === 'triagem_perfil' || model === 'csat' || model === 'out_of_hours' || model === 'sla_escalation') return 'conversation_flow';
  if (model === 'triage_bot') return 'bot_flow';
  if (model === 'keyword_routing') return 'routing_rule';
  return 'automation_rule';
}

export default function NewAutomationWizardPage() {
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
  const [oohMessage, setOohMessage] = useState(
    'Obrigado pelo contato. No momento estamos fora do horario de atendimento. Voltamos em {{next_open_at}}.'
  );

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

  const stepper = (
    <div className="mb-6 flex items-center gap-2 rounded-xl border border-border bg-surface p-3">
      {stepsMeta.map((s, i) => {
        const active = step === s.n;
        const done = step > s.n;
        return (
          <div key={s.n} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(s.n)}
              className={cn(
                'w-full rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-2',
                active && 'bg-primary/15 text-primary',
                done && 'text-success',
                !active && !done && 'text-muted-foreground hover:bg-surface-hover'
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-mono',
                  active ? 'bg-primary text-primary-foreground' : done ? 'bg-success text-success-foreground' : 'bg-muted'
                )}
              >
                {done ? <Check className="h-3 w-3" /> : s.n}
              </span>
              {stepLabel(s.n, kind)}
            </button>
            {i < stepsMeta.length - 1 ? <ChevronRight className="h-3.5 w-3.5 text-subtle-foreground" /> : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <form onSubmit={(e) => void save(e)} className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <Link href="/automacoes" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Automações
        </Link>

        <PageHeader
          eyebrow={isEditing ? 'Inteligência · Editar' : 'Inteligência · Nova'}
          title={isEditing ? 'Editar automação' : 'Criar automação'}
          description="Defina o gatilho, as ações e os detalhes do fluxo."
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.push('/automacoes')}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-hover transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!canTest}
                onClick={() => {
                  setTestOpen(true);
                  setTestResult(null);
                }}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-hover transition-colors disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" /> Testar
              </button>
              <button
                type="submit"
                disabled={!canSave || saving}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors disabled:opacity-50"
              >
                {saving ? 'Salvando…' : 'Salvar automação'}
              </button>
            </div>
          }
        />

        {stepper}
        <div className="hidden mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href="/automacoes" className="mb-2 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
              ‹ Automações
            </Link>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-subtle-foreground">Inteligência · Nova</div>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight-2 text-foreground">Criar automação</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">Defina o gatilho, as ações e os detalhes do fluxo.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/automacoes"
              className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              Cancelar
            </Link>
            <button
              type="button"
              disabled
              className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground opacity-60"
              title="Ainda não implementado"
            >
              Testar
            </button>
            <button
              type="submit"
              disabled={!canSave || saving}
              className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-glow disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Salvar automação'}
            </button>
          </div>
        </div>

        <div className="hidden mb-4">{stepper}</div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="rounded-xl border border-border bg-surface p-6">
              {step === 1 ? (
                <>
                  <div className="text-sm font-semibold tracking-tight text-foreground">Escolha um ponto de partida</div>
                  <div className="mt-1 text-xs text-muted-foreground">Modelos pré-configurados aceleram a criação. Você pode ajustar tudo depois.</div>

                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {templates.map((t) => {
                      const Icon = t.icon;
                      const selected = model === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setModel(t.id)}
                          className={cn(
                            'flex items-start gap-3 rounded-lg border p-4 text-left transition-all',
                            selected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-background/40 hover:border-border-strong'
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', t.color)}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium">{t.name}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">{t.desc}</div>
                            </div>
                          </div>
                          {selected ? <Check className="h-4 w-4 text-primary" /> : null}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      disabled
                      className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      disabled={!canNext}
                      className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors disabled:opacity-50"
                    >
                      Próximo <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              ) : step === 2 ? (
                <>
                  <div className="text-sm font-semibold tracking-tight text-foreground">Gatilho</div>
                  <div className="mt-1 text-xs text-muted-foreground">Defina quando esta automação deve executar.</div>

                  <div className="mt-4 grid grid-cols-1 gap-3">
                    {kind === 'routing_rule' ? (
                      <>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Perfil (opcional)</span>
                          <select
                            value={rrProfile || ''}
                            onChange={(e) => setRrProfile((e.target.value || null) as any)}
                            className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            <option value="">Qualquer</option>
                            <option value="driver">Entregador</option>
                            <option value="pharmacy">Farmácia</option>
                            <option value="leader">Líder</option>
                            <option value="unknown">Desconhecido</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Intent por setor (opcional)</span>
                          <select
                            value={rrIntentSectorId}
                            onChange={(e) => setRrIntentSectorId(e.target.value)}
                            className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            <option value="">—</option>
                            {activeSectors.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Intent (texto legado, opcional)</span>
                          <input
                            value={rrIntent}
                            onChange={(e) => setRrIntent(e.target.value)}
                            className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                            placeholder="Ex: Operacional"
                          />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Palavras-chave (qualquer) — separadas por vírgula</span>
                          <input
                            value={rrKeywordsAny}
                            onChange={(e) => setRrKeywordsAny(e.target.value)}
                            className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                            placeholder="Ex: atraso, falta, cobertura"
                          />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Palavras-chave (todas) — separadas por vírgula</span>
                          <input
                            value={rrKeywordsAll}
                            onChange={(e) => setRrKeywordsAll(e.target.value)}
                            className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                            placeholder="Ex: pagamento, não recebido"
                          />
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={rrRequiresContextPharmacy}
                            onChange={(e) => setRrRequiresContextPharmacy(e.target.checked)}
                          />
                          <span className="text-xs text-muted-foreground">Requer contexto de farmácia (quando aplicável)</span>
                        </label>
                      </>
                    ) : kind === 'bot_flow' ? (
                      <>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Chave do bot (usada pelo runtime)</span>
                          <input
                            value={bfName}
                            onChange={(e) => setBfName(e.target.value)}
                            className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                          />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Keywords (opcional) — separadas por vírgula</span>
                          <input
                            value={bfTriggerKeywords}
                            onChange={(e) => setBfTriggerKeywords(e.target.value)}
                            className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </label>
                      </>
                    ) : kind === 'out_of_hours' ? (
                      <div className="rounded-lg border border-border bg-background/40 p-3 text-sm text-muted-foreground">
                        Ativa quando a conversa entra em um setor fechado.
                      </div>
                    ) : kind === 'conversation_flow' ? (
                      <div className="grid grid-cols-1 gap-4">
                        <p className="text-xs text-muted-foreground">
                          O fluxo é salvo como <strong className="text-foreground">rascunho versionado</strong> com{' '}
                          <span className="font-mono">revive_blocos</span>. Para executar no motor, publique também DSL v2 em{' '}
                          <span className="font-mono">/automacoes/fluxos</span>.
                        </p>

                        <div>
                          <div className="text-xs font-medium text-foreground">Quando esta automação deve disparar?</div>
                          {model === 'csat' ? (
                            <div className="mt-2">
                              <div
                                className="flex items-start gap-3 rounded-lg border border-primary bg-primary/5 p-3 text-left ring-1 ring-primary/30"
                                role="status"
                              >
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                                  <CircleCheck className="h-4 w-4 text-primary" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium">Conversa resolvida</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">Quando o atendente finaliza</div>
                                </div>
                                <Check className="mt-1 h-4 w-4 shrink-0 text-primary" />
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <button
                                type="button"
                                onClick={() => setCfTrigger('message_received')}
                                className={cn(
                                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                                  cfTrigger === 'message_received'
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                    : 'border-border bg-background/40 hover:border-border-strong'
                                )}
                              >
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium">Mensagem recebida</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">A cada mensagem do cliente</div>
                                </div>
                                {cfTrigger === 'message_received' ? <Check className="mt-1 h-4 w-4 text-primary" /> : null}
                              </button>
                              <button
                                type="button"
                                onClick={() => setCfTrigger('conversation_started')}
                                className={cn(
                                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                                  cfTrigger === 'conversation_started'
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                    : 'border-border bg-background/40 hover:border-border-strong'
                                )}
                              >
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                                  <Play className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium">Nova conversa</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">Na abertura do ticket/conversa</div>
                                </div>
                                {cfTrigger === 'conversation_started' ? <Check className="mt-1 h-4 w-4 text-primary" /> : null}
                              </button>
                              <button
                                type="button"
                                onClick={() => setCfTrigger('conversation_resolved')}
                                className={cn(
                                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                                  cfTrigger === 'conversation_resolved'
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                    : 'border-border bg-background/40 hover:border-border-strong'
                                )}
                              >
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                                  <CircleCheck className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium">Conversa resolvida</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">Quando o atendimento é finalizado</div>
                                </div>
                                {cfTrigger === 'conversation_resolved' ? <Check className="mt-1 h-4 w-4 text-primary" /> : null}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCfTrigger('message_received');
                                  setCfFilters((prev) =>
                                    prev.some((f) => f.field === 'message_text' && f.textValue === 'sla_critical')
                                      ? prev
                                      : [...prev, newCfFilterRow({ field: 'message_text', op: 'contains', textValue: 'sla_critical' })]
                                  );
                                }}
                                className={cn(
                                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                                  model === 'sla_escalation'
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                    : 'border-border bg-background/40 hover:border-border-strong'
                                )}
                              >
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                                  <Zap className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium">SLA crítico</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">Prioriza quando a política de SLA sinaliza risco</div>
                                </div>
                                {model === 'sla_escalation' ? <Check className="mt-1 h-4 w-4 text-primary" /> : null}
                              </button>
                              {[
                                { label: 'Agendamento', desc: 'Disparo por agenda/cron', icon: Clock },
                                { label: 'Webhook', desc: 'Disparo externo via integração', icon: GitBranch },
                              ].map((t) => {
                                const Icon = t.icon;
                                return (
                                  <button
                                    key={t.label}
                                    type="button"
                                    disabled
                                    className="flex items-start gap-3 rounded-lg border border-border bg-background/25 p-3 text-left opacity-60"
                                    title="Disponível para regras de automação legadas"
                                  >
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                                      <Icon className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="flex-1">
                                      <div className="text-sm font-medium">{t.label}</div>
                                      <div className="mt-0.5 text-[11px] text-muted-foreground">{t.desc}</div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="rounded-lg border border-border border-dashed bg-background/30 p-3">
                          <div className="text-xs font-medium text-foreground">Filtros (opcional)</div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Primeiro escolha o <strong className="text-foreground">tipo de canal</strong> (opcional) e depois a{' '}
                            <strong className="text-foreground">conexão</strong> concreta do workspace. A operação &quot;não é&quot; no canal pode ficar só no
                            rascunho até o motor suportar negação no binding.
                          </p>
                          <p className="mt-2 text-[10px] text-muted-foreground">
                            Demandas, mensagens, SLA, filas e tags são lidos dos webhooks em Configurações → Canais.
                          </p>
                          <div className="mt-3 space-y-2">
                            {cfFilters.length === 0 ? (
                              <p className="text-[11px] text-muted-foreground">Nenhum filtro — aplica a todos os canais (conforme binding).</p>
                            ) : (
                              cfFilters.map((row) => (
                                <div key={row.id} className="flex flex-wrap items-end gap-2 rounded-md border border-border/60 bg-background/40 p-2">
                                  <label className="flex min-w-[120px] flex-1 flex-col gap-1">
                                    <span className="text-[10px] text-muted-foreground">Campo</span>
                                    <select
                                      value={row.field}
                                      onChange={(e) => {
                                        const field = e.target.value as CfFilterRow['field'];
                                        setCfFilters((prev) =>
                                          prev.map((r) =>
                                            r.id === row.id
                                              ? {
                                                  ...r,
                                                  field,
                                                  channelId: field === 'message_text' ? '' : r.channelId,
                                                  textValue: field === 'channel' ? '' : r.textValue,
                                                  channelTypeFilter: field === 'channel' ? r.channelTypeFilter || '' : '',
                                                }
                                              : r
                                          )
                                        );
                                      }}
                                      className="rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40"
                                    >
                                      <option value="channel">Canal</option>
                                      <option value="message_text">Texto da mensagem</option>
                                    </select>
                                  </label>
                                  <label className="flex min-w-[100px] flex-col gap-1">
                                    <span className="text-[10px] text-muted-foreground">Operador</span>
                                    <select
                                      value={row.op}
                                      onChange={(e) =>
                                        setCfFilters((prev) =>
                                          prev.map((r) => (r.id === row.id ? { ...r, op: e.target.value as CfFilterRow['op'] } : r))
                                        )
                                      }
                                      className="rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40"
                                    >
                                      <option value="eq">é</option>
                                      <option value="ne">não é</option>
                                      <option value="contains">contém</option>
                                      <option value="starts_with">começa com</option>
                                    </select>
                                  </label>
                                  {row.field === 'channel' ? (
                                    <>
                                      <label className="flex min-w-[130px] flex-col gap-1">
                                        <span className="text-[10px] text-muted-foreground">Tipo de canal</span>
                                        <select
                                          value={row.channelTypeFilter || ''}
                                          onChange={(e) => {
                                            const v = e.target.value;
                                            setCfFilters((prev) =>
                                              prev.map((r) => (r.id === row.id ? { ...r, channelTypeFilter: v, channelId: '' } : r))
                                            );
                                          }}
                                          className="rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40"
                                        >
                                          <option value="">Todos</option>
                                          {groupWorkspaceChannelsByType(channelsQuery.data || []).map((g) => (
                                            <option key={g.type} value={g.type}>
                                              {g.label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      <label className="flex min-w-[200px] flex-[2] flex-col gap-1">
                                        <span className="text-[10px] text-muted-foreground">Conexão (integração)</span>
                                        <select
                                          value={row.channelId}
                                          onChange={(e) =>
                                            setCfFilters((prev) =>
                                              prev.map((r) => (r.id === row.id ? { ...r, channelId: e.target.value } : r))
                                            )
                                          }
                                          className="rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40"
                                        >
                                          <option value="">—</option>
                                          {groupWorkspaceChannelsByType(channelsQuery.data || [])
                                            .filter((g) => !row.channelTypeFilter || g.type === row.channelTypeFilter)
                                            .map((g) => (
                                              <optgroup key={g.type} label={g.label}>
                                                {g.items.map((ch) => (
                                                  <option key={ch.id} value={ch.id}>
                                                    {(ch.display_name || '').trim() || formatChannelOption(ch)}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            ))}
                                        </select>
                                      </label>
                                    </>
                                  ) : (
                                    <label className="flex min-w-[160px] flex-[2] flex-col gap-1">
                                      <span className="text-[10px] text-muted-foreground">Valor</span>
                                      <input
                                        value={row.textValue}
                                        onChange={(e) =>
                                          setCfFilters((prev) =>
                                            prev.map((r) => (r.id === row.id ? { ...r, textValue: e.target.value } : r))
                                          )
                                        }
                                        className="rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40"
                                        placeholder="Ex.: ajuda"
                                      />
                                    </label>
                                  )}
                                  <button
                                    type="button"
                                    aria-label="Remover condição"
                                    onClick={() => setCfFilters((prev) => prev.filter((r) => r.id !== row.id))}
                                    className="mb-0.5 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setCfFilters((prev) => [...prev, newCfFilterRow()])}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            <Plus className="h-3.5 w-3.5" /> Adicionar condição
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {automationRuleTriggers.map((t) => {
                            const Icon = t.icon;
                            const selected =
                              t.id === 'schedule'
                                ? arTriggerType === 'schedule'
                                : arTriggerType === 'event' && arEventType === t.id;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                  if (t.id === 'schedule') {
                                    setArTriggerType('schedule');
                                    return;
                                  }
                                  setArTriggerType('event');
                                  setArEventType(t.id);
                                  if (t.id !== 'custom') setArEventTypeCustom('');
                                }}
                                className={cn(
                                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                                  selected
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                    : 'border-border bg-background/40 hover:border-border-strong'
                                )}
                              >
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                                  <Icon className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium">{t.label}</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">{t.desc}</div>
                                </div>
                                {selected ? <Check className="mt-1 h-4 w-4 text-primary" /> : null}
                              </button>
                            );
                          })}
                        </div>
                        <div className="hidden">
                          {arTriggerType === 'event' ? (
                          <>
                            <label className="flex flex-col gap-2">
                              <span className="text-xs text-muted-foreground">Evento</span>
                              <select
                                value={arEventType}
                                onChange={(e) => setArEventType(e.target.value)}
                                className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                              >
                                <option value="installment_due_weekly">Desconto semanal</option>
                                <option value="sla_80_alert">SLA 80% (tickets)</option>
                                <option value="sla_escalated">SLA escalonado (tickets)</option>
                                <option value="sla_daily_report">Relatório diário (tickets)</option>
                                <option value="csat">CSAT</option>
                                <option value="custom">Personalizado</option>
                              </select>
                            </label>
                            {arEventType === 'custom' ? (
                              <label className="flex flex-col gap-2">
                                <span className="text-xs text-muted-foreground">Evento (custom)</span>
                                <input
                                  value={arEventTypeCustom}
                                  onChange={(e) => setArEventTypeCustom(e.target.value)}
                                  className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                                  placeholder="Ex: ticket_resolved"
                                />
                              </label>
                            ) : null}
                          </>
                        ) : (
                          <label className="flex flex-col gap-2">
                            <span className="text-xs text-muted-foreground">Cron</span>
                            <input
                              value={arCron}
                              onChange={(e) => setArCron(e.target.value)}
                              className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                            />
                          </label>
                        )}
                        </div>

                        {arTriggerType === 'schedule' ? (
                          <label className="flex flex-col gap-2">
                            <span className="text-xs text-muted-foreground">Cron</span>
                            <input
                              value={arCron}
                              onChange={(e) => setArCron(e.target.value)}
                              className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                            />
                          </label>
                        ) : arEventType === 'custom' ? (
                          <label className="flex flex-col gap-2">
                            <span className="text-xs text-muted-foreground">Evento (custom)</span>
                            <input
                              value={arEventTypeCustom}
                              onChange={(e) => setArEventTypeCustom(e.target.value)}
                              className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                              placeholder="Ex: ticket_resolved"
                            />
                          </label>
                        ) : null}
                      </>
                    )}
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      disabled={!canNext}
                      className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors disabled:opacity-50"
                    >
                      Próximo <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              ) : step === 3 ? (
                <>
                  <div className="text-sm font-semibold tracking-tight text-foreground">
                    {kind === 'conversation_flow' ? 'Fluxo de atendimento' : 'Ações'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {kind === 'conversation_flow'
                      ? model === 'csat'
                        ? 'Pergunta e escala da pesquisa; o envio ocorre após resolução conforme gatilho e filtros.'
                        : 'Entregador, farmácia e líder em ramos separados; contato desconhecido passa por menu e fallback “Não entendi”.'
                      : 'Defina o que acontece quando o gatilho disparar.'}
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3">
                    {kind === 'routing_rule' ? (
                      <>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Encaminhar para</span>
                          <select
                            value={rrRouteTo}
                            onChange={(e) => setRrRouteTo(e.target.value as any)}
                            className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            <option value="sector">Fila / setor</option>
                            <option value="attendant">Atendente</option>
                            <option value="pharmacy_attendant">Atendente da farmácia</option>
                          </select>
                        </label>

                        {rrRouteTo === 'sector' ? (
                          <label className="flex flex-col gap-2">
                            <span className="text-xs text-muted-foreground">Fila / setor alvo</span>
                            <select
                              value={rrTargetSectorId}
                              onChange={(e) => setRrTargetSectorId(e.target.value)}
                              className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                            >
                              <option value="">Selecione…</option>
                              {activeSectors.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : rrRouteTo === 'attendant' ? (
                          <label className="flex flex-col gap-2">
                            <span className="text-xs text-muted-foreground">Atendente alvo</span>
                            <select
                              value={rrTargetAttendantId}
                              onChange={(e) => setRrTargetAttendantId(e.target.value)}
                              className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                            >
                              <option value="">Selecione…</option>
                              {attendants.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <div className="rounded-lg border border-border bg-background/40 p-3 text-sm text-muted-foreground">
                            Encaminha para o atendente vinculado à farmácia do contexto (requer contexto de farmácia no runtime).
                          </div>
                        )}

                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Prioridade</span>
                          <input
                            type="number"
                            value={rrPriority}
                            onChange={(e) => setRrPriority(Number(e.target.value))}
                            className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                            inputMode="numeric"
                          />
                        </label>
                      </>
                    ) : kind === 'bot_flow' ? (
                      <label className="flex flex-col gap-2">
                        <span className="text-xs text-muted-foreground">Mensagem</span>
                        <textarea
                          value={bfMessage}
                          onChange={(e) => setBfMessage(e.target.value)}
                          className="min-h-[160px] rounded-lg border border-border bg-background/40 p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                          spellCheck={false}
                        />
                      </label>
                    ) : kind === 'out_of_hours' ? (
                      <label className="flex flex-col gap-2">
                        <span className="text-xs text-muted-foreground">Mensagem</span>
                        <textarea
                          value={oohMessage}
                          onChange={(e) => setOohMessage(e.target.value)}
                          className="min-h-[160px] rounded-lg border border-border bg-background/40 p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                          spellCheck={false}
                        />
                      </label>
                    ) : kind === 'conversation_flow' ? (
                      <div className="space-y-3">
                        {model === 'csat' ? (
                          <p className="text-[11px] text-muted-foreground">
                            Adicione e configure o bloco abaixo. O fluxo é salvo como rascunho versionado em{' '}
                            <span className="font-mono">revive_blocos</span>; publique DSL v2 em{' '}
                            <span className="font-mono">/automacoes/fluxos</span> para o motor.
                          </p>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-background/40 px-3 py-2">
                            <span className="text-[11px] text-muted-foreground">Adicionar bloco na raiz</span>
                            <PaletaBlocos onAdd={(tipo: BlocoTipo) => setTriageBlocos((prev) => [...prev, novoBloco(tipo)])} />
                          </div>
                        )}
                        {triageBlocos.length === 0 ? (
                          <p className="rounded-lg border border-border/60 bg-background/30 px-3 py-6 text-center text-xs text-muted-foreground">
                            Nenhum bloco na raiz.
                          </p>
                        ) : (
                          <div className="max-h-[min(520px,60vh)] space-y-2 overflow-y-auto pr-1">
                            {triageBlocos.map((b) => (
                              <BlocoCard
                                key={b.id}
                                bloco={b}
                                showRemove={model !== 'csat'}
                                onConfigChange={(id, key, value) =>
                                  setTriageBlocos((prev) => updateBlocoConfig(prev, id, key, value))
                                }
                                onRemove={(id) => setTriageBlocos((prev) => removeBloco(prev, id))}
                                onToggle={(id) => setTriageBlocos((prev) => toggleCollapse(prev, id))}
                                onAddToBranch={(parentId, ramo, tipo) =>
                                  setTriageBlocos((prev) => addBlocoToBranch(prev, parentId, ramo, novoBloco(tipo)))
                                }
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Público</span>
                          <select
                            value={arAudience}
                            onChange={(e) => setArAudience(e.target.value)}
                            className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            <option value="drivers">Entregadores</option>
                            <option value="leaders">Líderes</option>
                            <option value="pharmacies">Farmácias</option>
                            <option value="custom">Personalizado</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Template</span>
                          <select
                            value={arTemplateId}
                            onChange={(e) => setArTemplateId(e.target.value)}
                            className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            {(templatesQuery.data || []).map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep(4)}
                      disabled={!canNext}
                      className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors disabled:opacity-50"
                    >
                      Próximo <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm font-semibold tracking-tight text-foreground">Detalhes</div>
                  <div className="mt-1 text-xs text-muted-foreground">Nome e status da automação.</div>

                  <div className="mt-4 grid grid-cols-1 gap-3">
                    <label className="flex flex-col gap-2">
                      <span className="text-xs text-muted-foreground">Nome</span>
                      <input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                      <span className="text-xs text-muted-foreground">Ativa</span>
                    </label>
                    {kind === 'conversation_flow' ? (
                      <>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Descrição interna (opcional)</span>
                          <textarea
                            value={cfDescription}
                            onChange={(e) => setCfDescription(e.target.value)}
                            rows={3}
                            spellCheck={false}
                            placeholder="Notas para a equipa (não é mensagem ao cliente)."
                            className="rounded-lg border border-border bg-background/40 p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </label>
                        <div>
                          <span className="text-xs text-muted-foreground">Prioridade do binding</span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(
                              [
                                { id: 'low' as const, label: 'Baixa' },
                                { id: 'medium' as const, label: 'Média' },
                                { id: 'high' as const, label: 'Alta' },
                              ] as const
                            ).map((tier) => (
                              <button
                                key={tier.id}
                                type="button"
                                onClick={() => setCfPriorityTier(tier.id)}
                                className={cn(
                                  'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                                  cfPriorityTier === tier.id
                                    ? 'border-primary bg-primary/15 text-primary ring-1 ring-primary/30'
                                    : 'border-border bg-background/40 text-muted-foreground hover:border-border-strong'
                                )}
                              >
                                {tier.label}
                              </button>
                            ))}
                          </div>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Quando existirem vários fluxos, prioridade mais alta avalia antes (valor numérico gravado no binding).
                          </p>
                        </div>
                      </>
                    ) : null}
                    {kind === 'automation_rule' ? (
                      <>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={arRequireApproval}
                            onChange={(e) => setArRequireApproval(e.target.checked)}
                          />
                          <span className="text-xs text-muted-foreground">Exigir aprovação antes de executar</span>
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Observações</span>
                          <textarea
                            value={arNotes}
                            onChange={(e) => setArNotes(e.target.value)}
                            className="min-h-[90px] rounded-lg border border-border bg-background/40 p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                            spellCheck={false}
                          />
                        </label>

                        <JsonTextarea
                          id="audience_filters_json"
                          label="Audience filters (JSON)"
                          value={arAudienceFiltersJson}
                          onChange={setArAudienceFiltersJson}
                          hint='Ex.: { "city": "Belo Horizonte" }'
                          error={jsonErrors?.audience}
                        />
                        <JsonTextarea
                          id="variables_mapping_json"
                          label="Variables mapping (JSON)"
                          value={arVariablesMappingJson}
                          onChange={setArVariablesMappingJson}
                          hint="Mapeia variáveis do template a partir de context.* e source.*"
                          error={jsonErrors?.variables}
                        />
                        <JsonTextarea
                          id="dispatch_config_json"
                          label="Dispatch config (JSON)"
                          value={arDispatchConfigJson}
                          onChange={setArDispatchConfigJson}
                          hint="Ex.: batch_size, pause_between_messages_ms, max_per_hour…"
                          error={jsonErrors?.dispatch}
                        />
                      </>
                    ) : null}
                    {error ? <div className="text-xs text-destructive">{error}</div> : null}
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => setStep(Math.max(1, step - 1) as Step)}
                      disabled={false}
                      className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                    >
                      Voltar
                    </button>
                    {step < 4 ? (
                      <button
                        type="button"
                        onClick={() => setStep(Math.min(4, step + 1) as Step)}
                        disabled={!canNext}
                        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors disabled:opacity-50"
                      >
                        Próximo <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!canSave || saving}
                        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" /> {isEditing ? 'Salvar automação' : 'Criar automação'}
                      </button>
                    )}
                  </div>

                  <div className="hidden mt-5 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      className="rounded-md border border-border bg-background/40 px-4 py-2 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                    >
                      ‹ Voltar
                    </button>
                    <button
                      type="submit"
                      disabled={!canSave || saving}
                      className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-glow disabled:opacity-60"
                    >
                      {saving ? 'Salvando…' : 'Salvar automação'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div>
            <div className="rounded-xl border border-border bg-surface p-6">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">Resumo</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="text-muted-foreground">Modelo</div>
                <div className="text-foreground font-medium">
                  {model === 'blank'
                    ? 'Em branco'
                    : model === 'triagem_perfil'
                      ? 'Triagem por perfil'
                      : model === 'triage_bot'
                      ? 'Triagem com bot'
                      : model === 'keyword_routing'
                        ? 'Roteamento por palavra-chave'
                        : model === 'out_of_hours'
                          ? 'Fora do horário'
                          : model === 'csat'
                            ? 'Pesquisa CSAT'
                            : 'Escalação por SLA'}
                </div>

                <div className="text-muted-foreground">Gatilho</div>
                <div className="text-foreground font-medium">
                  {kind === 'out_of_hours'
                    ? 'Fora do horário'
                    : kind === 'conversation_flow'
                      ? step >= 2
                        ? cfTrigger === 'conversation_started'
                          ? 'Nova conversa'
                          : cfTrigger === 'conversation_resolved'
                            ? 'Conversa resolvida'
                            : 'Mensagem recebida'
                        : '—'
                      : step >= 2
                        ? kind === 'automation_rule'
                          ? arTriggerType === 'schedule'
                            ? 'Cron'
                            : 'Evento'
                          : 'Inbound'
                        : '—'}
                </div>

                <div className="text-muted-foreground">
                  {kind === 'conversation_flow' ? 'Blocos do fluxo' : 'Ações'}
                </div>
                <div className="text-foreground font-medium">
                  {kind === 'conversation_flow'
                    ? String(countBlocos(triageBlocos))
                    : kind === 'routing_rule' || kind === 'bot_flow' || kind === 'out_of_hours'
                      ? '1'
                      : step >= 3
                        ? '1'
                        : '0'}
                </div>

                <div className="text-muted-foreground">Canais</div>
                <div className="text-foreground font-medium">{resumoCanais}</div>

                <div className="text-muted-foreground">Nome</div>
                <div className="text-foreground font-medium truncate">{draftName || 'Sem título'}</div>
              </div>

              <div className="mt-5 rounded-xl border border-border bg-background/40 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">Pré-visualização</div>
                <pre className="mt-3 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {previewLines.map((l) => ` ${l}`).join('\n')}
                </pre>
              </div>
            </div>
          </div>
        </div>

        {testOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setTestOpen(false)}>
            <div className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-elevated" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Teste via API</div>
                  <div className="text-sm font-semibold">Simular fluxo versionado</div>
                </div>
                <button type="button" onClick={() => setTestOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-5 py-4">
                <div className="rounded-lg border border-border bg-background/60 p-3">
                  <div className="mb-1.5 text-[10px] uppercase tracking-wider text-subtle-foreground">Payload simulado</div>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
{JSON.stringify(
  {
    model,
    kind,
    trigger: kind === 'automation_rule' ? (arTriggerType === 'schedule' ? 'schedule' : arEventType === 'custom' ? arEventTypeCustom : arEventType) : kind,
    name: draftName || '',
  },
  null,
  2
)}
                  </pre>
                </div>

                {testResult ? (
                  <div className="mt-3 rounded-lg border border-border bg-background/60 p-3">
                    <div className="mb-1.5 text-[10px] uppercase tracking-wider text-subtle-foreground">
                      Resultado · {testResult.status === 'ok' ? 'Sucesso' : 'Falha'}
                    </div>
                    <div className="space-y-0.5 font-mono text-[11px] text-muted-foreground max-h-48 overflow-y-auto">
                      {testResult.logs.map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
                <button
                  type="button"
                  onClick={() => setTestOpen(false)}
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-hover"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={() => void runTest()}
                  disabled={testRunning || !canTest}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow disabled:opacity-50"
                >
                  {testRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {testRunning ? 'Executando…' : testResult ? 'Executar novamente' : 'Executar teste'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </form>
  );
}
