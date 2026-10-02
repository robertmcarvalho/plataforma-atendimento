import { EXECUCAO_TASK_TYPES_FINANCEIRO, EXECUCAO_TASK_TYPES_GERAL } from '@/lib/operacao/operacaoMode';
import { taskMetaForType } from '@/lib/operacao/operacaoTaskMeta';

export function taskTypeFilterChips(board: 'geral' | 'financeiro') {
  const types = board === 'financeiro' ? EXECUCAO_TASK_TYPES_FINANCEIRO : EXECUCAO_TASK_TYPES_GERAL;
  return [
    { id: '', label: 'Todos os tipos' },
    ...types.map((taskType) => ({
      id: taskType,
      label: taskMetaForType(taskType).label,
    })),
  ];
}

export const TASK_STATUS_FILTER_CHIPS = [
  { id: '', label: 'Em execução' },
  { id: 'done', label: 'Concluídas' },
  { id: 'all', label: 'Todas no período' },
] as const;

const SUPERVISOR_TASK_TYPES = [...EXECUCAO_TASK_TYPES_GERAL, ...EXECUCAO_TASK_TYPES_FINANCEIRO] as const;

export function supervisorTaskTypeFilterOptions() {
  return [
    { value: '', label: 'Todos os tipos' },
    ...SUPERVISOR_TASK_TYPES.map((taskType) => ({
      value: taskType,
      label: taskMetaForType(taskType).label,
    })),
  ];
}
