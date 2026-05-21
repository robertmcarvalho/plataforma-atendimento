'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Key,
  Layers,
  ListChecks,
  MessageSquare,
  Plus,
  Route,
  Send,
  Settings2,
  ShieldCheck,
  Tag,
  Timer,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  CHANNEL_INTAKE_MESSAGE_KEYS,
  INTAKE_MESSAGE_LABELS,
  defaultChannelIntakeMessages,
} from '@plataforma/channel-runtime';
import {
  channelStatusFromUi,
  parseChannelOperationalConfig,
  registerMetaWebhook,
  serializeChannelOperationalConfig,
  slugDemandTitle,
  testChannelConnection,
  updateChannel,
  type ChannelBusinessHours,
  type ChannelDemand,
  type ChannelOperationalConfig,
  type ChannelQueue,
  type ChannelQueuePriority,
  type ChannelSectorConfig,
  type SectorOption,
  type WorkspaceChannel,
} from '@/lib/integrations/channelsApi';
import {
  MACRO_SECTOR_NAMES,
  buildOperationalSectorsQueuesPreset,
  reviveUiFromOperationalPreset,
} from '@/lib/integrations/operationalSectorsQueuesPreset';

type Kind = 'whatsapp' | 'instagram';
type PerfilId = 'entregador' | 'farmacia' | 'lider';
type TabId = 'credenciais' | 'setores' | 'demandas' | 'sla' | 'rota' | 'mensagens' | 'perfis' | 'operacao';

type Fila = {
  name: string;
  setores: string[];
  notifyEmail?: string;
  capacidade?: number;
  prioridade?: 'baixa' | 'media' | 'alta' | 'urgente';
  atendentes?: string[];
  transbordoPara?: string;
  slaPrimeiraResposta?: number;
  slaResolucao?: number;
};

type SetorCfg = {
  id: string;
  name: string;
  gestorEscalacao?: string;
  demandas: string[];
  isActive?: boolean;
};

type DemandaSlaOverride = {
  setor: string;
  demanda: string;
  slaPrimeiraResposta?: number;
  slaResolucao?: number;
};

type HorarioComercial = {
  dom: { ativo: boolean; inicio: string; fim: string };
  seg: { ativo: boolean; inicio: string; fim: string };
  ter: { ativo: boolean; inicio: string; fim: string };
  qua: { ativo: boolean; inicio: string; fim: string };
  qui: { ativo: boolean; inicio: string; fim: string };
  sex: { ativo: boolean; inicio: string; fim: string };
  sab: { ativo: boolean; inicio: string; fim: string };
};

type MensagensPadrao = {
  saudacao: string;
  foraHorario: string;
  filaCheia: string;
  encerramento: string;
  csat: string;
};

type PessoaOption = { id: string; label: string; role?: string };

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'credenciais', label: 'Credenciais', icon: Key },
  { id: 'setores', label: 'Setores & Filas', icon: Layers },
  { id: 'demandas', label: 'Demandas', icon: ListChecks },
  { id: 'sla', label: 'SLA & Horário', icon: Timer },
  { id: 'rota', label: 'Roteamento', icon: Route },
  { id: 'mensagens', label: 'Mensagens', icon: MessageSquare },
  { id: 'perfis', label: 'Perfis & Tags', icon: Tag },
  { id: 'operacao', label: 'Operação', icon: Settings2 },
];

const PERFIS: { id: PerfilId; label: string }[] = [
  { id: 'entregador', label: 'Entregador' },
  { id: 'farmacia', label: 'Farmácia' },
  { id: 'lider', label: 'Líder' },
];

const CAMPOS_DISPONIVEIS = ['Nome', 'CPF/CNPJ', 'Telefone', 'E-mail', 'Razão Social', 'Cidade', 'Cargo'];

const weekMap: Record<keyof HorarioComercial, keyof ChannelBusinessHours['weekly']> = {
  dom: 'sunday',
  seg: 'monday',
  ter: 'tuesday',
  qua: 'wednesday',
  qui: 'thursday',
  sex: 'friday',
  sab: 'saturday',
};

