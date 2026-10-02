import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INDIANA_LJ06_PHARMACY_ID,
  INDIANA_LJ19_PHARMACY_ID,
  PROD_FLUX_FARMA_WORKSPACE_ID,
  resolveFluxPharmacyException,
} from '../pharmacyFluxExceptions';

describe('resolveFluxPharmacyException', () => {
  it('maps Indiana LJ 06 MySQL and API keys', () => {
    assert.equal(resolveFluxPharmacyException(PROD_FLUX_FARMA_WORKSPACE_ID, 7, 6), INDIANA_LJ06_PHARMACY_ID);
    assert.equal(resolveFluxPharmacyException(PROD_FLUX_FARMA_WORKSPACE_ID, 0, 4), INDIANA_LJ06_PHARMACY_ID);
  });

  it('maps Indiana LJ 19 MySQL and API keys', () => {
    assert.equal(resolveFluxPharmacyException(PROD_FLUX_FARMA_WORKSPACE_ID, 7, 19), INDIANA_LJ19_PHARMACY_ID);
    assert.equal(resolveFluxPharmacyException(PROD_FLUX_FARMA_WORKSPACE_ID, 0, 6), INDIANA_LJ19_PHARMACY_ID);
  });

  it('ignores other workspace and unknown keys', () => {
    assert.equal(resolveFluxPharmacyException('other-ws', 7, 19), null);
    assert.equal(resolveFluxPharmacyException(PROD_FLUX_FARMA_WORKSPACE_ID, 7, 999), null);
  });
});
