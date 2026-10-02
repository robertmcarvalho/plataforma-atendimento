import api from '@/lib/api';
import type { InstallmentSettlementFilter } from '@/lib/financial/types';

export type ExportFinancialDailiesParams = {
  payment_date?: string;
  pharmacy_id?: string;
  leader_id?: string;
  driver_id?: string;
  status?: string;
  installment_status?: InstallmentSettlementFilter;
};

export async function exportFinancialDailiesXlsx(params: ExportFinancialDailiesParams): Promise<void> {
  const res = await api.post('/api/financial/export/dailies', params, { responseType: 'blob' });
  const blob = res.data as Blob;
  const paymentDate = params.payment_date || new Date().toISOString().slice(0, 10);
  const disposition = res.headers['content-disposition'] as string | undefined;
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || `relatorio_diarias_${paymentDate}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
