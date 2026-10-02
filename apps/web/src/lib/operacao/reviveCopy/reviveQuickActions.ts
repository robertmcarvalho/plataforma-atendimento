import type { LucideIcon } from 'lucide-react';
import { CalendarCheck, FileMinus2, FilePlus2, IdCard, UserPlus, UserX } from 'lucide-react';
import type { IconTileTone } from '@/components/ui/IconTile';

export type ReviveQuickAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  tone?: IconTileTone;
  href?: string;
  onClick?: () => void;
  /** Pré-seleciona tipo ao abrir Nova tarefa (AG). */
  taskType?: string;
};

const AG_QUICK_TASK_TYPES = [
  { taskType: 'driver_registration_completion', label: 'Finalizar cadastro', icon: FilePlus2, tone: 'primary' as const },
  { taskType: 'driver_enrollment_prep', label: 'Gerar matrícula', icon: IdCard, tone: 'warning' as const },
  {
    taskType: 'driver_termination_prep',
    label: 'Desligamento (operacional)',
    icon: FileMinus2,
    tone: 'destructive' as const,
  },
] as const;

export function agQuickActions(handlers: {
  onNovaTarefa: (taskType: string) => void;
  enabledTaskTypes?: Set<string>;
}): ReviveQuickAction[] {
  const enabled = handlers.enabledTaskTypes;
  return AG_QUICK_TASK_TYPES.filter((t) => !enabled || enabled.has(t.taskType)).map((t) => ({
    id: t.taskType,
    label: t.label,
    icon: t.icon,
    tone: t.tone,
    taskType: t.taskType,
    onClick: () => handlers.onNovaTarefa(t.taskType),
  }));
}

export function analistaQuickActions(handlers: {
  onOccurrence?: () => void;
  onPreCadastro?: () => void;
  onTermination?: () => void;
}): ReviveQuickAction[] {
  return [
    {
      id: 'cadastrar',
      label: 'Cadastrar entregador',
      icon: UserPlus,
      tone: 'success',
      href: '/drivers/new',
    },
    {
      id: 'ocorrencia',
      label: 'Ocorrência de escala',
      icon: CalendarCheck,
      tone: 'primary',
      onClick: handlers.onOccurrence,
    },
    {
      id: 'pre-cadastro',
      label: 'Pré-cadastro',
      icon: FilePlus2,
      tone: 'warning',
      onClick: handlers.onPreCadastro,
    },
    {
      id: 'desligamento',
      label: 'Solicitar desligamento',
      icon: UserX,
      tone: 'destructive',
      onClick: handlers.onTermination,
    },
  ];
}
