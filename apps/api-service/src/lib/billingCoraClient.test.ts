import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCoraHostAllowedForEnvironment,
  coraBaseUrl,
  isBillingCoraEnabled,
  maskCoraClientId,
  resolveCoraEnvironment,
  validateCoraConfigPatch,
  BillingCoraConfigError,
} from './billingCoraConfig';
import {
  assertSafeSecretRef,
  coraMtlsEnvSuffix,
  defaultMtlsSecretRefForEntity,
  resolveCoraMtlsPaths,
} from './billingCoraSecrets';
import {
  buildCoraTokenFormBody,
  mapCoraInvoiceStatusToBankSlip,
  BillingCoraClient,
  BillingCoraClientError,
} from './billingCoraClient';
import { buildCoraInvoicePayload, BillingCoraBuilderError } from './billingCoraInvoiceBuilder';

describe('billingCoraConfig', () => {
  it('BILLING_CORA_ENABLED default false', () => {
    const prev = process.env.BILLING_CORA_ENABLED;
    delete process.env.BILLING_CORA_ENABLED;
    assert.equal(isBillingCoraEnabled(), false);
    if (prev === undefined) delete process.env.BILLING_CORA_ENABLED;
    else process.env.BILLING_CORA_ENABLED = prev;
  });

  it('resolveCoraEnvironment default stage', () => {
    assert.equal(resolveCoraEnvironment(null), 'stage');
    assert.equal(coraBaseUrl('stage'), 'https://matls-clients.api.stage.cora.com.br');
    assert.equal(coraBaseUrl('production'), 'https://matls-clients.api.cora.com.br');
  });

  it('recusa host de produção em ambiente stage', () => {
    assert.throws(
      () =>
        assertCoraHostAllowedForEnvironment(
          'stage',
          'https://matls-clients.api.cora.com.br/token'
        ),
      /PROIBIDO/
    );
  });

  it('maskCoraClientId não vaza valor completo', () => {
    const masked = maskCoraClientId('int-ABCDEFGHijklmnopQRSTUV');
    assert.ok(masked);
    assert.ok(!masked!.includes('ABCDEFGH'));
    assert.ok(masked!.startsWith('int-'));
    assert.ok(masked!.endsWith('STUV'));
  });

  it('validateCoraConfigPatch recusa secret_ref com traversal', () => {
    assert.throws(
      () => validateCoraConfigPatch({ mtls_secret_ref: '../etc/passwd' }),
      BillingCoraConfigError
    );
    const ok = validateCoraConfigPatch({ mtls_secret_ref: 'cora-flux-mtls', environment: 'stage' });
    assert.equal(ok.mtls_secret_ref, 'cora-flux-mtls');
  });

  it('validateCoraConfigPatch aceita termos do boleto', () => {
    const ok = validateCoraConfigPatch({
      fine_mode: 'rate',
      fine_rate: 2,
      interest_rate: 1,
      pix_qr_enabled: true,
      service_description_template: 'Fatura {{invoice_id}}',
    });
    assert.equal(ok.fine_rate, 2);
    assert.equal(ok.interest_rate, 1);
    assert.throws(
      () => validateCoraConfigPatch({ fine_rate: 101 }),
      BillingCoraConfigError
    );
  });
});

describe('billingCoraSecrets', () => {
  it('default refs Flux/Coop', () => {
    assert.equal(defaultMtlsSecretRefForEntity('flux'), 'cora-flux-mtls');
    assert.equal(defaultMtlsSecretRefForEntity('coop'), 'cora-coop-mtls');
  });

  it('assertSafeSecretRef e paths', () => {
    assert.equal(assertSafeSecretRef('cora-flux-mtls'), 'cora-flux-mtls');
    assert.throws(() => assertSafeSecretRef('a/b'), /inválido/);
    const paths = resolveCoraMtlsPaths('cora-flux-mtls', { secretsDir: 'C:\\tmp\\secrets' });
    assert.ok(paths.certificatePath.endsWith('certificate.pem'));
    assert.ok(paths.privateKeyPath.endsWith('private-key.key'));
  });

  it('paths mTLS por entidade: env por ref; env genérico só para Flux', () => {
    const keys = [
      'BILLING_CORA_CERT_PATH',
      'BILLING_CORA_KEY_PATH',
      'BILLING_CORA_CERT_PATH_CORA_COOP_MTLS',
      'BILLING_CORA_KEY_PATH_CORA_COOP_MTLS',
    ];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      assert.equal(coraMtlsEnvSuffix('cora-coop-mtls'), 'CORA_COOP_MTLS');
      process.env.BILLING_CORA_CERT_PATH = '/secrets/cora-cert/certificate.pem';
      process.env.BILLING_CORA_KEY_PATH = '/secrets/cora-key/private-key.key';
      delete process.env.BILLING_CORA_CERT_PATH_CORA_COOP_MTLS;
      delete process.env.BILLING_CORA_KEY_PATH_CORA_COOP_MTLS;

      const flux = resolveCoraMtlsPaths('cora-flux-mtls');
      assert.equal(flux.certificatePath, '/secrets/cora-cert/certificate.pem');

      const coopLocal = resolveCoraMtlsPaths('cora-coop-mtls', { secretsDir: 'C:\\tmp\\secrets' });
      assert.ok(coopLocal.certificatePath.includes('cora-coop-mtls'));
      assert.notEqual(coopLocal.certificatePath, flux.certificatePath);

      process.env.BILLING_CORA_CERT_PATH_CORA_COOP_MTLS = '/secrets/cora-coop-cert/certificate.pem';
      process.env.BILLING_CORA_KEY_PATH_CORA_COOP_MTLS = '/secrets/cora-coop-key/private-key.key';
      const coop = resolveCoraMtlsPaths('cora-coop-mtls');
      assert.equal(coop.certificatePath, '/secrets/cora-coop-cert/certificate.pem');
      assert.equal(coop.privateKeyPath, '/secrets/cora-coop-key/private-key.key');
      assert.equal(resolveCoraMtlsPaths('cora-flux-mtls').certificatePath, flux.certificatePath);
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });
});

