'use client';

import { useAutomationWizardContext } from '@/lib/automations/AutomationWizardContext';
import { ChevronRight } from 'lucide-react';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { BlocoCard } from '@/components/conversation-flow/BlocoCard';
import { PaletaBlocos } from '@/components/conversation-flow/PaletaBlocos';
import { addBlocoToBranch, novoBloco, removeBloco, toggleCollapse, updateBlocoConfig, type BlocoTipo } from '@/lib/conversation-flow/fluxo';

export function StepActions() {
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
                  <div className="text-sm font-semibold tracking-tight text-foreground">
                    {kind === 'conversation_flow' ? 'Fluxo de atendimento' : 'Ações'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {kind === 'conversation_flow'
                      ? model === 'csat'
                        ? 'Pergunta e escala da pesquisa; o envio ocorre após resolução conforme gatilho e filtros.'
                        : 'Entregador, farmácia e líder em ramos separados; contato desconhecido passa por menu e fallback “Não entendi”.'
                      : 'Defina o que acontece quando o gatilho disparar.'}
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3">
                    {kind === 'routing_rule' ? (
                      <>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Encaminhar para</span>
                          <FormSelect
                            value={rrRouteTo}
                            onChange={(v) => setRrRouteTo(v as any)}
                            options={[
                              { value: 'sector', label: 'Fila / setor' },
                              { value: 'attendant', label: 'Atendente' },
                              { value: 'pharmacy_attendant', label: 'Atendente da farmácia' },
                            ]}
                          />
                        </label>

                        {rrRouteTo === 'sector' ? (
                          <label className="flex flex-col gap-2">
                            <span className="text-xs text-muted-foreground">Fila / setor alvo</span>
                            <FormSelect
                              value={rrTargetSectorId}
                              onChange={setRrTargetSectorId}
                              options={[
                                { value: '', label: 'Selecione…' },
                                ...activeSectors.map((s) => ({ value: s.id, label: s.name })),
                              ]}
                            />
                          </label>
                        ) : rrRouteTo === 'attendant' ? (
                          <label className="flex flex-col gap-2">
                            <span className="text-xs text-muted-foreground">Atendente alvo</span>
                            <FormSelect
                              value={rrTargetAttendantId}
                              onChange={setRrTargetAttendantId}
                              options={[
                                { value: '', label: 'Selecione…' },
                                ...attendants.map((a) => ({ value: a.id, label: a.name })),
                              ]}
                            />
                          </label>
                        ) : (
                          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                            Encaminha para o atendente vinculado à farmácia do contexto (requer contexto de farmácia no runtime).
                          </div>
                        )}

                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Prioridade</span>
                          <input
                            type="number"
                            value={rrPriority}
                            onChange={(e) => setRrPriority(Number(e.target.value))}
                            className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                            inputMode="numeric"
                          />
                        </label>
                      </>
                    ) : kind === 'bot_flow' ? (
                      <label className="flex flex-col gap-2">
                        <span className="text-xs text-muted-foreground">Mensagem</span>
                        <textarea
                          value={bfMessage}
                          onChange={(e) => setBfMessage(e.target.value)}
                          className="min-h-[160px] rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                          spellCheck={false}
                        />
                      </label>
                    ) : kind === 'out_of_hours' ? (
                      <label className="flex flex-col gap-2">
                        <span className="text-xs text-muted-foreground">Mensagem</span>
                        <textarea
                          value={oohMessage}
                          onChange={(e) => setOohMessage(e.target.value)}
                          className="min-h-[160px] rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                          spellCheck={false}
                        />
                      </label>
                    ) : kind === 'conversation_flow' ? (
                      <div className="space-y-3">
                        {model === 'csat' ? (
                          <p className="text-[11px] text-muted-foreground">
                            Adicione e configure o bloco abaixo. O fluxo é salvo como rascunho versionado em{' '}
                            <span className="font-mono">revive_blocos</span>; publique DSL v2 em{' '}
                            <span className="font-mono">/automacoes/fluxos</span> para o motor.
                          </p>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2">
                            <span className="text-[11px] text-muted-foreground">Adicionar bloco na raiz</span>
                            <PaletaBlocos onAdd={(tipo: BlocoTipo) => setTriageBlocos((prev) => [...prev, novoBloco(tipo)])} />
                          </div>
                        )}
                        {triageBlocos.length === 0 ? (
                          <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
                            Nenhum bloco na raiz.
                          </p>
                        ) : (
                          <div className="max-h-[min(520px,60vh)] space-y-2 overflow-y-auto pr-1">
                            {triageBlocos.map((b) => (
                              <BlocoCard
                                key={b.id}
                                bloco={b}
                                showRemove={model !== 'csat'}
                                onConfigChange={(id, key, value) =>
                                  setTriageBlocos((prev) => updateBlocoConfig(prev, id, key, value))
                                }
                                onRemove={(id) => setTriageBlocos((prev) => removeBloco(prev, id))}
                                onToggle={(id) => setTriageBlocos((prev) => toggleCollapse(prev, id))}
                                onAddToBranch={(parentId, ramo, tipo) =>
                                  setTriageBlocos((prev) => addBlocoToBranch(prev, parentId, ramo, novoBloco(tipo)))
                                }
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Público</span>
                          <FormSelect
                            value={arAudience}
                            onChange={setArAudience}
                            options={[
                              { value: 'drivers', label: 'Entregadores' },
                              { value: 'leaders', label: 'Líderes' },
                              { value: 'pharmacies', label: 'Farmácias' },
                              { value: 'custom', label: 'Personalizado' },
                            ]}
                          />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Template</span>
                          <FormSelect
                            value={arTemplateId}
                            onChange={setArTemplateId}
                            options={(templatesQuery.data || []).map((t) => ({ value: t.id, label: t.name }))}
                          />
                        </label>
                      </>
                    )}
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className={cn(reviveOutlineButtonClassName, 'disabled:opacity-40')}
                    >
                      Voltar
                    </button>
                    <Button type="button" size="xs" onClick={() => setStep(4)} disabled={!canNext}>
                      Próximo <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
    </>
  );
}
