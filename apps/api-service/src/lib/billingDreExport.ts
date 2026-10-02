import type { DreReport } from './billingDreEngine';

function brl(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function esc(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

export function dreReportToCsv(report: DreReport): string {
  const lines: string[] = [];
  const entityLabel = report.entity_type === 'coop' ? 'CoopMob' : 'Flux Farma';

  lines.push(`DRE Gerencial;${entityLabel};Competência;${report.competence_month}`);
  lines.push('');

  lines.push('CONSOLIDADO');
  lines.push('Código;Conta;Natureza;Valor (R$)');
  for (const line of report.consolidated) {
    lines.push(
      [line.account_code, esc(line.account_name), line.line_kind, brl(line.amount_cents)].join(';')
    );
  }
  lines.push('');

  lines.push('POR FARMÁCIA');
  lines.push(
    'Farmácia;Centro de custo;Receita;CV;CF;Imposto;Resultado'
  );
  for (const p of report.pharmacies) {
    lines.push(
      [
        esc(p.pharmacy_name),
        esc(p.cost_center_name || ''),
        brl(p.revenue_cents),
        brl(p.variable_cost_cents),
        brl(p.fixed_cost_cents),
        brl(p.tax_cents),
        brl(p.result_cents),
      ].join(';')
    );
  }
  lines.push('');

  if (report.cost_centers?.length) {
    lines.push('POR CENTRO DE CUSTO');
    lines.push('Centro de custo;Farmácias;Receita;CV;CF;Imposto;Resultado');
    for (const cc of report.cost_centers) {
      lines.push(
        [
          esc(cc.cost_center_name),
          String(cc.pharmacy_count),
          brl(cc.revenue_cents),
          brl(cc.variable_cost_cents),
          brl(cc.fixed_cost_cents),
          brl(cc.tax_cents),
          brl(cc.result_cents),
        ].join(';')
      );
    }
  }

  return lines.join('\n');
}
