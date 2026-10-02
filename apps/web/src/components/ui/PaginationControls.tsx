import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export const DEFAULT_LIST_PAGE_SIZE = 20;

type PaginationControlsProps = {
  page: number;
  pageSize?: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  className?: string;
};

export function PaginationControls({
  page,
  pageSize = DEFAULT_LIST_PAGE_SIZE,
  totalItems,
  onPageChange,
  itemLabel = 'itens',
  className,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = totalItems === 0 ? 0 : Math.min(totalItems, currentPage * pageSize);

  return (
    <div className={cn('mt-4 flex flex-col gap-3 border-t border-border pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between', className)}>
      <div>
        Mostrando <span className="font-medium text-foreground">{start}</span>-<span className="font-medium text-foreground">{end}</span> de{' '}
        <span className="font-medium text-foreground">{totalItems}</span> {itemLabel}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Anterior
        </Button>
        <span className="text-xs">
          Página <span className="font-medium text-foreground">{currentPage}</span> de <span className="font-medium text-foreground">{totalPages}</span>
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Próxima
        </Button>
      </div>
    </div>
  );
}
