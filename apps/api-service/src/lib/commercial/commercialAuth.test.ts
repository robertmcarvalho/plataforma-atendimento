import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('commercialAuth boolean parsing', () => {
  it('isCommercialProposalsEnabled defaults false when setting absent', async () => {
    const { isCommercialProposalsEnabled } = await import('./commercialAuth');
    const enabled = await isCommercialProposalsEnabled('00000000-0000-0000-0000-000000000000');
    assert.equal(enabled, false);
  });
});
