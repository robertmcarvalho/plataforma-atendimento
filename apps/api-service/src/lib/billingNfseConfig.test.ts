import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSefinHostAllowedForEnvironment,
  buildSefinHttpsBaseUrl,
  defaultSecretRefForEntity,
  deliveryDefaultsForEntity,
  effectiveRevenueLine,
  isBillingNfseEnabled,
  isBillingNfseSaasEnabled,
  isSaasRevenueLine,
  normalizeIbgeCityCode,
  parseNfseRevenueLine,
  pickServiceProfile,
  resolveInvoiceRevenueLine,
  resolveNfseEnvironment,
  saasDefaultsForRevenueLine,
  validateCertificateMetadataPatch,
  validateIbgeCityCode,
  validateIssuerConfigPatch,
  validateServiceProfilePatch,
  BillingNfseConfigError,
} from './billingNfseConfig';
import { BILLING_NFSE_DEFAULTS, type BillingNfseServiceProfile } from './billingNfseTypes';
import { renderNfseDescriptionTemplate } from './billingNfseDpsBuilder';

describe('billingNfseConfig', () => {
  const prevEnabled = process.env.BILLING_NFSE_ENABLED;
  const prevSaas = process.env.BILLING_NFSE_SAAS_ENABLED;
  const prevForce = process.env.BILLING_NFSE_FORCE_PRODUCAO_RESTRITA;

  after(() => {
    if (prevEnabled === undefined) delete process.env.BILLING_NFSE_ENABLED;
    else process.env.BILLING_NFSE_ENABLED = prevEnabled;
    if (prevSaas === undefined) delete process.env.BILLING_NFSE_SAAS_ENABLED;
    else process.env.BILLING_NFSE_SAAS_ENABLED = prevSaas;
    if (prevForce === undefined) delete process.env.BILLING_NFSE_FORCE_PRODUCAO_RESTRITA;
    else process.env.BILLING_NFSE_FORCE_PRODUCAO_RESTRITA = prevForce;
  });

  it('BILLING_NFSE_ENABLED default false', () => {
    delete process.env.BILLING_NFSE_ENABLED;
    assert.equal(isBillingNfseEnabled(), false);
  });

  it('resolveNfseEnvironment default producao_restrita', () => {
    assert.equal(resolveNfseEnvironment(null), 'producao_restrita');
  });

  it('recusa host Sefin produção em ambiente restrita', () => {
    assert.throws(
      () => assertSefinHostAllowedForEnvironment('producao_restrita', 'https://sefin.nfse.gov.br/'),
      /PROIBIDO/
    );
  });

  it('aceita host produção restrita', () => {
    assert.doesNotThrow(() =>
      assertSefinHostAllowedForEnvironment(
        'producao_restrita',
        'sefin.producaorestrita.nfse.gov.br'
      )
    );
    assert.equal(
      buildSefinHttpsBaseUrl('producao_restrita'),
      'https://sefin.producaorestrita.nfse.gov.br'
    );
  });

  it('delivery defaults Coop ISS 3% e Flux SN', () => {
    const coop = deliveryDefaultsForEntity('coop');
    assert.equal(coop.ctn, '26.01.01');
    assert.equal(coop.nbs, '1.0702.00.00');
    assert.equal(coop.iss_rate_pct, 3);
    assert.equal(coop.simples_nacional, false);
    const flux = deliveryDefaultsForEntity('flux');
    assert.equal(flux.iss_rate_pct, null);
    assert.equal(flux.simples_nacional, true);
    assert.equal(flux.ibge_city_code, '3170206');
  });

  it('saas defaults CTN/NBS e templates distintos', () => {
    const monthly = saasDefaultsForRevenueLine('saas_monthly', 'flux');
    const perDelivery = saasDefaultsForRevenueLine('saas_per_delivery', 'flux');
    assert.equal(monthly.ctn, '010501');
    assert.equal(monthly.nbs, '1.1103.22.00');
    assert.equal(monthly.active, false);
    assert.equal(monthly.ctn, BILLING_NFSE_DEFAULTS.saas.ctn);
    assert.equal(monthly.nbs, BILLING_NFSE_DEFAULTS.saas.nbs);
    assert.match(monthly.description_template, /SaaS mensal/);
    assert.match(perDelivery.description_template, /SaaS por entrega/);
    assert.notEqual(monthly.description_template, perDelivery.description_template);
    assert.equal(monthly.iss_rate_pct, null);
    assert.equal(saasDefaultsForRevenueLine('saas_monthly', 'coop').iss_rate_pct, 3);
  });

  it('renderNfseDescriptionTemplate aplica placeholders SaaS', () => {
    const monthly = renderNfseDescriptionTemplate(
      BILLING_NFSE_DEFAULTS.saas.monthly_description_template,
      { pharmacy: 'Farmácia X', cycle_start: '01/08/2026', cycle_end: '31/08/2026' }
    );
    assert.match(monthly, /Farmácia X/);
    assert.match(monthly, /01\/08\/2026/);
    assert.match(monthly, /SaaS mensal/);
    const per = renderNfseDescriptionTemplate(
      BILLING_NFSE_DEFAULTS.saas.per_delivery_description_template,
      { pharmacy: 'Farmácia Y', cycle_start: '01/08/2026', cycle_end: '07/08/2026' }
    );
    assert.match(per, /SaaS por entrega/);
    assert.match(per, /Farmácia Y/);
  });

  it('pickServiceProfile com flag off usa delivery (legado)', () => {
    delete process.env.BILLING_NFSE_ENABLED;
    delete process.env.BILLING_NFSE_SAAS_ENABLED;
    const profiles = [
      {
        id: '1',
        workspace_id: 'w',
        issuer_config_id: 'i',
        revenue_line: 'saas_monthly',
        ctn: '010501',
        nbs: '1.1103.22.00',
        iss_rate_pct: null,
        description_template: 'x',
        active: true,
      },
      {
        id: '2',
        workspace_id: 'w',
        issuer_config_id: 'i',
        revenue_line: 'delivery',
        ctn: '26.01.01',
        nbs: '1.0702.00.00',
        iss_rate_pct: null,
        description_template: 'd',
        active: true,
      },
    ] as BillingNfseServiceProfile[];
    assert.equal(pickServiceProfile(profiles, 'saas_monthly')?.id, '2'); // flag off → delivery
    assert.equal(effectiveRevenueLine('saas_monthly'), 'delivery');
    assert.equal(pickServiceProfile(profiles, 'delivery')?.id, '2');
  });

  it('pickServiceProfile resolve SaaS com flags on', () => {
    process.env.BILLING_NFSE_ENABLED = 'true';
    process.env.BILLING_NFSE_SAAS_ENABLED = 'true';
    assert.equal(isBillingNfseSaasEnabled(), true);
    const profiles = [
      {
        id: '1',
        workspace_id: 'w',
        issuer_config_id: 'i',
        revenue_line: 'saas_per_delivery',
        ctn: '010501',
        nbs: '1.1103.22.00',
        iss_rate_pct: null,
        description_template: 'saas',
        active: true,
      },
      {
        id: '2',
        workspace_id: 'w',
        issuer_config_id: 'i',
        revenue_line: 'delivery',
        ctn: '26.01.01',
        nbs: '1.0702.00.00',
        iss_rate_pct: null,
        description_template: 'd',
        active: true,
      },
    ] as BillingNfseServiceProfile[];
    assert.equal(pickServiceProfile(profiles, 'saas_per_delivery')?.id, '1');
    assert.equal(pickServiceProfile(profiles, 'delivery')?.id, '2');
  });

  it('resolveInvoiceRevenueLine: coluna, metadata de linha e fallback', () => {
    process.env.BILLING_NFSE_ENABLED = 'true';
    process.env.BILLING_NFSE_SAAS_ENABLED = 'true';
    assert.equal(parseNfseRevenueLine('saas_monthly'), 'saas_monthly');
    assert.equal(parseNfseRevenueLine('nope'), null);
    assert.equal(resolveInvoiceRevenueLine({}), 'delivery');
    assert.equal(resolveInvoiceRevenueLine({ revenue_line: 'saas_monthly' }), 'saas_monthly');
    assert.equal(
      resolveInvoiceRevenueLine({
        lines: [{ metadata: { nfse_revenue_line: 'saas_per_delivery' } }],
      }),
      'saas_per_delivery'
    );
    assert.equal(resolveInvoiceRevenueLine({ fallback: 'saas_monthly' }), 'saas_monthly');
    delete process.env.BILLING_NFSE_SAAS_ENABLED;
    assert.equal(resolveInvoiceRevenueLine({ revenue_line: 'saas_monthly' }), 'delivery');
  });

  it('validateIbgeCityCode exige 7 dígitos', () => {
    assert.equal(validateIbgeCityCode('3170206'), null);
    assert.equal(normalizeIbgeCityCode('31.702-06'), '3170206');
    assert.match(validateIbgeCityCode('3170') || '', /7 dígitos/);
  });

  it('validateIssuerConfigPatch normaliza IBGE e IM', () => {
    const out = validateIssuerConfigPatch({
      ibge_city_code: '31.702-06',
      municipal_registration: '  123  ',
      dps_next_number: 10,
    });
    assert.equal(out.ibge_city_code, '3170206');
    assert.equal(out.municipal_registration, '123');
    assert.throws(() => validateIssuerConfigPatch({ dps_next_number: 0 }), BillingNfseConfigError);
  });

  it('validateServiceProfilePatch bloqueia ativar SaaS sem flag', () => {
    delete process.env.BILLING_NFSE_ENABLED;
    delete process.env.BILLING_NFSE_SAAS_ENABLED;
    assert.equal(isSaasRevenueLine('saas_monthly'), true);
    assert.throws(
      () => validateServiceProfilePatch('saas_monthly', { active: true }),
      /BILLING_NFSE_SAAS_ENABLED/
    );
    assert.doesNotThrow(() =>
      validateServiceProfilePatch('delivery', { active: true, ctn: '26.01.01', nbs: '1.0702.00.00' })
    );
  });

  it('validateServiceProfilePatch permite ativar SaaS com flags', () => {
    process.env.BILLING_NFSE_ENABLED = 'true';
    process.env.BILLING_NFSE_SAAS_ENABLED = 'true';
    assert.doesNotThrow(() => validateServiceProfilePatch('saas_monthly', { active: true }));
  });

  it('validateCertificateMetadataPatch recusa path traversal em secret_ref', () => {
    assert.throws(
      () => validateCertificateMetadataPatch({ secret_ref: '../etc/passwd' }),
      /secret_ref inválido/
    );
    const ok = validateCertificateMetadataPatch({ secret_ref: 'billing-nfse-coop-pfx' });
    assert.equal(ok.secret_ref, 'billing-nfse-coop-pfx');
    assert.equal(defaultSecretRefForEntity('flux'), 'billing-nfse-flux-pfx');
  });
});
