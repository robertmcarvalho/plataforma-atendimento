import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapIbgeMunicipiosPayload, normalizeIbgeCityCode } from './ibge';

describe('geo/ibge', () => {
  it('normalizeIbgeCityCode aceita 7 dígitos', () => {
    assert.equal(normalizeIbgeCityCode('3170206'), '3170206');
    assert.equal(normalizeIbgeCityCode(3170206), '3170206');
    assert.equal(normalizeIbgeCityCode('31.702-06'), '3170206');
    assert.equal(normalizeIbgeCityCode('3170'), null);
    assert.equal(normalizeIbgeCityCode(''), null);
  });

  it('mapIbgeMunicipiosPayload preserva id+nome (escopo UF)', () => {
    const out = mapIbgeMunicipiosPayload([
      { id: 3170206, nome: 'Uberlândia' },
      { id: '3550308', nome: 'São Paulo' },
      { id: 12, nome: 'inválido' },
      { id: 3106200, nome: '  ' },
    ]);
    assert.deepEqual(out, [
      { id: '3170206', name: 'Uberlândia' },
      { id: '3550308', name: 'São Paulo' },
    ]);
  });
});
