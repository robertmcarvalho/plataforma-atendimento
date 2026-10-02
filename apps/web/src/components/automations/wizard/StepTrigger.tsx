'use client';

import { useAutomationWizardContext } from '@/lib/automations/AutomationWizardContext';
import { Check, ChevronRight, CircleCheck, Clock, GitBranch, MessageSquare, Play, Plus, Trash2, Zap } from 'lucide-react';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { automationRuleTriggers } from '@/lib/automations/wizardConstants';
import { groupWorkspaceChannelsByType, newCfFilterRow, formatChannelOption } from '@/lib/conversation-flow/wizardConversationFlow';
import { StepConditions } from '@/components/automations/wizard/StepConditions';

export function StepTrigger() {
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
                  <div className="text-sm font-semibold tracking-tight text-foreground">Gatilho</div>
                  <div className="mt-1 text-xs text-muted-foreground">Defina quando esta automação deve executar.</div>

                  <div className="mt-4 grid grid-cols-1 gap-3">
                    {kind === 'routing_rule' ? (
                      <>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Perfil (opcional)</span>
                          <FormSelect
                            value={rrProfile || ''}
                            onChange={(v) => setRrProfile((v || null) as any)}
                            options={[
                              { value: '', label: 'Qualquer' },
                              { value: 'driver', label: 'Entregador' },
                              { value: 'pharmacy', label: 'Farmácia' },
                              { value: 'leader', label: 'Líder' },
                              { value: 'unknown', label: 'Desconhecido' },
                            ]}
                          />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Intent por setor (opcional)</span>
                          <FormSelect
                            value={rrIntentSectorId}
                            onChange={setRrIntentSectorId}
                            options={[
                              { value: '', label: '—' },
                              ...activeSectors.map((s) => ({ value: s.id, label: s.name })),
                            ]}
                          />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Intent (texto legado, opcional)</span>
                          <input
                            value={rrIntent}
                            onChange={(e) => setRrIntent(e.target.value)}
                            className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                            placeholder="Ex: Operacional"
                          />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Palavras-chave (qualquer) — separadas por vírgula</span>
                          <input
                            value={rrKeywordsAny}
                            onChange={(e) => setRrKeywordsAny(e.target.value)}
                            className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                            placeholder="Ex: atraso, falta, cobertura"
                          />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Palavras-chave (todas) — separadas por vírgula</span>
                          <input
                            value={rrKeywordsAll}
                            onChange={(e) => setRrKeywordsAll(e.target.value)}
                            className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                            placeholder="Ex: pagamento, não recebido"
                          />
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={rrRequiresContextPharmacy}
                            onChange={(e) => setRrRequiresContextPharmacy(e.target.checked)}
                          />
                          <span className="text-xs text-muted-foreground">Requer contexto de farmácia (quando aplicável)</span>
                        </label>
                      </>
                    ) : kind === 'bot_flow' ? (
                      <>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Chave do bot (usada pelo runtime)</span>
                          <input
                            value={bfName}
                            onChange={(e) => setBfName(e.target.value)}
                            className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 font-mono"
                          />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs text-muted-foreground">Keywords (opcional) — separadas por vírgula</span>
                          <input
                            value={bfTriggerKeywords}
                            onChange={(e) => setBfTriggerKeywords(e.target.value)}
                            className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                          />
                        </label>
                      </>
                    ) : kind === 'out_of_hours' ? (
                      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                        Ativa quando a conversa entra em um setor fechado.
                      </div>
                    ) : kind === 'conversation_flow' ? (
                      <div className="grid grid-cols-1 gap-4">
                        <p className="text-xs text-muted-foreground">
                          O fluxo é salvo como <strong className="text-foreground">rascunho versionado</strong> com{' '}
                          <span className="font-mono">revive_blocos</span>. Para executar no motor, publique também DSL v2 em{' '}
                          <span className="font-mono">/automacoes/fluxos</span>.
                        </p>

                        <div>
                          <div className="text-xs font-medium text-foreground">Quando esta automação deve disparar?</div>
                          {model === 'csat' ? (
                            <div className="mt-2">
                              <div
                                className="flex items-start gap-3 rounded-lg border border-primary bg-primary/5 p-3 text-left ring-1 ring-primary/30"
                                role="status"
                              >
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                                  <CircleCheck className="h-4 w-4 text-primary" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium">Conversa resolvida</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">Quando o atendente finaliza</div>
                                </div>
                                <Check className="mt-1 h-4 w-4 shrink-0 text-primary" />
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <button
                                type="button"
                                onClick={() => setCfTrigger('message_received')}
                                className={cn(
                                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                                  cfTrigger === 'message_received'
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                    : 'border-border bg-muted/30 hover:border-border-strong'
                                )}
                              >
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium">Mensagem recebida</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">A cada mensagem do cliente</div>
                                </div>
                                {cfTrigger === 'message_received' ? <Check className="mt-1 h-4 w-4 text-primary" /> : null}
                              </button>
                              <button
                                type="button"
                                onClick={() => setCfTrigger('conversation_started')}
                                className={cn(
                                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                                  cfTrigger === 'conversation_started'
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                    : 'border-border bg-muted/30 hover:border-border-strong'
                                )}
                              >
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                                  <Play className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium">Nova conversa</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">Na abertura do ticket/conversa</div>
                                </div>
                                {cfTrigger === 'conversation_started' ? <Check className="mt-1 h-4 w-4 text-primary" /> : null}
                              </button>
                              <button
                                type="button"
                                onClick={() => setCfTrigger('conversation_resolved')}
                                className={cn(
                                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                                  cfTrigger === 'conversation_resolved'
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                    : 'border-border bg-muted/30 hover:border-border-strong'
                                )}
                              >
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                                  <CircleCheck className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium">Conversa resolvida</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">Quando o atendimento é finalizado</div>
                                </div>
                                {cfTrigger === 'conversation_resolved' ? <Check className="mt-1 h-4 w-4 text-primary" /> : null}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCfTrigger('message_received');
                                  setCfFilters((prev) =>
                                    prev.some((f) => f.field === 'message_text' && f.textValue === 'sla_critical')
                                      ? prev
                                      : [...prev, newCfFilterRow({ field: 'message_text', op: 'contains', textValue: 'sla_critical' })]
                                  );
                                }}
                                className={cn(
                                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                                  model === 'sla_escalation'
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                    : 'border-border bg-muted/30 hover:border-border-strong'
                                )}
                              >
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                                  <Zap className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium">SLA crítico</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">Prioriza quando a política de SLA sinaliza risco</div>
                                </div>
                                {model === 'sla_escalation' ? <Check className="mt-1 h-4 w-4 text-primary" /> : null}
                              </button>
                              {[
                                { label: 'Agendamento', desc: 'Disparo por agenda/cron', icon: Clock },
                                { label: 'Webhook', desc: 'Disparo externo via integração', icon: GitBranch },
                              ].map((t) => {
                                const Icon = t.icon;
                                return (
                                  <button
                                    key={t.label}
                                    type="button"
                                    disabled
                                    className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-3 text-left opacity-60"
                                    title="Disponível para regras de automação legadas"
                                  >
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                                      <Icon className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="flex-1">
                                      <div className="text-sm font-medium">{t.label}</div>
                                      <div className="mt-0.5 text-[11px] text-muted-foreground">{t.desc}</div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <StepConditions />
                      </div>
                    ) : (
                      <>
                        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {automationRuleTriggers.map((t) => {
                            const Icon = t.icon;
                            const selected =
                              t.id === 'schedule'
                                ? arTriggerType === 'schedule'
                                : arTriggerType === 'event' && arEventType === t.id;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                  if (t.id === 'schedule') {
                                    setArTriggerType('schedule');
                                    return;
                                  }
                                  setArTriggerType('event');
                                  setArEventType(t.id);
                                  if (t.id !== 'custom') setArEventTypeCustom('');
                                }}
                                className={cn(
                                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                                  selected
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                    : 'border-border bg-muted/30 hover:border-border-strong'
                                )}
                              >
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                                  <Icon className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium">{t.label}</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">{t.desc}</div>
                                </div>
                                {selected ? <Check className="mt-1 h-4 w-4 text-primary" /> : null}
                              </button>
                            );
                          })}
                        </div>
                        <div className="hidden">
                          {arTriggerType === 'event' ? (
                          <>
                            <label className="flex flex-col gap-2">
                              <span className="text-xs text-muted-foreground">Evento</span>
                              <FormSelect
                                value={arEventType}
                                onChange={setArEventType}
                                options={[
                                  { value: 'installment_due_weekly', label: 'Desconto semanal' },
                                  { value: 'sla_80_alert', label: 'SLA 80% (tickets)' },
                                  { value: 'sla_escalated', label: 'SLA escalonado (tickets)' },
                                  { value: 'sla_daily_report', label: 'Relatório diário (tickets)' },
                                  { value: 'csat', label: 'CSAT' },
                                  { value: 'custom', label: 'Personalizado' },
                                ]}
                              />
                            </label>
                            {arEventType === 'custom' ? (
                              <label className="flex flex-col gap-2">
                                <span className="text-xs text-muted-foreground">Evento (custom)</span>
                                <input
                                  value={arEventTypeCustom}
                                  onChange={(e) => setArEventTypeCustom(e.target.value)}
                                  className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 font-mono"
                                  placeholder="Ex: ticket_resolved"
                                />
                              </label>
                            ) : null}
                          </>
                        ) : (
                          <label className="flex flex-col gap-2">
                            <span className="text-xs text-muted-foreground">Cron</span>
                            <input
                              value={arCron}
                              onChange={(e) => setArCron(e.target.value)}
                              className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 font-mono"
                            />
                          </label>
                        )}
                        </div>

                        {arTriggerType === 'schedule' ? (
                          <label className="flex flex-col gap-2">
                            <span className="text-xs text-muted-foreground">Cron</span>
                            <input
                              value={arCron}
                              onChange={(e) => setArCron(e.target.value)}
                              className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 font-mono"
                            />
                          </label>
                        ) : arEventType === 'custom' ? (
                          <label className="flex flex-col gap-2">
                            <span className="text-xs text-muted-foreground">Evento (custom)</span>
                            <input
                              value={arEventTypeCustom}
                              onChange={(e) => setArEventTypeCustom(e.target.value)}
                              className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 font-mono"
                              placeholder="Ex: ticket_resolved"
                            />
                          </label>
                        ) : null}
                      </>
                    )}
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className={cn(reviveOutlineButtonClassName, 'disabled:opacity-40')}
                    >
                      Voltar
                    </button>
                    <Button type="button" size="xs" onClick={() => setStep(3)} disabled={!canNext}>
                      Próximo <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
    </>
  );
}
