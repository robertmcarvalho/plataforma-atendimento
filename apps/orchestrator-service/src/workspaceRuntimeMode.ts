import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export type FlowRuntimeMode = 'legacy' | 'catalog' | 'shadow' | 'flow';

const cache = new Map<string, { expiresAt: number; mode: FlowRuntimeMode }>();
const CACHE_TTL_MS = 60 * 1000;

let activeMode: FlowRuntimeMode = 'catalog';

export function setActiveFlowRuntimeMode(mode: FlowRuntimeMode) {
  activeMode = mode;
}

export function getActiveFlowRuntimeMode(): FlowRuntimeMode {
  return activeMode;
}

export async function loadWorkspaceFlowRuntimeMode(workspaceId: string): Promise<FlowRuntimeMode> {
  const cached = cache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) return cached.mode;

  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('key', 'flow_runtime_mode')
    .maybeSingle();

  if (error) {
    console.warn('[Orchestrator] flow_runtime_mode read failed:', error.message);
  }

  const raw = String(data?.value ?? 'catalog').toLowerCase();
  const mode: FlowRuntimeMode =
    raw === 'legacy' || raw === 'shadow' || raw === 'flow' ? (raw as FlowRuntimeMode) : 'catalog';
  cache.set(workspaceId, { expiresAt: Date.now() + CACHE_TTL_MS, mode });
  return mode;
}