describe('billingCoraClient', () => {
  it('buildCoraTokenFormBody', () => {
    const body = buildCoraTokenFormBody('int-example');
    assert.equal(body, 'grant_type=client_credentials&client_id=int-example');
  });

  it('mapCoraInvoiceStatusToBankSlip', () => {
    assert.equal(mapCoraInvoiceStatusToBankSlip('OPEN'), 'open');
    assert.equal(mapCoraInvoiceStatusToBankSlip('PAID'), 'paid');
    assert.equal(mapCoraInvoiceStatusToBankSlip('CANCELLED'), 'canceled');
  });

  it('getAccessToken + createInvoice com mock (sem rede)', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = new BillingCoraClient({
      environment: 'stage',
      clientId: 'int-mock',
      material: {
        certificatePem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
        certificatePath: '/tmp/c.pem',
        privateKeyPath: '/tmp/k.key',
      },
      requestImpl: async (params) => {
        calls.push({ url: params.url, method: params.method });
        if (params.url.endsWith('/token')) {
          return {
            status: 200,
            body: { access_token: 'tok-mock', expires_in: 86400, token_type: 'Bearer' },
            rawText: '{}',
          };
        }
        if (params.url.includes('/v2/invoices')) {
          assert.equal(params.headers?.Authorization, 'Bearer tok-mock');
          assert.ok(params.headers?.['Idempotency-Key']);
          return {
            status: 200,
            body: {
              id: 'inv_mock',
              status: 'OPEN',
              payment_options: {
                bank_slip: {
                  digitable: '23793...',
                  barcode: '23793',
                  our_number: '123',
                  url: 'https://example.com/boleto.pdf',
                },
              },
            },
            rawText: '{}',
          };
        }
        throw new Error(`unexpected url ${params.url}`);
      },
    });

    const token = await client.getAccessToken();
    assert.equal(token, 'tok-mock');
    const inv = await client.createInvoice(
      {
        code: 'inv-1',
        customer: {
          name: 'Farmácia Teste',
          document: { identity: '12345678000199', type: 'CNPJ' },
          address: {
            street: 'Rua A',
            number: '1',
            district: 'Centro',
            city: 'Uberlândia',
            state: 'MG',
            zip_code: '38400000',
          },
        },
        services: [{ name: 'Serviço', description: 'Desc', amount: 5000 }],
        payment_terms: { due_date: '2026-09-15' },
      },
      '550e8400-e29b-41d4-a716-446655440000'
    );
    assert.equal(inv.id, 'inv_mock');
    assert.equal(calls.length, 2);
  });

  it('cancelInvoice DELETE /v2/invoices/{id} com mock', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = new BillingCoraClient({
      environment: 'production',
      clientId: 'int-mock',
      material: {
        certificatePem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
        certificatePath: '/tmp/c.pem',
        privateKeyPath: '/tmp/k.key',
      },
      requestImpl: async (params) => {
        calls.push({ url: params.url, method: params.method });
        if (params.url.endsWith('/token')) {
          return {
            status: 200,
            body: { access_token: 'tok-mock', expires_in: 86400, token_type: 'Bearer' },
            rawText: '{}',
          };
        }
        if (params.method === 'DELETE' && params.url.includes('/v2/invoices/inv_to_cancel')) {
          assert.equal(params.headers?.Authorization, 'Bearer tok-mock');
          return { status: 204, body: null, rawText: '' };
        }
        throw new Error(`unexpected ${params.method} ${params.url}`);
      },
    });
    await client.cancelInvoice('inv_to_cancel');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, 'DELETE');
  });

  it('recusa Idempotency-Key inválida', async () => {
    const client = new BillingCoraClient({
      environment: 'stage',
      clientId: 'int-mock',
      material: {
        certificatePem: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
        certificatePath: '/tmp/c.pem',
        privateKeyPath: '/tmp/k.key',
      },
      requestImpl: async () => ({ status: 200, body: {}, rawText: '{}' }),
    });
    await assert.rejects(
      () =>
        client.createInvoice(
          {
            code: 'x',
            customer: {
              name: 'A',
              document: { identity: '1', type: 'CNPJ' },
              address: {
                street: 's',
                number: '1',
                district: 'd',
                city: 'c',
                state: 'MG',
                zip_code: '38400000',
              },
            },
            services: [{ name: 'n', description: 'd', amount: 500 }],
            payment_terms: { due_date: '2026-09-15' },
          },
          'not-a-uuid'
        ),
      BillingCoraClientError
    );
  });
});

