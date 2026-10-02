import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pagePath = path.join(root, 'src/app/(app)/settings/automations/new/page.tsx');
const lines = fs.readFileSync(pagePath, 'utf8').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

const WIZARD_STATE_KEYS = `
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
`.trim();

function patchStep(rel) {
  const file = path.join(root, rel);
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(
    /import \{ AutomationWizardProvider, useAutomationWizardContext \} from '@\/lib\/automations\/AutomationWizardContext';\n/,
    `import { useAutomationWizardContext } from '@/lib/automations/AutomationWizardContext';\n`
  );
  content = content.replace(
    /const w = useAutomationWizardContext\(\);\n/,
    `const {\n${WIZARD_STATE_KEYS}\n  } = useAutomationWizardContext();\n`
  );
  content = content.replace(/return \(\n    <>\n                <>\n/, 'return (\n    <>\n');
  content = content.replace(/\n                <\/>\n    <>\n/g, '\n');
  fs.writeFileSync(file, content);
  console.log('patched', rel);
}

for (const step of [
  'src/components/automations/wizard/StepModel.tsx',
  'src/components/automations/wizard/StepTrigger.tsx',
  'src/components/automations/wizard/StepConditions.tsx',
  'src/components/automations/wizard/StepActions.tsx',
  'src/components/automations/wizard/StepReview.tsx',
]) {
  patchStep(step);
}

// Replace duplicate filters block in StepTrigger with StepConditions
const triggerPath = path.join(root, 'src/components/automations/wizard/StepTrigger.tsx');
let trigger = fs.readFileSync(triggerPath, 'utf8');
const filterStart = trigger.indexOf('<div className="rounded-lg border border-border border-dashed bg-background/30 p-3">');
const filterEnd = trigger.indexOf('</div>\n                      </div>\n                    ) : (\n                      <>');
if (filterStart !== -1 && filterEnd !== -1) {
  trigger =
    trigger.slice(0, filterStart) +
    '<StepConditions />\n                      </div>\n                    ) : (\n                      <>' +
    trigger.slice(filterEnd + '</div>\n                      </div>\n                    ) : (\n                      <>'.length);
  fs.writeFileSync(triggerPath, trigger);
  console.log('patched StepTrigger filters -> StepConditions');
}

const stepSwitch = `{step === 1 ? (
                <StepModel />
              ) : step === 2 ? (
                <StepTrigger />
              ) : step === 3 ? (
                <StepActions />
              ) : (
                <StepReview />
              )}`;

const shellInner = `${slice(1197, 1199)}
            <div className="rounded-xl border border-border bg-surface p-6">
              ${stepSwitch}
${slice(2063, 2136)}`;

const pageContent = `'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import Link from 'next/link';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Loader2,
  Play,
  X,
} from 'lucide-react';
import { StepActions } from '@/components/automations/wizard/StepActions';
import { StepModel } from '@/components/automations/wizard/StepModel';
import { StepReview } from '@/components/automations/wizard/StepReview';
import { StepTrigger } from '@/components/automations/wizard/StepTrigger';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { AutomationWizardProvider } from '@/lib/automations/AutomationWizardContext';
import { stepsMeta } from '@/lib/automations/wizardConstants';
import { stepLabel } from '@/lib/automations/wizardUtils';
import { useAutomationWizard } from '@/lib/automations/useAutomationWizard';
import { countBlocos } from '@/lib/conversation-flow/fluxo';
import { interactiveNavItem } from '@/lib/interactiveRow';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { cn } from '@/lib/utils';

export function AutomationWizardPageContent() {
  const wizard = useAutomationWizard();
  const {
    router,
    step,
    setStep,
    kind,
    model,
    cfTrigger,
    arTriggerType,
    arEventType,
    arEventTypeCustom,
    triageBlocos,
    resumoCanais,
    draftName,
    previewLines,
    isEditing,
    canSave,
    saving,
    save,
    canTest,
    testOpen,
    setTestOpen,
    testResult,
    setTestResult,
    testRunning,
    runTest,
  } = wizard;

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
                'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                active && 'bg-primary/15 text-primary',
                done && 'text-success',
                !active && !done && interactiveNavItem(false)
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
    <AutomationWizardProvider value={wizard}>
      <form onSubmit={(e) => void save(e)} className="h-full overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">
          <Link href="/automacoes" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Automações
          </Link>

          <PageHeader
            icon={Bot}
            eyebrow={isEditing ? 'Inteligência · Editar' : 'Inteligência · Nova'}
            title={isEditing ? 'Editar automação' : 'Criar automação'}
            description="Defina o gatilho, as ações e os detalhes do fluxo."
            actions={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.push('/automacoes')}
                  className={reviveOutlineButtonClassName}
                >
                  Cancelar
                </button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={!canTest}
                  onClick={() => {
                    setTestOpen(true);
                    setTestResult(null);
                  }}
                >
                  <Play className="h-3.5 w-3.5" /> Testar
                </Button>
                <Button type="submit" size="xs" disabled={!canSave || saving}>
                  {saving ? 'Salvando…' : 'Salvar automação'}
                </Button>
              </div>
            }
          />

          {stepper}

${shellInner}

${slice(2138, 2191)}

        </div>
      </form>
    </AutomationWizardProvider>
  );
}
`;

fs.writeFileSync(path.join(root, 'src/components/automations/AutomationWizardPageContent.tsx'), pageContent);
console.log('wrote AutomationWizardPageContent.tsx');

fs.writeFileSync(
  path.join(root, 'src/app/(app)/settings/automations/new/page.tsx'),
  `'use client';

import { AutomationWizardPageContent } from '@/components/automations/AutomationWizardPageContent';

export default function NewAutomationWizardPage() {
  return <AutomationWizardPageContent />;
}
`
);
console.log('wrote thin page.tsx');
