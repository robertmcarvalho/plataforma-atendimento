'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Building2, ClipboardPlus, Inbox, UserX } from 'lucide-react';
import { SectionTitle } from '@/components/ui/SectionTitle';

const quickActionClass =
  'flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-primary/40 hover:bg-sidebar-accent/40';

function QuickActionButton({
  onClick,
  icon: Icon,
  title,
  description,
}: {
  onClick: () => void;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <button type="button" onClick={onClick} className={quickActionClass}>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <div>
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-[10px] text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

function QuickActionLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className={quickActionClass}>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <div>
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-[10px] text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}

export function OperacaoQuickActions({
  onNewTask,
  onOccurrence,
  showOccurrence = true,
  variant = 'carteira',
}: {
  onNewTask?: () => void;
  onOccurrence?: () => void;
  showOccurrence?: boolean;
  variant?: 'carteira' | 'financeiro_gestor';
}) {
  return (
    <section>
      <SectionTitle className="mb-3 text-sm font-semibold text-foreground">Ações rápidas</SectionTitle>
      <div className="space-y-2">
        {variant === 'carteira' ? (
          <>
            {onNewTask ? (
              <QuickActionButton
                onClick={onNewTask}
                icon={ClipboardPlus}
                title="Nova tarefa"
                description="Cadastro, matrícula ou desligamento"
              />
            ) : null}
            {showOccurrence && onOccurrence ? (
              <QuickActionButton
                onClick={onOccurrence}
                icon={UserX}
                title="Lançar ocorrência"
                description="Em nome do líder"
              />
            ) : null}
            <QuickActionLink
              href="/inbox"
              icon={Inbox}
              title="Abrir inbox"
              description="Atendimentos em andamento"
            />
            <QuickActionLink
              href="/pharmacies"
              icon={Building2}
              title="Farmácias"
              description="Cadastro e rede"
            />
          </>
        ) : (
          <>
            <QuickActionLink
              href="/financial"
              icon={BarChart3}
              title="Módulo financeiro"
              description="Lançamentos e acertos"
            />
            <QuickActionLink
              href="/inbox"
              icon={Inbox}
              title="Abrir inbox"
              description="Atendimentos do setor"
            />
            <QuickActionLink
              href="/audit/operational"
              icon={BarChart3}
              title="Relatórios"
              description="Auditoria operacional"
            />
          </>
        )}
      </div>
    </section>
  );
}
