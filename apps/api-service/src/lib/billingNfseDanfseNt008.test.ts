import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DANFSE_NT008_LAYOUT_GAPS,
  generateDanfsePdfNt008,
} from './billingNfseDanfseNt008';
import { resolveDanfsePdfBuffer } from './billingNfseDanfsePdf';
import { buildInvoicePackageEmailBody } from './billingInvoicePackageEmailBody';

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

describe('billingNfseDanfseNt008', () => {
  it('gera PDF NT 008 a partir do XML mínimo', async () => {
    const result = await generateDanfsePdfNt008({ nfseXml: MINIMAL_NFSE_XML });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.source, 'nt008_local');
    assert.ok(result.pdf.length > 500);
    assert.equal(result.pdf.subarray(0, 4).toString('utf8'), '%PDF');
  });

  it('falha com MISSING_XML', async () => {
    const result = await generateDanfsePdfNt008({ nfseXml: '' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'MISSING_XML');
  });

  it('resolveDanfsePdfBuffer prefere NT 008 sobre ADN quando há XML', async () => {
    const fakeAdn = Buffer.from('%PDF-1.4 fake-adn-content-xxxxxxxxxx');
    const resolved = await resolveDanfsePdfBuffer({
      adnPdf: fakeAdn,
      nfseXml: MINIMAL_NFSE_XML,
    });
    assert.equal(resolved?.source, 'nt008_local');
    assert.ok(resolved && resolved.pdf !== fakeAdn);
  });

  it('documenta gaps de layout', () => {
    assert.ok(DANFSE_NT008_LAYOUT_GAPS.length >= 3);
  });

  it('smoke DELTA XML em tmp (se existir)', async () => {
    if (!existsSync(deltaXmlPath)) {
      return;
    }
    const xml = readFileSync(deltaXmlPath);
    const result = await generateDanfsePdfNt008({ nfseXml: xml });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.pdf.subarray(0, 4).toString('utf8'), '%PDF');
    assert.ok(result.pdf.length > 1000);
  });
});

describe('billingInvoicePackageEmail body', () => {
  it('monta assunto e link HTML', () => {
    const body = buildInvoicePackageEmailBody({
      pharmacyName: 'DELTA FARMA',
      cycleLabel: '2026-08-17 a 2026-08-23',
      invoiceHtmlUrl: 'https://app.example/public/billing/tok123',
      entityLabel: 'Flux Farma',
    });
    assert.match(body.subject, /DELTA FARMA/);
    assert.match(body.html, /public\/billing\/tok123/);
    assert.match(body.html, /Abrir fatura/);
    assert.match(body.text, /boleto/);
  });
});
