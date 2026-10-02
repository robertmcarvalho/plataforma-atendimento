import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateDanfsePdfViaLib,
  isDanfseLibEnabled,
  resolveDanfseLibJarPath,
} from './billingNfseDanfseLib';
import { resolveDanfsePdfBuffer } from './billingNfseDanfsePdf';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const deltaXmlPath = join(
  repoRoot,
  'tmp',
  'nfse-delta-240d2025-1de9-48f8-a34d-262bc6020fe2.xml'
);
const jarCandidates = [
  join(repoRoot, 'tools', 'xml-danfse-br', 'target', 'xml-danfse-br-cli.jar'),
  join(repoRoot, 'tmp', 'danfse-lib-poc', 'xml-danfse-br-cli-0.9.0-portal-patched.jar'),
  join(repoRoot, 'apps', 'api-service', 'vendor', 'xml-danfse-br', 'xml-danfse-br-cli.jar'),
];

function findLocalJar(): string | null {
  for (const p of jarCandidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

describe('billingNfseDanfseLib', () => {
  it('isDanfseLibEnabled default true', () => {
    const prev = process.env.BILLING_DANFSE_LIB_ENABLED;
    delete process.env.BILLING_DANFSE_LIB_ENABLED;
    assert.equal(isDanfseLibEnabled(), true);
    process.env.BILLING_DANFSE_LIB_ENABLED = 'false';
    assert.equal(isDanfseLibEnabled(), false);
    if (prev === undefined) delete process.env.BILLING_DANFSE_LIB_ENABLED;
    else process.env.BILLING_DANFSE_LIB_ENABLED = prev;
  });

  it('generateDanfsePdfViaLib + resolve prefer lib (quando jar+java disponíveis)', async () => {
    const jar = findLocalJar();
    if (!jar || !existsSync(deltaXmlPath)) {
      return;
    }
    const prevEnabled = process.env.BILLING_DANFSE_LIB_ENABLED;
    const prevJar = process.env.BILLING_DANFSE_LIB_JAR;
    process.env.BILLING_DANFSE_LIB_ENABLED = 'true';
    process.env.BILLING_DANFSE_LIB_JAR = jar;
    try {
      assert.equal(resolveDanfseLibJarPath(), jar);
      const xml = readFileSync(deltaXmlPath);
      const lib = await generateDanfsePdfViaLib({ nfseXml: xml });
      assert.equal(lib.ok, true, lib.ok ? '' : lib.message);
      if (!lib.ok) return;
      assert.equal(lib.pdf.subarray(0, 4).toString('utf8'), '%PDF');
      assert.ok(lib.pdf.length > 10_000);

      const resolved = await resolveDanfsePdfBuffer({ nfseXml: xml });
      assert.equal(resolved?.source, 'xml_danfse_br');
      assert.ok(resolved && resolved.pdf.length > 10_000);
    } finally {
      if (prevEnabled === undefined) delete process.env.BILLING_DANFSE_LIB_ENABLED;
      else process.env.BILLING_DANFSE_LIB_ENABLED = prevEnabled;
      if (prevJar === undefined) delete process.env.BILLING_DANFSE_LIB_JAR;
      else process.env.BILLING_DANFSE_LIB_JAR = prevJar;
    }
  });
});
