'use client';

import { useAutomationWizardContext } from '@/lib/automations/AutomationWizardContext';
import { Check, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { templates } from '@/lib/automations/wizardConstants';

export function StepModel() {
  const {
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
  } = useAutomationWizardContext();
  return (
    <>
                  <div className="text-sm font-semibold tracking-tight text-foreground">Escolha um ponto de partida</div>
                  <div className="mt-1 text-xs text-muted-foreground">Modelos pré-configurados aceleram a criação. Você pode ajustar tudo depois.</div>

                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {templates.map((t) => {
                      const Icon = t.icon;
                      const selected = model === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setModel(t.id)}
                          className={cn(
                            'flex items-start gap-3 rounded-lg border p-4 text-left transition-all',
                            selected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-muted/30 hover:border-border-strong'
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', t.color)}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium">{t.name}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">{t.desc}</div>
                            </div>
                          </div>
                          {selected ? <Check className="h-4 w-4 text-primary" /> : null}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      disabled
                      className={cn(reviveOutlineButtonClassName, 'disabled:opacity-40')}
                    >
                      Voltar
                    </button>
                    <Button type="button" size="xs" onClick={() => setStep(2)} disabled={!canNext}>
                      Próximo <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
    </>
  );
}
