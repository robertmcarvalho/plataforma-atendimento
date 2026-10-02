import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECENT_ATTENDANT_REPLY_SKIP_CLOSING_MS,
  resolveClosingTextForPostResolve,
  shouldSkipClosingAfterAttendantReply,
} from './postResolveClosingPolicy';

describe('postResolveClosingPolicy', () => {
  it('resolveClosingTextForPostResolve — substitui texto de fila legado', () => {
    assert.equal(
      resolveClosingTextForPostResolve('Obrigado pelo contato. Em breve retornamos.'),
      'Atendimento encerrado. Obrigado pelo contato!'
    );
    assert.equal(
      resolveClosingTextForPostResolve('Atendimento encerrado. Obrigado!'),
      'Atendimento encerrado. Obrigado!'
    );
  });

  it('shouldSkipClosingAfterAttendantReply — atendente respondeu há pouco', () => {
    const now = Date.parse('2026-06-12T12:27:16.000Z');
    const lastOutbound = '2026-06-12T12:27:02.822Z';
    assert.equal(
      shouldSkipClosingAfterAttendantReply({
        attendantId: 'att-1',
        lastOutboundAt: lastOutbound,
        nowMs: now,
        windowMs: RECENT_ATTENDANT_REPLY_SKIP_CLOSING_MS,
      }),
      true
    );
  });

  it('shouldSkipClosingAfterAttendantReply — sem atendente ou outbound antigo', () => {
    const now = Date.parse('2026-06-12T12:27:16.000Z');
    assert.equal(
      shouldSkipClosingAfterAttendantReply({
        attendantId: null,
        lastOutboundAt: '2026-06-12T12:27:02.822Z',
        nowMs: now,
      }),
      false
    );
    assert.equal(
      shouldSkipClosingAfterAttendantReply({
        attendantId: 'att-1',
        lastOutboundAt: '2026-06-12T12:10:00.000Z',
        nowMs: now,
      }),
      false
    );
  });
});
