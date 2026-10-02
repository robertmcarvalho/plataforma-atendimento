'use client';
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="rounded-xl border border-border bg-surface p-6">
              {step === 1 ? (
                <StepModel />
              ) : step === 2 ? (
                <StepTrigger />
              ) : step === 3 ? (
                <StepActions />
              ) : (
                <StepReview />
              )}
            </div>
          </div>

          <div>
            <div className="rounded-xl border border-border bg-surface p-6">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">Resumo</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="text-muted-foreground">Modelo</div>
                <div className="text-foreground font-medium">
                  {model === 'blank'
                    ? 'Em branco'
                    : model === 'triagem_perfil'
                      ? 'Triagem por perfil'
                      : model === 'triage_bot'
                      ? 'Triagem com bot'
                      : model === 'keyword_routing'
                        ? 'Roteamento por palavra-chave'
                        : model === 'out_of_hours'
                          ? 'Fora do horário'
                          : model === 'csat'
                            ? 'Pesquisa CSAT'
                            : 'Escalação por SLA'}
                </div>

                <div className="text-muted-foreground">Gatilho</div>
                <div className="text-foreground font-medium">
                  {kind === 'out_of_hours'
                    ? 'Fora do horário'
                    : kind === 'conversation_flow'
                      ? step >= 2
                        ? cfTrigger === 'conversation_started'
                          ? 'Nova conversa'
                          : cfTrigger === 'conversation_resolved'
                            ? 'Conversa resolvida'
                            : 'Mensagem recebida'
                        : '—'
                      : step >= 2
                        ? kind === 'automation_rule'
                          ? arTriggerType === 'schedule'
                            ? 'Cron'
                            : 'Evento'
                          : 'Inbound'
                        : '—'}
                </div>

                <div className="text-muted-foreground">
                  {kind === 'conversation_flow' ? 'Blocos do fluxo' : 'Ações'}
                </div>
                <div className="text-foreground font-medium">
                  {kind === 'conversation_flow'
                    ? String(countBlocos(triageBlocos))
                    : kind === 'routing_rule' || kind === 'bot_flow' || kind === 'out_of_hours'
                      ? '1'
                      : step >= 3
                        ? '1'
                        : '0'}
                </div>

                <div className="text-muted-foreground">Canais</div>
                <div className="text-foreground font-medium">{resumoCanais}</div>

                <div className="text-muted-foreground">Nome</div>
                <div className="text-foreground font-medium truncate">{draftName || 'Sem título'}</div>
              </div>

              <div className="mt-5 rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">Pré-visualização</div>
                <pre className="mt-3 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {previewLines.map((l) => ` ${l}`).join('\n')}
                </pre>
              </div>
            </div>
          </div>
        </div>

        {testOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setTestOpen(false)}>
            <div className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-elevated" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Teste via API</div>
                  <div className="text-sm font-semibold">Simular fluxo versionado</div>
                </div>
                <button type="button" onClick={() => setTestOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-5 py-4">
                <div className="rounded-lg border border-border bg-background/60 p-3">
                  <div className="mb-1.5 text-[10px] uppercase tracking-wider text-subtle-foreground">Payload simulado</div>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
{JSON.stringify(
  {
    model,
    kind,
    trigger: kind === 'automation_rule' ? (arTriggerType === 'schedule' ? 'schedule' : arEventType === 'custom' ? arEventTypeCustom : arEventType) : kind,
    name: draftName || '',
  },
  null,
  2
)}
                  </pre>
                </div>

                {testResult ? (
                  <div className="mt-3 rounded-lg border border-border bg-background/60 p-3">
                    <div className="mb-1.5 text-[10px] uppercase tracking-wider text-subtle-foreground">
                      Resultado · {testResult.status === 'ok' ? 'Sucesso' : 'Falha'}
                    </div>
                    <div className="space-y-0.5 font-mono text-[11px] text-muted-foreground max-h-48 overflow-y-auto">
                      {testResult.logs.map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
                <Button type="button" variant="outline" size="xs" onClick={() => setTestOpen(false)}>
                  Fechar
                </Button>
                <Button type="button" size="xs" onClick={() => void runTest()} disabled={testRunning || !canTest}>
                  {testRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {testRunning ? 'Executando…' : testResult ? 'Executar novamente' : 'Executar teste'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        </div>
      </form>
    </AutomationWizardProvider>
  );
}
