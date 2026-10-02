import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadScoringResponse } from './scoring';

describe('buildLeadScoringResponse', () => {
  it('returns pending without persisted score', () => {
    const res = buildLeadScoringResponse({
      ai_score: null,
      ai_score_set_at: null,
      updated_at: new Date().toISOString(),
    });
    assert.equal(res.status, 'pending');
    assert.equal(res.is_pending, true);
    assert.equal(res.ai_score, null);
    assert.equal(res.lead_temperature, null);
  });

  it('never returns mock score 50 when unset', () => {
    const res = buildLeadScoringResponse({
      updated_at: new Date().toISOString(),
    });
    assert.notEqual(res.ai_score, 50);
    assert.equal(res.ai_score, null);
  });

  it('returns ready when ai_score_set_at is set', () => {
    const res = buildLeadScoringResponse({
      ai_score: 73,
      ai_score_set_at: new Date().toISOString(),
      ai_score_explanation: 'Lead respondeu rápido.',
      lead_temperature: 'quente',
      updated_at: new Date().toISOString(),
    });
    assert.equal(res.status, 'ready');
    assert.equal(res.ai_score, 73);
    assert.equal(res.lead_temperature, 'quente');
    assert.equal(res.explanation, 'Lead respondeu rápido.');
  });
});
