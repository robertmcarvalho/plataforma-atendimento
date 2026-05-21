'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import api from '@/lib/api';

type CatalogAction = { action: string; description: string };
type CatalogTool = {
  tool: string;
  title: string;
  description: string;
  priority: string;
  actions: CatalogAction[];
};

type ToolGovernance = {
  enabled: boolean;
  timeout_ms: number;
  retry: number;
  roles: string[];
};

type GovernanceState = Record<string, ToolGovernance>;
type RolloutState = {
  enabled: boolean;
  pilot_tenants: string[];
};

const DEFAULT_ROLES = ['admin', 'supervisor'];

function defaultGovernanceForTools(tools: CatalogTool[]): GovernanceState {
  return Object.fromEntries(
    tools.map((t) => [
      t.tool,
      {
        enabled: true,
        timeout_ms: 8000,
        retry: 1,
        roles: DEFAULT_ROLES,
      },
    ])
  );
}

export default function McpToolsSettingsPage() {
  const [saveNote, setSaveNote] = useState<{ tone: 'ok' | 'err'; message: string } | null>(null);
  const [draft, setDraft] = useState<GovernanceState | null>(null);
  const [rolloutDraft, setRolloutDraft] = useState<RolloutState | null>(null);
  const [saving, setSaving] = useState(false);

  const toolsQuery = useQuery({
    queryKey: ['settings', 'mcp-tools', 'catalog'],
    queryFn: async () => (await api.get('/api/mcp/tools')).data as CatalogTool[],
  });

  const settingsQuery = useQuery({
    queryKey: ['settings', 'mcp-tools', 'governance'],
    queryFn: async () => (await api.get('/api/settings')).data as Record<string, unknown>,
  });

  const data = useMemo(() => {
    const tools = toolsQuery.data || [];
    const base = defaultGovernanceForTools(tools);
    const stored = settingsQuery.data?.mcp_tools_governance as GovernanceState | undefined;
    return stored ? { ...base, ...stored } : base;
  }, [toolsQuery.data, settingsQuery.data]);

  const model = draft || data;
  const rolloutData = useMemo(() => {
    const stored = settingsQuery.data?.mcp_rollout_config as Partial<RolloutState> | undefined;
    return {
      enabled: Boolean(stored?.enabled),
      pilot_tenants: Array.isArray(stored?.pilot_tenants) ? stored.pilot_tenants.map((x) => String(x)) : [],
    };
  }, [settingsQuery.data]);
  const rollout = rolloutDraft || rolloutData;

  const setToolPatch = (tool: string, patch: Partial<ToolGovernance>) => {
    setDraft((current) => {
      const next = { ...(current || data) };
      next[tool] = { ...(next[tool] || { enabled: true, timeout_ms: 8000, retry: 1, roles: DEFAULT_ROLES }), ...patch };
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setSaveNote(null);
    try {
      await api.put('/api/settings', {
        key: 'mcp_tools_governance',
        value: model,
      });
      await api.put('/api/settings', {
        key: 'mcp_rollout_config',
        value: rollout,
      });
      setSaveNote({ tone: 'ok', message: 'Governança e rollout MCP salvos com sucesso.' });
      await settingsQuery.refetch();
      setDraft(null);
      setRolloutDraft(null);
    } catch (err: unknown) {
      setSaveNote({ tone: 'err', message: err instanceof Error ? err.message : 'Falha ao salvar governança/rollout MCP.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Configurações
        </Link>

        <PageHeader
          eyebrow="Configurações"
          title="MCP Tools"
          description="Governança por ferramenta: timeout, retry e permissões por papel."
          actions={
            <button
              onClick={() => void save()}
              disabled={saving || toolsQuery.isLoading || settingsQuery.isLoading}
              className="button-primary rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60"
            >
              {saving ? 'Salvando...' : 'Salvar governança'}
            </button>
          }
        />

        {saveNote ? (
          <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${saveNote.tone === 'ok' ? 'border-success/40 text-success' : 'border-destructive/40 text-destructive'}`}>
            {saveNote.message}
          </div>
        ) : null}

        {toolsQuery.isError || settingsQuery.isError ? <div className="text-xs text-destructive">Falha ao carregar dados de governança MCP.</div> : null}
        {toolsQuery.isLoading || settingsQuery.isLoading ? <div className="text-xs text-muted-foreground">Carregando ferramentas MCP...</div> : null}

        <div className="space-y-3">
          <div className="panel rounded-xl p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Rollout piloto multi-tenant</p>
                <p className="text-xs text-muted-foreground">
                  Controla liberação de `mcp-finance` e `mcp-integrations` por tenant.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={rollout.enabled}
                  onChange={(e) => setRolloutDraft({ ...rollout, enabled: e.target.checked })}
                  className="rounded border-border bg-background"
                />
                Rollout ativo
              </label>
            </div>
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Pilot tenants (UUID, separados por vírgula)</label>
              <input
                value={rollout.pilot_tenants.join(', ')}
                onChange={(e) =>
                  setRolloutDraft({
                    ...rollout,
                    pilot_tenants: e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
                className="control-input mt-1 !rounded-lg !py-2 !text-sm"
                placeholder="11111111-1111-1111-1111-111111111111, 22222222-2222-2222-2222-222222222222"
              />
            </div>
          </div>

          {(toolsQuery.data || []).map((tool) => {
            const cfg = model[tool.tool];
            return (
              <div key={tool.tool} className="panel rounded-xl p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{tool.title}</p>
                    <p className="text-xs text-muted-foreground">{tool.description}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-subtle-foreground">
                      {tool.tool} · prioridade {tool.priority}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={Boolean(cfg?.enabled)}
                      onChange={(e) => setToolPatch(tool.tool, { enabled: e.target.checked })}
                      className="rounded border-border bg-background"
                    />
                    Ativo
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Timeout (ms)</label>
                    <input
                      type="number"
                      min={500}
                      step={500}
                      value={cfg?.timeout_ms ?? 8000}
                      onChange={(e) => setToolPatch(tool.tool, { timeout_ms: Number(e.target.value) || 8000 })}
                      className="control-input mt-1 !rounded-lg !py-2 !text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Retry</label>
                    <input
                      type="number"
                      min={0}
                      max={5}
                      value={cfg?.retry ?? 1}
                      onChange={(e) => setToolPatch(tool.tool, { retry: Number(e.target.value) || 0 })}
                      className="control-input mt-1 !rounded-lg !py-2 !text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Papéis permitidos</label>
                    <input
                      value={(cfg?.roles || DEFAULT_ROLES).join(', ')}
                      onChange={(e) =>
                        setToolPatch(tool.tool, {
                          roles: e.target.value
                            .split(',')
                            .map((r) => r.trim())
                            .filter(Boolean),
                        })
                      }
                      className="control-input mt-1 !rounded-lg !py-2 !text-sm"
                      placeholder="admin, supervisor"
                    />
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-border bg-background/40 p-2">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Actions</p>
                  <div className="flex flex-wrap gap-1">
                    {tool.actions.map((a) => (
                      <span key={a.action} className="rounded bg-background/70 px-2 py-1 text-[10px] text-muted-foreground">
                        {a.action}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
