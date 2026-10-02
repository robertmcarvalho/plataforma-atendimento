import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INDIANA_LJ06_PHARMACY_ID,
  INDIANA_LJ19_PHARMACY_ID,
  PROD_FLUX_FARMA_WORKSPACE_ID,
} from '../pharmacyFluxExceptions';
import {
  buildPharmacyCnpjIndex,
  buildPharmacyFluxIndex,
  preferDriverLinkedPharmacy,
  resolveDeliveryPharmacyId,
  resolveFluxApiDeliveryPharmacyFromKeys,
  resolveFluxPharmacyFromKeys,
  resolveMysqlDeliveryPharmacyFromKeys,
  resolveMysqlDeliveryPharmacyId,
} from '../resolveDeliveryPharmacy';
import { EXCLUDED_BILLING_INGEST_CNPJ_DIGITS } from '../pharmacyFluxExceptions';

const BEM_TEFAZ_ID = '2f5c1ad5-698c-4111-b12f-8e50433daa8e';
const LJ101_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_PHARMACY_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('resolveFluxPharmacyFromKeys', () => {
  const index = buildPharmacyFluxIndex([
    { id: INDIANA_LJ06_PHARMACY_ID, flux_codpes: 7, flux_codloc: 6 },
    { id: BEM_TEFAZ_ID, flux_codpes: 0, flux_codloc: 36 },
  ]);

  it('keeps Indiana 7:6 and API 0:4 exceptions', () => {
    assert.equal(
      resolveFluxPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 7, 6, index),
      INDIANA_LJ06_PHARMACY_ID
    );
    assert.equal(
      resolveFluxPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 0, 4, index),
      INDIANA_LJ06_PHARMACY_ID
    );
  });

  it('does not route 70:6 to Indiana via codloc fallback', () => {
    assert.equal(resolveFluxPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 70, 6, index), null);
  });

  it('still resolves codloc-only keys when codpes is absent/zero', () => {
    assert.equal(resolveFluxPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 0, 36, index), BEM_TEFAZ_ID);
    assert.equal(resolveFluxPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, null, 36, index), BEM_TEFAZ_ID);
  });
});

describe('preferDriverLinkedPharmacy', () => {
  it('keeps resolved pharmacy when driver is linked there', () => {
    const out = preferDriverLinkedPharmacy(INDIANA_LJ06_PHARMACY_ID, {
      primaryPharmacyId: INDIANA_LJ06_PHARMACY_ID,
      linkedPharmacyIds: [],
    });
    assert.equal(out.pharmacyId, INDIANA_LJ06_PHARMACY_ID);
    assert.equal(out.disambiguated, false);
  });

  it('reassigns ambiguous Indiana 7:6 to driver primary when not linked', () => {
    const out = preferDriverLinkedPharmacy(INDIANA_LJ06_PHARMACY_ID, {
      primaryPharmacyId: BEM_TEFAZ_ID,
      linkedPharmacyIds: [BEM_TEFAZ_ID],
    });
    assert.equal(out.pharmacyId, BEM_TEFAZ_ID);
    assert.equal(out.disambiguated, true);
  });
});

describe('resolveDeliveryPharmacyId', () => {
  const index = buildPharmacyFluxIndex([
    { id: INDIANA_LJ06_PHARMACY_ID, flux_codpes: 7, flux_codloc: 6 },
    { id: BEM_TEFAZ_ID, flux_codpes: 0, flux_codloc: 36 },
  ]);

  it('disambiguates MySQL 7:6 for non-Indiana drivers', () => {
    const out = resolveDeliveryPharmacyId(PROD_FLUX_FARMA_WORKSPACE_ID, 7, 6, index, {
      primaryPharmacyId: BEM_TEFAZ_ID,
      linkedPharmacyIds: [BEM_TEFAZ_ID],
    });
    assert.deepEqual(out, { pharmacyId: BEM_TEFAZ_ID, disambiguated: true });
  });
});

describe('resolveMysqlDeliveryPharmacyFromKeys', () => {
  const cnpjIndex = buildPharmacyCnpjIndex([
    { id: LJ101_ID, cnpj: '25102146002465' },
    { id: OTHER_PHARMACY_ID, cnpj: '12345678000199' },
  ]);

  it('matches pharmacy by CNPJ and ignores codloc-only fallback', () => {
    assert.equal(
      resolveMysqlDeliveryPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 70, 19, '25102146002465', cnpjIndex),
      LJ101_ID
    );
    assert.equal(
      resolveMysqlDeliveryPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 70, 19, null, cnpjIndex),
      null
    );
  });

  it('keeps Indiana 7:6 and 7:19 exceptions without CNPJ match', () => {
    assert.equal(
      resolveMysqlDeliveryPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 7, 6, '00000000000000', cnpjIndex),
      INDIANA_LJ06_PHARMACY_ID
    );
    assert.equal(
      resolveMysqlDeliveryPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 7, 19, '00000000000000', cnpjIndex),
      INDIANA_LJ19_PHARMACY_ID
    );
  });
});

describe('resolveFluxApiDeliveryPharmacyFromKeys', () => {
  const cnpjIndex = buildPharmacyCnpjIndex([
    { id: LJ101_ID, cnpj: '25102146002465' },
    { id: OTHER_PHARMACY_ID, cnpj: '12345678000199' },
  ]);

  it('matches Flux API row by CNPJ (not codloc fallback)', () => {
    assert.equal(
      resolveFluxApiDeliveryPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 0, 19, '25102146002465', cnpjIndex),
      LJ101_ID
    );
    assert.equal(
      resolveFluxApiDeliveryPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 0, 19, null, cnpjIndex),
      null
    );
  });

  it('never imports LJ 139 CNPJ', () => {
    const withLj139 = buildPharmacyCnpjIndex([{ id: 'ignored', cnpj: '25102146014714' }]);
    assert.equal(
      resolveFluxApiDeliveryPharmacyFromKeys(PROD_FLUX_FARMA_WORKSPACE_ID, 10, 20, '25102146014714', withLj139),
      null
    );
    assert.ok(EXCLUDED_BILLING_INGEST_CNPJ_DIGITS.has('25102146014714'));
  });
});

describe('resolveMysqlDeliveryPharmacyId', () => {
  const cnpjIndex = buildPharmacyCnpjIndex([{ id: OTHER_PHARMACY_ID, cnpj: '12345678000199' }]);

  it('does not reassign Indiana 7:6 via driver primary on ingest', () => {
    const out = resolveMysqlDeliveryPharmacyId(
      PROD_FLUX_FARMA_WORKSPACE_ID,
      7,
      6,
      '00000000000000',
      cnpjIndex,
      {
        primaryPharmacyId: OTHER_PHARMACY_ID,
        linkedPharmacyIds: [OTHER_PHARMACY_ID],
      }
    );
    assert.deepEqual(out, { pharmacyId: INDIANA_LJ06_PHARMACY_ID, disambiguated: false });
  });
});