describe('billingCoraInvoiceBuilder', () => {
  const pharmacyOk = {
    cnpj: '12.345.678/0001-99',
    legal_name: 'Farmácia Exemplo LTDA',
    trade_name: 'Farmácia Exemplo',
    address_cep: '38400-000',
    address_street: 'Av. Brasil',
    address_number: '100',
    address_neighborhood: 'Centro',
    city: 'Uberlândia',
    state: 'MG',
    ibge_city_code: '3170206',
  };

  it('monta payload com defaults comerciais (multa 2%, juros 1% a.m., PIX)', () => {
    const payload = buildCoraInvoicePayload({
      invoiceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      totalCents: 15000,
      dueDate: '2026-09-20',
      pharmacy: pharmacyOk,
      cycleLabel: 'Semana 37',
    });
    assert.equal(payload.customer.document.identity, '12345678000199');
    assert.equal(payload.customer.document.type, 'CNPJ');
    assert.equal(payload.services[0].amount, 15000);
    assert.equal(payload.payment_terms.due_date, '2026-09-20');
    assert.equal(payload.code, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.deepEqual(payload.payment_terms.fine, { rate: 2 });
    assert.deepEqual(payload.payment_terms.interest, { rate: 1 });
    assert.deepEqual(payload.payment_forms, ['BANK_SLIP', 'PIX']);
    assert.ok(payload.services[0].description.includes('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
    assert.ok(payload.services[0].description.length <= 100);
    assert.ok(payload.services[0].name.includes('Semana 37'));
  });

  it('fine_mode=none omite fine; PIX off omite payment_forms', () => {
    const payload = buildCoraInvoicePayload({
      invoiceId: 'id-1',
      totalCents: 5000,
      dueDate: '2026-09-20',
      pharmacy: pharmacyOk,
      boletoTerms: {
        fine_mode: 'none',
        interest_rate: null,
        pix_qr_enabled: false,
        service_description_template: 'Desc custom {{cycle}}',
      },
      cycleLabel: 'C1',
    });
    assert.equal(payload.payment_terms.fine, undefined);
    assert.equal(payload.payment_terms.interest, undefined);
    assert.equal(payload.payment_forms, undefined);
    assert.equal(payload.services[0].description, 'Desc custom C1');
  });

  it('fine_mode=amount usa centavos; rate truncado a 2 casas', () => {
    const amountPayload = buildCoraInvoicePayload({
      invoiceId: 'id-2',
      totalCents: 5000,
      dueDate: '2026-09-20',
      pharmacy: pharmacyOk,
      boletoTerms: {
        fine_mode: 'amount',
        fine_amount_cents: 1500,
        interest_rate: 1.234,
        pix_qr_enabled: true,
      },
    });
    assert.deepEqual(amountPayload.payment_terms.fine, { amount: 1500 });
    assert.deepEqual(amountPayload.payment_terms.interest, { rate: 1.23 });

    const ratePayload = buildCoraInvoicePayload({
      invoiceId: 'id-3',
      totalCents: 5000,
      dueDate: '2026-09-20',
      pharmacy: pharmacyOk,
      boletoTerms: { fine_mode: 'rate', fine_rate: 2.5, interest_rate: 0 },
    });
    assert.deepEqual(ratePayload.payment_terms.fine, { rate: 2.5 });
    assert.equal(ratePayload.payment_terms.interest, undefined);
  });

  it('trunca description em 100 chars (limite Cora)', () => {
    const long = 'X'.repeat(150);
    const payload = buildCoraInvoicePayload({
      invoiceId: 'id-4',
      totalCents: 5000,
      dueDate: '2026-09-20',
      pharmacy: pharmacyOk,
      boletoTerms: { service_description_template: long },
    });
    assert.equal(payload.services[0].description.length, 100);
  });

  it('recusa valor abaixo do mínimo', () => {
    assert.throws(
      () =>
        buildCoraInvoicePayload({
          invoiceId: 'id',
          totalCents: 499,
          dueDate: '2026-09-20',
          pharmacy: pharmacyOk,
        }),
      BillingCoraBuilderError
    );
  });

  it('recusa farmácia sem CNPJ', () => {
    assert.throws(
      () =>
        buildCoraInvoicePayload({
          invoiceId: 'id',
          totalCents: 5000,
          dueDate: '2026-09-20',
          pharmacy: { ...pharmacyOk, cnpj: '123' },
        }),
      /CNPJ/
    );
  });
});
