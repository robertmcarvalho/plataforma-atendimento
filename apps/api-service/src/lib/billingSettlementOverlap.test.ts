import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLinkActiveDays,
  findSameDayMgOverlaps,
  pickLatestLastWorkedAt,
  prorateCents,
  resolveOperationalLastDay,
  sumMgActiveDays,
} from './billingSettlementOverlap';

const cycle = { cycleStart: '2026-08-10', cycleEnd: '2026-08-16' };

describe('resolveOperationalLastDay', () => {
  it('usa last_worked_at do desligamento, não o ended_at do cadastro (Delta 17/08)', () => {
    assert.equal(
      resolveOperationalLastDay({
        cycleEnd: cycle.cycleEnd,
        lastWorkedAt: '2026-07-27',
        endedAt: '2026-08-17',
      }),
      '2026-07-27'
    );
  });

  it('cai para ended_at quando não há desligamento (Tânia 11/08)', () => {
    assert.equal(
      resolveOperationalLastDay({
        cycleEnd: cycle.cycleEnd,
        lastWorkedAt: null,
        endedAt: '2026-08-11',
      }),
      '2026-08-11'
    );
  });

  it('last_worked_at manda mesmo sem ended_at (vínculo ainda ativo no cadastro)', () => {
    assert.equal(
      resolveOperationalLastDay({
        cycleEnd: cycle.cycleEnd,
        lastWorkedAt: '2026-08-11',
        endedAt: null,
      }),
      '2026-08-11'
    );
  });

  it('inactive_at corta o último dia, sem zerar vigência anterior', () => {
    assert.equal(
      resolveOperationalLastDay({
        cycleEnd: cycle.cycleEnd,
        endedAt: null,
        inactiveAt: '2026-08-12',
      }),
      '2026-08-12'
    );
  });

  it('ignora last_worked_at de emprego anterior (antes do started_at)', () => {
    assert.equal(
      resolveOperationalLastDay({
        cycleEnd: cycle.cycleEnd,
        startedAt: '2026-08-10',
        lastWorkedAt: '2026-07-05',
        endedAt: null,
      }),
      cycle.cycleEnd
    );
  });
});

describe('computeLinkActiveDays', () => {
  it('Anderson 27/07 + ended_at 17/08 → 0 dias no ciclo 10–16/08', () => {
    const r = computeLinkActiveDays({
      ...cycle,
      lastWorkedAt: '2026-07-27',
      endedAt: '2026-08-17',
    });
    assert.equal(r.activeDays, 0);
  });

  it('Tânia ended_at 11/08 sem desligamento → 2/7', () => {
    const r = computeLinkActiveDays({
      ...cycle,
      startedAt: null,
      endedAt: '2026-08-11',
    });
    assert.equal(r.activeDays, 2);
    assert.equal(r.lastDay, '2026-08-11');
  });

  it('inactive_at no 3º dia gera 3/7, não zero', () => {
    const r = computeLinkActiveDays({
      ...cycle,
      inactiveAt: '2026-08-12',
    });
    assert.equal(r.activeDays, 3);
  });

  it('substituição seg→terça: 1/7 + 6/7 = 7/7', () => {
    const outgoing = computeLinkActiveDays({
      ...cycle,
      lastWorkedAt: '2026-08-10',
    });
    const incoming = computeLinkActiveDays({
      ...cycle,
      startedAt: '2026-08-11',
    });
    assert.equal(outgoing.activeDays, 1);
    assert.equal(incoming.activeDays, 6);
    assert.equal(sumMgActiveDays([outgoing, incoming]), 7);
  });

  it('lacuna terça: 1/7 + 5/7 = 6/7 e a loja não completa a semana', () => {
    const outgoing = computeLinkActiveDays({
      ...cycle,
      lastWorkedAt: '2026-08-10',
    });
    const incoming = computeLinkActiveDays({
      ...cycle,
      startedAt: '2026-08-12',
    });
    assert.equal(outgoing.activeDays, 1);
    assert.equal(incoming.activeDays, 5);
    assert.equal(sumMgActiveDays([outgoing, incoming]), 6);
  });
});

describe('findSameDayMgOverlaps', () => {
  it('alerta quando dois fixos coincidem no mesmo dia', () => {
    const hits = findSameDayMgOverlaps(
      [
        { driverId: 'out', startedAt: null, lastDay: '2026-08-11', activeDays: 2 },
        { driverId: 'in', startedAt: '2026-08-11', lastDay: '2026-08-16', activeDays: 6 },
      ],
      cycle.cycleStart
    );
    assert.equal(hits.length, 1);
  });

  it('lacuna sem overlap no mesmo dia não alerta', () => {
    const hits = findSameDayMgOverlaps(
      [
        { driverId: 'out', startedAt: null, lastDay: '2026-08-10', activeDays: 1 },
        { driverId: 'in', startedAt: '2026-08-12', lastDay: '2026-08-16', activeDays: 5 },
      ],
      cycle.cycleStart
    );
    assert.equal(hits.length, 0);
  });
});

describe('prorateCents', () => {
  it('MG 2/7 de 114000 = 32571', () => {
    assert.equal(prorateCents(114000, 2, 7), 32571);
  });
});

describe('pickLatestLastWorkedAt', () => {
  it('prefere desligamento concluído sobre solicitação aberta mais nova', () => {
    assert.equal(
      pickLatestLastWorkedAt([
        { lastWorkedAt: '2026-08-01', createdAt: '2026-08-17', preferred: false },
        { lastWorkedAt: '2026-07-27', createdAt: '2026-07-28', preferred: true },
      ]),
      '2026-07-27'
    );
  });
});
