'use client';

type McpToolCatalogItem = {
  tool: string;
  title: string;
  actions: Array<{ action: string; description: string }>;
};

type Props = {
  enabled: boolean;
  tool: string;
  action: string;
  tools: McpToolCatalogItem[];
  actions: Array<{ action: string; description: string }>;
  loading?: boolean;
  error?: boolean;
  onToggle: (enabled: boolean) => void;
  onToolChange: (tool: string) => void;
  onActionChange: (action: string) => void;
};

export function ToolCallMcpNode(props: Props) {
  const { enabled, tool, action, tools, actions, loading, error, onToggle, onToolChange, onActionChange } = props;

  return (
    <div className="rounded-xl border border-border bg-background/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Tool Call (MCP)</div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="rounded border-border bg-background"
          />
          Ativar
        </label>
      </div>
      {!enabled ? (
        <div className="text-xs text-muted-foreground">Opcional. Habilite para configurar chamada MCP nesta automação.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Tool</label>
            <select
              value={tool}
              onChange={(e) => onToolChange(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none"
            >
              <option value="">—</option>
              {tools.map((t) => (
                <option key={t.tool} value={t.tool}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Action</label>
            <select
              value={action}
              onChange={(e) => onActionChange(e.target.value)}
              disabled={!tool}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none disabled:opacity-60"
            >
              <option value="">—</option>
              {actions.map((a) => (
                <option key={a.action} value={a.action}>
                  {a.action}
                </option>
              ))}
            </select>
          </div>
          {loading ? <p className="col-span-2 text-xs text-muted-foreground">Carregando catálogo MCP...</p> : null}
          {error ? <p className="col-span-2 text-xs text-destructive">Falha ao carregar catálogo MCP.</p> : null}
        </div>
      )}
    </div>
  );
}
