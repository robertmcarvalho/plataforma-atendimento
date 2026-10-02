/**
 * Split orchestrator-service/src/index.ts into modules (Phase D1).
 * Run from repo root: node apps/orchestrator-service/scripts/split-orchestrator-index.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const indexPath = path.join(SRC, 'index.ts');
const backupPath = path.join(SRC, 'index.monolith.ts.bak');

if (!fs.existsSync(indexPath)) {
  console.error('index.ts not found');
  process.exit(1);
}

const raw = fs.readFileSync(indexPath, 'utf8');
const lines = raw.split(/\r?\n/);
const slice = (start, end) => lines.slice(start - 1, end).join('\n');

if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, raw);
  console.log('Backup:', backupPath);
}

// --- orchestratorConfig.ts (lines 50-103) ---
fs.writeFileSync(
  path.join(SRC, 'lib/orchestratorConfig.ts'),
  `/** Constantes e flags de ambiente do orquestrador. */
${slice(50, 103)}
`,
);

// --- orchestratorUtils.ts (lines 105-151) ---
fs.writeFileSync(
  path.join(SRC, 'lib/orchestratorUtils.ts'),
  `import { logger } from './orchestratorContext';
import { LATENCY_TARGETS_MS } from './orchestratorConfig';

${slice(105, 151)}
`,
);

// --- legacyBotRuntime.ts (lines 410-3139) ---
const legacyImports = `import axios from 'axios';
import { addBusinessMinutes, hasCanonicalBusinessHours, isOpen, normalizeBusinessHours, type BusinessHoursConfig } from './lib/businessHours';
import { maybeOutOfHoursNotice, refreshConversationSla } from './lib/conversationSla';
import { executeToolCallMcp, getMcpToolRegistry, type McpCallInput } from './mcp/toolCallMcp';
import { type GuidedDemandProfile } from './guidedIntake';
import {
  loadWorkspaceCatalog,
  runtimeCatalogMessage,
  runtimeListDemandsForSector,
  runtimeSlaPresetForDemand,
  setActiveWorkspaceCatalog,
} from './workspaceCatalogRuntime';
import { tryConversationFlowTurn } from './conversationFlowRuntime';
import {
  getActiveFlowRuntimeMode,
  loadWorkspaceFlowRuntimeMode,
  setActiveFlowRuntimeMode,
} from './workspaceRuntimeMode';
import { postWhatsAppMessage, setOutboundWorkspaceId } from './lib/whatsappOutbound';
import {
  formatQueueSlaAppliedNote,
  formatTriagemGuidadaNote,
} from '@plataforma/operational-notes';
import {
  buildLeaderDriverListRows,
  getDriversAtPharmacyForLeader,
  isDriverLinkedToPharmacy,
  LEADER_DRIVER_NONE_ID,
  LEADER_DRIVER_NO_ID,
  LEADER_DRIVER_YES_ID,
  needsNumberedLeaderDriverMenu,
  normalizeLeaderPharmacyRows,
  type LeaderDriverOption,
  type LeaderPharmacyRow,
} from './leaderIntake';
import { supabase, orchestratorConsole as console } from './lib/orchestratorContext';
import {
  BOT_INBOUND_META_DEDUP_KEY,
  GUIDED_INTAKE_FIRST,
  LATENCY_TARGETS_MS,
  LEGACY_BOT_SESSION_ENABLED,
  LEGACY_INTENT_TO_SECTOR,
  NUMBERED_MENU_PAGE_SIZE,
  NUMBERED_MENU_TITLE_MAX,
  WA_BTN_TITLE_MAX,
  WA_LIST_BTN_DEMANDS,
  WA_LIST_BTN_DRIVERS,
  WA_LIST_BTN_PHARMACIES,
  WA_LIST_BTN_SECTORS,
  WA_LIST_MAX_ROWS,
  WA_LIST_ROW_TITLE_MAX,
  WA_LIST_SECTION_DEMANDS,
  WA_LIST_SECTION_DRIVERS,
  WA_LIST_SECTION_PHARMACIES,
  WA_LIST_SECTION_SECTORS,
} from './lib/orchestratorConfig';
import {
  elapsedMs,
  isUuid,
  logDuration,
  normalizeIntent,
  normalizeText,
  toStringArray,
} from './lib/orchestratorUtils';

`;

fs.writeFileSync(
  path.join(SRC, 'legacyBotRuntime.ts'),
  `${legacyImports}
