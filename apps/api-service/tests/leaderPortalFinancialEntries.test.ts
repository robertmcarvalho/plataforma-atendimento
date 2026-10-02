import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveLeaderEntryStatus } from '../src/lib/leaderPortalFinancialEntries.ts';

describe('deriveLeaderEntryStatus', () => {
  it('maps pending approval', () => {
    assert.equal(
      deriveLeaderEntryStatus({ type: 'daily', status: 'pending_approval' }, [
        { id: '1', due_date: '2026-07-28', amount: 100, status: 'pending', paid_at: null },
      ]),
      'pending_approval',
    );
  });

  it('maps overdue installment', () => {
    assert.equal(
      deriveLeaderEntryStatus({ type: 'daily', status: 'active' }, [
        { id: '1', due_date: '2026-07-21', amount: 100, status: 'overdue', paid_at: null },
      ]),
      'overdue',
    );
  });

  it('maps cancelled', () => {
    assert.equal(
      deriveLeaderEntryStatus({ type: 'daily', status: 'cancelled' }, []),
      'cancelled',
    );
  });
});
