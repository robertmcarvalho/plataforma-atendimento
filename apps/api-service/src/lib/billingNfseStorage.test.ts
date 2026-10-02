import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decodeNfseXmlGzipB64, nfseStoragePaths } from './billingNfseStorage';
import { canCancelNfseDocument, canReemitNfseDocument } from './billingNfseEmitEngine';
import { BILLING_NFSE_AUDIT_CODES, BILLING_NFSE_CANCELABLE_STATUSES, BILLING_NFSE_REEMITTABLE_STATUSES } from './billingNfseTypes';

describe('billingNfseStorage paths + decode', () => {
  it('monta paths canônicos por workspace/documento', () => {
    const paths = nfseStoragePaths('ws-1', 'doc-2');
    assert.equal(paths.dpsXml, 'ws-1/doc-2/dps.xml');
    assert.equal(paths.nfseXml, 'ws-1/doc-2/nfse.xml');
    assert.equal(paths.danfsePdf, 'ws-1/doc-2/danfse.pdf');
    assert.equal(paths.cancelEventXml, 'ws-1/doc-2/evento-cancelamento.xml');
  });

  it('decodeNfseXmlGzipB64 descompacta gzip+base64', () => {
    const xml = '<?xml version="1.0"?><NFSe><n>1</n></NFSe>';
    const b64 = gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    const out = decodeNfseXmlGzipB64(b64);
    assert.equal(out.toString('utf8'), xml);
  });

  it('decodeNfseXmlGzipB64 aceita XML plain em base64', () => {
    const xml = '<NFSe/>';
    const b64 = Buffer.from(xml, 'utf8').toString('base64');
    const out = decodeNfseXmlGzipB64(b64);
    assert.equal(out.toString('utf8'), xml);
  });
});

describe('billingNfse reemit status rules', () => {
  it('rejected e canceled são reemitíveis', () => {
    assert.equal(canReemitNfseDocument('rejected'), true);
    assert.equal(canReemitNfseDocument('canceled'), true);
    assert.equal(canReemitNfseDocument('authorized'), false);
    assert.equal(canReemitNfseDocument('pending'), false);
    assert.equal(canReemitNfseDocument(null), false);
    assert.equal(canCancelNfseDocument('authorized'), true);
    assert.equal(canCancelNfseDocument('canceled'), false);
  });

  it('lista reemitível alinhada ao audit REEMIT', () => {
    assert.deepEqual([...BILLING_NFSE_REEMITTABLE_STATUSES], ['rejected', 'canceled']);
    assert.deepEqual([...BILLING_NFSE_CANCELABLE_STATUSES], ['authorized']);
    assert.equal(BILLING_NFSE_AUDIT_CODES.REEMIT, 'NFSE_REEMIT');
    assert.equal(BILLING_NFSE_AUDIT_CODES.CANCELED, 'NFSE_CANCELED');
  });
});