${slice(410, 3139)}
`,
);

// --- inboundMessage.ts ---
const inboundImports = `import { contextFromPubSubEnvelope, normalizeError } from '@plataforma/logger';
import { resolveWhatsAppChannel } from '@plataforma/channel-runtime';
import { processInboundTicketing } from './ticketing/classifier';
import { scheduleInboundAiAnalysis } from '@plataforma/ai-core';
import { setOutboundWorkspaceId } from './lib/whatsappOutbound';
import { tryHandleAdvanceRejectionFollowup } from './lib/advanceRejectionFollowup.js';
import { supabase, logger, orchestratorConsole as console } from './lib/orchestratorContext';
import { LATENCY_TARGETS_MS } from './lib/orchestratorConfig';
import { isUuid, logDuration } from './lib/orchestratorUtils';
import {
  createConversation,
  ensureConversationSummary,
  extractContent,
  getActiveConversation,
  getOrCreateContact,
  processBotSession,
} from './legacyBotRuntime';

`;

fs.writeFileSync(
  path.join(SRC, 'handlers/inboundMessage.ts'),
  `${inboundImports}
type InboundChannelEnvelope = {
  workspace_channel_id?: unknown;
  channel_type?: unknown;
  phone_number_id?: unknown;
};

type InboundIntakeHints = {
  ooh_handled_at_edge?: boolean;
};

${slice(199, 211)}

${slice(213, 408)}

${slice(2607, 2618)}

export { handleInboundMessage, handleStatusUpdate, resolveInboundWorkspaceChannelId };
`,
);

// Fix: resolveInboundWorkspaceChannelId and types need export - the slice includes them but handleStatusUpdate was separate
// Re-read - slice 199-211 is resolveInboundWorkspaceChannelId only. 213-408 handleInbound. 2607-2618 handleStatusUpdate.
// Remove duplicate export line if functions aren't exported - add export keyword to async functions in file

let inboundContent = fs.readFileSync(path.join(SRC, 'handlers/inboundMessage.ts'), 'utf8');
inboundContent = inboundContent
  .replace('async function resolveInboundWorkspaceChannelId', 'export async function resolveInboundWorkspaceChannelId')
  .replace('async function handleInboundMessage', 'export async function handleInboundMessage')
  .replace('async function handleStatusUpdate', 'export async function handleStatusUpdate')
  .replace(/\nexport \{ handleInboundMessage, handleStatusUpdate, resolveInboundWorkspaceChannelId \};\n?$/, '\n');
fs.writeFileSync(path.join(SRC, 'handlers/inboundMessage.ts'), inboundContent);

// --- pubsubBinding.ts ---
fs.writeFileSync(
  path.join(SRC, 'pubsubBinding.ts'),
  `import { contextFromPubSubEnvelope, normalizeError } from '@plataforma/logger';
import { pubsub, logger } from './lib/orchestratorContext';
import { handleInboundMessage, handleStatusUpdate } from './handlers/inboundMessage';

type InboundIntakeHints = {
  ooh_handled_at_edge?: boolean;
};

export function bindOrchestratorSubscriptions() {
  bindSubscription(process.env.PUBSUB_SUBSCRIPTION_INBOUND!);
  if (process.env.PUBSUB_SUBSCRIPTION_STATUS) {
    bindSubscription(process.env.PUBSUB_SUBSCRIPTION_STATUS);
  }
}

${slice(171, 197).replace('function bindSubscription', 'function bindSubscription')}
`,
);

let pubsubContent = fs.readFileSync(path.join(SRC, 'pubsubBinding.ts'), 'utf8');
pubsubContent = pubsubContent.replace('function bindSubscription', 'function bindSubscription');
fs.writeFileSync(path.join(SRC, 'pubsubBinding.ts'), pubsubContent);

// --- healthServer.ts ---
fs.writeFileSync(
  path.join(SRC, 'healthServer.ts'),
  `import { createServer } from 'http';
import { orchestratorConsole as console } from './lib/orchestratorContext';

export function startHealthServer() {
${slice(3144, 3165)}
}
`,
);

// --- legacyBotRuntime exports for inbound ---
let legacyContent = fs.readFileSync(path.join(SRC, 'legacyBotRuntime.ts'), 'utf8');
const exportNames = [
  'processBotSession',
  'getOrCreateContact',
  'getActiveConversation',
  'createConversation',
  'ensureConversationSummary',
  'extractContent',
];
for (const name of exportNames) {
  legacyContent = legacyContent.replace(
    new RegExp(`\\nasync function ${name}\\(`),
    `\nexport async function ${name}(`
  );
  legacyContent = legacyContent.replace(
    new RegExp(`\\nfunction ${name}\\(`),
    `\nexport function ${name}(`
  );
}
fs.writeFileSync(path.join(SRC, 'legacyBotRuntime.ts'), legacyContent);

// --- index.ts bootstrap ---
fs.writeFileSync(
  path.join(SRC, 'index.ts'),
  `import 'dotenv/config';
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
`,
);

console.log('Split complete. Run: npm run build --workspace=orchestrator-service');
