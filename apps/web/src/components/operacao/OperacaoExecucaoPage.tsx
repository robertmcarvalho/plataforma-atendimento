'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OperacaoExecucaoReviveView } from '@/components/operacao/OperacaoExecucaoReviveView';
import { OperacaoCreateTaskModal } from '@/components/operacao/revive/OperacaoCreateTaskModal';
import { fetchExecutionBoard, fetchTaskLaunchContext } from '@/lib/ops/opsAnalyticsApi';
import { useOpsHubFilters } from '@/lib/operacao/useOpsHubFilters';
import { agQuickActions } from '@/lib/operacao/reviveCopy/reviveQuickActions';
import { TASK_STATUS_FILTER_CHIPS, taskTypeFilterChips } from '@/lib/operacao/taskFilterOptions';
import { Button } from '@/components/ui/button';

export function OperacaoExecucaoPage({ mode }: { mode: 'execucao_geral' | 'execucao_financeiro' }) {
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const deepTask = searchParams.get('task');

  const boardKey = mode === 'execucao_financeiro' ? 'financeiro' : 'geral';

  const { period, setPeriod, referenceDate, setReferenceDate, hydrated } = useOpsHubFilters(7);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [initialTaskType, setInitialTaskType] = useState<string | null>(null);

  const [taskTypeFilter, setTaskTypeFilter] = useState('');
  const [taskStatusFilter, setTaskStatusFilter] = useState('');

  useEffect(() => {
    if (deepTask) setSelectedTaskId(deepTask);
  }, [deepTask]);

  const boardQuery = useQuery({
    queryKey: [
      'ops-analytics',
      'execution-board',
      boardKey,
      period,
      referenceDate,
      taskTypeFilter,
      taskStatusFilter,
    ],
    queryFn: () =>
      fetchExecutionBoard(boardKey, period, {
        referenceDate,
        taskType: taskTypeFilter || undefined,
        status: taskStatusFilter || undefined,
      }),
    enabled: hydrated,
    refetchInterval: 45_000,
  });

  const launchTypesQuery = useQuery({
    queryKey: ['ops-analytics', 'task-launch-context', 'ag', 'quick-actions'],
    queryFn: () => fetchTaskLaunchContext('ag'),
    enabled: mode === 'execucao_geral',
  });

  const enabledTaskTypes = useMemo(() => {
    const types = launchTypesQuery.data?.manual_task_types || [];
    return new Set(types.map((t) => t.task_type));
  }, [launchTypesQuery.data]);

  const quickActions = useMemo(() => {
    if (mode !== 'execucao_geral') return [];
    return agQuickActions({
      enabledTaskTypes,
      onNovaTarefa: (taskType) => {
        setInitialTaskType(taskType);
        setTaskModalOpen(true);
      },
    });
  }, [mode, enabledTaskTypes]);

  const taskTypeOptions = useMemo(() => taskTypeFilterChips(boardKey), [boardKey]);
  const statusFilterOptions = useMemo(() => [...TASK_STATUS_FILTER_CHIPS], []);

  return (
    <>
      <OperacaoExecucaoReviveView
        mode={mode}
        board={boardQuery.data}
        loading={boardQuery.isLoading}
        error={boardQuery.isError}
        period={period}
        onPeriodChange={setPeriod}
        referenceDate={referenceDate}
        onReferenceDateChange={setReferenceDate}
        onRefresh={() => void boardQuery.refetch()}
        refreshing={boardQuery.isFetching}
        selectedTaskId={selectedTaskId}
        onSelectTask={setSelectedTaskId}
        quickActions={quickActions}
        taskTypeFilter={taskTypeFilter}
        onTaskTypeFilterChange={setTaskTypeFilter}
        taskTypeOptions={taskTypeOptions}
        statusFilter={taskStatusFilter}
        onStatusFilterChange={setTaskStatusFilter}
        statusFilterOptions={statusFilterOptions}
        headerActions={
          mode === 'execucao_geral' ? (
            <Button
              type="button"
              onClick={() => {
                setInitialTaskType(null);
                setTaskModalOpen(true);
              }}
            >
              Nova tarefa
            </Button>
          ) : null
        }
      />

      {mode === 'execucao_geral' ? (
        <OperacaoCreateTaskModal
          open={taskModalOpen}
          onClose={() => {
            setTaskModalOpen(false);
            setInitialTaskType(null);
          }}
          scope="ag"
          initialTaskType={initialTaskType}
          onCreated={(taskId, deepLink) => {
            void qc.invalidateQueries({ queryKey: ['ops-analytics', 'execution-board'] });
            setSelectedTaskId(taskId);
            router.push(deepLink);
          }}
        />
      ) : null}
    </>
  );
}
