import { supabase } from './supabase';

export const BILLING_DRE_CUTOVER_MONTH = '2026-07';

export type DreEntityType = 'coop' | 'flux';
export type DreLineKind = 'revenue' | 'variable_cost' | 'fixed_cost' | 'financial_expense' | 'tax' | 'result';

export type DreAccountSeed = {
  code: string;
  name: string;
  line_kind: DreLineKind;
  display_order: number;
};

const COOP_ACCOUNTS: DreAccountSeed[] = [
  { code: 'C-REV', name: 'Receita de entregas (Coop)', line_kind: 'revenue', display_order: 10 },
  { code: 'C-CV-REP', name: 'Repasse cooperados', line_kind: 'variable_cost', display_order: 20 },
  { code: 'C-CV-COM', name: 'Comissões comerciais', line_kind: 'variable_cost', display_order: 30 },
  { code: 'C-CV-OPS', name: 'Custos operacionais', line_kind: 'variable_cost', display_order: 35 },
  { code: 'C-CF-INSS', name: 'INSS cooperados (provisão)', line_kind: 'fixed_cost', display_order: 40 },
  { code: 'C-CF-ADM', name: 'Despesas administrativas', line_kind: 'fixed_cost', display_order: 50 },
  { code: 'C-DCOM', name: 'Despesas comerciais', line_kind: 'fixed_cost', display_order: 55 },
  { code: 'C-DFIN', name: 'Despesas financeiras', line_kind: 'financial_expense', display_order: 58 },
  { code: 'C-IMP-ISS', name: 'ISS e tributos locais', line_kind: 'tax', display_order: 60 },
  { code: 'C-IMP-OUT', name: 'Outros impostos e taxas', line_kind: 'tax', display_order: 65 },
  { code: 'C-RES', name: 'Resultado operacional', line_kind: 'result', display_order: 90 },
];

const FLUX_ACCOUNTS: DreAccountSeed[] = [
  { code: 'F-REV', name: 'Receita serviço Flux', line_kind: 'revenue', display_order: 10 },
  { code: 'F-CV-LID', name: 'Comissão líderes', line_kind: 'variable_cost', display_order: 20 },
  { code: 'F-CV-COM', name: 'Comissões comerciais', line_kind: 'variable_cost', display_order: 30 },
  { code: 'F-CV-OPS', name: 'Custos operacionais', line_kind: 'variable_cost', display_order: 35 },
  { code: 'F-CF-PL', name: 'Pró-labore sócios', line_kind: 'fixed_cost', display_order: 40 },
  { code: 'F-CF-PRV', name: 'Prestadores internos', line_kind: 'fixed_cost', display_order: 50 },
  { code: 'F-CF-ADM', name: 'Despesas administrativas', line_kind: 'fixed_cost', display_order: 60 },
  { code: 'F-DCOM', name: 'Despesas comerciais', line_kind: 'fixed_cost', display_order: 65 },
  { code: 'F-DFIN', name: 'Despesas financeiras', line_kind: 'financial_expense', display_order: 68 },
  { code: 'F-IMP-SNP', name: 'Simples Nacional (competência)', line_kind: 'tax', display_order: 70 },
  { code: 'F-IMP-OUT', name: 'Outros tributos', line_kind: 'tax', display_order: 80 },
  { code: 'F-RES', name: 'Resultado operacional', line_kind: 'result', display_order: 90 },
];

export type DreAccountRow = {
  id: string;
  code: string;
  name: string;
  line_kind: DreLineKind;
  display_order: number;
};

export async function ensureDreAccounts(workspaceId: string): Promise<Map<string, DreAccountRow>> {
  const byCode = new Map<string, DreAccountRow>();
  const now = new Date().toISOString();

  for (const entity of ['coop', 'flux'] as const) {
    const seeds = entity === 'coop' ? COOP_ACCOUNTS : FLUX_ACCOUNTS;
    for (const seed of seeds) {
      const { data: existing } = await supabase
        .from('billing_dre_accounts')
        .select('id, code, name, line_kind, display_order')
        .eq('workspace_id', workspaceId)
        .eq('entity_type', entity)
        .eq('code', seed.code)
        .maybeSingle();

      if (existing) {
        byCode.set(`${entity}:${seed.code}`, existing as DreAccountRow);
        continue;
      }

      const { data: inserted, error } = await supabase
        .from('billing_dre_accounts')
        .insert({
          workspace_id: workspaceId,
          entity_type: entity,
          code: seed.code,
          name: seed.name,
          line_kind: seed.line_kind,
          display_order: seed.display_order,
          updated_at: now,
        })
        .select('id, code, name, line_kind, display_order')
        .single();
      if (error) throw new Error(error.message);
      byCode.set(`${entity}:${seed.code}`, inserted as DreAccountRow);
    }
  }

  return byCode;
}

const DEFAULT_TAX_RULES: { entity_type: DreEntityType; tax_code: string; name: string; rate_pct: number }[] = [
  { entity_type: 'flux', tax_code: 'simples_nacional', name: 'Simples Nacional', rate_pct: 6 },
  { entity_type: 'coop', tax_code: 'iss', name: 'ISS', rate_pct: 2 },
  { entity_type: 'coop', tax_code: 'inss_cooperados', name: 'INSS cooperados (provisão)', rate_pct: 20 },
];

export async function ensureDreTaxRules(workspaceId: string): Promise<void> {
  const now = new Date().toISOString();
  for (const rule of DEFAULT_TAX_RULES) {
    const { data: existing } = await supabase
      .from('billing_dre_tax_rules')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('entity_type', rule.entity_type)
      .eq('tax_code', rule.tax_code)
      .maybeSingle();
    if (existing) continue;

    const { error } = await supabase.from('billing_dre_tax_rules').insert({
      workspace_id: workspaceId,
      entity_type: rule.entity_type,
      tax_code: rule.tax_code,
      name: rule.name,
      rate_pct: rule.rate_pct,
      active: true,
      updated_at: now,
    });
    if (error) throw new Error(error.message);
  }
}

export function accountForEntity(accounts: Map<string, DreAccountRow>, entity: DreEntityType, code: string): DreAccountRow {
  const row = accounts.get(`${entity}:${code}`);
  if (!row) throw new Error(`Conta DRE ${entity}:${code} não encontrada`);
  return row;
}
