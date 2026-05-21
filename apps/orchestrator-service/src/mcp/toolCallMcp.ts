import axios from 'axios';

export type McpToolName = 'mcp-operacao' | 'mcp-routing' | 'mcp-tasking' | 'mcp-audit';

export type McpActionName =
  | 'get_driver_context'
  | 'get_pharmacy_context'
  | 'get_leader_context'
  | 'explain_routing'
  | 'suggest_queue'
  | 'create_pending_task'
  | 'list_open_tasks'
  | 'log_tool_execution'
  | 'list_recent_events';

export type McpCallInput = {
  tool: McpToolName;
  action: McpActionName;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

export type McpCallResult = {
  ok: boolean;
  tool: McpToolName;
  action: McpActionName;
  execution_id?: string;
  output?: Record<string, unknown>;
  raw?: unknown;
};

type ToolRegistry = Record<McpToolName, { actions: Set<McpActionName>; enabled: boolean }>;

const DEFAULT_TIMEOUT_MS = Number(process.env.MCP_TIMEOUT_MS || 8000);
const DEFAULT_RETRY_MAX = Number(process.env.MCP_RETRY_MAX || 1);

function parseEnabledTools(): Set<McpToolName> {
  const raw = (process.env.MCP_ENABLED_TOOLS || '').trim();
  if (!raw) return new Set(['mcp-operacao', 'mcp-routing', 'mcp-tasking', 'mcp-audit']);
  return new Set(
    raw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x): x is McpToolName => ['mcp-operacao', 'mcp-routing', 'mcp-tasking', 'mcp-audit'].includes(x))
  );
}

export function getMcpToolRegistry(): ToolRegistry {
  const enabledTools = parseEnabledTools();
  return {
    'mcp-operacao': {
      enabled: enabledTools.has('mcp-operacao'),
      actions: new Set(['get_driver_context', 'get_pharmacy_context', 'get_leader_context']),
    },
    'mcp-routing': {
      enabled: enabledTools.has('mcp-routing'),
      actions: new Set(['explain_routing', 'suggest_queue']),
    },
    'mcp-tasking': {
      enabled: enabledTools.has('mcp-tasking'),
      actions: new Set(['create_pending_task', 'list_open_tasks']),
    },
    'mcp-audit': {
      enabled: enabledTools.has('mcp-audit'),
      actions: new Set(['log_tool_execution', 'list_recent_events']),
    },
  };
}

export function isValidMcpToolAction(input: McpCallInput): boolean {
  const registry = getMcpToolRegistry();
  const row = registry[input.tool];
  if (!row || !row.enabled) return false;
  return row.actions.has(input.action);
}

export async function executeToolCallMcp(input: McpCallInput): Promise<McpCallResult> {
  if (!isValidMcpToolAction(input)) {
    return {
      ok: false,
      tool: input.tool,
      action: input.action,
      output: { error: 'tool_or_action_not_enabled' },
    };
  }

  const baseUrl = (process.env.INTERNAL_API_BASE_URL || '').trim();
  if (!baseUrl) {
    return {
      ok: false,
      tool: input.tool,
      action: input.action,
      output: { error: 'internal_api_base_url_missing' },
    };
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/api/mcp/execute`;
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= DEFAULT_RETRY_MAX) {
    try {
      const response = await axios.post(
        url,
        {
          tool: input.tool,
          action: input.action,
          input: input.input || {},
          context: input.context || {},
        },
        {
          timeout: DEFAULT_TIMEOUT_MS,
          headers: {
            ...(process.env.INTERNAL_API_KEY ? { 'x-internal-api-key': process.env.INTERNAL_API_KEY } : {}),
          },
        }
      );

      return {
        ok: true,
        tool: input.tool,
        action: input.action,
        execution_id: response.data?.execution_id,
        output: (response.data?.output || {}) as Record<string, unknown>,
        raw: response.data,
      };
    } catch (error) {
      lastError = error;
      attempt += 1;
    }
  }

  const errorMessage = lastError instanceof Error ? lastError.message : 'mcp_call_failed';
  return {
    ok: false,
    tool: input.tool,
    action: input.action,
    output: { error: errorMessage },
  };
}
