import { supabase } from './supabase';

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Gera rascunhos mensais a partir da última despesa com recurrence=monthly no mês anterior. */
export async function generateRecurringExpenses(
  workspaceId: string,
  month: string
): Promise<{ created: number }> {
  const { start, end } = monthBounds(month);
  const prior = prevMonth(month);
  const { start: priorStart, end: priorEnd } = monthBounds(prior);

  const { data: templates, error: tplErr } = await supabase
    .from('billing_expenses')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('recurrence', 'monthly')
    .gte('expense_date', priorStart)
    .lte('expense_date', priorEnd);
  if (tplErr) throw new Error(tplErr.message);

  const { data: existing, error: exErr } = await supabase
    .from('billing_expenses')
    .select('description, expense_type_id, amount_cents')
    .eq('workspace_id', workspaceId)
    .gte('expense_date', start)
    .lte('expense_date', end);
  if (exErr) throw new Error(exErr.message);

  const existingKeys = new Set(
    (existing || []).map((e) => `${e.expense_type_id || ''}:${e.description}:${e.amount_cents}`)
  );

  let created = 0;
  const now = new Date().toISOString();

  for (const tpl of templates || []) {
    const key = `${tpl.expense_type_id || ''}:${tpl.description}:${tpl.amount_cents}`;
    if (existingKeys.has(key)) continue;

    const { error } = await supabase.from('billing_expenses').insert({
      workspace_id: workspaceId,
      expense_type_id: tpl.expense_type_id,
      description: tpl.description,
      amount_cents: tpl.amount_cents,
      expense_date: start,
      cost_center_id: tpl.cost_center_id,
      legal_entity_type: tpl.legal_entity_type,
      allocation: tpl.allocation || {},
      recurrence: 'monthly',
      status: 'draft',
      updated_at: now,
    });
    if (error) throw new Error(error.message);
    created += 1;
    existingKeys.add(key);
  }

  return { created };
}
