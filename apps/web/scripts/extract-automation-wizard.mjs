import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pagePath = path.join(root, 'src/app/(app)/settings/automations/new/page.tsx');
const lines = fs.readFileSync(pagePath, 'utf8').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

function write(rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log('wrote', rel);
}

write(
  'src/lib/automations/wizardTypes.ts',
  `${slice(75, 125).replace(/^type /gm, 'export type ').replace(/^interface /gm, 'export interface ')}\n`
);

write(
  'src/lib/automations/wizardConstants.ts',
  `'use client';

import { Bot, Clock, GitBranch, MessageSquare, Sparkles, Users, Zap } from 'lucide-react';
import type { ModelKey } from '@/lib/automations/wizardTypes';

${slice(127, 164)}
`
);

write(
  'src/lib/automations/wizardUtils.ts',
  `import type { KindKey, ModelKey } from '@/lib/automations/wizardTypes';

${slice(166, 237)}
`
);

write(
  'src/components/automations/wizard/JsonTextarea.tsx',
  `'use client';

${slice(194, 223).replace('function JsonTextarea', 'export function JsonTextarea')}
`
);

let hookBody = slice(240, 1089)
  .replace('export default function NewAutomationWizardPage() {', '')
  .replace(/^  const router = useRouter\(\);/m, '  const router = useRouter();\n');
if (!hookBody.trimStart().startsWith('const router')) {
  hookBody = `export function useAutomationWizard() {\n${hookBody}`;
} else {
  hookBody = `export function useAutomationWizard() {\n${hookBody}`;
}

write(
  'src/lib/automations/useAutomationWizard.ts',
  `'use client';
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

${hookBody}

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
`
);

// Step extractions (inner JSX only)
const stepHeader = `'use client';

import { AutomationWizardProvider, useAutomationWizardContext } from '@/lib/automations/AutomationWizardContext';
`;

function extractStep(name, start, end, extraImports = '') {
  const body = slice(start, end);
  write(
    `src/components/automations/wizard/${name}.tsx`,
    stepHeader +
      extraImports +
      `\nexport function ${name}() {\n  const w = useAutomationWizardContext();\n  return (\n    <>\n${body}\n    </>\n  );\n}\n`
  );
}

// Step 1 inner: 1201-1246
extractStep(
  'StepModel',
  1201,
  1246,
  `import { Check, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { templates } from '@/lib/automations/wizardConstants';
`
);

extractStep(
  'StepTrigger',
  1250,
  1743,
  `import { Check, ChevronRight, CircleCheck, Clock, GitBranch, MessageSquare, Play, Plus, Trash2, Zap } from 'lucide-react';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { automationRuleTriggers } from '@/lib/automations/wizardConstants';
import { groupWorkspaceChannelsByType, newCfFilterRow, formatChannelOption } from '@/lib/conversation-flow/wizardConversationFlow';
import { StepConditions } from '@/components/automations/wizard/StepConditions';
`
);

// StepConditions - cf filters block only - will be manual fix in StepTrigger to use component
extractStep(
  'StepConditions',
  1478,
  1623,
  `import { Plus, Trash2 } from 'lucide-react';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { groupWorkspaceChannelsByType, formatChannelOption } from '@/lib/conversation-flow/wizardConversationFlow';
`
);

extractStep(
  'StepActions',
  1747,
  1911,
  `import { ChevronRight } from 'lucide-react';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { BlocoCard } from '@/components/conversation-flow/BlocoCard';
import { PaletaBlocos } from '@/components/conversation-flow/PaletaBlocos';
import { addBlocoToBranch, novoBloco, removeBloco, toggleCollapse, updateBlocoConfig, type BlocoTipo } from '@/lib/conversation-flow/fluxo';
`
);

extractStep(
  'StepReview',
  1915,
  2061,
  `import { ChevronRight } from 'lucide-react';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { JsonTextarea } from '@/components/automations/wizard/JsonTextarea';
import { bindingPriorityFromTier } from '@/lib/conversation-flow/wizardConversationFlow';
`
);

console.log('Done — patch StepTrigger to use <StepConditions /> and fix w. prefixes manually if needed');
