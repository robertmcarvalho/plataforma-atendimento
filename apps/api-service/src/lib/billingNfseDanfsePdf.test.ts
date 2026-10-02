import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractAccessKeyFromNfseXml,
  generateDanfsePdfFromXml,
  parseNfseAuthorizedXml,
  resolveDanfsePdfBuffer,
} from './billingNfseDanfsePdf';

/** Unit tests: força fallback PDFKit/NT008 (sem depender de JRE/jar). */
process.env.BILLING_DANFSE_LIB_ENABLED = 'false';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const deltaXmlPath = join(
  repoRoot,
  'tmp',
  'nfse-delta-240d2025-1de9-48f8-a34d-262bc6020fe2.xml'
);

const MINIMAL_NFSE_XML = `<?xml version="1.0" encoding="utf-8"?>
<NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS31702062227124815000139000000000176626090033201875">
    <xLocEmi>Uberlândia</xLocEmi>
    <xLocPrestacao>Uberlândia</xLocPrestacao>
    <nNFSe>1766</nNFSe>
    <cLocIncid>3170206</cLocIncid>
    <xLocIncid>Uberlândia</xLocIncid>
    <verAplic>SefinNacional_1.6.0</verAplic>
    <cStat>100</cStat>
    <dhProc>2026-09-08T14:28:26-03:00</dhProc>
    <nDFSe>14842821</nDFSe>
    <emit>
      <CNPJ>27124815000139</CNPJ>
      <xNome>FLUX FARMA LTDA</xNome>
      <enderNac>
        <xLgr>RUA DAS ACACIAS</xLgr>
        <nro>187</nro>
        <xBairro>CIDADE JARDIM</xBairro>
        <cMun>3170206</cMun>
        <UF>MG</UF>
        <CEP>38412130</CEP>
      </enderNac>
    </emit>
    <valores><vLiq>450.00</vLiq></valores>
    <DPS versao="1.01">
      <infDPS Id="DPS317020622712481500013900001000000000900001">
        <serie>1</serie>
        <nDPS>900001</nDPS>
        <dCompet>2026-08-23</dCompet>
        <toma>
          <CNPJ>34850773000189</CNPJ>
          <xNome>L2 DROGARIA E PERFUMARIA LTDA</xNome>
          <end>
            <endNac><cMun>2906501</cMun><CEP>43805000</CEP></endNac>
            <xLgr>Rua Treze de Maio</xLgr>
            <nro>126</nro>
            <xBairro>Centro</xBairro>
          </end>
        </toma>
        <serv>
          <cServ>
            <cTribNac>260101</cTribNac>
            <xDescServ>Prestação de serviços de entrega — DELTA</xDescServ>
            <cNBS>107020000</cNBS>
          </cServ>
        </serv>
        <valores>
          <vServPrest><vServ>450.00</vServ></vServPrest>
          <trib><totTrib><pTotTribSN>18.83</pTotTribSN></totTrib></trib>
        </valores>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;

describe('billingNfseDanfsePdf parse', () => {
  it('extrai chave do Id NFS…', () => {
    const key = extractAccessKeyFromNfseXml(MINIMAL_NFSE_XML);
    assert.equal(key, '31702062227124815000139000000000176626090033201875');
  });

  it('parseia campos principais do XML', () => {
    const f = parseNfseAuthorizedXml(MINIMAL_NFSE_XML);
    assert.equal(f.nNfse, '1766');
    assert.equal(f.nDfse, '14842821');
    assert.equal(f.cStat, '100');
    assert.equal(f.emitNome, 'FLUX FARMA LTDA');
    assert.equal(f.emitCnpj, '27124815000139');
    assert.match(f.emitEndereco || '', /ACACIAS/);
    assert.equal(f.tomaNome, 'L2 DROGARIA E PERFUMARIA LTDA');
    assert.equal(f.tomaCnpj, '34850773000189');
    assert.match(f.tomaEndereco || '', /Treze de Maio/);
    assert.match(f.descServ || '', /DELTA/);
    assert.equal(f.cTribNac, '260101');
    assert.equal(f.vServ, '450.00');
    assert.equal(f.vLiq, '450.00');
    assert.equal(f.pTotTribSn, '18.83');
    assert.equal(f.accessKey, '31702062227124815000139000000000176626090033201875');
  });
});

describe('billingNfseDanfsePdf generate', () => {
  it('gera PDF não vazio a partir do XML mínimo', async () => {
    const pdf = await generateDanfsePdfFromXml(MINIMAL_NFSE_XML);
    assert.ok(pdf.length > 200);
    assert.equal(pdf.subarray(0, 4).toString('utf8'), '%PDF');
  });

  it('resolveDanfsePdfBuffer prefere NT 008 quando há XML (mesmo com ADN)', async () => {
    const fakeAdn = Buffer.from('%PDF-1.4 fake-adn-content-xxxxxxxxxx');
    const resolved = await resolveDanfsePdfBuffer({
      adnPdf: fakeAdn,
      nfseXml: MINIMAL_NFSE_XML,
    });
    assert.equal(resolved?.source, 'nt008_local');
    assert.ok(resolved && resolved.pdf !== fakeAdn);
  });

  it('resolveDanfsePdfBuffer usa ADN quando preferAdn=true', async () => {
    const fakeAdn = Buffer.from('%PDF-1.4 fake-adn-content-xxxxxxxxxx');
    const resolved = await resolveDanfsePdfBuffer({
      adnPdf: fakeAdn,
      nfseXml: MINIMAL_NFSE_XML,
      preferAdn: true,
    });
    assert.equal(resolved?.source, 'adn');
    assert.equal(resolved?.pdf, fakeAdn);
  });

  it('resolveDanfsePdfBuffer gera NT 008 a partir do XML', async () => {
    const resolved = await resolveDanfsePdfBuffer({
      adnPdf: null,
      nfseXml: MINIMAL_NFSE_XML,
      accessKey: '31702062227124815000139000000000176626090033201875',
    });
    assert.equal(resolved?.source, 'nt008_local');
    assert.ok(resolved && resolved.pdf.length > 200);
    assert.equal(resolved.pdf.subarray(0, 4).toString('utf8'), '%PDF');
  });
});

describe('billingNfseDanfsePdf DELTA fixture', () => {
  it('parse + PDF a partir do XML DELTA em tmp/ (se existir)', async () => {
    let xml: string;
    try {
      xml = readFileSync(deltaXmlPath, 'utf8');
    } catch {
      // Fixture opcional fora do CI
      return;
    }
    const f = parseNfseAuthorizedXml(xml);
    assert.equal(f.nNfse, '1766');
    assert.equal(f.emitNome, 'FLUX FARMA LTDA');
    assert.match(f.descServ || '', /DELTA/);
    const pdf = await generateDanfsePdfFromXml(xml);
    assert.ok(pdf.length > 500);
    assert.equal(pdf.subarray(0, 4).toString('utf8'), '%PDF');
  });
});
