import { describe, expect, it } from 'vitest';
import { isWithinWhatsAppMessagingWindow } from './messagingWindow';

describe('isWithinWhatsAppMessagingWindow', () => {
  it('returns false when there are no inbound messages', () => {
    expect(isWithinWhatsAppMessagingWindow([])).toBe(false);
    expect(
      isWithinWhatsAppMessagingWindow([{ direction: 'outbound', created_at: new Date().toISOString() }]),
    ).toBe(false);
  });

  it('returns true when last inbound is within 24h', () => {
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(
      isWithinWhatsAppMessagingWindow([
        { direction: 'outbound', created_at: recent },
        { direction: 'inbound', created_at: recent },
      ]),
    ).toBe(true);
  });

  it('returns false when last inbound is older than 24h', () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(isWithinWhatsAppMessagingWindow([{ direction: 'inbound', created_at: old }])).toBe(false);
  });
});
