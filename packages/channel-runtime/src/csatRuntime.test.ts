import { describe, expect, it } from 'vitest';
import { parseCsatScore, parseCsatScoreFromMessage } from './csatRuntime';

describe('parseCsatScore', () => {
  it('parses list row id', () => {
    expect(parseCsatScore({ interactiveId: 'csat_4' })).toBe(4);
  });

  it('parses list row title', () => {
    expect(parseCsatScore({ text: '4 — Bom' })).toBe(4);
    expect(parseCsatScore({ text: '1 - Muito ruim' })).toBe(1);
  });

  it('parses interactive message payload', () => {
    expect(
      parseCsatScoreFromMessage({
        type: 'interactive',
        interactive: {
          type: 'list_reply',
          list_reply: { id: 'csat_5', title: '5 — Excelente' },
        },
      })
    ).toBe(5);
  });
});
