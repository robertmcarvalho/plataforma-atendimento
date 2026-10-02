'use client';

import { useAutomationWizardContext } from '@/lib/automations/AutomationWizardContext';
import { Plus, Trash2 } from 'lucide-react';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { groupWorkspaceChannelsByType, formatChannelOption } from '@/lib/conversation-flow/wizardConversationFlow';

export function StepConditions() {
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
                        <div className="rounded-lg border border-border border-dashed bg-background/30 p-3">
                          <div className="text-xs font-medium text-foreground">Filtros (opcional)</div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Primeiro escolha o <strong className="text-foreground">tipo de canal</strong> (opcional) e depois a{' '}
                            <strong className="text-foreground">conexão</strong> concreta do workspace. A operação &quot;não é&quot; no canal pode ficar só no
                            rascunho até o motor suportar negação no binding.
                          </p>
                          <p className="mt-2 text-[10px] text-muted-foreground">
                            Demandas, mensagens, SLA, filas e tags são lidos dos webhooks em Configurações → Canais.
                          </p>
                          <div className="mt-3 space-y-2">
                            {cfFilters.length === 0 ? (
                              <p className="text-[11px] text-muted-foreground">Nenhum filtro — aplica a todos os canais (conforme binding).</p>
                            ) : (
                              cfFilters.map((row) => (
                                <div key={row.id} className="flex flex-wrap items-end gap-2 rounded-md border border-border/60 bg-muted/30 p-2">
                                  <label className="flex min-w-[120px] flex-1 flex-col gap-1">
                                    <span className="text-[10px] text-muted-foreground">Campo</span>
                                    <FormSelect
                                      size="sm"
                                      className="text-xs"
                                      value={row.field}
                                      onChange={(v) => {
                                        const field = v as CfFilterRow['field'];
                                        setCfFilters((prev) =>
                                          prev.map((r) =>
                                            r.id === row.id
                                              ? {
                                                  ...r,
                                                  field,
                                                  channelId: field === 'message_text' ? '' : r.channelId,
                                                  textValue: field === 'channel' ? '' : r.textValue,
                                                  channelTypeFilter: field === 'channel' ? r.channelTypeFilter || '' : '',
                                                }
                                              : r
                                          )
                                        );
                                      }}
                                      options={[
                                        { value: 'channel', label: 'Canal' },
                                        { value: 'message_text', label: 'Texto da mensagem' },
                                      ]}
                                    />
                                  </label>
                                  <label className="flex min-w-[100px] flex-col gap-1">
                                    <span className="text-[10px] text-muted-foreground">Operador</span>
                                    <FormSelect
                                      size="sm"
                                      className="text-xs"
                                      value={row.op}
                                      onChange={(v) =>
                                        setCfFilters((prev) =>
                                          prev.map((r) => (r.id === row.id ? { ...r, op: v as CfFilterRow['op'] } : r))
                                        )
                                      }
                                      options={[
                                        { value: 'eq', label: 'é' },
                                        { value: 'ne', label: 'não é' },
                                        { value: 'contains', label: 'contém' },
                                        { value: 'starts_with', label: 'começa com' },
                                      ]}
                                    />
                                  </label>
                                  {row.field === 'channel' ? (
                                    <>
                                      <label className="flex min-w-[130px] flex-col gap-1">
                                        <span className="text-[10px] text-muted-foreground">Tipo de canal</span>
                                        <FormSelect
                                          size="sm"
                                          className="text-xs"
                                          value={row.channelTypeFilter || ''}
                                          onChange={(v) => {
                                            setCfFilters((prev) =>
                                              prev.map((r) => (r.id === row.id ? { ...r, channelTypeFilter: v, channelId: '' } : r))
                                            );
                                          }}
                                          options={[
                                            { value: '', label: 'Todos' },
                                            ...groupWorkspaceChannelsByType(channelsQuery.data || []).map((g) => ({
                                              value: g.type,
                                              label: g.label,
                                            })),
                                          ]}
                                        />
                                      </label>
                                      <label className="flex min-w-[200px] flex-[2] flex-col gap-1">
                                        <span className="text-[10px] text-muted-foreground">Conexão (integração)</span>
                                        <FormSelect
                                          size="sm"
                                          className="text-xs"
                                          value={row.channelId}
                                          onChange={(v) =>
                                            setCfFilters((prev) =>
                                              prev.map((r) => (r.id === row.id ? { ...r, channelId: v } : r))
                                            )
                                          }
                                          options={[
                                            { value: '', label: '—' },
                                            ...groupWorkspaceChannelsByType(channelsQuery.data || [])
                                              .filter((g) => !row.channelTypeFilter || g.type === row.channelTypeFilter)
                                              .flatMap((g) =>
                                                g.items.map((ch) => ({
                                                  value: ch.id,
                                                  label: `${g.label}: ${(ch.display_name || '').trim() || formatChannelOption(ch)}`,
                                                }))
                                              ),
                                          ]}
                                        />
                                      </label>
                                    </>
                                  ) : (
                                    <label className="flex min-w-[160px] flex-[2] flex-col gap-1">
                                      <span className="text-[10px] text-muted-foreground">Valor</span>
                                      <FormControl
                                        value={row.textValue}
                                        onChange={(e) =>
                                          setCfFilters((prev) =>
                                            prev.map((r) => (r.id === row.id ? { ...r, textValue: e.target.value } : r))
                                          )
                                        }
                                        inputSize="sm"
                                        className="text-xs"
                                        placeholder="Ex.: ajuda"
                                      />
                                    </label>
                                  )}
                                  <button
                                    type="button"
                                    aria-label="Remover condição"
                                    onClick={() => setCfFilters((prev) => prev.filter((r) => r.id !== row.id))}
                                    className="mb-0.5 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setCfFilters((prev) => [...prev, newCfFilterRow()])}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            <Plus className="h-3.5 w-3.5" /> Adicionar condição
                          </button>
                        </div>
    </>
  );
}
