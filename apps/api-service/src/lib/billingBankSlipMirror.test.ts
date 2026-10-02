import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BillingBankSlipMirrorError,
  mirrorCoraBoletoPdfToStorage,
} from './billingBankSlipMirror';
import { bankSlipStoragePaths } from './billingBankSlipStorage';

describe('billingBankSlipMirror', () => {
  it('bankSlipStoragePaths é canônico', () => {
    assert.equal(
      bankSlipStoragePaths('ws-1', 'slip-2').boletoPdf,
      'ws-1/slip-2/boleto.pdf'
    );
  });

  it('reusa path existente sem fetch', async () => {
    const cached = Buffer.from('%PDF-1.4 cached');
    let fetched = false;
    const result = await mirrorCoraBoletoPdfToStorage({
      workspaceId: 'ws-1',
      bankSlipId: 'slip-2',
      pdfUrl: 'https://example.com/boleto.pdf',
      existingStoragePath: 'ws-1/slip-2/boleto.pdf',
      downloadPdf: async () => cached,
      fetchPdf: async () => {
        fetched = true;
        return Buffer.from('%PDF-new');
      },
      uploadPdf: async () => {
        throw new Error('não deveria upload');
      },
    });
    assert.equal(result.mirrored, false);
    assert.equal(result.pdf_storage_path, 'ws-1/slip-2/boleto.pdf');
    assert.equal(result.bytes, cached.length);
    assert.equal(fetched, false);
  });

  it('faz fetch + upload quando não há mirror', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake boleto content');
    const uploaded: Array<{ path: string; bytes: number }> = [];
    const result = await mirrorCoraBoletoPdfToStorage({
      workspaceId: 'ws-1',
      bankSlipId: 'slip-9',
      pdfUrl: 'https://cora.example/boleto.pdf',
      fetchPdf: async (url) => {
        assert.equal(url, 'https://cora.example/boleto.pdf');
        return pdf;
      },
      uploadPdf: async (path, buffer) => {
        uploaded.push({ path, bytes: buffer.length });
      },
      downloadPdf: async () => null,
    });
    assert.equal(result.mirrored, true);
    assert.equal(result.pdf_storage_path, 'ws-1/slip-9/boleto.pdf');
    assert.equal(result.bytes, pdf.length);
    assert.deepEqual(uploaded, [{ path: 'ws-1/slip-9/boleto.pdf', bytes: pdf.length }]);
  });

  it('falha sem pdf_url', async () => {
    await assert.rejects(
      () =>
        mirrorCoraBoletoPdfToStorage({
          workspaceId: 'ws',
          bankSlipId: 's',
          pdfUrl: null,
          fetchPdf: async () => Buffer.from('%PDF'),
          uploadPdf: async () => undefined,
        }),
      (err: unknown) =>
        err instanceof BillingBankSlipMirrorError && err.code === 'missing_pdf_url'
    );
  });

  it('rejeita payload que não é PDF', async () => {
    await assert.rejects(
      () =>
        mirrorCoraBoletoPdfToStorage({
          workspaceId: 'ws',
          bankSlipId: 's',
          pdfUrl: 'https://example.com/x',
          fetchPdf: async () => Buffer.from('<html>nope</html>'),
          uploadPdf: async () => undefined,
        }),
      (err: unknown) =>
        err instanceof BillingBankSlipMirrorError && err.code === 'cora_pdf_invalid'
    );
  });
});
