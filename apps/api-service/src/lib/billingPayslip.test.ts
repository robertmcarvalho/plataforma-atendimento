import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayslipTemplateParameters,
  computePayslipTotals,
  dailyCentsFromSettlementLine,
  formatBrlCents,
  formatIsoDateBr,
  maskCpf,
  payslipTrackFromPayable,
  payslipWeekdayDate,
  resolvePayslipSupportPhone,
  weekOffsetLabel,
  weekdayLabel,
  type DriverPayslip,
} from './billingPayslipCore';

describe('billingPayslip', () => {
  it('total do ciclo inclui diárias e a quinta é o restante', () => {
    const totals = computePayslipTotals({
      thursdayPixCents: 114_033,
      dailiesCents: 14_000,
      dailiesPaidCents: 14_000,
    });
    assert.equal(totals.cycleTotalCents, 128_033);
    assert.equal(totals.thursdayPixCents, 114_033);
    assert.equal(totals.dailiesCents, 14_000);
    assert.equal(totals.dailiesPaidCents, 14_000);
  });

  it('diária zerada no acerto ainda conta via metadata excluded', () => {
    assert.equal(
      dailyCentsFromSettlementLine({
        kind: 'daily',
        driver_amount_cents: 0,
        metadata: { settlement_driver_amount_excluded_cents: 14000 },
      }),
      14000
    );
    assert.equal(dailyCentsFromSettlementLine({ kind: 'absence', driver_amount_cents: -100 }), 0);
  });

  it('mascara CPF e formata valores', () => {
    assert.equal(maskCpf('12345678909'), '***.***.***-09');
    assert.equal(formatIsoDateBr('2026-08-27'), '27/08/2026');
    assert.match(formatBrlCents(114033), /1\.140,33/);
    assert.equal(weekdayLabel(3), 'quarta');
    assert.equal(weekOffsetLabel(1), 'semana seguinte');
    assert.equal(payslipTrackFromPayable('financial_daily'), 'daily');
    assert.equal(payslipTrackFromPayable('cycle_settlement'), 'weekly');
  });

  it('Indiana offset 1: boleto quarta 26/08 e PIX quinta 27/08 após ciclo 16/08', () => {
    const cycleEnd = '2026-08-16';
    assert.equal(payslipWeekdayDate(cycleEnd, 3, 1), '2026-08-26');
    assert.equal(payslipWeekdayDate(cycleEnd, 4, 1), '2026-08-27');
    assert.equal(payslipWeekdayDate(cycleEnd, 4, 0), '2026-08-20');
  });

  it('telefone de suporte vem de app_settings ou fica vazio', () => {
    assert.equal(resolvePayslipSupportPhone('(11) 3000-1010'), '(11) 3000-1010');
    assert.equal(resolvePayslipSupportPhone({ phone: '1130001010' }), '1130001010');
    assert.equal(resolvePayslipSupportPhone(''), null);
    assert.equal(resolvePayslipSupportPhone(null), null);
  });

  it('template WhatsApp usa 5 variáveis na ordem documentada', () => {
    const payslip = {
      pix: { payment_date: '2026-08-27', amount_cents: 114_033, method: 'pix' },
      totals: { cycle_total_cents: 128_033, dailies_cents: 14_000 },
    } as DriverPayslip;
    const params = buildPayslipTemplateParameters(payslip, 'https://www.aetheraai.com.br/public/recibo/abc');
    assert.deepEqual(params, [
      '27/08/2026',
      formatBrlCents(128_033),
      formatBrlCents(14_000),
      formatBrlCents(114_033),
      'https://www.aetheraai.com.br/public/recibo/abc',
    ]);
    assert.equal(params.length, 5);
  });
});
