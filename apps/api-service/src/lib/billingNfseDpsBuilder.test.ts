import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_NFSE_DPS_NS,
  BILLING_NFSE_DPS_VERSAO,
  BILLING_NFSE_VER_APLIC,
  BILLING_NFSE_VER_APLIC_MAX_LEN,
  buildDpsId,
  buildDpsXml,
  buildFixtureDpsInput,
  normalizeCtn,
  normalizeMunicipalRegistration,
  normalizeNbs,
  renderNfseDescriptionTemplate,
  tpAmbForEnvironment,
} from './billingNfseDpsBuilder';

describe('billingNfseDpsBuilder', () => {
  it('verAplic respeita TSVerAplic maxLength=20', () => {
    assert.ok(BILLING_NFSE_VER_APLIC.length >= 1);
    assert.ok(BILLING_NFSE_VER_APLIC.length <= BILLING_NFSE_VER_APLIC_MAX_LEN);
    const built = buildDpsXml(buildFixtureDpsInput());
    assert.match(built.xml, new RegExp(`<verAplic>${BILLING_NFSE_VER_APLIC}</verAplic>`));
  });

  it('normaliza CTN/NBS/IM', () => {
    assert.equal(normalizeCtn('26.01.01'), '260101');
    assert.equal(normalizeNbs('1.0702.00.00'), '107020000');
    assert.equal(normalizeMunicipalRegistration('123'), '000000000000123');
    assert.equal(normalizeMunicipalRegistration('ABC-1'), 'ABC-1');
  });

  it('tpAmb 2 em producao_restrita', () => {
    assert.equal(tpAmbForEnvironment('producao_restrita'), '2');
    assert.equal(tpAmbForEnvironment('producao'), '1');
  });

  it('monta Id DPS com larguras oficiais', () => {
    const id = buildDpsId({
      cLocEmi: '3170206',
      cnpj: '50.749.016/0001-70',
      serie: '1',
      nDps: 1,
    });
    assert.match(id, /^DPS\d{42}$/);
    assert.equal(id.length, 45); // DPS + 42
    assert.ok(id.startsWith('DPS31702062'));
  });

  it('renderiza template de descrição', () => {
    const out = renderNfseDescriptionTemplate(
      'Prestação {{pharmacy}} {{cycle_start}}-{{cycle_end}}',
      { pharmacy: 'ACME', cycle_start: '01/08', cycle_end: '15/08' }
    );
    assert.equal(out, 'Prestação ACME 01/08-15/08');
  });

  it('gera XML DPS golden-like a partir do fixture', () => {
    const built = buildDpsXml(buildFixtureDpsInput());
    assert.equal(built.tp_amb, '2');
    assert.match(built.xml, new RegExp(`xmlns="${BILLING_NFSE_DPS_NS}"`));
    assert.match(built.xml, new RegExp(`versao="${BILLING_NFSE_DPS_VERSAO}"`));
    assert.match(built.xml, /<infDPS Id="DPS31702062/);
    assert.match(built.xml, /<tpAmb>2<\/tpAmb>/);
    assert.match(built.xml, /<cTribNac>260101<\/cTribNac>/);
    assert.match(built.xml, /<cNBS>107020000<\/cNBS>/);
    assert.match(built.xml, /<vServ>150\.50<\/vServ>/);
    assert.match(built.xml, /<opSimpNac>1<\/opSimpNac>/);
    assert.match(built.xml, /<regEspTrib>1<\/regEspTrib>/);
    assert.match(built.xml, /FARMACIA FIXTURE LTDA/);
    assert.doesNotMatch(built.xml, /Signature/);
  });

  it('Flux SN usa opSimpNac 3 e pTotTribSN', () => {
    const built = buildDpsXml(
      buildFixtureDpsInput({
        entity_type: 'flux',
        simples_nacional: true,
        special_tax_regime: 'none',
        valores: { service_amount: 10, tot_trib_sn_pct: 18.83 },
      })
    );
    assert.match(built.xml, /<opSimpNac>3<\/opSimpNac>/);
    assert.match(built.xml, /<regApTribSN>1<\/regApTribSN>/);
    assert.match(built.xml, /<pTotTribSN>18\.83<\/pTotTribSN>/);
  });

  it('cLocPrestacao usa IBGE da farmácia quando informado (não o do emitente)', () => {
    const pharmacyIbge = '2906501'; // Candeias/BA
    const built = buildDpsXml(
      buildFixtureDpsInput({
        prestador: {
          cnpj: '50749016000170',
          municipal_registration: '123456',
          ibge_city_code: '3170206', // Uberlândia (emitente)
        },
        tomador: {
          cnpj: '11222333000181',
          legal_name: 'FARMACIA CANDEIAS LTDA',
          municipal_registration: '998877',
          address: {
            street: 'Rua Exemplo',
            number: '100',
            neighborhood: 'Centro',
            ibge_city_code: pharmacyIbge,
            cep: '43800000',
            city: 'Candeias',
            state: 'BA',
          },
        },
        servico: {
          ctn: '26.01.01',
          nbs: '1.0702.00.00',
          description: 'Prestação teste',
          ibge_prestacao: pharmacyIbge,
        },
      })
    );
    assert.match(built.xml, /<cLocEmi>3170206<\/cLocEmi>/);
    assert.match(built.xml, new RegExp(`<cLocPrestacao>${pharmacyIbge}</cLocPrestacao>`));
    assert.match(built.xml, new RegExp(`<cMun>${pharmacyIbge}</cMun>`));
  });
});
