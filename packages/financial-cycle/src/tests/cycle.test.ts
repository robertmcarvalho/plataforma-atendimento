import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveDailyPaymentDate } from '../daily';
import { buildAbsenceApuracao, resolveAbsencePaymentDate } from '../absence';
import { matchesConferenceDate, isDailyExclusiveConferenceDay, isDailyPaymentConferenceDay } from '../conference';
import { generateInstallmentDueDates } from '../installments';
import { mergeDiscountRulesFromJson } from '../rules';
import type { DiscountRule } from '../types';

const defaultRules = mergeDiscountRulesFromJson(null);

describe('resolveAbsencePaymentDate', () => {
  it('evento 13/05 → pagamento 21/05 com quinta configurada', () => {
    const pay = resolveAbsencePaymentDate('2026-05-13', defaultRules.absence);
    assert.equal(pay, '2026-05-21');
    const ap = buildAbsenceApuracao('2026-05-13', defaultRules.absence);
    assert.equal(ap.apuracaoStart, '2026-05-11');
    assert.equal(ap.apuracaoEnd, '2026-05-17');
  });
});

describe('resolveDailyPaymentDate', () => {
  const dailyRule: DiscountRule = defaultRules.daily;

  it('quinta antes do corte paga na mesma quinta', () => {
    const created = new Date('2026-05-21T13:00:00.000Z');
    const pay = resolveDailyPaymentDate(created, dailyRule);
    assert.equal(pay, '2026-05-21');
  });

  it('quinta após corte paga na terça seguinte', () => {
    const created = new Date('2026-05-21T15:00:00.000Z');
    const pay = resolveDailyPaymentDate(created, dailyRule);
    assert.equal(pay, '2026-05-26');
  });

  it('quinta às 11:20 em São Paulo paga na terça seguinte', () => {
    const created = new Date('2026-06-18T14:20:13.000Z');
    const pay = resolveDailyPaymentDate(created, dailyRule);
    assert.equal(pay, '2026-06-23');
  });

  it('segunda antes do corte paga na terça da mesma semana', () => {
    const created = new Date('2026-07-20T13:00:00.000Z'); // 10:00 SP
    const pay = resolveDailyPaymentDate(created, dailyRule);
    assert.equal(pay, '2026-07-21');
  });

  it('segunda após o corte paga na quinta da mesma semana', () => {
    const created = new Date('2026-07-20T21:00:00.000Z'); // 18:00 SP
    const pay = resolveDailyPaymentDate(created, dailyRule);
    assert.equal(pay, '2026-07-23');
  });
});

describe('generateInstallmentDueDates', () => {
  it('adiantamento: 2 parcelas a partir de sábado 23/05 → quintas 28/05 e 04/06', () => {
    const rule = defaultRules.advance;
    const dates = generateInstallmentDueDates(rule, '2026-05-23', 2, 'weekly');
    assert.deepEqual(dates, ['2026-05-28', '2026-06-04']);
  });

  it('uniforme: 2 parcelas em ter e qui a partir de 18/05', () => {
    const rule = defaultRules.uniform;
    const dates = generateInstallmentDueDates(rule, '2026-05-18', 2, 'weekly');
    assert.deepEqual(dates, ['2026-05-19', '2026-05-21']);
  });
});

describe('matchesConferenceDate', () => {
  it('terça: só diária', () => {
    assert.equal(isDailyExclusiveConferenceDay(2, defaultRules), true);
    assert.equal(isDailyPaymentConferenceDay(2, defaultRules), true);
    assert.equal(isDailyPaymentConferenceDay(4, defaultRules), true);
    assert.equal(isDailyExclusiveConferenceDay(4, defaultRules), false);
    const created = new Date('2026-05-19T14:00:00.000Z');
    const payIso = resolveDailyPaymentDate(created, defaultRules.daily);
    const daily = {
      type: 'daily',
      created_at: created.toISOString(),
      start_date: payIso,
      financial_installments: [{ due_date: payIso }],
    };
    const bag = {
      type: 'bag',
      created_at: '2026-05-18T10:00:00.000Z',
      start_date: '2026-05-19',
      financial_installments: [{ due_date: '2026-05-19' }],
    };
    assert.equal(matchesConferenceDate(daily, payIso, defaultRules), true);
    assert.equal(matchesConferenceDate(bag, payIso, defaultRules), false);
  });
});
