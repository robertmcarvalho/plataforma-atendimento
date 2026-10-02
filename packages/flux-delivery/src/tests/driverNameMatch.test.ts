import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchUniqueDriverByNameSimilarity,
  normalizeDriverName,
  type NamedDriver,
} from '../driverNameMatch';

function drivers(...names: Array<[string, string]>): NamedDriver[] {
  return names.map(([id, name]) => ({ id, nameKey: normalizeDriverName(name) }));
}

describe('normalizeDriverName', () => {
  it('uppercases, strips accents, collapses spaces', () => {
    assert.equal(normalizeDriverName('  Phablo  Héinrick '), 'PHABLO HEINRICK');
  });
});

describe('matchUniqueDriverByNameSimilarity', () => {
  it('matches Phablo-style initials truncation', () => {
    const local = drivers([
      'phablo',
      'PHABLO HEINRICK VALADARES FERREIRA',
    ], ['other', 'PEDRO HENRIQUE SILVA']);
    const id = matchUniqueDriverByNameSimilarity(
      normalizeDriverName('Phablo H V Ferreira'),
      local
    );
    assert.equal(id, 'phablo');
  });

  it('matches Marcus-style truncated first names as prefix', () => {
    const local = drivers(
      ['marcus', 'Marcus Vinicios da Silva Santos'],
      ['other', 'Marcus Aurelio Souza']
    );
    const id = matchUniqueDriverByNameSimilarity(
      normalizeDriverName('Marcus Vinicios'),
      local
    );
    assert.equal(id, 'marcus');
  });

  it('matches Marcus vs Marcos spelling (edit distance 1) when unique', () => {
    const local = drivers(
      ['marcos', 'MARCOS VINICIOS RODRIGUES PINHEIRO DE SOUSA'],
      ['other', 'MARCUS AURELIO SOUZA']
    );
    const id = matchUniqueDriverByNameSimilarity(
      normalizeDriverName('Marcus Vinicios Rodrigues Pinheiro de Sousa'),
      local
    );
    assert.equal(id, 'marcos');
  });

  it('matches truncated last token (jeferson andrade ferreir)', () => {
    const local = drivers(
      ['jef', 'JEFERSON ANDRADE FERREIRA'],
      ['other', 'JEFERSON ANDRADE LIMA']
    );
    const id = matchUniqueDriverByNameSimilarity(
      normalizeDriverName('jeferson andrade ferreir'),
      local
    );
    assert.equal(id, 'jef');
  });

  it('matches Wendel lima as unique word prefix', () => {
    const local = drivers(
      ['wendel', 'WENDEL LIMA DE SOUZA'],
      ['other', 'WENDEL SOUZA LIMA']
    );
    const id = matchUniqueDriverByNameSimilarity(normalizeDriverName('Wendel lima'), local);
    assert.equal(id, 'wendel');
  });

  it('skips ambiguous single-token names (Junio)', () => {
    const local = drivers(
      ['a', 'JUNIO DE ANDRADE ARRUDA'],
      ['b', 'JUNIO SILVA'],
      ['c', 'RAUL CAMPREGHER JUNIOR']
    );
    assert.equal(matchUniqueDriverByNameSimilarity(normalizeDriverName('Junio'), local), null);
  });

  it('skips when two locals share the same Flux prefix', () => {
    const local = drivers(
      ['a', 'MARCUS VINICIOS DA SILVA'],
      ['b', 'MARCUS VINICIOS PEREIRA']
    );
    assert.equal(
      matchUniqueDriverByNameSimilarity(normalizeDriverName('Marcus Vinicios'), local),
      null
    );
  });

  it('returns null for empty / short Flux names', () => {
    const local = drivers(['a', 'ANA SILVA']);
    assert.equal(matchUniqueDriverByNameSimilarity('', local), null);
    assert.equal(matchUniqueDriverByNameSimilarity('AB', local), null);
  });
});
