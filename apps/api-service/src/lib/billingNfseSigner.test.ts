import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSelfSignedTestPfx,
  gzipBase64Xml,
  hasSignatureElement,
  loadPfxMaterial,
  loadPfxMaterialFromBuffer,
  pfxFileExists,
  resolvePfxPath,
  signDpsXml,
  signDpsXmlToGzipBase64,
  signPedRegEventoXml,
  toPfxMaterialLogMeta,
  BillingNfseSignerError,
} from './billingNfseSigner';
import { buildDpsXml, buildFixtureDpsInput } from './billingNfseDpsBuilder';
import { buildCancelEventXml } from './billingNfseEventBuilder';

describe('billingNfseSigner', () => {
  it('resolvePfxPath recusa traversal', () => {
    assert.throws(() => resolvePfxPath('../etc/passwd'), /secret_ref inválido/);
  });

  it('PFX por entidade: BILLING_NFSE_PFX_PATH_<REF> + senha pelo mesmo ref', () => {
    const keys = [
      'BILLING_NFSE_PFX_PATH_BILLING_NFSE_COOP_PFX',
      'BILLING_NFSE_PFX_PASSWORD_BILLING_NFSE_COOP_PFX',
    ];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-coop-'));
    try {
      const password = 'coop-test';
      const file = path.join(dir, 'billing-nfse-coop-pfx.pfx');
      fs.writeFileSync(file, createSelfSignedTestPfx(password));
      process.env.BILLING_NFSE_PFX_PATH_BILLING_NFSE_COOP_PFX = file;
      process.env.BILLING_NFSE_PFX_PASSWORD_BILLING_NFSE_COOP_PFX = password;

      assert.equal(resolvePfxPath('billing-nfse-coop-pfx', { secretsDir: '/secrets/nfse' }), file);
      assert.equal(pfxFileExists('billing-nfse-coop-pfx', { secretsDir: '/secrets/nfse' }), true);
      assert.equal(loadPfxMaterial('billing-nfse-coop-pfx').subjectCn, 'NFSE-TEST-FIXTURE');
      assert.notEqual(
        resolvePfxPath('billing-nfse-flux-pfx', { secretsDir: '/secrets/nfse' }),
        file
      );

      process.env.BILLING_NFSE_PFX_PATH_BILLING_NFSE_COOP_PFX = 'relative/coop.pfx';
      assert.throws(() => resolvePfxPath('billing-nfse-coop-pfx'), /path absoluto/);
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('toPfxMaterialLogMeta é JSON-safe (sem ciclo issuerCertificate)', () => {
    const password = 'test-nfse';
    const material = loadPfxMaterialFromBuffer(createSelfSignedTestPfx(password), password);
    const meta = toPfxMaterialLogMeta(material);
    assert.doesNotThrow(() => JSON.stringify(meta));
    assert.match(meta.thumbprintSha1, /^[0-9A-F]{40}$/);
    assert.equal(meta.subjectCn, 'NFSE-TEST-FIXTURE');
    assert.ok(meta.validUntil);
    assert.equal(meta.hasPrivateKeyPem, true);
    // Garante que o meta não carrega PEMs nem objetos Certificate
    assert.equal('privateKeyPem' in meta, false);
    assert.equal('certificatePem' in meta, false);
  });

  it('assina DPS com PFX de teste (mock)', () => {
    const password = 'test-nfse';
    const pfx = createSelfSignedTestPfx(password);
    const material = loadPfxMaterialFromBuffer(pfx, password);
    assert.ok(material.privateKeyPem.includes('PRIVATE KEY'));
    assert.ok(material.certificatePem.includes('CERTIFICATE'));
    assert.equal(material.subjectCn, 'NFSE-TEST-FIXTURE');
    assert.match(material.thumbprintSha1, /^[0-9A-F]{40}$/);

    const { xml } = buildDpsXml(buildFixtureDpsInput());
    const signed = signDpsXml(xml, material);
    assert.ok(hasSignatureElement(signed));
    assert.match(signed, /DigestMethod/);
    assert.match(signed, /SignatureValue/);
    assert.match(signed, /#DPS31702062/);

    const packed = signDpsXmlToGzipBase64(xml, material);
    assert.ok(packed.dpsXmlGZipB64.length > 100);
    // Round-trip gzip header present in base64 decode
    const buf = Buffer.from(packed.dpsXmlGZipB64, 'base64');
    assert.equal(buf[0], 0x1f);
    assert.equal(buf[1], 0x8b);
  });

  it('assina pedRegEvento (infPedReg) com PFX de teste', () => {
    const password = 'test-nfse';
    const material = loadPfxMaterialFromBuffer(createSelfSignedTestPfx(password), password);
    const { xml } = buildCancelEventXml({
      environment: 'producao_restrita',
      autor_cnpj: '50749016000170',
      access_key: '7'.repeat(50),
      justificativa: 'Erro no preenchimento dos dados da NFS-e',
      dh_evento: '2026-08-18T16:00:00-03:00',
    });
    const signed = signPedRegEventoXml(xml, material);
    assert.ok(hasSignatureElement(signed));
    assert.match(signed, new RegExp(`#PRE${'7'.repeat(50)}101101`));
    assert.match(signed, /SignatureValue/);
  });

  it('gzipBase64Xml comprime texto', () => {
    const b64 = gzipBase64Xml('<DPS/>');
    assert.ok(b64.length > 0);
  });

  it('loadPfxMaterial lê arquivo temporário', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-pfx-'));
    const file = path.join(dir, 'billing-nfse-coop-pfx.pfx');
    const password = 'local';
    fs.writeFileSync(file, createSelfSignedTestPfx(password));
    try {
      assert.equal(pfxFileExists(file), true);
      const material = loadPfxMaterial(file, password);
      assert.ok(material.certificatePem);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falha se PFX ausente', () => {
    assert.throws(
      () => loadPfxMaterial(path.join(os.tmpdir(), `missing-${Date.now()}.pfx`), ''),
      BillingNfseSignerError
    );
  });
});
