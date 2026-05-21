/** Gera linhas de parcelas para financial_installments (compartilhado entre financial routes e leader-portal). */
export function generateInstallments(
  entryId: string,
  startDate: string,
  count: number,
  amount: number,
  frequency: string
): Array<{
  entry_id: string;
  installment_number: number;
  amount: number;
  due_date: string;
  status: string;
}> {
  const installments: Array<{
    entry_id: string;
    installment_number: number;
    amount: number;
    due_date: string;
    status: string;
  }> = [];
  const base = new Date(`${startDate}T12:00:00.000Z`);
  for (let i = 0; i < count; i++) {
    const due = new Date(base);
    if (frequency === 'weekly') due.setUTCDate(base.getUTCDate() + i * 7);
    else due.setUTCMonth(base.getUTCMonth() + i);
    installments.push({
      entry_id: entryId,
      installment_number: i + 1,
      amount,
      due_date: due.toISOString().split('T')[0],
      status: 'pending',
    });
  }
  return installments;
}
