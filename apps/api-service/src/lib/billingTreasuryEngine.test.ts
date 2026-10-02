import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  bankMovementContentBaseKey,
  looksLikeC6BankStatement,
  looksLikeC6LoteBankStatement,
  parseBankStatement,
  parseC6BankStatement,
  resolveBankStatementFormat,
  summarizeBankMovementRows,
} from './billingTreasuryEngine';

const sampleC6 = `\uFEFFEXTRATO DE CONTA CORRENTE C6 BANK

Agência: 1 / Conta: 325159408

Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)
05/08/2026,05/08/2026,Pix recebido de EMPRESA,Pix recebido,5347.79,0.00,5547.80
06/08/2026,06/08/2026,Pix enviado para JOAO,PAGAMENTO,0.00,1500.00,0.01
17/08/26,17/08/26,Pix recebido de COOPMOB,Transferência,19538.59,0.00,0.01
18/08/2026,18/08/2026,Pix enviado para MARIA,PAGAMENTO,0.00,0.00,0.01
`;

const sampleC6Lote = `\uFEFFEXTRATO DO LOTE C6 BANK

Lote: #574

Data Pagamento,Vencimento,Status,Tipo e Beneficiário,Aprovadores,Valor
20/08/2026,-,Pago,PIX • RENATO MENDES DE SOUZA,LILIANE DE FATIMA REZENDE JUSTINO,924.00
20/08/2026,-,Pago,PIX • EDVAN DA SILVA ALVES,LILIANE DE FATIMA REZENDE JUSTINO,700.00
20/08/2026,-,Pendente,PIX • NAO DEVE IMPORTAR,APROVADOR,100.00
20/08/2026,-,Pago,PIX • Arlindo Costa Felix,LILIANE DE FATIMA REZENDE JUSTINO,1572.00
`;

function readSampleCsv(): string {
  const filePath = path.resolve(process.cwd(), '../../01M0FT54XME6XXS8XE3N94820N.csv');
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return readFileSync(path.resolve(process.cwd(), '01M0FT54XME6XXS8XE3N94820N.csv'), 'utf8');
  }
}

function readLoteSampleCsv(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../01M0J4RBH2SWZ6V5FM1QQ4E2QE.csv'),
    path.resolve(process.cwd(), '01M0J4RBH2SWZ6V5FM1QQ4E2QE.csv'),
    path.resolve(process.cwd(), '../../apps/api-service/src/lib/fixtures/c6-lote-01M0J4RB.csv'),
    path.resolve(process.cwd(), 'src/lib/fixtures/c6-lote-01M0J4RB.csv'),
  ];
  for (const filePath of candidates) {
    try {
      return readFileSync(filePath, 'utf8');
    } catch {
      /* try next */
    }
  }
  throw new Error('Fixture C6 lote 01M0J4RB… não encontrada');
}

describe('parseC6BankStatement', () => {
  it('detecta cabeçalho C6 mesmo com BOM e linhas de preâmbulo', () => {
    assert.equal(looksLikeC6BankStatement(sampleC6), true);
    assert.equal(resolveBankStatementFormat(sampleC6, 'csv'), 'c6');
  });

  it('parseia entradas/saídas e ano com 2 dígitos', () => {
    const rows = parseC6BankStatement(sampleC6);
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.movement_date, '2026-08-05');
    assert.equal(rows[0]?.direction, 'credit');
    assert.equal(rows[0]?.amount_cents, 534779);
    assert.equal(rows[1]?.direction, 'debit');
    assert.equal(rows[1]?.amount_cents, 150000);
    assert.equal(rows[2]?.movement_date, '2026-08-17');
    assert.equal(rows[2]?.amount_cents, 1953859);
  });

  it('auto-detecta C6 quando formato pedido é csv genérico', () => {
    const rows = parseBankStatement(sampleC6, 'csv');
    assert.equal(rows.length, 3);
    const stats = summarizeBankMovementRows(rows);
    assert.equal(stats.total, 3);
    assert.equal(stats.by_date['2026-08-05'], 1);
    assert.equal(stats.by_date['2026-08-17'], 1);
  });

  it('gera external_id estável em dois parses do mesmo arquivo', () => {
    const a = parseC6BankStatement(sampleC6);
    const b = parseC6BankStatement(sampleC6);
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i += 1) {
      assert.equal(a[i]?.external_id, b[i]?.external_id);
      assert.ok(a[i]?.external_id);
    }
  });

  it('mantém o mesmo fingerprint quando o preâmbulo muda (índice de linha diferente)', () => {
    const withExtraPreamble = `EXTRATO C6\n\nLinha extra\n\n${sampleC6}`;
    const a = parseC6BankStatement(sampleC6);
    const b = parseC6BankStatement(withExtraPreamble);
    assert.equal(a.length, b.length);
    assert.deepEqual(
      a.map((r) => r.external_id),
      b.map((r) => r.external_id)
    );
  });

  it('distingue duas movimentações idênticas no mesmo dia via occurrence', () => {
    const twin = `\uFEFFEXTRATO DE CONTA CORRENTE C6 BANK

Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)
06/08/2026,06/08/2026,Pix enviado para JOAO,PAGAMENTO,0.00,1500.00,0.01
06/08/2026,06/08/2026,Pix enviado para JOAO,PAGAMENTO,0.00,1500.00,0.01
`;
    const rows = parseC6BankStatement(twin);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0]?.external_id, rows[1]?.external_id);
    assert.equal(bankMovementContentBaseKey(rows[0]!), bankMovementContentBaseKey(rows[1]!));
  });
});

