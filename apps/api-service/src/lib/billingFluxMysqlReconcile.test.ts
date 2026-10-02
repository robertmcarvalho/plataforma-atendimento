import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryBusinessFingerprint,
  buildMysqlExternalId,
  hasMysqlDriverName,
  normalizeMysqlExternalId,
  resolveMysqlDriverName,
  resolveMysqlRowCnpj,
} from './billingFluxMysqlReconcile';
import {
  buildPharmacyCnpjIndex,
  fluxPharmacyKey,
  PROD_FLUX_FARMA_WORKSPACE_ID,
  resolveMysqlDeliveryPharmacyFromKeys,
} from '@plataforma/flux-delivery';

describe('billingFluxMysqlReconcile helpers', () => {
  it('normalizeMysqlExternalId remove prefixo legado', () => {
    assert.equal(normalizeMysqlExternalId('mysql:1:2:3'), '1:2:3');
    assert.equal(normalizeMysqlExternalId('1:2:3'), '1:2:3');
  });

  it('deliveryBusinessFingerprint casa API e MySQL no mesmo minuto', () => {
    const fpMysql = deliveryBusinessFingerprint({
      flux_codpes: 10,
      flux_codloc: 20,
      document_number: 'ABC',
      delivered_at: '2026-07-13T14:22:33.000Z',
    });
    const fpApi = deliveryBusinessFingerprint({
      flux_codpes: 10,
      flux_codloc: 20,
      document_number: 'ABC',
      delivered_at: '2026-07-13T14:22:01.000Z',
    });
    assert.equal(fpMysql, '10:20:ABC:2026-07-13T14:22');
    assert.equal(fpMysql, fpApi);
  });

  it('resolveMysqlRowCnpj prefere view_farmacias e faz fallback para rota', () => {
    const farmMap = new Map([[fluxPharmacyKey(7, 19), '25102146002465']]);
    assert.equal(resolveMysqlRowCnpj(7, 19, '99999999000199', farmMap), '25102146002465');
    assert.equal(resolveMysqlRowCnpj(70, 19, '12345678000199', farmMap), '12345678000199');
    assert.equal(resolveMysqlRowCnpj(70, 19, null, farmMap), null);
  });

  it('hasMysqlDriverName rejeita vazio/nulo', () => {
    assert.equal(hasMysqlDriverName(null), false);
    assert.equal(hasMysqlDriverName(''), false);
    assert.equal(hasMysqlDriverName('   '), false);
    assert.equal(hasMysqlDriverName('João Silva'), true);
  });

  it('resolveMysqlDriverName busca por IDEntr e CPF', () => {
    const catalog = {
      byId: new Map([['42', 'MARCOS SILVA']]),
      byCpf: new Map([['12345678901', 'LUCAS PEREIRA']]),
    };
    assert.equal(resolveMysqlDriverName('42', null, catalog), 'MARCOS SILVA');
    assert.equal(resolveMysqlDriverName('', '12345678901', catalog), 'LUCAS PEREIRA');
    assert.equal(resolveMysqlDriverName('99', '99999999999', catalog), null);
  });
});

describe('MySQL import skip rules', () => {
  const cnpjIndex = buildPharmacyCnpjIndex([{ id: 'pharm-1', cnpj: '12345678000199' }]);

  it('pula quando CNPJ não está cadastrado no Aethera', () => {
    assert.equal(
      resolveMysqlDeliveryPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 10, 20, '99999999000199', cnpjIndex),
      null
    );
  });

  it('importa Indiana 7:6 mesmo sem CNPJ local', () => {
    assert.equal(
      resolveMysqlDeliveryPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 7, 6, null, cnpjIndex),
      '60aa74f6-e09e-450e-bcf4-72d011342c9f'
    );
  });

  it('buildMysqlExternalId inclui rota para evitar colisão no mesmo minuto', () => {
    const at = '2026-07-13T14:22:33.000Z';
    const a = buildMysqlExternalId({
      codpes: 7,
      codloc: 11,
      driverFluxId: '42',
      documentNumber: 'DOC1',
      deliveredAt: at,
      routeId: '100',
    });
    const b = buildMysqlExternalId({
      codpes: 7,
      codloc: 11,
      driverFluxId: '42',
      documentNumber: 'DOC1',
      deliveredAt: at,
      routeId: '101',
    });
    assert.notEqual(a, b);
    assert.ok(a.endsWith(':r100'));
    assert.ok(b.endsWith(':r101'));
  });
});
