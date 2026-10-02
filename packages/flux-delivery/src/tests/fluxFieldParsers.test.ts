import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fluxLocalDateTimeToUtcIso,
  fluxLocalIsoDateTimeToUtcIso,
  parseFluxDeliveryAt,
  parseFluxDeliveryExternalKey,
} from '../fluxFieldParsers';

describe('parseFluxDeliveryAt', () => {
  it('interpreta datetime MySQL sem timezone como America/Sao_Paulo', () => {
    assert.equal(
      parseFluxDeliveryAt({ datHorEnt: '2026-07-27 16:45:08' }),
      '2026-07-27T19:45:08.000Z'
    );
  });

  it('interpreta ISO sem timezone como America/Sao_Paulo', () => {
    assert.equal(
      parseFluxDeliveryAt({ dataEntrega: '2026-07-27T16:45:08' }),
      '2026-07-27T19:45:08.000Z'
    );
  });

  it('preserva ISO com Z explícito', () => {
    assert.equal(
      parseFluxDeliveryAt({ dataEntrega: '2026-07-27T19:45:08.000Z' }),
      '2026-07-27T19:45:08.000Z'
    );
  });

  it('preserva ISO com offset explícito', () => {
    assert.equal(
      parseFluxDeliveryAt({ dataEntrega: '2026-07-27T16:45:08-03:00' }),
      '2026-07-27T19:45:08.000Z'
    );
  });

  it('interpreta data-only como meio-dia BRT', () => {
    assert.equal(parseFluxDeliveryAt({ dataEntrega: '2026-07-27' }), '2026-07-27T15:00:00.000Z');
  });

  it('interpreta formato BR com hora como BRT', () => {
    assert.equal(
      parseFluxDeliveryAt({ data_entrega: '27/07/2026 16:45' }),
      '2026-07-27T19:45:00.000Z'
    );
  });

  it('retorna null para valor vazio', () => {
    assert.equal(parseFluxDeliveryAt({}), null);
    assert.equal(parseFluxDeliveryAt({ datHorEnt: '' }), null);
  });
});

describe('fluxLocalDateTimeToUtcIso', () => {
  it('converte meia-noite BRT para 03:00 UTC', () => {
    assert.equal(fluxLocalDateTimeToUtcIso(2026, 1, 15, 0, 0, 0), '2026-01-15T03:00:00.000Z');
  });
});

describe('parseFluxDeliveryExternalKey', () => {
  it('usa timestamp UTC corrigido na chave composta', () => {
    const key = parseFluxDeliveryExternalKey({
      codPes: 33,
      codLoc: 2,
      idEntregador: 'DRV1',
      nroDocto: 'DOC99',
      datHorEnt: '2026-07-27 16:45:08',
    });
    assert.equal(key, '33:2:DRV1:DOC99:2026-07-27T19:45:08');
  });
});

describe('fluxLocalIsoDateTimeToUtcIso', () => {
  it('parseia slice de 19 chars', () => {
    assert.equal(fluxLocalIsoDateTimeToUtcIso('2026-07-27T16:45:08'), '2026-07-27T19:45:08.000Z');
  });
});
