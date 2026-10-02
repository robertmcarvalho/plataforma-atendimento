import { cn } from '@/lib/utils';

export function tarefaStatusLabel(status: string): string {
  if (status === 'in_progress') return 'Em execução';
  if (status === 'done') return 'Concluída';
  if (status === 'cancelled') return 'Cancelada';
  return 'Aberta';
}

export function tarefaStatusPillClass(status: string): string {
  return cn(
    'shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase',
    status === 'in_progress' && 'bg-primary/15 text-primary',
    status === 'open' && 'bg-muted text-muted-foreground',
    status === 'done' && 'bg-success/15 text-success',
    status === 'cancelled' && 'bg-muted text-muted-foreground'
  );
}
