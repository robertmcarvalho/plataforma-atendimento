import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addCivilDays,
  buildCoraEntryExternalId,
  coraCreatedAtToMovementDate,
  mapCoraEntryDirection,
  mapCoraStatementEntriesToImportRows,
  resolveCoraStatementSyncWindow,
  type CoraStatementEntry,
} from './billingCoraStatementMapper';
import {
  isCoraStatementSyncEnabled,
  isCoraStatementSyncWriteEnabled,
  coraStatementSyncEntities,
} from './billingCoraStatementFlags';
import { BillingCoraClient, BillingCoraClientError } from './billingCoraClient';

describe('billingCoraStatementMapper', () => {
  it('mapCoraEntryDirection CREDIT/UNBLOCK vs DEBIT/BLOCK', () => {
    assert.equal(mapCoraEntryDirection('CREDIT'), 'credit');
    assert.equal(mapCoraEntryDirection('UNBLOCK'), 'credit');
    assert.equal(mapCoraEntryDirection('DEBIT'), 'debit');
    assert.equal(mapCoraEntryDirection('BLOCK'), 'debit');
    assert.equal(mapCoraEntryDirection('OTHER'), null);
  });

  it('external_id prefer transaction.id then entry.id', () => {
    assert.equal(
      buildCoraEntryExternalId({ id: 'entry-1', transaction: { id: 'tx-9' } }),
      'cora:tx-9'
    );
    assert.equal(buildCoraEntryExternalId({ id: 'entry-1' }), 'cora:entry-1');
    assert.equal(buildCoraEntryExternalId({}), null);
  });

  it('converte createdAt UTC para data civil BRT', () => {
    // 2026-09-09 02:30 UTC = ainda 08/09 em BRT (UTC-3)
    const d = coraCreatedAtToMovementDate('2026-09-09T02:30:00.000Z');
    assert.equal(d, '2026-09-08');
    assert.equal(coraCreatedAtToMovementDate('2026-09-09'), '2026-09-09');
  });

  it('aceita offset curto Cora (+00 / -03)', () => {
    assert.equal(coraCreatedAtToMovementDate('2026-09-09T19:42:36+00'), '2026-09-09');
    // 2026-09-09 02:30-03 = 05:30Z → ainda 09/09 BRT
    assert.equal(coraCreatedAtToMovementDate('2026-09-09T02:30:00-03'), '2026-09-09');
  });

  it('mapCoraStatementEntriesToImportRows fixture JSON', () => {
    const entries: CoraStatementEntry[] = [
      {
        id: 'e1',
        type: 'CREDIT',
        amount: 15050,
        createdAt: '2026-09-08T15:00:00.000Z',
        transaction: { id: 'abc-ident', type: 'PIX', description: 'Recebimento PIX' },
        counterParty: { name: 'Cliente X' },
      },
      {
        id: 'e2',
        type: 'DEBIT',
        amount: 200,
        createdAt: '2026-09-09T12:00:00.000-03:00',
        transaction: { id: 'fee-1', type: 'FEE', description: 'Tarifa' },
      },
      {
        id: 'skip',
        type: 'UNKNOWN',
        amount: 10,
        createdAt: '2026-09-09T12:00:00.000Z',
      },
    ];
    const rows = mapCoraStatementEntriesToImportRows(entries);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].external_id, 'cora:abc-ident');
    assert.equal(rows[0].direction, 'credit');
    assert.equal(rows[0].amount_cents, 15050);
    assert.ok(rows[0].description?.includes('Recebimento PIX'));
    assert.equal(rows[1].external_id, 'cora:fee-1');
    assert.equal(rows[1].direction, 'debit');
    assert.equal(rows[1].movement_date, '2026-09-09');
  });

  it('dedupe ids estáveis entre reprocessamentos', () => {
    const entry = {
      id: 'e1',
      type: 'CREDIT' as const,
      amount: 100,
      createdAt: '2026-09-09T18:00:00.000-03:00',
      transaction: { id: 'stable-id' },
    };
    const a = mapCoraStatementEntriesToImportRows([entry]);
    const b = mapCoraStatementEntriesToImportRows([entry]);
    assert.equal(a[0].external_id, b[0].external_id);
    assert.equal(a[0].external_id, 'cora:stable-id');
  });

  it('janela overlap 3 dias + cursor piso', () => {
    const w1 = resolveCoraStatementSyncWindow({ today: '2026-09-09', lastSuccessfulEndDate: null });
    assert.deepEqual(w1, { start: '2026-09-07', end: '2026-09-09' });

    // Cursor recente: overlap curto
    const w2 = resolveCoraStatementSyncWindow({
      today: '2026-09-09',
      lastSuccessfulEndDate: '2026-09-08',
    });
    assert.deepEqual(w2, { start: '2026-09-07', end: '2026-09-09' });

    // Cursor atrasado: start = last_end - 1
    const w3 = resolveCoraStatementSyncWindow({
      today: '2026-09-09',
      lastSuccessfulEndDate: '2026-09-01',
    });
    assert.deepEqual(w3, { start: '2026-08-31', end: '2026-09-09' });

    assert.equal(addCivilDays('2026-09-01', -1), '2026-08-31');
  });
});

