import 'dotenv/config';
import { getMcpToolRegistry } from './mcp/toolCallMcp';
import { orchestratorConsole as console } from './lib/orchestratorContext';
import { GUIDED_INTAKE_FIRST, LEGACY_BOT_SESSION_ENABLED } from './lib/orchestratorConfig';
import { bindOrchestratorSubscriptions } from './pubsubBinding';
import { startHealthServer } from './healthServer';

console.log('Orchestrator Service iniciando...');
if (!LEGACY_BOT_SESSION_ENABLED) {
  console.warn('[Orchestrator] Funil legado do bot DESLIGADO (ORCHESTRATOR_LEGACY_BOT_SESSION_ENABLED=false).');
}
if (GUIDED_INTAKE_FIRST) {
  console.log('[Orchestrator] Triagem guiada antes do funil legado (ORCHESTRATOR_GUIDED_INTAKE_FIRST=true).');
}
const mcpRegistry = getMcpToolRegistry();
console.log(
  '[MCP] registry carregado:',
  Object.entries(mcpRegistry).map(([tool, cfg]) => ({ tool, enabled: cfg.enabled, actions: cfg.actions.size }))
);

bindOrchestratorSubscriptions();
startHealthServer();

console.log('Orchestrator aguardando mensagens do Pub/Sub...');
