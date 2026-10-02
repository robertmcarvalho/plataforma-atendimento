import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllDailyEntriesForExport } from './financialDailyXlsxExport';

type FakeQuery = {
  select: () => FakeQuery;
  eq: (col: string, val: unknown) => FakeQuery;
  in: (col: string, val: unknown) => FakeQuery;
  order: () => FakeQuery;
  range: (from: number, to: number) => Promise<{ data: Array<{ id: string }>; error: null }>;
};

function makeFakeDb(total: number) {
  const calls: Array<{ from: number; to: number }> = [];
  const db = {
    from() {
      const q: FakeQuery = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        in() {
          return q;
        },
        order() {
          return q;
        },
        async range(from, to) {
          calls.push({ from, to });
          const page = [];
          for (let i = from; i <= to && i < total; i += 1) {
            page.push({ id: `row-${i}` });
          }
          return { data: page, error: null };
        },
      };
      return q;
    },
  };
  return { db: db as never, calls };
}

describe('fetchAllDailyEntriesForExport', () => {
  it('paginates beyond the PostgREST 1000-row cap', async () => {
    const { db, calls } = makeFakeDb(1094);
    const rows = await fetchAllDailyEntriesForExport(db, 'ws', '*', {});
    assert.equal(rows.length, 1094);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { from: 0, to: 999 });
    assert.deepEqual(calls[1], { from: 1000, to: 1999 });
  });

  it('stops after a short first page', async () => {
    const { db, calls } = makeFakeDb(40);
    const rows = await fetchAllDailyEntriesForExport(db, 'ws', '*', {});
    assert.equal(rows.length, 40);
    assert.equal(calls.length, 1);
  });
});
