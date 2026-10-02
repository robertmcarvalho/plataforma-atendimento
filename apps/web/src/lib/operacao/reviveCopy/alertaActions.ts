import type { AlertaOperacional, TarefaAtendimento } from '@/lib/operacao/reviveCopy/operacaoReviveTypes';

export function resolveAlertaTarefa(
  alerta: AlertaOperacional,
  tarefas: TarefaAtendimento[]
): TarefaAtendimento | null {
  if (alerta.acao === 'open_overdue_task') {
    const overdue = tarefas.filter((t) => t.status === 'atrasada');
    if (overdue.length) return overdue[0];
  }
  return null;
}
