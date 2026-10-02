import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingArtifactContentDisposition,
  buildBillingArtifactFilename,
  cnpjRoot8,
  cycleDateToken,
  sanitizeFilenameSegment,
} from './billingArtifactFilename';

describe('billingArtifactFilename', () => {
  it('sanitize remove acentos, path e colapsa hífens', () => {
    assert.equal(sanitizeFilenameSegment('DELTA Farmácia / Filial'), 'delta-farmacia-filial');
    assert.equal(sanitizeFilenameSegment('../etc/passwd'), 'etc-passwd');
    assert.equal(sanitizeFilenameSegment(''), 'x');
  });

  it('cnpjRoot8 pega raiz de 8 dígitos', () => {
    assert.equal(cnpjRoot8('12.345.678/0001-90'), '12345678');
    assert.equal(cnpjRoot8('123'), '00000123');
  });

  it('cycleDateToken formata YYYYMMDD', () => {
    assert.equal(cycleDateToken('2026-08-17'), '20260817');
    assert.equal(cycleDateToken(null), '00000000');
  });

  it('buildBillingArtifactFilename segue plano §B (DELTA)', () => {
    const boleto = buildBillingArtifactFilename({
      entity: 'flux',
      pharmacyName: 'DELTA',
      cnpj: '12.345.678/0001-90',
      cycleStart: '2026-08-17',
      cycleEnd: '2026-08-23',
      tipo: 'boleto',
      docRef: 'inv_yOgInV7rSPu90wOp21ekGyQ',
    });
    assert.equal(
      boleto,
      'flux_delta_12345678_20260817-20260823_boleto_inv_yoginv7rspu90wop21ekgyq.pdf'
    );

    const xml = buildBillingArtifactFilename({
      entity: 'flux',
      pharmacyName: 'DELTA',
      cnpj: '12.345.678/0001-90',
      cycleStart: '2026-08-17',
      cycleEnd: '2026-08-23',
      tipo: 'nfse-xml',
      docRef: '1766',
    });
    assert.equal(xml, 'flux_delta_12345678_20260817-20260823_nfse-xml_1766.xml');

    const danfse = buildBillingArtifactFilename({
      entity: 'flux',
      pharmacyName: 'DELTA',
      cnpj: '12.345.678/0001-90',
      cycleStart: '2026-08-17',
      cycleEnd: '2026-08-23',
      tipo: 'danfse_aux',
      docRef: '1766',
    });
    assert.equal(danfse, 'flux_delta_12345678_20260817-20260823_danfse_aux_1766.pdf');
  });

  it('billingArtifactContentDisposition escapa aspas', () => {
    const h = billingArtifactContentDisposition('flux_delta_boleto.pdf');
    assert.equal(h, 'attachment; filename="flux_delta_boleto.pdf"');
    assert.equal(
      billingArtifactContentDisposition('bad"name\r\n.pdf'),
      'attachment; filename="badname.pdf"'
    );
  });
});
