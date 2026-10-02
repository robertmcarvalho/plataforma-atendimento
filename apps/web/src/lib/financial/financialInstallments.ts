import { format, parseISO } from 'date-fns';
import { formatDateTimeBr } from '@/lib/datetimeBr';
import type { ApiEntry, InstallmentSettlementFilter, InstallmentStatus } from '@/lib/financial/types';

export const SP_TZ = 'America/Sao_Paulo';

export function formatRequestAtSaoPaulo(iso: string) {
  try {
    return formatDateTimeBr(iso, SP_TZ);
  } catch {
    return format(parseISO(iso), 'dd/MM/yyyy HH:mm');
  }
}

export function installmentStatusLabel(type: string, status: InstallmentStatus): string {
  if (status === 'pending') return 'Pendente';
  if (status === 'paid') return type === 'daily' ? 'Pago' : 'Descontado';
  if (status === 'overdue') return 'Atrasado';
  if (status === 'cancelled') return 'Cancelado';
  return status;
}

export function installmentsOnReferenceDate(entry: ApiEntry, refDate: string) {
  return (entry.financial_installments ?? []).filter((i) => i.due_date === refDate);
}

/** Parcela ainda não quitada (pendente ou marcada como vencida pelo job diário). */
export function isOpenInstallmentStatus(status: InstallmentStatus | string): boolean {
  return status === 'pending' || status === 'overdue';
}

export function matchesInstallmentSettlementFilter(
  entry: ApiEntry,
  refDate: string,
  filter: InstallmentSettlementFilter
): boolean {
  const onRef = installmentsOnReferenceDate(entry, refDate);
  if (filter === 'all') return onRef.length > 0;
  if (!onRef.length) return false;
  const t = entry.type;
  if (filter === 'pending') return onRef.some((i) => isOpenInstallmentStatus(i.status));
  if (filter === 'paid') return onRef.some((i) => i.status === 'paid' && t === 'daily');
  if (filter === 'discounted') return onRef.some((i) => i.status === 'paid' && t !== 'daily');
  return true;
}