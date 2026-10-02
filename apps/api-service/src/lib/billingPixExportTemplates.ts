import type { PixBatchRow } from './billingPayablesEngine';
import type { PixExportTemplate } from './billingTreasuryEngine';

function brlCsv(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function escCsv(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

export function pixBatchToCsvWithTemplate(
  rows: PixBatchRow[],
  cycleLabel: string | null,
  template: PixExportTemplate = 'generic',
  options?: { description?: string }
): string {
  const exportable = rows.filter((r) => !r.warnings.includes('PIX não cadastrado'));
  const desc =
    options?.description ??
    (cycleLabel ? `Repasse ciclo ${cycleLabel}` : 'Repasse ciclo');

  if (template === 'itau') {
    const header = ['nome_favorecido', 'cpf_cnpj', 'tipo_chave', 'chave_pix', 'valor', 'identificador'];
    const lines = [header.join(';')];
    for (const row of exportable) {
      lines.push(
        [
          escCsv(row.name),
          row.cpf || '',
          row.pix_key_type || '',
          escCsv(row.pix_key || ''),
          brlCsv(row.amount_cents),
          row.reference,
        ].join(';')
      );
    }
    return lines.join('\n');
  }

  if (template === 'bradesco') {
    const header = ['Nome do Favorecido', 'CPF/CNPJ', 'Tipo Chave', 'Chave PIX', 'Valor (R$)', 'Descrição'];
    const lines = [header.join(';')];
    for (const row of exportable) {
      lines.push(
        [
          escCsv(row.name),
          row.cpf || '',
          row.pix_key_type || '',
          escCsv(row.pix_key || ''),
          brlCsv(row.amount_cents),
          escCsv(desc),
        ].join(';')
      );
    }
    return lines.join('\n');
  }

  if (template === 'santander') {
    const header = ['beneficiario', 'documento', 'tipo_pix', 'chave', 'valor', 'referencia'];
    const lines = [header.join(';')];
    for (const row of exportable) {
      lines.push(
        [
          escCsv(row.name),
          row.cpf || '',
          row.pix_key_type || '',
          escCsv(row.pix_key || ''),
          brlCsv(row.amount_cents),
          row.reference,
        ].join(';')
      );
    }
    return lines.join('\n');
  }

  if (template === 'bb') {
    const header = ['nome', 'cpf', 'tipo_chave', 'chave_pix', 'valor', 'info'];
    const lines = [header.join(';')];
    for (const row of exportable) {
      lines.push(
        [
          escCsv(row.name),
          row.cpf || '',
          row.pix_key_type || '',
          escCsv(row.pix_key || ''),
          brlCsv(row.amount_cents),
          escCsv(desc),
        ].join(';')
      );
    }
    return lines.join('\n');
  }

  if (template === 'nubank' || template === 'inter') {
    const header = ['name', 'tax_id', 'pix_key_type', 'pix_key', 'amount', 'description'];
    const lines = [header.join(',')];
    for (const row of exportable) {
      lines.push(
        [
          escCsv(row.name),
          row.cpf || '',
          row.pix_key_type || '',
          escCsv(row.pix_key || ''),
          (row.amount_cents / 100).toFixed(2),
          escCsv(desc),
        ].join(',')
      );
    }
    return lines.join('\n');
  }

  const header = ['nome', 'cpf', 'tipo_chave_pix', 'chave_pix', 'valor', 'referencia', 'descricao'];
  const lines = [header.join(',')];
  for (const row of exportable) {
    lines.push(
      [
        escCsv(row.name),
        row.cpf || '',
        row.pix_key_type || '',
        escCsv(row.pix_key || ''),
        brlCsv(row.amount_cents),
        row.reference,
        escCsv(desc),
      ].join(',')
    );
  }
  return lines.join('\n');
}
