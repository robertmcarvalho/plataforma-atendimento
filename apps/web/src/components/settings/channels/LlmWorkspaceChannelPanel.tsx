'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Eye, EyeOff, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  fetchLlmCatalog,
  listChannels,
  testChannelConnection,
  upsertWorkspaceLlmConfig,
  type LlmFieldSpec,
  type LlmProviderCatalogEntry,
  type WorkspaceChannel,
} from '@/lib/integrations/channelsApi';

function channelHasStoredSecrets(ch: WorkspaceChannel | undefined, def: LlmProviderCatalogEntry | undefined): boolean {
  if (!ch || !def) return false;
  return def.credentialFields.some(
    (f) =>
      f.kind === 'secret' &&
      typeof ch.credentials[f.key] === 'string' &&
      String(ch.credentials[f.key]).length > 0,
  );
}

export function LlmWorkspaceChannelPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const qc = useQueryClient();
  const { data: all = [] } = useQuery({ queryKey: ['integrations', 'channels'], queryFn: listChannels });
  const { data: catalog = [], isLoading: catalogLoading } = useQuery({
    queryKey: ['integrations', 'llm-catalog'],
    queryFn: fetchLlmCatalog,
  });

  const llmChannel = useMemo(() => all.find((c) => c.channel_type === 'llm'), [all]);
  const currentDef = useMemo(
    () => catalog.find((p) => p.id === llmChannel?.provider),
    [catalog, llmChannel?.provider],
  );

  const [modalProviderId, setModalProviderId] = useState<string | null>(null);
  const modalDef = modalProviderId ? catalog.find((p) => p.id === modalProviderId) : undefined;

  const [displayName, setDisplayName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [credDraft, setCredDraft] = useState<Record<string, string>>({});
  const [cfgDraft, setCfgDraft] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});

  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');

  useEffect(() => {
    if (!modalDef) return;
    const sameProv = llmChannel?.provider === modalDef.id;
    setDisplayName(
      sameProv && llmChannel?.display_name?.trim()
        ? llmChannel.display_name
        : `${modalDef.name} (IA)`,
    );
    setIsActive(llmChannel?.is_active ?? true);

    const existingCfg = sameProv ? llmChannel?.config || {} : {};
    const cfg: Record<string, string> = {};
    for (const f of modalDef.configFields) {
      const v = existingCfg[f.key];
      cfg[f.key] =
        typeof v === 'string' && v.trim()
          ? v
          : f.defaultValue !== undefined
            ? f.defaultValue
            : '';
    }
    setCfgDraft(cfg);

    const cred: Record<string, string> = {};
    for (const f of modalDef.credentialFields) cred[f.key] = '';
    setCredDraft(cred);
    setShowSecret({});
  }, [modalDef, llmChannel]);

  const anyCredStored = Boolean(
    llmChannel &&
      Object.values(llmChannel.credentials || {}).some((v) => typeof v === 'string' && String(v).length > 0),
  );

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!modalDef) throw new Error('Escolha um provedor.');
      const credentials: Record<string, string> = {};
      for (const f of modalDef.credentialFields) {
        const v = credDraft[f.key]?.trim();
        if (v) credentials[f.key] = v;
      }
      const sameProv = llmChannel?.provider === modalDef.id;
      const hadSecretsHere = channelHasStoredSecrets(llmChannel, modalDef);
      const requiredSecrets = modalDef.credentialFields.filter((f) => f.kind === 'secret' && f.required);
      if (requiredSecrets.length > 0) {
        if (!sameProv && Object.keys(credentials).length === 0) {
          throw new Error('Informe as credenciais obrigatórias para mudar para este provedor.');
        }
        if (sameProv && !hadSecretsHere && Object.keys(credentials).length === 0) {
          throw new Error('Informe as credenciais na primeira configuração.');
        }
      }

      const configPayload: Record<string, unknown> = {};
      for (const f of modalDef.configFields) {
        const v = cfgDraft[f.key]?.trim() ?? '';
        configPayload[f.key] = v;
      }

      return upsertWorkspaceLlmConfig({
        provider: modalDef.id,
        display_name: displayName.trim() || undefined,
        config: configPayload,
        credentials: Object.keys(credentials).length ? credentials : undefined,
        is_active: isActive,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['integrations', 'channels'] });
      setModalProviderId(null);
      setMsg('Configuração salva.');
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const handleTest = async () => {
    if (!llmChannel?.id) {
      setMsg('Salve o canal antes de testar.');
      return;
    }
    setTesting('loading');
    try {
      await testChannelConnection(llmChannel.id);
      setTesting('ok');
    } catch {
      setTesting('err');
    }
  };

  const renderField = (f: LlmFieldSpec, group: 'cred' | 'cfg') => {
    const value = group === 'cred' ? credDraft[f.key] ?? '' : cfgDraft[f.key] ?? '';
    const setVal = (next: string) => {
      if (group === 'cred') setCredDraft((prev) => ({ ...prev, [f.key]: next }));
      else setCfgDraft((prev) => ({ ...prev, [f.key]: next }));
    };

    if (f.kind === 'secret') {
      const maskedStored =
        llmChannel != null &&
        modalDef != null &&
        llmChannel.provider === modalDef.id &&
        typeof llmChannel.credentials[f.key] === 'string' &&
        String(llmChannel.credentials[f.key]).length > 0;

      return (
        <label key={f.key} className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {f.label}
            {f.required ? <span className="text-destructive"> *</span> : null}
          </span>
          <div className="relative">
            <input
              type={showSecret[f.key] ? 'text' : 'password'}
              value={value}
              onChange={(e) => setVal(e.target.value)}
              disabled={!isAdmin}
              placeholder={
                maskedStored ? '•••• deixe em branco para manter a credencial atual' : f.placeholder || '…'
              }
              autoComplete="off"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-xs font-mono text-foreground disabled:opacity-60"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-sidebar-accent/60"
              onClick={() => setShowSecret((s) => ({ ...s, [f.key]: !s[f.key] }))}
              title={showSecret[f.key] ? 'Ocultar' : 'Mostrar'}
            >
              {showSecret[f.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {f.help ? <p className="text-[10px] text-muted-foreground">{f.help}</p> : null}
        </label>
      );
    }

    const inputType = f.kind === 'url' ? 'url' : 'text';

    return (
      <label key={f.key} className="block space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          {f.label}
          {f.required ? <span className="text-destructive"> *</span> : null}
        </span>
        <input
          type={inputType}
          value={value}
          onChange={(e) => setVal(e.target.value)}
          disabled={!isAdmin}
          placeholder={f.placeholder}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono text-foreground disabled:opacity-60"
        />
        {f.help ? <p className="text-[10px] text-muted-foreground">{f.help}</p> : null}
      </label>
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">IA / LLM</h3>
              <p className="text-[11px] text-muted-foreground">
                Escolha o provedor usado pelo copiloto interno e pela sugestão de resposta neste workspace (BYOK). Os campos são
                definidos pelo catálogo na API — novos provedores podem ser acrescentados sem alterar esta tela.
              </p>
            </div>
          </div>
          {anyCredStored ? (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                llmChannel?.is_active ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
              )}
            >
              {llmChannel?.is_active ? 'Credenciais guardadas · ativo' : 'Credenciais guardadas · inativo'}
            </span>
          ) : (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
              Sem BYOK neste workspace
            </span>
          )}
        </div>
        {currentDef ? (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Provedor atual: <span className="font-medium text-foreground">{currentDef.name}</span> ({currentDef.id})
          </p>
        ) : llmChannel?.provider ? (
          <p className="mt-3 text-[11px] text-warning">
            Canal guardado com provedor <span className="font-mono">{llmChannel.provider}</span> que não está no catálogo —
            atualize o servidor ou contacte o suporte.
          </p>
        ) : (
          <p className="mt-3 text-[11px] text-muted-foreground">Nenhum canal LLM neste workspace ainda.</p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <p className="mb-3 text-[11px] font-medium text-muted-foreground">Provedores disponíveis</p>
        {catalogLoading ? (
          <p className="text-xs text-muted-foreground">A carregar catálogo…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!isAdmin}
                onClick={() => {
                  setMsg(null);
                  setModalProviderId(p.id);
                }}
                className={cn(
                  'rounded-xl border border-border bg-background p-4 text-left transition-colors hover:bg-sidebar-accent/60 disabled:opacity-60',
                  llmChannel?.provider === p.id && 'ring-2 ring-primary/40'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold">{p.name}</span>
                  {llmChannel?.provider === p.id ? (
                    <span className="text-[10px] text-primary">Atual</span>
                  ) : null}
                </div>
                <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{p.description}</p>
                <span className="mt-2 inline-block text-[10px] font-medium text-primary">Configurar →</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {modalDef ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setModalProviderId(null);
            setMsg(null);
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold">{modalDef.name}</h4>
                <p className="text-[11px] text-muted-foreground">{modalDef.description}</p>
              </div>
              {modalDef.docsUrl ? (
                <a
                  href={modalDef.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex shrink-0 items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  Docs <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Nome no painel</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={!isAdmin}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs disabled:opacity-60"
                />
              </label>

              <div className="space-y-3 rounded-lg border border-border bg-muted/15 p-3">
                <p className="text-[11px] font-semibold text-muted-foreground">Credenciais</p>
                {modalDef.credentialFields.map((f) => renderField(f, 'cred'))}
              </div>

              <div className="space-y-3 rounded-lg border border-border bg-muted/15 p-3">
                <p className="text-[11px] font-semibold text-muted-foreground">Parâmetros</p>
                {modalDef.configFields.map((f) => renderField(f, 'cfg'))}
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                <input type="checkbox" checked={isActive} disabled={!isAdmin} onChange={(e) => setIsActive(e.target.checked)} />
                Canal ativo neste workspace
              </label>

              {msg ? <p className="text-[11px] text-muted-foreground">{msg}</p> : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={!isAdmin || saveMut.isPending}
                  onClick={() => {
                    setMsg(null);
                    void saveMut.mutateAsync().catch(() => undefined);
                  }}
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => {
                    setModalProviderId(null);
                    setMsg(null);
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
              {!isAdmin ? (
                <p className="text-[11px] font-medium text-warning">
                  Somente administradores do workspace podem alterar esta configuração.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        <p className="text-[11px] text-muted-foreground">Testar com o canal já guardado no workspace</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!isAdmin || !llmChannel?.id || testing === 'loading'}
            onClick={() => void handleTest()}
            className="rounded-lg border border-border bg-background px-4 py-2 text-xs font-semibold disabled:opacity-50"
          >
            Testar conexão
          </button>
          {testing === 'ok' ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> OK
            </span>
          ) : null}
          {testing === 'err' ? <span className="text-[11px] text-destructive">Falha no teste</span> : null}
        </div>
      </div>
    </div>
  );
}
