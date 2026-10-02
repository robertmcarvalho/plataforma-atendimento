import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_NFSE_AUDIT_CODES,
  BillingNfseApproveError,
  NFSE_TOMADOR_INCOMPLETE_CODE,
} from './billingNfseTypes';
import { evaluateNfseTomadorGate } from './billingNfseTomadorGate';
import { isBillingNfseEnabled } from './billingNfseConfig';
import { canCancelNfseDocument, canReemitNfseDocument } from './billingNfseEmitEngine';
import { pfxFileExists } from './billingNfseSigner';

const completePharmacy = {
  cnpj: '12.345.678/0001-95',
  legal_name: 'Farmácia Exemplo LTDA',
  address_cep: '38400-000',
  address_street: 'Av. Brasil',
  address_number: '100',
  address_neighborhood: 'Centro',
  city: 'Uberlândia',
  state: 'MG',
  ibge_city_code: '3170206',
  municipal_registration: '123456',
};

describe('billingNfseEmitEngine (Sprint 3 contracts)', () => {
  const prevEnabled = process.env.BILLING_NFSE_ENABLED;

  afterEach(() => {
    if (prevEnabled === undefined) delete process.env.BILLING_NFSE_ENABLED;
    else process.env.BILLING_NFSE_ENABLED = prevEnabled;
  });

  it('exporta códigos de auditoria NFSE_*', () => {
    assert.equal(NFSE_TOMADOR_INCOMPLETE_CODE, 'NFSE_TOMADOR_INCOMPLETE');
    assert.equal(BILLING_NFSE_AUDIT_CODES.PENDING, 'NFSE_PENDING');
    assert.equal(BILLING_NFSE_AUDIT_CODES.AUTHORIZED, 'NFSE_AUTHORIZED');
    assert.equal(BILLING_NFSE_AUDIT_CODES.REJECTED, 'NFSE_REJECTED');
    assert.equal(BILLING_NFSE_AUDIT_CODES.EMIT_FAILED, 'NFSE_EMIT_FAILED');
    assert.equal(BILLING_NFSE_AUDIT_CODES.CERT_MISSING, 'NFSE_CERT_MISSING');
    assert.equal(BILLING_NFSE_AUDIT_CODES.REEMIT, 'NFSE_REEMIT');
    assert.equal(BILLING_NFSE_AUDIT_CODES.CANCELED, 'NFSE_CANCELED');
    assert.equal(BILLING_NFSE_AUDIT_CODES.CANCEL_FAILED, 'NFSE_CANCEL_FAILED');
  });

  it('BillingNfseApproveError carrega 422 + gaps do gate', () => {
    const gate = evaluateNfseTomadorGate({
      ...completePharmacy,
      ibge_city_code: null,
      municipal_registration: null,
    });
    assert.equal(gate.ok, false);
    assert.ok(gate.gaps.some((g) => g.code === 'ibge_city_code'));
    assert.ok(!gate.gaps.some((g) => g.code === 'municipal_registration'));
    const err = new BillingNfseApproveError('Cadastro fiscal incompleto', {
      status: 422,
      code: NFSE_TOMADOR_INCOMPLETE_CODE,
      gaps: gate.gaps,
    });
    assert.equal(err.status, 422);
    assert.equal(err.code, NFSE_TOMADOR_INCOMPLETE_CODE);
    assert.ok(err.gaps && err.gaps.some((g) => g.code === 'ibge_city_code'));
  });

  it('gate ok sem IM do tomador (default); bloqueia só se exigir IM', () => {
    const pharmacy = { ...completePharmacy, municipal_registration: null };
    assert.equal(evaluateNfseTomadorGate(pharmacy).ok, true);
    const required = evaluateNfseTomadorGate(pharmacy, { requireMunicipalRegistration: true });
    assert.equal(required.ok, false);
    assert.ok(required.gaps.some((g) => g.code === 'municipal_registration'));
  });

  it('BILLING_NFSE_ENABLED default false; true com env', () => {
    delete process.env.BILLING_NFSE_ENABLED;
    assert.equal(isBillingNfseEnabled(), false);
    process.env.BILLING_NFSE_ENABLED = 'true';
    assert.equal(isBillingNfseEnabled(), true);
    process.env.BILLING_NFSE_ENABLED = '0';
    assert.equal(isBillingNfseEnabled(), false);
  });

  it('gate ok para tomador completo (pré-condição do approve)', () => {
    assert.equal(evaluateNfseTomadorGate(completePharmacy).ok, true);
  });

  it('cert Coop ausente falha graciosamente via pfxFileExists', () => {
    assert.equal(pfxFileExists('billing-nfse-coop-pfx-missing-xyz'), false);
  });

  it('cert Flux local presente quando .secrets tem PFX', () => {
    const present = pfxFileExists('billing-nfse-flux-pfx');
    assert.equal(typeof present, 'boolean');
    assert.equal(present, true);
  });

  it('só authorized é cancelável; rejected e canceled reemitíveis', () => {
    assert.equal(canCancelNfseDocument('authorized'), true);
    assert.equal(canCancelNfseDocument('rejected'), false);
    assert.equal(canCancelNfseDocument('pending'), false);
    assert.equal(canCancelNfseDocument('canceled'), false);
    assert.equal(canReemitNfseDocument('authorized'), false);
    assert.equal(canReemitNfseDocument('rejected'), true);
    assert.equal(canReemitNfseDocument('canceled'), true);
  });
});
