import { useCallback, useMemo, useState } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '@/components/ui/PaginationControls';

export { DEFAULT_LIST_PAGE_SIZE, DEFAULT_LIST_PAGE_SIZE as BILLING_LIST_PAGE_SIZE };

export function signedAmountClassName(cents: number, options?: { neutralZero?: boolean }) {
  if (options?.neutralZero && cents === 0) return 'text-muted-foreground';
  if (cents > 0) return 'text-success';
  if (cents < 0) return 'text-destructive';
  return 'text-muted-foreground';
}

export function formatSignedBrlCents(cents: number): string {
  const abs = Math.abs(cents);
  const formatted = (abs / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (cents > 0) return `+${formatted}`;
  if (cents < 0) return `-${formatted}`;
  return formatted;
}

export function escapeSpreadsheetCell(value: string | number | null | undefined) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadSpreadsheet(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const csv = [
    '\uFEFF' + headers.map(escapeSpreadsheetCell).join(','),
    ...rows.map((row) => row.map(escapeSpreadsheetCell).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function useClientPagination<T>(items: T[], pageSize = DEFAULT_LIST_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const resetPage = useCallback(() => setPage(1), []);

  return { page: currentPage, setPage, pageItems, totalItems, pageSize, resetPage };
}

export function monthInRange(isoDate: string | null | undefined, month: string): boolean {
  if (!month) return true;
  const date = String(isoDate || '').slice(0, 7);
  return date === month;
}