describe('billingCoraStatementSync flags', () => {
  it('defaults off', () => {
    const prevE = process.env.BILLING_CORA_STATEMENT_SYNC_ENABLED;
    const prevW = process.env.BILLING_CORA_STATEMENT_SYNC_WRITE;
    delete process.env.BILLING_CORA_STATEMENT_SYNC_ENABLED;
    delete process.env.BILLING_CORA_STATEMENT_SYNC_WRITE;
    assert.equal(isCoraStatementSyncEnabled(), false);
    assert.equal(isCoraStatementSyncWriteEnabled(), false);
    assert.deepEqual(coraStatementSyncEntities(), ['flux']);
    if (prevE === undefined) delete process.env.BILLING_CORA_STATEMENT_SYNC_ENABLED;
    else process.env.BILLING_CORA_STATEMENT_SYNC_ENABLED = prevE;
    if (prevW === undefined) delete process.env.BILLING_CORA_STATEMENT_SYNC_WRITE;
    else process.env.BILLING_CORA_STATEMENT_SYNC_WRITE = prevW;
  });
});

describe('BillingCoraClient statement/balance mocks', () => {
  it('getBalance + getStatementAll pagina', async () => {
    const calls: string[] = [];
    const client = new BillingCoraClient({
      environment: 'stage',
      clientId: 'int-mock',
      material: {
        certificatePem: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
        certificatePath: '/tmp/c.pem',
        privateKeyPath: '/tmp/k.key',
      },
      requestImpl: async (params) => {
        calls.push(`${params.method} ${params.url}`);
        if (params.url.endsWith('/token')) {
          return {
            status: 200,
            body: { access_token: 'tok', expires_in: 86400 },
            rawText: '{}',
          };
        }
        if (params.url.includes('/third-party/account/balance')) {
          return { status: 200, body: { balance: 99900 }, rawText: '{}' };
        }
        if (params.url.includes('/bank-statement/statement')) {
          const u = new URL(params.url);
          const page = Number(u.searchParams.get('page') || 1);
          if (page === 1) {
            return {
              status: 200,
              body: {
                entries: [
                  {
                    id: 'e1',
                    type: 'CREDIT',
                    amount: 100,
                    createdAt: '2026-09-09T12:00:00.000-03:00',
                    transaction: { id: 't1', description: 'Pix' },
                  },
                ],
                totalPages: 2,
                end: { balance: 99900 },
              },
              rawText: '{}',
            };
          }
          return {
            status: 200,
            body: { entries: [], totalPages: 2 },
            rawText: '{}',
          };
        }
        throw new BillingCoraClientError(`unexpected ${params.url}`);
      },
    });

    const bal = await client.getBalance();
    assert.equal(bal.balance, 99900);
    const all = await client.getStatementAll({ start: '2026-09-07', end: '2026-09-09', perPage: 200 });
    assert.equal(all.pages.length, 2);
    assert.equal(all.entries.length, 1);
    assert.ok(calls.some((c) => c.includes('/bank-statement/statement')));
  });
});
