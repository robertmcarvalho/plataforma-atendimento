import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateNfseTomadorGate,
  isNfseTomadorReady,
  resolveTomadorCityState,
} from './billingNfseTomadorGate';

const completePharmacy = {
  cnpj: '12.345.678/0001-95',
  legal_name: 'Farmácia Exemplo LTDA',
  address_cep: '38400-000',
  address_street: 'Av. Brasil',
  address_number: '100',
  address_neighborhood: 'Centro',
  address_city: 'Uberlândia',
  address_state: 'MG',
  ibge_city_code: '3170206',
  municipal_registration: '123456',
};

describe('billingNfseTomadorGate', () => {
  it('ok quando cadastro fiscal completo', () => {
    const result = evaluateNfseTomadorGate(completePharmacy);
    assert.equal(result.ok, true);
    assert.deepEqual(result.gaps, []);
    assert.equal(isNfseTomadorReady(completePharmacy), true);
  });

  it('lista gaps quando farmácia ausente (IM opcional por default)', () => {
    const result = evaluateNfseTomadorGate(null);
    assert.equal(result.ok, false);
    assert.ok(result.gaps.length >= 8);
    assert.ok(result.gaps.some((g) => g.code === 'cnpj'));
    assert.ok(result.gaps.some((g) => g.code === 'ibge_city_code'));
    assert.ok(!result.gaps.some((g) => g.code === 'municipal_registration'));
  });

  it('inclui IM no checklist ausente quando requireMunicipalRegistration=true', () => {
    const result = evaluateNfseTomadorGate(null, { requireMunicipalRegistration: true });
    assert.equal(result.ok, false);
    assert.ok(result.gaps.some((g) => g.code === 'municipal_registration'));
  });

  it('exige CNPJ com 14 dígitos', () => {
    const result = evaluateNfseTomadorGate({ ...completePharmacy, cnpj: '123' });
    assert.equal(result.ok, false);
    assert.ok(result.gaps.some((g) => g.code === 'cnpj'));
  });

  it('exige IBGE com 7 dígitos', () => {
    const result = evaluateNfseTomadorGate({ ...completePharmacy, ibge_city_code: '3170' });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.gaps.map((g) => g.code),
      ['ibge_city_code']
    );
  });

  it('aceita city/state legado quando address_* vazio', () => {
    const pharmacy = {
      ...completePharmacy,
      address_city: null,
      address_state: null,
      city: 'Uberlândia',
      state: 'mg',
    };
    const resolved = resolveTomadorCityState(pharmacy);
    assert.equal(resolved.city, 'Uberlândia');
    assert.equal(resolved.state, 'MG');
    assert.equal(isNfseTomadorReady(pharmacy), true);
  });

  it('IM opcional por default; obrigatória só com requireMunicipalRegistration=true', () => {
    const pharmacy = { ...completePharmacy, municipal_registration: null };
    assert.equal(isNfseTomadorReady(pharmacy), true);
    assert.equal(isNfseTomadorReady(pharmacy, { requireMunicipalRegistration: false }), true);
    assert.equal(isNfseTomadorReady(pharmacy, { requireMunicipalRegistration: true }), false);
    const required = evaluateNfseTomadorGate(pharmacy, { requireMunicipalRegistration: true });
    assert.equal(required.ok, false);
    assert.deepEqual(
      required.gaps.map((g) => g.code),
      ['municipal_registration']
    );
  });

  it('checklist cobre endereço incompleto', () => {
    const result = evaluateNfseTomadorGate({
      ...completePharmacy,
      address_cep: null,
      address_street: '',
      address_number: null,
      address_neighborhood: '  ',
    });
    assert.equal(result.ok, false);
    const codes = result.gaps.map((g) => g.code);
    assert.ok(codes.includes('address_cep'));
    assert.ok(codes.includes('address_street'));
    assert.ok(codes.includes('address_number'));
    assert.ok(codes.includes('address_neighborhood'));
  });
});
