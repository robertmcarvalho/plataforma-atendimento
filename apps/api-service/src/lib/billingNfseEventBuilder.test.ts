import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import {
  BILLING_NFSE_CANCEL_EVENT_CODE,
  BILLING_NFSE_CANCEL_EVENT_DESC,
  BILLING_NFSE_PED_REG_EVENTO_VERSAO,
  BILLING_NFSE_XMOTIVO_MIN,
  buildCancelEventXml,
  buildPedRegEventoId,
  normalizeCancelJustificativa,
  normalizeCancelMotivo,
  normalizeNfseAccessKey,
} from './billingNfseEventBuilder';
import { BILLING_NFSE_DPS_NS, BILLING_NFSE_VER_APLIC } from './billingNfseDpsBuilder';
import {
  createSelfSignedTestPfx,
  hasSignatureElement,
  loadPfxMaterialFromBuffer,
  signPedRegEventoXmlToGzipBase64,
} from './billingNfseSigner';
import {
  BillingNfseSefinClient,
  normalizeSefinEventResponse,
} from './billingNfseSefinClient';
import type { LoadedPfxMaterial } from './billingNfseSigner';

const CHAVE = '8'.repeat(50);

describe('billingNfseEventBuilder (e101101)', () => {
  it('monta Id PRE + chave 50 + tipo evento 6 (sem nPed)', () => {
    const id = buildPedRegEventoId(CHAVE, '101101');
    assert.equal(id, `PRE${CHAVE}101101`);
    assert.equal(id.length, 59);
    assert.equal(normalizeNfseAccessKey(CHAVE), CHAVE);
    assert.throws(() => buildPedRegEventoId(CHAVE, '101'), /6 dígitos/);
  });

  it('recusa chave curta e justificativa curta', () => {
    assert.throws(() => normalizeNfseAccessKey('123'), /50 dígitos/);
    assert.throws(() => normalizeCancelJustificativa('curto'), /mínimo 15/);
    assert.equal(normalizeCancelJustificativa('Erro no preenchimento').length >= BILLING_NFSE_XMOTIVO_MIN, true);
    assert.equal(normalizeCancelMotivo(2), '2');
    assert.throws(() => normalizeCancelMotivo(9), /1, 2 ou 3/);
  });

  it('gera XML pedRegEvento e101101 em producao_restrita (tpAmb=2)', () => {
    const built = buildCancelEventXml({
      environment: 'producao_restrita',
      autor_cnpj: '50.749.016/0001-70',
      access_key: CHAVE,
      justificativa: 'Erro no preenchimento dos dados da NFS-e',
      codigo_motivo: 1,
      n_ped_reg: 1,
      dh_evento: '2026-08-18T16:00:00-03:00',
    });
    assert.equal(built.tp_amb, '2');
    assert.equal(built.event_code, BILLING_NFSE_CANCEL_EVENT_CODE);
    assert.equal(built.c_motivo, '1');
    assert.match(built.xml, new RegExp(`xmlns="${BILLING_NFSE_DPS_NS}"`));
    assert.match(built.xml, new RegExp(`versao="${BILLING_NFSE_PED_REG_EVENTO_VERSAO}"`));
    assert.match(built.xml, new RegExp(`<infPedReg Id="PRE${CHAVE}101101">`));
    assert.equal(built.ped_reg_id, `PRE${CHAVE}101101`);
    assert.match(built.xml, /<tpAmb>2<\/tpAmb>/);
    assert.match(built.xml, new RegExp(`<verAplic>${BILLING_NFSE_VER_APLIC}</verAplic>`));
    assert.match(built.xml, /<CNPJAutor>50749016000170<\/CNPJAutor>/);
    assert.match(built.xml, new RegExp(`<chNFSe>${CHAVE}</chNFSe>`));
    assert.match(built.xml, /<e101101>/);
    assert.match(built.xml, new RegExp(`<xDesc>${BILLING_NFSE_CANCEL_EVENT_DESC}</xDesc>`));
    assert.match(built.xml, /<cMotivo>1<\/cMotivo>/);
    assert.match(built.xml, /<xMotivo>Erro no preenchimento dos dados da NFS-e<\/xMotivo>/);
    assert.doesNotMatch(built.xml, /nPedReg/);
    assert.doesNotMatch(built.xml, /Signature/);
  });
});

describe('billingNfse cancel + mocked Sefin', () => {
  it('assina infPedReg e POST /nfse/{chave}/eventos com gzip b64', async () => {
    const password = 'test-nfse';
    const material = loadPfxMaterialFromBuffer(createSelfSignedTestPfx(password), password);
    const built = buildCancelEventXml({
      environment: 'producao_restrita',
      autor_cnpj: '50749016000170',
      access_key: CHAVE,
      justificativa: 'Erro no preenchimento dos dados da NFS-e',
      dh_evento: '2026-08-18T16:00:00-03:00',
    });
    const packed = signPedRegEventoXmlToGzipBase64(built.xml, material);
    assert.ok(hasSignatureElement(packed.signedXml));
    assert.match(packed.signedXml, new RegExp(`#PRE${CHAVE}101101`));

    let postedUrl = '';
    let postedBody = '';
    const dummy: LoadedPfxMaterial = material;
    const client = new BillingNfseSefinClient({
      environment: 'producao_restrita',
      material: dummy,
      fetchImpl: (async (url, init) => {
        postedUrl = String(url);
        postedBody = String(init?.body || '');
        return new Response(
          JSON.stringify({
            chaveAcesso: CHAVE,
            nProt: 'PROT-CANCEL-1',
            eventoXmlGZipB64: gzipSync(Buffer.from(packed.signedXml, 'utf8')).toString('base64'),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch,
    });

    const res = await client.postNfseEvento(CHAVE, packed.pedidoRegistroEventoXmlGZipB64);
    assert.equal(res.ok, true);
    assert.equal(res.nProt, 'PROT-CANCEL-1');
    assert.equal(
      postedUrl,
      `https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${CHAVE}/eventos`
    );
    const json = JSON.parse(postedBody) as { pedidoRegistroEventoXmlGZipB64?: string };
    assert.ok(json.pedidoRegistroEventoXmlGZipB64);
    assert.equal(json.pedidoRegistroEventoXmlGZipB64, packed.pedidoRegistroEventoXmlGZipB64);
  });

  it('normalizeSefinEventResponse exige protocolo/xml e lê erros', () => {
    const ok = normalizeSefinEventResponse(200, { nProt: 'P1', chaveAcesso: CHAVE });
    assert.equal(ok.ok, true);
    assert.equal(ok.nProt, 'P1');

    const bad = normalizeSefinEventResponse(400, {
      erros: [{ Codigo: 'E2001', Descricao: 'fora do prazo' }],
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.erros?.[0]?.codigo, 'E2001');
  });
});
