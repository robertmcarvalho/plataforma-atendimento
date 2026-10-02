import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  C6_PIX_MAX_PAYMENTS_PER_FILE,
  c6PixPartFilenameSuffix,
  chunkRowsForC6PixFile,
  formatC6PixKey,
} from './billingC6PixExport';

describe('chunkRowsForC6PixFile', () => {
  it(`divide em fatias de ${C6_PIX_MAX_PAYMENTS_PER_FILE}`, () => {
    const rows = Array.from({ length: 250 }, (_, i) => i);
    const chunks = chunkRowsForC6PixFile(rows);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0]!.length, 100);
    assert.equal(chunks[1]!.length, 100);
    assert.equal(chunks[2]!.length, 50);
  });

  it('retorna um único chunk quando cabe no limite', () => {
    const rows = Array.from({ length: 40 }, (_, i) => i);
    assert.deepEqual(chunkRowsForC6PixFile(rows), [rows]);
  });

  it('sufixo de parte só aparece com múltiplos arquivos', () => {
    assert.equal(c6PixPartFilenameSuffix(0, 1), '');
    assert.equal(c6PixPartFilenameSuffix(0, 3), '-parte1de3');
    assert.equal(c6PixPartFilenameSuffix(2, 3), '-parte3de3');
  });
});

describe('formatC6PixKey', () => {
  it('não prefixa CPF de 11 dígitos com +55 (tipo cpf)', () => {
    assert.equal(formatC6PixKey('12345678901', 'cpf'), '12345678901');
    assert.equal(formatC6PixKey('123.456.789-01', 'cpf'), '123.456.789-01');
  });

  it('não trata 11 dígitos sem tipo como telefone (CPF BR)', () => {
    assert.equal(formatC6PixKey('12345678901', null), '12345678901');
    assert.equal(formatC6PixKey('12345678901', ''), '12345678901');
  });

  it('não prefixa CNPJ / email / EVP', () => {
    assert.equal(formatC6PixKey('12345678000199', 'cnpj'), '12345678000199');
    assert.equal(formatC6PixKey('user@example.com', 'email'), 'user@example.com');
    assert.equal(formatC6PixKey('user@example.com', null), 'user@example.com');
    assert.equal(
      formatC6PixKey('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'evp'),
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    );
    assert.equal(
      formatC6PixKey('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'random'),
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    );
  });

  it('prefixa telefone com +55 quando tipo é phone/celular', () => {
    assert.equal(formatC6PixKey('31999887766', 'phone'), '+5531999887766');
    assert.equal(formatC6PixKey('3199887766', 'celular'), '+553199887766');
    assert.equal(formatC6PixKey('+5531999887766', 'telefone'), '+5531999887766');
  });

  it('prefixa 10 dígitos sem tipo como telefone (DDD + número)', () => {
    assert.equal(formatC6PixKey('3199887766', null), '+553199887766');
  });

  it('normaliza número já com 55 sem +', () => {
    assert.equal(formatC6PixKey('5531999887766', 'phone'), '+5531999887766');
  });

  it('retorna vazio para chave nula', () => {
    assert.equal(formatC6PixKey(null, 'cpf'), '');
  });
});
