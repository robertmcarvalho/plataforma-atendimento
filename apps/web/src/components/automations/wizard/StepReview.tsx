'use client';

import { useAutomationWizardContext } from '@/lib/automations/AutomationWizardContext';
import { ChevronRight } from 'lucide-react';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { JsonTextarea } from '@/components/automations/wizard/JsonTextarea';
import { bindingPriorityFromTier } from '@/lib/conversation-flow/wizardConversationFlow';

export function StepReview() {
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
                  <div className="text-sm font-semibold tracking-tight text-foreground">Detalhes</div>
                  <div className="mt-1 text-xs text-muted-foreground">Nome e status da automação.</div>

                  <div className="mt-4 grid grid-cols-1 gap-3">
                    <label className="flex flex-col gap-2">
                      <span className="text-xs text-muted-foreground">Nome</span>
                      <input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                      <span className="text-xs text-muted-foreground">Ativa</span>
                    </label>
                    {kind === 'conversation_flow' ? (
                      <>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Descrição interna (opcional)</span>
                          <textarea
                            value={cfDescription}
                            onChange={(e) => setCfDescription(e.target.value)}
                            rows={3}
                            spellCheck={false}
                            placeholder="Notas para a equipa (não é mensagem ao cliente)."
                            className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </label>
                        <div>
                          <span className="text-xs text-muted-foreground">Prioridade do binding</span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(
                              [
                                { id: 'low' as const, label: 'Baixa' },
                                { id: 'medium' as const, label: 'Média' },
                                { id: 'high' as const, label: 'Alta' },
                              ] as const
                            ).map((tier) => (
                              <button
                                key={tier.id}
                                type="button"
                                onClick={() => setCfPriorityTier(tier.id)}
                                className={cn(
                                  'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                                  cfPriorityTier === tier.id
                                    ? 'border-primary bg-primary/15 text-primary ring-1 ring-primary/30'
                                    : 'border-border bg-background/40 text-muted-foreground hover:border-border-strong'
                                )}
                              >
                                {tier.label}
                              </button>
                            ))}
                          </div>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Quando existirem vários fluxos, prioridade mais alta avalia antes (valor numérico gravado no binding).
                          </p>
                        </div>
                      </>
                    ) : null}
                    {kind === 'automation_rule' ? (
                      <>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={arRequireApproval}
                            onChange={(e) => setArRequireApproval(e.target.checked)}
                          />
                          <span className="text-xs text-muted-foreground">Exigir aprovação antes de executar</span>
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Observações</span>
                          <textarea
                            value={arNotes}
                            onChange={(e) => setArNotes(e.target.value)}
                            className="min-h-[90px] rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                            spellCheck={false}
                          />
                        </label>

                        <JsonTextarea
                          id="audience_filters_json"
                          label="Audience filters (JSON)"
                          value={arAudienceFiltersJson}
                          onChange={setArAudienceFiltersJson}
                          hint='Ex.: { "city": "Belo Horizonte" }'
                          error={jsonErrors?.audience}
                        />
                        <JsonTextarea
                          id="variables_mapping_json"
                          label="Variables mapping (JSON)"
                          value={arVariablesMappingJson}
                          onChange={setArVariablesMappingJson}
                          hint="Mapeia variáveis do template a partir de context.* e source.*"
                          error={jsonErrors?.variables}
                        />
                        <JsonTextarea
                          id="dispatch_config_json"
                          label="Dispatch config (JSON)"
                          value={arDispatchConfigJson}
                          onChange={setArDispatchConfigJson}
                          hint="Ex.: batch_size, pause_between_messages_ms, max_per_hour…"
                          error={jsonErrors?.dispatch}
                        />
                      </>
                    ) : null}
                    {error ? <div className="text-xs text-destructive">{error}</div> : null}
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => setStep(Math.max(1, step - 1) as Step)}
                      disabled={false}
                      className={cn(reviveOutlineButtonClassName, 'disabled:opacity-40')}
                    >
                      Voltar
                    </button>
                    {step < 4 ? (
                      <Button
                        type="button"
                        size="xs"
                        onClick={() => setStep(Math.min(4, step + 1) as Step)}
                        disabled={!canNext}
                      >
                        Próximo <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button type="submit" size="xs" disabled={!canSave || saving}>
                        <Check className="h-3.5 w-3.5" /> {isEditing ? 'Salvar automação' : 'Criar automação'}
                      </Button>
                    )}
                  </div>

                  <div className="hidden mt-5 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      className="rounded-md border border-border bg-background/40 px-4 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    >
                      ‹ Voltar
                    </button>
                    <Button type="submit" size="sm" disabled={!canSave || saving}>
                      {saving ? 'Salvando…' : 'Salvar automação'}
                    </Button>
                  </div>
    </>
  );
}
