import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import {
  assertSefinClientEnvironmentAllowed,
  assertSefinRequestUrlAllowed,
  buildDanfseBaseUrl,
  buildSefinNacionalBaseUrl,
  BillingNfseSefinClient,
  BillingNfseSefinClientError,
  normalizeSefinEmitResponse,
  normalizeSefinEventResponse,
} from './billingNfseSefinClient';
import type { LoadedPfxMaterial } from './billingNfseSigner';

const dummyMaterial: LoadedPfxMaterial = {
  privateKeyPem: '-----BEGIN PRIVATE KEY-----\nM\n-----END PRIVATE KEY-----\n',
  certificatePem: '-----BEGIN CERTIFICATE-----\nM\n-----END CERTIFICATE-----\n',
  certChainPem: '-----BEGIN CERTIFICATE-----\nM\n-----END CERTIFICATE-----\n',
  thumbprintSha1: 'A'.repeat(40),
  subjectCn: 'dummy',
  validFrom: null,
  validUntil: null,
};

describe('billingNfseSefinClient', () => {
  const prevAllow = process.env.BILLING_NFSE_ALLOW_PRODUCAO;

  after(() => {
    if (prevAllow === undefined) delete process.env.BILLING_NFSE_ALLOW_PRODUCAO;
    else process.env.BILLING_NFSE_ALLOW_PRODUCAO = prevAllow;
  });

  it('aceita producao_restrita e monta base /SefinNacional', () => {
    delete process.env.BILLING_NFSE_ALLOW_PRODUCAO;
    assert.doesNotThrow(() => assertSefinClientEnvironmentAllowed('producao_restrita'));
    assert.equal(
      buildSefinNacionalBaseUrl('producao_restrita'),
      'https://sefin.producaorestrita.nfse.gov.br/SefinNacional'
    );
    assert.equal(
      buildDanfseBaseUrl('producao_restrita'),
      'https://adn.producaorestrita.nfse.gov.br/danfse'
    );
  });

  it('recusa environment producao sem flag de go-live', () => {
    delete process.env.BILLING_NFSE_ALLOW_PRODUCAO;
    assert.throws(
      () => assertSefinClientEnvironmentAllowed('producao'),
      /PROIBIDO/
    );
  });

  it('recusa host sefin.nfse.gov.br mesmo se URL passada', () => {
    assert.throws(
      () =>
        assertSefinRequestUrlAllowed(
          'producao_restrita',
          'https://sefin.nfse.gov.br/SefinNacional/nfse'
        ),
      BillingNfseSefinClientError
    );
  });

  it('com ALLOW_PRODUCAO=true aceita host produção quando environment=producao', () => {
    process.env.BILLING_NFSE_ALLOW_PRODUCAO = 'true';
    assert.doesNotThrow(() => assertSefinClientEnvironmentAllowed('producao'));
    assert.doesNotThrow(() =>
      assertSefinRequestUrlAllowed('producao', 'https://sefin.nfse.gov.br/SefinNacional/nfse')
    );
    assert.equal(
      buildSefinNacionalBaseUrl('producao'),
      'https://sefin.nfse.gov.br/SefinNacional'
    );
  });

  it('mesmo com ALLOW_PRODUCAO, producao_restrita continua bloqueando host aberto', () => {
    process.env.BILLING_NFSE_ALLOW_PRODUCAO = 'true';
    assert.throws(
      () =>
        assertSefinRequestUrlAllowed(
          'producao_restrita',
          'https://sefin.nfse.gov.br/SefinNacional/nfse'
        ),
      BillingNfseSefinClientError
    );
  });

  it('cliente construtor recusa baseUrl de produção', () => {
    assert.throws(
      () =>
        new BillingNfseSefinClient({
          environment: 'producao_restrita',
          baseUrl: 'https://sefin.nfse.gov.br/SefinNacional',
          material: dummyMaterial,
        }),
      /PROIBIDO/
    );
  });

  it('normalizeSefinEmitResponse lê chave e erros', () => {
    const ok = normalizeSefinEmitResponse(200, {
      chaveAcesso: '1'.repeat(50),
      nfseXmlGZipB64: 'abc',
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.chaveAcesso?.length, 50);

    const bad = normalizeSefinEmitResponse(400, {
      erros: [{ codigo: 'E0001', descricao: 'falha' }],
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.erros?.[0]?.codigo, 'E0001');
  });

  it('normalizeSefinEventResponse lê nProt e recusa erros', () => {
    const ok = normalizeSefinEventResponse(200, { nProt: 'ABC', chaveAcesso: '1'.repeat(50) });
    assert.equal(ok.ok, true);
    assert.equal(ok.nProt, 'ABC');
    const bad = normalizeSefinEventResponse(422, {
      erros: [{ codigo: 'E2001', descricao: 'prazo' }],
    });
    assert.equal(bad.ok, false);
  });

  it('postNfseEvento (fetch mock) usa /nfse/{chave}/eventos em producao_restrita', async () => {
    const chave = '9'.repeat(50);
    const client = new BillingNfseSefinClient({
      environment: 'producao_restrita',
      material: dummyMaterial,
      fetchImpl: (async (url) => {
        assert.equal(
          String(url),
          `https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${chave}/eventos`
        );
        return new Response(JSON.stringify({ nProt: 'P', chaveAcesso: chave }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch,
    });
    const res = await client.postNfseEvento(chave, gzipSync(Buffer.from('<pedRegEvento/>')).toString('base64'));
    assert.equal(res.ok, true);
    assert.equal(res.nProt, 'P');
  });
});