export function ChannelWebhookModal({
  kind,
  channel,
  sectors: sectorsProp,
  onClose,
  onSaved,
  onCreate,
}: {
  kind: Kind;
  channel: WorkspaceChannel | null;
  sectors: SectorOption[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onCreate: (payload: {
    display_name?: string;
    external_id?: string | null;
    verify_token?: string | null;
    config?: Record<string, unknown>;
    credentials?: Record<string, unknown>;
    status?: 'active' | 'draft';
  }) => Promise<void>;
}) {
  const qc = useQueryClient();
  const labels =
    kind === 'whatsapp'
      ? { id: 'Phone Number ID', waba: 'WABA ID', token: 'Access Token (Meta)', number: 'Número' }
      : { id: 'Instagram User ID', waba: 'Business Account ID', token: 'Access Token (Instagram Graph)', number: 'Handle' };

  const initialOperational = useMemo(
    () => seedSectorsFromLegacy(parseChannelOperationalConfig(channel?.config), sectorsProp),
    [channel?.config, sectorsProp]
  );
  const initialRevive = useMemo(() => reviveFromOperational(initialOperational), [initialOperational]);

  const [tab, setTab] = useState<TabId>('credenciais');
  const [showToken, setShowToken] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  const [name, setName] = useState(channel?.display_name || '');
  const [number, setNumber] = useState(String(channel?.config?.display_number || ''));
  const [phoneId, setPhoneId] = useState(channel?.external_id || '');
  const [wabaId, setWabaId] = useState(String(channel?.config?.waba_id || ''));
  const [token, setToken] = useState('');
  const [verifyToken, setVerifyToken] = useState(channel?.verify_token || '');

  const [filas, setFilas] = useState<Fila[]>(initialRevive.filas);
  const [setoresCfg, setSetoresCfg] = useState<SetorCfg[]>(initialRevive.setoresCfg);
  const [novaFila, setNovaFila] = useState('');
  const [novoSetor, setNovoSetor] = useState('');
  const [overrides, setOverrides] = useState<DemandaSlaOverride[]>(initialRevive.overrides);
  const [horario, setHorario] = useState<HorarioComercial>(initialRevive.horario);
  const [feriados, setFeriados] = useState<string[]>(initialRevive.feriados);
  const [novoFeriado, setNovoFeriado] = useState('');
  const [filaDefault, setFilaDefault] = useState(initialRevive.filaDefault);
  const [mensagens, setMensagens] = useState<MensagensPadrao>(initialRevive.mensagens);
  const [intakeMensagens, setIntakeMensagens] = useState<Record<string, string>>(initialRevive.intakeMensagens);
  const [oohReplyAtEdge, setOohReplyAtEdge] = useState(initialRevive.oohReplyAtEdge);
  const [migratingMessages, setMigratingMessages] = useState(false);
  const [perfisAceitos, setPerfisAceitos] = useState<PerfilId[]>(initialRevive.perfisAceitos);
  const [tags, setTags] = useState<string[]>(initialRevive.tags);
  const [novaTag, setNovaTag] = useState('');
  const [camposPre, setCamposPre] = useState<Record<PerfilId, string[]>>(initialRevive.camposPre);
  const [csatAtivo, setCsatAtivo] = useState(initialRevive.csatAtivo);
  const [limites, setLimites] = useState(initialRevive.limites);

  const { data: emailsNotificacao = [] } = useQuery({
    queryKey: ['settings', 'alert_emails'],
    queryFn: async () => {
      try {
        return (await api.get<string[]>('/api/settings/alert_emails')).data || [];
      } catch {
        return [];
      }
    },
  });

  const { data: pessoas = [] } = useQuery({
    queryKey: ['settings', 'webhook-editor-people'],
    queryFn: async (): Promise<PessoaOption[]> => {
      try {
        const { data } = await api.get<Array<{ id: string; name?: string; email?: string; role?: string }>>(
          '/api/users/attendants?include_supervisors=1'
        );
        return (data || []).map((u) => ({ id: u.id, label: u.name || u.email || u.id, role: u.role || 'attendant' }));
      } catch {
        return [];
      }
    },
  });

  const pessoasComValoresAtuais = useMemo(() => {
    const map = new Map(pessoas.map((p) => [p.id, p]));
    for (const fila of filas) {
      for (const id of fila.atendentes || []) {
        if (!map.has(id)) map.set(id, { id, label: id });
      }
    }
    for (const setor of setoresCfg) {
      if (setor.gestorEscalacao && !map.has(setor.gestorEscalacao)) {
        map.set(setor.gestorEscalacao, { id: setor.gestorEscalacao, label: setor.gestorEscalacao });
      }
    }
    return Array.from(map.values());
  }, [filas, pessoas, setoresCfg]);
  const atendentesComValoresAtuais = useMemo(
    () => pessoasComValoresAtuais.filter((p) => !p.role || p.role === 'attendant'),
    [pessoasComValoresAtuais]
  );
  const gestoresComValoresAtuais = useMemo(() => {
    const gestores = pessoasComValoresAtuais.filter((p) => p.role === 'supervisor');
    for (const setor of setoresCfg) {
      if (setor.gestorEscalacao && !gestores.some((p) => p.id === setor.gestorEscalacao)) {
        const current = pessoasComValoresAtuais.find((p) => p.id === setor.gestorEscalacao);
        gestores.push(current || { id: setor.gestorEscalacao, label: setor.gestorEscalacao });
      }
    }
    return gestores;
  }, [pessoasComValoresAtuais, setoresCfg]);

  const callbackUrl = channel?.webhook_callback_url || 'Será gerada após salvar (WEBHOOK_PUBLIC_BASE_URL)';

  const flash = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 1600);
  };

  const addFila = () => {
    const n = novaFila.trim();
    if (!n) return flash('Informe o nome da fila');
    if (filas.some((f) => f.name.toLowerCase() === n.toLowerCase())) return flash('Fila já existe');
    setFilas([...filas, { name: n, setores: [], notifyEmail: '', capacidade: 50, prioridade: 'media', atendentes: [] }]);
    if (!filaDefault) setFilaDefault(n);
    setNovaFila('');
  };

  const updateFila = (name: string, patch: Partial<Fila>) => {
    setFilas(filas.map((f) => (f.name === name ? { ...f, ...patch } : f)));
  };

  const removeFila = (name: string) => {
    setFilas(filas.filter((f) => f.name !== name));
    if (filaDefault === name) setFilaDefault('');
  };

  const addSetor = () => {
    const s = novoSetor.trim();
    if (!s) return flash('Informe o nome do setor');
    if (setoresCfg.some((x) => x.name.toLowerCase() === s.toLowerCase())) return flash('Setor já existe');
    setSetoresCfg([...setoresCfg, { id: slugDemandTitle(s), name: s, demandas: [], isActive: true }]);
    setNovoSetor('');
  };

  const updateSetor = (name: string, patch: Partial<SetorCfg>) => {
    setSetoresCfg(setoresCfg.map((s) => (s.name === name ? { ...s, ...patch } : s)));
  };

  const removeSetor = (name: string) => {
    setSetoresCfg(setoresCfg.filter((s) => s.name !== name));
    setFilas(filas.map((f) => ({ ...f, setores: f.setores.filter((x) => x !== name) })));
    setOverrides(overrides.filter((o) => o.setor !== name));
  };

  const applySectorsQueuesPreset = () => {
    const operational = buildOperationalSectorsQueuesPreset(sectorsProp);
    if (!operational) {
      const missing = MACRO_SECTOR_NAMES.filter(
        (n) => !sectorsProp.some((s) => s.name.trim().toLowerCase() === n.toLowerCase())
      );
      flash(
        missing.length
          ? `Crie no workspace os setores: ${missing.join(', ')} (API / setores) e tente de novo.`
          : 'Setores do banco incompletos para o preset.'
      );
      return;
    }
    const ui = reviveUiFromOperationalPreset(operational);
    setSetoresCfg(
      ui.setoresCfg.map((s) => {
        const prev = setoresCfg.find((x) => x.id === s.id || x.name === s.name);
        return { ...s, gestorEscalacao: prev?.gestorEscalacao ?? '' };
      })
    );
    setFilas(
      ui.filas.map((f) => ({
        name: f.name,
        setores: f.setores,
        notifyEmail: '',
        capacidade: f.capacidade,
        prioridade: f.prioridade,
        atendentes: filas.find((x) => x.name === f.name)?.atendentes ?? [],
        transbordoPara: f.transbordoPara,
        slaPrimeiraResposta: f.slaPrimeiraResposta,
        slaResolucao: f.slaResolucao,
      }))
    );
    setFilaDefault(ui.filaDefault);
    setTab('setores');
    flash('Preset Geral + Especializada aplicado. Revise e salve o canal.');
  };

  const handleSave = async () => {
    if (!name.trim() || !phoneId.trim()) {
      flash('Nome e ID externo são obrigatórios');
      return;
    }
    setSaving(true);
    try {
      const operational = operationalFromRevive({
        base: initialOperational,
        filas,
        setoresCfg,
        overrides,
        horario,
        feriados,
        filaDefault,
        mensagens,
        intakeMensagens,
        oohReplyAtEdge,
        perfisAceitos,
        tags,
        camposPre,
        csatAtivo,
        limites,
      });
      const payload = {
        display_name: name.trim(),
        external_id: phoneId.trim(),
        verify_token: verifyToken.trim() || undefined,
        config: serializeChannelOperationalConfig(
          {
            ...(channel?.config || {}),
            waba_id: wabaId.trim() || undefined,
            display_number: number.trim() || undefined,
          },
          operational
        ),
        credentials: {
          ...(token.trim() ? { access_token: token.trim() } : {}),
          phone_number_id: phoneId.trim(),
        },
        status: channelStatusFromUi(channel ? (channel.status === 'active' ? 'ativo' : 'rascunho') : 'rascunho'),
      };

      if (channel) await updateChannel(channel.id, payload);
      else await onCreate({ ...payload, status: 'draft' });
      await onSaved();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['channel-operational-catalog'] }),
        qc.invalidateQueries({ queryKey: ['sectors-from-messaging-webhooks'] }),
        qc.invalidateQueries({ queryKey: ['demands-from-messaging-webhooks'] }),
        qc.invalidateQueries({ queryKey: ['integrations', 'channels'] }),
      ]);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleMigrateLegacyMessages = async () => {
    if (!channel?.id) {
      flash('Salve o webhook antes de migrar mensagens');
      return;
    }
    setMigratingMessages(true);
    try {
      const { data } = await api.post<{
        migrated_keys?: string[];
        channel?: WorkspaceChannel;
      }>(`/api/integrations/channels/${channel.id}/messages/migrate-from-workspace`);
      const keys = data?.migrated_keys?.length ?? 0;
      if (data?.channel?.config) {
        const operational = parseChannelOperationalConfig(data.channel.config);
        setIntakeMensagens(buildIntakeMensagensFromOperational(operational));
      }
      flash(keys > 0 ? `Migradas ${keys} mensagens do catálogo legado` : 'Nenhuma mensagem legada para migrar');
      void qc.invalidateQueries({ queryKey: ['sectors-from-messaging-webhooks'] });
      void qc.invalidateQueries({ queryKey: ['channel-operational-catalog'] });
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Falha ao migrar mensagens');
    } finally {
      setMigratingMessages(false);
    }
  };

  const handleTest = async () => {
    if (!channel?.id) {
      flash('Salve o webhook antes de testar');
      return;
    }
    const hasUnsavedCredentials =
      token.trim() ||
      phoneId.trim() !== String(channel.external_id || '').trim() ||
      verifyToken.trim() !== String(channel.verify_token || '').trim() ||
      wabaId.trim() !== String(channel.config?.waba_id || '').trim();
    if (hasUnsavedCredentials) {
      setTesting('err');
      setTestError('Salve o webhook antes de testar as credenciais alteradas.');
      return;
    }
    setTesting('loading');
    setTestError(null);
    try {
      await testChannelConnection(channel.id);
      setTesting('ok');
    } catch (e) {
      setTesting('err');
      const detail = (e as { response?: { data?: { error?: string; graph?: { error?: { message?: string } } } } })?.response?.data;
      setTestError(detail?.error || detail?.graph?.error?.message || 'Falha - verifique credenciais');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h3 className="text-sm font-semibold">
              {channel ? `Editar ${name || 'webhook'}` : `Novo webhook ${kind === 'whatsapp' ? 'WhatsApp' : 'Instagram'}`}
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Tudo da operação deste canal fica vinculado ao webhook: setores, filas, demandas, SLA, mensagens e regras.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="w-48 shrink-0 space-y-0.5 overflow-y-auto border-r border-border bg-background/30 p-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors',
                  tab === t.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-surface-hover'
                )}
              >
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto p-6">
            {tab === 'credenciais' && (
              <div className="space-y-4">
                <SectionTitle title="Credenciais Meta Cloud" desc="A plataforma usa estas credenciais automaticamente." />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Nome de exibição" value={name} onChange={setName} />
                  <Field label={labels.number} value={number} onChange={setNumber} mono />
                  <Field label={labels.id} value={phoneId} onChange={setPhoneId} mono />
                  <Field label={labels.waba} value={wabaId} onChange={setWabaId} mono />
                </div>
                <div>
                  <Lbl>{labels.token}</Lbl>
                  <div className="mt-1 flex gap-2">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder={channel ? 'Deixe vazio para manter o token atual' : 'Cole o access token'}
                      className="flex-1 rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-xs"
                    />
                    <button type="button" onClick={() => setShowToken((s) => !s)} className="rounded-md border border-border px-3 hover:bg-surface-hover">
                      {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <Field label="Verify Token" value={verifyToken} onChange={setVerifyToken} mono />
                <div>
                  <Lbl>Callback URL (configure na Meta)</Lbl>
                  <div className="mt-1 flex gap-2">
                    <input readOnly value={callbackUrl} className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs" />
                    {channel?.webhook_callback_url ? (
                      <button type="button" onClick={() => void navigator.clipboard.writeText(channel.webhook_callback_url!)} className="rounded-md border border-border px-3 hover:bg-surface-hover">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button type="button" onClick={() => void handleTest()} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[11px] hover:bg-surface-hover">
                    <Send className="h-3 w-3" /> Testar conexão
                  </button>
                  {testing === 'loading' && <span className="text-[11px] text-muted-foreground">Testando...</span>}
                  {testing === 'ok' && (
                    <span className="flex items-center gap-1 text-[11px] text-success">
                      <CheckCircle2 className="h-3 w-3" /> OK
                    </span>
                  )}
                  {testing === 'err' && (
                    <span className="text-[11px] text-destructive">
                      {testError || 'Falha - verifique credenciais'}
                    </span>
                  )}
                </div>
              </div>
            )}

            {tab === 'setores' && (
              <div className="space-y-5">
                <SectionTitle
                  title="Setores da operação"
                  desc="Use os UUIDs dos setores cadastrados no workspace. Preset: 4 setores macro + filas Geral (25/120/480 min) e Especializada (15/75/300 min)."
                />
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2">
                  <button
                    type="button"
                    onClick={applySectorsQueuesPreset}
                    className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary-glow"
                  >
                    Aplicar preset Geral + Especializada
                  </button>
                  <span className="text-[10px] text-muted-foreground">
                    Requer {MACRO_SECTOR_NAMES.join(', ')} em /api/sectors — ou rode{' '}
                    <code className="rounded bg-background px-1">npm run apply:sectors-queues-preset</code>
                  </span>
                </div>
                <div className="flex gap-2">
                  <input value={novoSetor} onChange={(e) => setNovoSetor(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSetor())} placeholder="Novo setor (ex.: Comercial)" className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs" />
                  <button type="button" onClick={addSetor} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow">
                    <Plus className="h-3 w-3" /> Setor
                  </button>
                </div>
                <div className="space-y-2">
                  {setoresCfg.map((s) => (
                    <div key={s.id} className="rounded-md border border-border bg-background/40 p-3">
                      <div className="flex items-center justify-between">
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">{s.name}</span>
                        <button type="button" onClick={() => removeSetor(s.name)} className="text-destructive hover:text-destructive/80">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-2">
                        <Lbl>Gestor de escalação</Lbl>
                        <select value={s.gestorEscalacao ?? ''} onChange={(e) => updateSetor(s.name, { gestorEscalacao: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-xs">
                          <option value="">— Sem gestor —</option>
                          {gestoresComValoresAtuais.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                  {setoresCfg.length === 0 && <Empty>Nenhum setor. Adicione um setor acima.</Empty>}
                </div>

                <SectionTitle title="Filas" desc="Cada fila pode conter setores, atendentes, capacidade, prioridade e regra de transbordo." />
                <div className="flex gap-2">
                  <input value={novaFila} onChange={(e) => setNovaFila(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFila())} placeholder="Nome da fila (ex.: Geral, Vendas)" className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs" />
                  <button type="button" onClick={addFila} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow">
                    <Plus className="h-3 w-3" /> Fila
                  </button>
                </div>
                <div className="space-y-2">
                  {filas.map((f) => (
                    <div key={f.name} className="space-y-3 rounded-md border border-border bg-background/40 p-3">
                      <div className="flex items-center justify-between">
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">{f.name}</span>
                        <button type="button" onClick={() => removeFila(f.name)} className="text-destructive hover:text-destructive/80">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <div>
                        <Lbl>Setores vinculados</Lbl>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {setoresCfg.map((s) => {
                            const on = f.setores.includes(s.name);
                            return (
                              <button key={s.id} type="button" onClick={() => updateFila(f.name, { setores: on ? f.setores.filter((x) => x !== s.name) : [...f.setores, s.name] })} className={cn('rounded-md border px-2 py-1 text-[10px]', on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-surface-hover')}>
                                {on && '✓ '}
                                {s.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <Lbl>Atendentes vinculados</Lbl>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {atendentesComValoresAtuais.length === 0 && <span className="text-[10px] text-muted-foreground">Nenhum atendente disponível.</span>}
                          {atendentesComValoresAtuais.map((a) => {
                            const on = (f.atendentes ?? []).includes(a.id);
                            return (
                              <button key={a.id} type="button" onClick={() => updateFila(f.name, { atendentes: on ? (f.atendentes ?? []).filter((x) => x !== a.id) : [...(f.atendentes ?? []), a.id] })} className={cn('rounded-md border px-2 py-1 text-[10px]', on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-surface-hover')}>
                                {on && '✓ '}
                                {a.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                        <NumberField label="Capacidade" value={f.capacidade ?? 50} onChange={(v) => updateFila(f.name, { capacidade: v })} />
                        <div>
                          <Lbl>Prioridade</Lbl>
                          <select value={f.prioridade ?? 'media'} onChange={(e) => updateFila(f.name, { prioridade: e.target.value as Fila['prioridade'] })} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-xs">
                            <option value="baixa">Baixa</option>
                            <option value="media">Média</option>
                            <option value="alta">Alta</option>
                            <option value="urgente">Urgente</option>
                          </select>
                        </div>
                        <div>
                          <Lbl>Transbordo para</Lbl>
                          <select value={f.transbordoPara ?? ''} onChange={(e) => updateFila(f.name, { transbordoPara: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-xs">
                            <option value="">— Nenhum —</option>
                            {filas.filter((x) => x.name !== f.name).map((x) => (
                              <option key={x.name} value={x.name}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <Lbl>E-mail de notificação</Lbl>
                        <select value={f.notifyEmail ?? ''} onChange={(e) => updateFila(f.name, { notifyEmail: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-xs">
                          <option value="">— Nenhum —</option>
                          {emailsNotificacao.map((em) => (
                            <option key={em} value={em}>
                              {em}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                  {filas.length === 0 && <Empty>Nenhuma fila. Adicione uma fila acima.</Empty>}
                </div>
              </div>
            )}

            {tab === 'demandas' && (
              <div className="space-y-4">
                <SectionTitle title="Demandas por setor" desc="Catálogo oferecido pelo bot quando o contato cai em cada setor. Editável apenas aqui — não fica livre no fluxo." />
                {setoresCfg.length === 0 && <Empty>Crie setores na aba &quot;Setores & Filas&quot; primeiro.</Empty>}
                {setoresCfg.map((s) => (
                  <DemandasSetor key={s.id} setor={s} onChange={(d) => updateSetor(s.name, { demandas: d })} />
                ))}
              </div>
            )}

            {tab === 'sla' && (
              <div className="space-y-5">
                <SectionTitle title="SLA por fila" desc="Tempo de 1ª resposta e resolução. Vale dentro do horário comercial definido abaixo." />
                {filas.length === 0 && <Empty>Crie filas primeiro.</Empty>}
                {filas.map((f) => (
                  <div key={f.name} className="rounded-md border border-border bg-background/40 p-3">
                    <div className="text-xs font-medium">{f.name}</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <NumberField label="1ª resposta (min)" value={f.slaPrimeiraResposta ?? 15} onChange={(v) => updateFila(f.name, { slaPrimeiraResposta: v })} />
                      <NumberField label="Resolução (min)" value={f.slaResolucao ?? 240} onChange={(v) => updateFila(f.name, { slaResolucao: v })} />
                    </div>
                  </div>
                ))}

                <SectionTitle title="SLA por demanda (override)" desc="Use quando uma demanda for mais crítica que o SLA da fila." />
                <OverridesEditor setoresCfg={setoresCfg} overrides={overrides} setOverrides={setOverrides} />

                <SectionTitle title="Horário de atendimento" desc="Fora deste horário o canal usa a mensagem de fora de horário." />
                <div className="space-y-1 rounded-md border border-border bg-background/40 p-3">
                  {(Object.keys(horario) as (keyof HorarioComercial)[]).map((dia) => {
                    const d = horario[dia];
                    return (
                      <div key={dia} className="flex items-center gap-2 text-xs">
                        <button type="button" onClick={() => setHorario({ ...horario, [dia]: { ...d, ativo: !d.ativo } })} className={cn('w-12 rounded px-2 py-1 text-[10px] font-medium uppercase', d.ativo ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
                          {dia}
                        </button>
                        <input type="time" value={d.inicio} onChange={(e) => setHorario({ ...horario, [dia]: { ...d, inicio: e.target.value } })} disabled={!d.ativo} className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50" />
                        <span className="text-muted-foreground">até</span>
                        <input type="time" value={d.fim} onChange={(e) => setHorario({ ...horario, [dia]: { ...d, fim: e.target.value } })} disabled={!d.ativo} className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50" />
                      </div>
                    );
                  })}
                </div>

                <SectionTitle title="Feriados" desc="Datas em que o canal segue regra de fora de horário, mesmo em dia útil." />
                <div className="flex gap-2">
                  <input type="date" value={novoFeriado} onChange={(e) => setNovoFeriado(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-xs" />
                  <button type="button" onClick={() => { if (novoFeriado && !feriados.includes(novoFeriado)) { setFeriados([...feriados, novoFeriado].sort()); setNovoFeriado(''); } }} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow">
                    <Plus className="h-3 w-3" /> Adicionar
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {feriados.map((f) => (
                    <span key={f} className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px]">
                      {f}
                      <button type="button" onClick={() => setFeriados(feriados.filter((x) => x !== f))} className="text-muted-foreground hover:text-destructive">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  {feriados.length === 0 && <span className="text-[11px] text-muted-foreground">Nenhum feriado cadastrado.</span>}
                </div>
              </div>
            )}

            {tab === 'rota' && (
              <div className="space-y-4">
                <SectionTitle title="Roteamento padrão" desc="Fila para onde o contato vai quando o bot não consegue classificar." />
                <select value={filaDefault} onChange={(e) => setFilaDefault(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs">
                  <option value="">— Selecione uma fila —</option>
                  {filas.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-[11px] text-muted-foreground">
                  Política de transbordo entre filas é definida individualmente na aba <strong>Setores & Filas</strong> (campo &quot;Transbordo para&quot;).
                </div>
                <SectionTitle title="Gestores de escalação" desc='Visão consolidada — edite por setor na aba "Setores & Filas".' />
                <div className="space-y-1.5">
                  {setoresCfg.map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
                      <span>{s.name}</span>
                      <span className="text-muted-foreground">{labelForPessoa(gestoresComValoresAtuais, s.gestorEscalacao) || '— sem gestor —'}</span>
                    </div>
                  ))}
                  {setoresCfg.length === 0 && <Empty>Nenhum setor configurado.</Empty>}
                </div>
              </div>
            )}

            {tab === 'mensagens' && (
              <div className="space-y-4">
                <SectionTitle
                  title="Mensagens operacionais"
                  desc="Saudação, fora do horário, fila, encerramento e CSAT — vinculadas a este webhook/canal."
                />
                {(Object.keys(mensagens) as (keyof MensagensPadrao)[]).map((k) => (
                  <div key={k}>
                    <Lbl>{k === 'foraHorario' ? 'Fora de horário' : k === 'filaCheia' ? 'Fila cheia' : k === 'csat' ? 'Pesquisa CSAT' : k.charAt(0).toUpperCase() + k.slice(1)}</Lbl>
                    <textarea value={mensagens[k]} onChange={(e) => setMensagens({ ...mensagens, [k]: e.target.value })} rows={2} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-xs" />
                  </div>
                ))}

                <SectionTitle
                  title="Mensagens do fluxo de atendimento (intake)"
                  desc="Textos da triagem guiada: cadastro desconhecido, nome, cidade, farmácia e boas-vindas por perfil."
                />
                {(['welcome', 'collect', 'pharmacy', 'sector'] as const).map((section) => (
                  <div key={section} className="space-y-3 rounded-lg border border-border bg-background/30 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">
                      {section === 'welcome'
                        ? 'Boas-vindas e identificação'
                        : section === 'collect'
                          ? 'Coleta de dados'
                          : section === 'pharmacy'
                            ? 'Farmácia'
                            : 'Setor'}
                    </p>
                    {CHANNEL_INTAKE_MESSAGE_KEYS.filter((key) => INTAKE_MESSAGE_LABELS[key]?.section === section).map(
                      (key) => (
                        <div key={key}>
                          <Lbl>
                            {INTAKE_MESSAGE_LABELS[key].label}
                            {INTAKE_MESSAGE_LABELS[key].optional ? (
                              <span className="ml-1 font-normal text-muted-foreground">(opcional)</span>
                            ) : null}
                          </Lbl>
                          <textarea
                            value={intakeMensagens[key] || ''}
                            onChange={(e) => setIntakeMensagens({ ...intakeMensagens, [key]: e.target.value })}
                            rows={2}
                            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-xs"
                          />
                        </div>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}

            {tab === 'perfis' && (
              <div className="space-y-5">
                <SectionTitle title="Perfis aceitos neste canal" desc="Ex.: webhook B2B só atende Farmácia/Líder; webhook do consumidor só Entregador." />
                <div className="flex gap-1.5">
                  {PERFIS.map((p) => {
                    const on = perfisAceitos.includes(p.id);
                    return (
                      <button key={p.id} type="button" onClick={() => setPerfisAceitos(on ? perfisAceitos.filter((x) => x !== p.id) : [...perfisAceitos, p.id])} className={cn('rounded-md border px-3 py-1.5 text-xs', on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-surface-hover')}>
                        {on && '✓ '}
                        {p.label}
                      </button>
                    );
                  })}
                </div>

                <SectionTitle title="Campos obrigatórios de pré-cadastro" desc="Por perfil aceito." />
                {perfisAceitos.map((pid) => {
                  const p = PERFIS.find((x) => x.id === pid)!;
                  return (
                    <div key={pid} className="rounded-md border border-border bg-background/40 p-3">
                      <div className="text-xs font-medium">{p.label}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {CAMPOS_DISPONIVEIS.map((c) => {
                          const on = (camposPre[pid] ?? []).includes(c);
                          return (
                            <button key={c} type="button" onClick={() => setCamposPre({ ...camposPre, [pid]: on ? camposPre[pid].filter((x) => x !== c) : [...(camposPre[pid] ?? []), c] })} className={cn('rounded-md border px-2 py-1 text-[10px]', on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-surface-hover')}>
                              {on && '✓ '}
                              {c}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                <SectionTitle title="Tags da operação" desc="Catálogo controlado. Atendentes só podem aplicar tags desta lista." />
                <div className="flex gap-2">
                  <input value={novaTag} onChange={(e) => setNovaTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag(novaTag, tags, setTags, setNovaTag))} placeholder="Nova tag" className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs" />
                  <button type="button" onClick={() => addTag(novaTag, tags, setTags, setNovaTag)} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow">
                    <Plus className="h-3 w-3" /> Tag
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px]">
                      {t}
                      <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} className="text-muted-foreground hover:text-destructive">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {tab === 'operacao' && (
              <div className="space-y-5">
                <SectionTitle title="Pesquisa de satisfação (CSAT)" desc="Disparada automaticamente ao finalizar o atendimento. Metodologia CSAT (1–5)." />
                <div className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
                  <div className="text-xs">CSAT ativo ao encerrar atendimento</div>
                  <button type="button" onClick={() => setCsatAtivo(!csatAtivo)} className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', csatAtivo ? 'bg-primary' : 'bg-muted')}>
                    <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform', csatAtivo ? 'translate-x-5' : 'translate-x-1')} />
                  </button>
                </div>

                <SectionTitle title="Fora do horário" desc="Resposta automática antes do orchestrator (webhook-service)." />
                <div className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
                  <div className="text-xs">
                    Responder fora do horário no webhook
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Evita duplicar a mensagem e não inicia o bot na mesma entrada.</p>
                  </div>
                  <button type="button" onClick={() => setOohReplyAtEdge(!oohReplyAtEdge)} className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', oohReplyAtEdge ? 'bg-primary' : 'bg-muted')}>
                    <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform', oohReplyAtEdge ? 'translate-x-5' : 'translate-x-1')} />
                  </button>
                </div>

                <SectionTitle title="Limites operacionais" desc="Controle de capacidade por atendente e inatividade." />
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="Máx. conversas simultâneas por atendente" value={limites.maxSimultaneasPorAtendente} onChange={(v) => setLimites({ ...limites, maxSimultaneasPorAtendente: v })} />
                  <NumberField label="Timeout de inatividade (min)" value={limites.timeoutInatividadeMin} onChange={(v) => setLimites({ ...limites, timeoutInatividadeMin: v })} />
                </div>

                <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-[11px] text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>Todas as configurações acima ficam atreladas a este webhook. Automações deste canal herdam estes valores e só sobrescrevem em casos específicos.</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="text-[11px] text-muted-foreground">
              {filas.length} fila{filas.length !== 1 ? 's' : ''} · {setoresCfg.length} setor{setoresCfg.length !== 1 ? 'es' : ''} · {overrides.length} override{overrides.length !== 1 ? 's' : ''} de SLA
            </div>
            {channel ? (
              <button
                type="button"
                disabled={migratingMessages}
                onClick={() => void handleMigrateLegacyMessages()}
                className="rounded-md border border-border px-3 py-1.5 text-[11px] hover:bg-surface-hover disabled:opacity-50"
              >
                {migratingMessages ? 'Migrando...' : 'Migrar mensagens do catálogo legado'}
              </button>
            ) : null}
            {channel && kind === 'whatsapp' ? (
              <button
                type="button"
                onClick={() =>
                  void registerMetaWebhook(channel.id)
                    .then(() => flash('Pedido enviado à Meta'))
                    .catch(() => flash('Falha ao registar na Meta'))
                }
                className="rounded-md border border-border px-3 py-1.5 text-[11px] hover:bg-surface-hover"
              >
                Registar na Meta
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs">
              Cancelar
            </button>
            <button type="button" disabled={saving} onClick={() => void handleSave()} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar webhook'}
            </button>
          </div>
        </div>
      </div>
      {feedback && (
        <div className="pointer-events-none fixed left-1/2 top-6 z-[60] -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-[11px] font-medium text-background shadow-lg">
          {feedback}
        </div>
      )}
    </div>
  );
}

const Lbl = ({ children }: { children: ReactNode }) => (
  <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">{children}</label>
);

const SectionTitle = ({ title, desc }: { title: string; desc?: string }) => (
  <div>
    <h4 className="text-xs font-semibold">{title}</h4>
    {desc && <p className="mt-0.5 text-[11px] text-muted-foreground">{desc}</p>}
  </div>
);

const Empty = ({ children }: { children: ReactNode }) => (
  <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">{children}</div>
);

const Field = ({ label, value, onChange, mono }: { label: string; value: string; onChange?: (v: string) => void; mono?: boolean }) => (
  <div>
    <Lbl>{label}</Lbl>
    <input
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn(
        'mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20',
        mono && 'font-mono text-xs'
      )}
    />
  </div>
);

const NumberField = ({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) => (
  <div>
    <Lbl>{label}</Lbl>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-xs"
    />
  </div>
);

const DemandasSetor = ({ setor, onChange }: { setor: SetorCfg; onChange: (d: string[]) => void }) => {
  const [nova, setNova] = useState('');
  const add = () => {
    const n = nova.trim();
    if (!n || setor.demandas.includes(n)) return;
    onChange([...setor.demandas, n]);
    setNova('');
  };
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">{setor.name}</span>
        <span className="text-[10px] text-muted-foreground">
          {setor.demandas.length} demanda{setor.demandas.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <input value={nova} onChange={(e) => setNova(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} placeholder="Nova demanda (ex.: Cancelamento, Faturamento)" className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs" />
        <button type="button" onClick={add} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow">
          <Plus className="h-3 w-3" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {setor.demandas.map((d) => (
          <span key={d} className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px]">
            {d}
            <button type="button" onClick={() => onChange(setor.demandas.filter((x) => x !== d))} className="text-muted-foreground hover:text-destructive">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
};

const OverridesEditor = ({
  setoresCfg,
  overrides,
  setOverrides,
}: {
  setoresCfg: SetorCfg[];
  overrides: DemandaSlaOverride[];
  setOverrides: (o: DemandaSlaOverride[]) => void;
}) => {
  const [setor, setSetor] = useState('');
  const [demanda, setDemanda] = useState('');
  const [primeira, setPrimeira] = useState(5);
  const [resolucao, setResolucao] = useState(60);
  const demandasDoSetor = setoresCfg.find((s) => s.name === setor)?.demandas ?? [];
  const add = () => {
    if (!setor || !demanda) return;
    if (overrides.some((o) => o.setor === setor && o.demanda === demanda)) return;
    setOverrides([...overrides, { setor, demanda, slaPrimeiraResposta: primeira, slaResolucao: resolucao }]);
    setDemanda('');
  };
  return (
    <div className="space-y-3 rounded-md border border-border bg-background/40 p-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <select value={setor} onChange={(e) => { setSetor(e.target.value); setDemanda(''); }} className="rounded-md border border-border bg-background px-2 py-2 text-xs">
          <option value="">Setor...</option>
          {setoresCfg.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={demanda} onChange={(e) => setDemanda(e.target.value)} disabled={!setor} className="rounded-md border border-border bg-background px-2 py-2 text-xs disabled:opacity-50">
          <option value="">Demanda...</option>
          {demandasDoSetor.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input type="number" value={primeira} onChange={(e) => setPrimeira(Number(e.target.value) || 0)} placeholder="1ª resp (min)" className="rounded-md border border-border bg-background px-2 py-2 text-xs" />
        <input type="number" value={resolucao} onChange={(e) => setResolucao(Number(e.target.value) || 0)} placeholder="Resolução (min)" className="rounded-md border border-border bg-background px-2 py-2 text-xs" />
      </div>
      <button type="button" onClick={add} disabled={!setor || !demanda} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow disabled:opacity-50">
        <Plus className="h-3 w-3" /> Adicionar override
      </button>
      <div className="space-y-1">
        {overrides.map((o, i) => (
          <div key={`${o.setor}:${o.demanda}:${i}`} className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-xs">
            <span>
              <strong>{o.setor}</strong> · {o.demanda}{' '}
              <span className="text-muted-foreground">
                — 1ª resp {o.slaPrimeiraResposta}min · resolução {o.slaResolucao}min
              </span>
            </span>
            <button type="button" onClick={() => setOverrides(overrides.filter((_, idx) => idx !== i))} className="text-destructive hover:text-destructive/80">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        {overrides.length === 0 && <Empty>Nenhum override. SLA da fila será usado.</Empty>}
      </div>
    </div>
  );
};

function reviveFromOperational(operational: ChannelOperationalConfig) {
  const sectorById = new Map(operational.sectors.map((s) => [s.id, s]));
  const setorNameById = new Map(operational.sectors.map((s) => [s.id, s.name]));
  const demandasBySector = new Map<string, string[]>();
  const overrides: DemandaSlaOverride[] = [];

  for (const demand of operational.demands) {
    for (const sectorId of demand.sector_ids) {
      const bucket = demandasBySector.get(sectorId) || [];
      if (!bucket.includes(demand.title)) bucket.push(demand.title);
      demandasBySector.set(sectorId, bucket);
      if (demand.sla_override) {
        overrides.push({
          setor: setorNameById.get(sectorId) || sectorId,
          demanda: demand.title,
          slaPrimeiraResposta: demand.sla_override.first_response_sla_minutes,
          slaResolucao: demand.sla_override.resolution_sla_minutes,
        });
      }
    }
  }

  const setoresCfg = operational.sectors.map((s) => ({
    id: s.id,
    name: s.name,
    gestorEscalacao: s.escalation_manager_id || s.escalation_manager_name || '',
    demandas: demandasBySector.get(s.id) || [],
    isActive: s.is_active !== false,
  }));

  const filas = operational.queues.map((q) => ({
    name: q.name,
    setores: q.sector_ids.map((id) => sectorById.get(id)?.name || id).filter(Boolean),
    notifyEmail: q.notify_email || '',
    capacidade: q.capacity ?? 50,
    prioridade: priorityToPt(q.priority),
    atendentes: q.attendant_ids || [],
    transbordoPara: q.overflow_queue_name || '',
    slaPrimeiraResposta: q.sla?.first_response_sla_minutes ?? operational.sla.first_response_sla_minutes,
    slaResolucao: q.sla?.resolution_sla_minutes ?? operational.sla.resolution_sla_minutes,
  }));

  return {
    filas,
    setoresCfg,
    overrides,
    horario: horarioFromBusinessHours(operational.business_hours),
    feriados: operational.holidays,
    filaDefault: operational.routing.default_queue_name,
    mensagens: {
      saudacao: operational.messages.greeting,
      foraHorario: operational.messages.out_of_hours,
      filaCheia: operational.messages.queue_full,
      encerramento: operational.messages.closing,
      csat: operational.messages.csat,
    },
    perfisAceitos: operational.profiles.accepted.length ? operational.profiles.accepted : (['entregador', 'farmacia', 'lider'] as PerfilId[]),
    tags: operational.operation.tags,
    camposPre: operational.profiles.pre_registration_fields,
    csatAtivo: operational.operation.csat_enabled,
    limites: {
      maxSimultaneasPorAtendente: operational.operation.max_simultaneous_per_attendant,
      timeoutInatividadeMin: operational.operation.inactivity_timeout_minutes,
    },
    intakeMensagens: buildIntakeMensagensFromOperational(operational),
    oohReplyAtEdge: operational.operation.ooh_reply_at_edge !== false,
  };
}

function buildIntakeMensagensFromOperational(operational: ChannelOperationalConfig): Record<string, string> {
  const defaults = defaultChannelIntakeMessages();
  const out: Record<string, string> = { ...defaults };
  for (const key of CHANNEL_INTAKE_MESSAGE_KEYS) {
    const v = operational.messages.intake?.[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim();
  }
  return out;
}

function operationalFromRevive(input: {
  base: ChannelOperationalConfig;
  filas: Fila[];
  setoresCfg: SetorCfg[];
  overrides: DemandaSlaOverride[];
  horario: HorarioComercial;
  feriados: string[];
  filaDefault: string;
  mensagens: MensagensPadrao;
  intakeMensagens: Record<string, string>;
  oohReplyAtEdge: boolean;
  perfisAceitos: PerfilId[];
  tags: string[];
  camposPre: Record<PerfilId, string[]>;
  csatAtivo: boolean;
  limites: { maxSimultaneasPorAtendente: number; timeoutInatividadeMin: number };
}): ChannelOperationalConfig {
  const sectorByName = new Map(input.setoresCfg.map((s) => [s.name, s]));
  const existingDemandByTitle = new Map(input.base.demands.map((d) => [d.title.toLowerCase(), d]));
  const overrideBySectorDemand = new Map(input.overrides.map((o) => [`${o.setor}::${o.demanda}`, o]));
  const demandTitles = new Map<string, { title: string; sector_ids: string[]; overrides: DemandaSlaOverride[] }>();

  for (const setor of input.setoresCfg) {
    for (const demanda of setor.demandas) {
      const title = demanda.trim();
      if (!title) continue;
      const key = title.toLowerCase();
      const row = demandTitles.get(key) || { title, sector_ids: [], overrides: [] };
      if (!row.sector_ids.includes(setor.id)) row.sector_ids.push(setor.id);
      const override = overrideBySectorDemand.get(`${setor.name}::${title}`);
      if (override) row.overrides.push(override);
      demandTitles.set(key, row);
    }
  }

  const demands: ChannelDemand[] = Array.from(demandTitles.values()).map((row, index) => {
    const existing = existingDemandByTitle.get(row.title.toLowerCase());
    const firstOverride = row.overrides[0];
    return {
      ...(existing || {}),
      id: existing?.id || slugDemandTitle(row.title),
      title: row.title,
      sector_ids: row.sector_ids,
      is_active: existing?.is_active !== false,
      requires_pharmacy: existing?.requires_pharmacy || false,
      route_to: existing?.route_to || null,
      target_sector_id: existing?.target_sector_id || null,
      target_queue_name: existing?.target_queue_name || null,
      target_attendant_id: existing?.target_attendant_id || null,
      sla_override: firstOverride
        ? {
            ...input.base.sla,
            first_response_sla_minutes: firstOverride.slaPrimeiraResposta || input.base.sla.first_response_sla_minutes,
            resolution_sla_minutes: firstOverride.slaResolucao || input.base.sla.resolution_sla_minutes,
          }
        : existing?.sla_override || null,
      sort_order: existing?.sort_order || index + 1,
    };
  });

  const queues: ChannelQueue[] = input.filas.map((fila) => ({
    name: fila.name,
    sector_ids: fila.setores.map((name) => sectorByName.get(name)?.id || '').filter(Boolean),
    notify_email: fila.notifyEmail || undefined,
    capacity: fila.capacidade,
    priority: priorityToEn(fila.prioridade),
    attendant_ids: fila.atendentes || [],
    overflow_queue_name: fila.transbordoPara || undefined,
    sla: {
      ...input.base.sla,
      first_response_sla_minutes: fila.slaPrimeiraResposta || input.base.sla.first_response_sla_minutes,
      resolution_sla_minutes: fila.slaResolucao || input.base.sla.resolution_sla_minutes,
    },
  }));

  const firstQueueSla = queues.find((q) => q.sla)?.sla;
  return {
    queues,
    sectors: input.setoresCfg.map((s): ChannelSectorConfig => ({
      id: s.id,
      name: s.name,
      is_active: s.isActive !== false,
      escalation_manager_id: s.gestorEscalacao || null,
      escalation_manager_name: s.gestorEscalacao || null,
    })),
    demands,
    sla: {
      ...input.base.sla,
      ...(firstQueueSla || {}),
    },
    business_hours: businessHoursFromHorario(input.horario, input.base.business_hours.timezone),
    holidays: input.feriados,
    routing: { default_queue_name: input.filaDefault },
    messages: {
      greeting: input.mensagens.saudacao,
      out_of_hours: input.mensagens.foraHorario,
      queue_full: input.mensagens.filaCheia,
      closing: input.mensagens.encerramento,
      csat: input.mensagens.csat,
      intake: { ...input.intakeMensagens },
    },
    profiles: {
      accepted: input.perfisAceitos,
      pre_registration_fields: input.camposPre,
    },
    operation: {
      csat_enabled: input.csatAtivo,
      max_simultaneous_per_attendant: input.limites.maxSimultaneasPorAtendente,
      inactivity_timeout_minutes: input.limites.timeoutInatividadeMin,
      tags: input.tags,
      ooh_reply_at_edge: input.oohReplyAtEdge,
    },
  };
}

function horarioFromBusinessHours(bh: ChannelBusinessHours): HorarioComercial {
  return {
    dom: dayFromBusiness(bh.weekly.sunday),
    seg: dayFromBusiness(bh.weekly.monday),
    ter: dayFromBusiness(bh.weekly.tuesday),
    qua: dayFromBusiness(bh.weekly.wednesday),
    qui: dayFromBusiness(bh.weekly.thursday),
    sex: dayFromBusiness(bh.weekly.friday),
    sab: dayFromBusiness(bh.weekly.saturday),
  };
}

function dayFromBusiness(day: ChannelBusinessHours['weekly'][keyof ChannelBusinessHours['weekly']]) {
  return { ativo: day.is_open, inicio: day.start, fim: day.end };
}

function businessHoursFromHorario(horario: HorarioComercial, timezone: string): ChannelBusinessHours {
  const weekly = {} as ChannelBusinessHours['weekly'];
  for (const key of Object.keys(weekMap) as (keyof HorarioComercial)[]) {
    const day = horario[key];
    weekly[weekMap[key]] = { is_open: day.ativo, start: day.inicio, end: day.fim };
  }
  return { timezone, weekly };
}

function priorityToPt(priority?: ChannelQueuePriority): Fila['prioridade'] {
  if (priority === 'low') return 'baixa';
  if (priority === 'high') return 'alta';
  if (priority === 'urgent') return 'urgente';
  return 'media';
}

function priorityToEn(priority?: Fila['prioridade']): ChannelQueuePriority {
  if (priority === 'baixa') return 'low';
  if (priority === 'alta') return 'high';
  if (priority === 'urgente') return 'urgent';
  return 'medium';
}

function addTag(tagRaw: string, tags: string[], setTags: (tags: string[]) => void, setNovaTag: (tag: string) => void) {
  const tag = tagRaw.trim();
  if (!tag || tags.includes(tag)) return;
  setTags([...tags, tag]);
  setNovaTag('');
}

function labelForPessoa(pessoas: PessoaOption[], id?: string) {
  if (!id) return '';
  return pessoas.find((p) => p.id === id)?.label || id;
}

function seedSectorsFromLegacy(operational: ChannelOperationalConfig, sectorsProp: SectorOption[]): ChannelOperationalConfig {
  if (operational.sectors.length > 0) return operational;
  const ids = new Set<string>();
  for (const q of operational.queues) q.sector_ids.forEach((id) => ids.add(id));
  for (const d of operational.demands) d.sector_ids.forEach((id) => ids.add(id));
  const sectors = sectorsProp
    .filter((s) => ids.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, is_active: true }));
  return { ...operational, sectors };
}
