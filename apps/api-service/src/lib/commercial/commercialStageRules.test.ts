import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findDiagnosticoStage,
  isAtOrAfterDiagnostico,
  visibleTabsForLead,
} from './commercialStageRules';

const stages = [
  { id: 's0', name: 'Novo lead', sort_order: 0 },
  { id: 's1', name: 'Contato', sort_order: 1 },
  { id: 's2', name: 'Qualificação', sort_order: 2 },
  { id: 's3', name: 'Reunião', sort_order: 3 },
  { id: 's4', name: 'Diagnóstico', sort_order: 4 },
  { id: 's5', name: 'Proposta', sort_order: 5 },
];

describe('commercialStageRules', () => {
  it('finds Diagnóstico stage by name', () => {
    assert.equal(findDiagnosticoStage(stages)?.id, 's4');
  });

  it('hides Viabilidade tab before Diagnóstico', () => {
    const tabs = visibleTabsForLead('s2', stages);
    assert.ok(!tabs.includes('Viabilidade'));
  });

  it('shows Viabilidade from Diagnóstico onward', () => {
    assert.equal(isAtOrAfterDiagnostico('s4', stages), true);
    assert.ok(visibleTabsForLead('s5', stages).includes('Viabilidade'));
  });

  it('hides Proposta tab when proposals disabled', () => {
    const tabs = visibleTabsForLead('s5', stages, { proposalsEnabled: false });
    assert.ok(!tabs.includes('Proposta'));
    assert.ok(tabs.includes('Viabilidade'));
  });
});
