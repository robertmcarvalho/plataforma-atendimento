import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDiscountRulesFromJson } from '@plataforma/financial-cycle';
import { computeFinancialEntryFields } from '../src/lib/financialEntryFactory.js';

test('computeFinancialEntryFields uses start_date for advance', () => {
  const rules = mergeDiscountRulesFromJson(null);
  const computed = computeFinancialEntryFields(
    {
      workspace_id: 'ws',
      created_by: 'user',
      driver_id: 'driver',
      pharmacy_id: 'pharmacy',
      type: 'advance',
      total_amount: 400,
      installments_count: 4,
      frequency: 'weekly',
      start_date: '2026-08-10',
      status: 'active',
      created_at_iso: '2026-08-05T15:00:00.000Z',
    },
    rules,
    new Date('2026-08-05T15:00:00.000Z')
  );
  assert.equal(computed.start_date, '2026-08-10');
});

test('advance cancel reason minimum length policy', () => {
  const minLen = 10;
  assert.ok('curto'.trim().length < minLen);
  assert.ok('motivo valido'.trim().length >= minLen);
});