describe('parseC6BankStatement — extrato de lote', () => {
  it('detecta e parseia layout Data Pagamento / Tipo e Beneficiário / Valor', () => {
    assert.equal(looksLikeC6LoteBankStatement(sampleC6Lote), true);
    assert.equal(looksLikeC6BankStatement(sampleC6Lote), true);
    assert.equal(resolveBankStatementFormat(sampleC6Lote, 'csv'), 'c6');
    const rows = parseC6BankStatement(sampleC6Lote);
    assert.equal(rows.length, 3); // Pendente ignorado
    assert.equal(rows[0]?.movement_date, '2026-08-20');
    assert.equal(rows[0]?.direction, 'debit');
    assert.equal(rows[0]?.amount_cents, 92400);
    assert.ok(rows[0]?.description?.includes('RENATO MENDES'));
    assert.equal(rows[1]?.amount_cents, 70000);
    assert.equal(rows[2]?.amount_cents, 157200);
  });

  it('auto-detecta lote via parseBankStatement(csv)', () => {
    const rows = parseBankStatement(sampleC6Lote, 'csv');
    assert.equal(rows.length, 3);
  });

  it('gera external_id estável (c6-lote) sem índice de linha', () => {
    const a = parseC6BankStatement(sampleC6Lote);
    const withExtra = `Lote extra\n\n${sampleC6Lote}`;
    const b = parseC6BankStatement(withExtra);
    assert.deepEqual(
      a.map((r) => r.external_id),
      b.map((r) => r.external_id)
    );
    assert.ok(a.every((r) => r.external_id && /^[a-f0-9]{40}$/.test(r.external_id)));
  });
});

describe('parseC6BankStatement — arquivo anexado', () => {
  it('conta linhas do extrato 01M0FT54… por data (14–19/08)', () => {
    const content = readSampleCsv();
    assert.equal(looksLikeC6BankStatement(content), true);
    const rows = parseC6BankStatement(content);
    const stats = summarizeBankMovementRows(rows);
    assert.equal(stats.total, 599);
    assert.equal(stats.by_date['2026-08-14'] ?? 0, 0);
    assert.equal(stats.by_date['2026-08-15'] ?? 0, 0);
    assert.equal(stats.by_date['2026-08-16'] ?? 0, 0);
    assert.equal(stats.by_date['2026-08-17'], 18);
    assert.equal(stats.by_date['2026-08-18'], 35);
    assert.equal(stats.by_date['2026-08-19'], 5);
    assert.ok((stats.by_date['2026-08-13'] ?? 0) > 100);
  });

  it('dois parses do CSV anexado produzem os mesmos external_ids (dedupe)', () => {
    const content = readSampleCsv();
    const a = parseC6BankStatement(content);
    const b = parseC6BankStatement(content);
    assert.equal(a.length, 599);
    assert.deepEqual(
      a.map((r) => r.external_id),
      b.map((r) => r.external_id)
    );
    const unique = new Set(a.map((r) => r.external_id));
    assert.equal(unique.size, a.length);
  });
});

describe('parseC6BankStatement — arquivo anexado lote 01M0J4RB…', () => {
  it('parseia o extrato de lote anexado com stats estáveis', () => {
    const content = readLoteSampleCsv();
    assert.equal(looksLikeC6LoteBankStatement(content), true);
    const rows = parseC6BankStatement(content);
    const stats = summarizeBankMovementRows(rows);
    assert.ok(stats.total >= 16, `esperado >=16 linhas, got ${stats.total}`);
    assert.equal(stats.by_date['2026-08-20'], stats.total);
    assert.ok(rows.every((r) => r.direction === 'debit'));
    assert.equal(rows[0]?.amount_cents, 92400);
    assert.ok(rows[0]?.description?.includes('RENATO'));
  });

  it('dois parses do lote anexado produzem os mesmos external_ids', () => {
    const content = readLoteSampleCsv();
    const a = parseC6BankStatement(content);
    const b = parseC6BankStatement(content);
    assert.deepEqual(
      a.map((r) => r.external_id),
      b.map((r) => r.external_id)
    );
    assert.equal(new Set(a.map((r) => r.external_id)).size, a.length);
  });
});
