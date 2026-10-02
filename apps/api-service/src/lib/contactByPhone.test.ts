import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWaPhoneForStorage } from './contactByPhone';
import { waPhoneLookupVariants } from '@plataforma/channel-runtime';

describe('contactByPhone normalizeWaPhoneForStorage', () => {
  it('strips E.164 plus and keeps Brazil digits', () => {
    assert.equal(normalizeWaPhoneForStorage('+5531999887766'), '5531999887766');
  });

  it('prefixes 55 for national 11-digit mobiles', () => {
    assert.equal(normalizeWaPhoneForStorage('31999887766'), '5531999887766');
  });

  it('keeps already-canonical 55 numbers', () => {
    assert.equal(normalizeWaPhoneForStorage('5531999887766'), '5531999887766');
  });
});

describe('leader contact phone variants include legacy + prefix', () => {
  it('lookup variants cover with/without mobile 9', () => {
    const variants = waPhoneLookupVariants('+5532998001691');
    assert.ok(variants.includes('5532998001691'));
    assert.ok(variants.includes('553298001691'));
  });
});
