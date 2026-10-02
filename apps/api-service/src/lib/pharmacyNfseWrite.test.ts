import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingInvoiceApproveSelect,
  omitInvoiceNfseWriteColumns,
  omitPharmacyNfseWriteColumns,
} from './pharmacyNfseWrite';

describe('omitPharmacyNfseWriteColumns', () => {
  const prev = process.env.BILLING_NFSE_ENABLED;

  after(() => {
    if (prev === undefined) delete process.env.BILLING_NFSE_ENABLED;
    else process.env.BILLING_NFSE_ENABLED = prev;
  });

  it('remove ibge_city_code e municipal_registration quando NFS-e está off', () => {
    delete process.env.BILLING_NFSE_ENABLED;
    const out = omitPharmacyNfseWriteColumns({
      daily_billing_enabled: true,
      ibge_city_code: null,
      municipal_registration: null,
      trade_name: 'Farmácia Teste',
    });
    assert.equal('ibge_city_code' in out, false);
    assert.equal('municipal_registration' in out, false);
    assert.equal(out.daily_billing_enabled, true);
    assert.equal(out.trade_name, 'Farmácia Teste');
  });

  it('mantém colunas NFS-e quando BILLING_NFSE_ENABLED=true', () => {
    process.env.BILLING_NFSE_ENABLED = 'true';
    const out = omitPharmacyNfseWriteColumns({
      ibge_city_code: '3170206',
      municipal_registration: '123',
      daily_billing_enabled: true,
    });
    assert.equal(out.ibge_city_code, '3170206');
    assert.equal(out.municipal_registration, '123');
  });

  it('remove revenue_line do insert de fatura quando NFS-e está off', () => {
    delete process.env.BILLING_NFSE_ENABLED;
    const out = omitInvoiceNfseWriteColumns({
      workspace_id: 'ws',
      status: 'draft',
      revenue_line: 'delivery',
    });
    assert.equal('revenue_line' in out, false);
    assert.equal(out.status, 'draft');
  });

  it('SELECT de approve não pede revenue_line com NFS-e off', () => {
    delete process.env.BILLING_NFSE_ENABLED;
    const select = billingInvoiceApproveSelect();
    assert.equal(select.includes('revenue_line'), false);
    assert.equal(select.includes('billing_invoice_lines'), false);
    assert.ok(select.includes('due_date'));
  });

  it('SELECT de approve inclui revenue_line com NFS-e on', () => {
    process.env.BILLING_NFSE_ENABLED = 'true';
    const select = billingInvoiceApproveSelect();
    assert.ok(select.includes('revenue_line'));
    assert.ok(select.includes('billing_invoice_lines(metadata)'));
  });
});
