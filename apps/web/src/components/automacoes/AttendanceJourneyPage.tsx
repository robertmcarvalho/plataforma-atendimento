'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, ExternalLink, Play, Route } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { reviveKpiCardClassName } from '@/lib/reviveSurfaces';
import { INTAKE_JOURNEY_STEPS } from '@/lib/automacoes/intakeJourney';
import { SimulateIntakeModal } from '@/components/automacoes/SimulateIntakeModal';
import { useChannelOperationalCatalog } from '@/lib/integrations/useSectorsFromMessagingWebhooks';

const TAB_LINKS: Record<string, string> = {
  profiles: '/settings?section=channels',
  sectors: '/settings?section=channels',
  channels: '/settings?section=channels',
  messages: '/settings?section=channels',
  sla: '/settings?section=channels',
  out_of_hours: '/settings?section=channels',
};

export function AttendanceJourneyPage() {
  const [simulateOpen, setSimulateOpen] = useState(false);

  const query = useChannelOperationalCatalog(true);

  const messageByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of query.data?.messages || []) {
      map.set('messages.greeting', m.greeting);
      map.set('driver_greeting_list', m.intake?.driver_greeting_list || m.greeting);
      map.set('messages.out_of_hours', m.out_of_hours);
      map.set('queue_full', m.queue_full);
      map.set('closing', m.closing);
      map.set('csat', m.csat);
      if (m.intake) {
        for (const [key, text] of Object.entries(m.intake)) {
          if (text?.trim()) map.set(key, text.trim());
        }
      }
    }
    return map;
  }, [query.data]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <Link href="/automacoes" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Automações
        </Link>
        <PageHeader
          icon={Route}
          eyebrow="Motor de atendimento"
          title="Jornada do intake"
          description="Etapas do fluxo guiado — mensagens, demandas, SLA e operação vêm dos webhooks configurados em Canais."
          actions={
            <button
              type="button"
              onClick={() => setSimulateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              <Play className="h-3.5 w-3.5" /> Simular conversa
            </button>
          }
        />
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-0">
          {INTAKE_JOURNEY_STEPS.map((step, idx) => (
            <div key={step.id} className="relative flex gap-4 pb-8">
              {idx < INTAKE_JOURNEY_STEPS.length - 1 ? (
                <div className="absolute left-[15px] top-8 h-[calc(100%-8px)] w-px bg-border" />
              ) : null}
              <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-xs font-semibold text-primary">
                {step.order + 1}
              </div>
              <div className={cn('min-w-0 flex-1', reviveKpiCardClassName)}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                  </div>
                  {step.catalogTab ? (
                    <Link
                      href={TAB_LINKS[step.catalogTab] || '/automacoes/catalogos'}
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      Editar em canais
                      <ChevronRight className="h-3 w-3" />
                    </Link>
                  ) : null}
                </div>

                {step.messageKeys.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {step.messageKeys.map((mk) => {
                      const content = messageByKey.get(mk.key);
                      return (
                        <li key={mk.key} className="rounded-lg border border-border bg-background/40 p-3">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{mk.key}</code>
                            <span className="text-[10px] text-muted-foreground">{mk.label}</span>
                            {mk.optional ? (
                              <span className="rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">opcional</span>
                            ) : null}
                          </div>
                          {content ? (
                            <p className="whitespace-pre-wrap text-xs text-foreground">{content}</p>
                          ) : (
                            <p className="text-xs italic text-muted-foreground">Mensagem não configurada no webhook.</p>
                          )}
                          <Link
                            href="/settings?section=channels"
                            className="mt-2 inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                          >
                            Editar texto <ExternalLink className="h-3 w-3" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Configurado nas abas do webhook do canal.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-dashed border-border bg-surface/50 p-4 text-center">
          <p className="text-xs text-muted-foreground">
            Editor JSON de grafo (avançado){' '}
            <Link href="/automacoes/fluxos" className="text-primary underline">
              /automacoes/fluxos
            </Link>
          </p>
        </div>
      </div>

      <SimulateIntakeModal open={simulateOpen} onClose={() => setSimulateOpen(false)} />
    </div>
  );
}
