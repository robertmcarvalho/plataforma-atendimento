import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatSlaCountdown,
  formatSlaCountdownFromDeadline,
  formatSlaMinutes,
  formatSlaOverdue,
} from './formatSlaDuration';

describe('formatSlaCountdown', () => {
  it('formats long SLA as H:MM', () => {
    const ms = (31 * 60 + 19) * 60 * 1000;
    assert.equal(formatSlaCountdown(ms), '31:19');
  });

  it('formats sub-hour as M:SS', () => {
    assert.equal(formatSlaCountdown(45 * 60 * 1000 + 30 * 1000), '45:30');
  });

  it('formats overdue as +H:MM', () => {
    const overdue = -((2 * 60 + 15) * 60 * 1000);
    assert.equal(formatSlaCountdown(overdue), '+2h15');
  });

  it('formats short overdue in minutes', () => {
    assert.equal(formatSlaCountdown(-5 * 60 * 1000), '+5min');
  });
});

describe('formatSlaCountdownFromDeadline', () => {
  it('returns --:-- without deadline', () => {
    assert.equal(formatSlaCountdownFromDeadline(null, Date.now()), '--:--');
  });

  it('computes from ISO deadline', () => {
    const now = Date.parse('2026-05-22T10:00:00.000Z');
    const deadline = '2026-05-23T17:19:00.000Z';
    assert.equal(formatSlaCountdownFromDeadline(deadline, now), '31:19');
  });
});

describe('formatSlaOverdue', () => {
  it('uses hours for long overdue', () => {
    assert.equal(formatSlaOverdue(-135 * 60 * 1000), '+2h15');
  });
});

describe('formatSlaMinutes', () => {
  it('formats hours', () => {
    assert.equal(formatSlaMinutes(480), '8h00');
  });

  it('formats days', () => {
    assert.equal(formatSlaMinutes(2880), '2d');
  });

  it('formats minutes', () => {
    assert.equal(formatSlaMinutes(25), '25min');
  });
});
