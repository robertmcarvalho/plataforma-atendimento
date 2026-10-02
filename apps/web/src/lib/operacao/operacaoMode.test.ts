import { describe, expect, it } from 'vitest';
import { resolveOperacaoMode } from './operacaoMode';

describe('resolveOperacaoMode', () => {
  it('mantém Atendimento Geral global mesmo com farmácias vinculadas', () => {
    const mode = resolveOperacaoMode({
      role: 'attendant',
      sectorNames: ['Atendimento Geral'],
      sectorIds: ['ag-id'],
      sectors: [{ id: 'ag-id', name: 'Atendimento Geral' }],
      hasPortfolioPharmacies: true,
    });
    expect(mode).toBe('execucao_geral');
  });

  it('mantém execucao_geral sem carteira e só Atendimento Geral', () => {
    const mode = resolveOperacaoMode({
      role: 'attendant',
      sectorNames: ['Atendimento Geral'],
      hasPortfolioPharmacies: false,
    });
    expect(mode).toBe('execucao_geral');
  });

  it('prioriza financeiro quando setor primário é Financeiro', () => {
    const mode = resolveOperacaoMode({
      role: 'attendant',
      sectorNames: ['Financeiro'],
      primarySectorId: 'fin-id',
      sectors: [{ id: 'fin-id', name: 'Financeiro' }],
      hasPortfolioPharmacies: true,
    });
    expect(mode).toBe('execucao_financeiro');
  });

  it('abre gestor financeiro para papel financial', () => {
    expect(
      resolveOperacaoMode({
        role: 'financial',
        sectorNames: [],
      })
    ).toBe('gestor_financeiro');
  });

  it('abre gestor financeiro para supervisor só no setor Financeiro', () => {
    expect(
      resolveOperacaoMode({
        role: 'supervisor',
        sectorNames: ['Financeiro'],
      })
    ).toBe('gestor_financeiro');
  });

  it('abre gestor financeiro para supervisor com setor primário Financeiro', () => {
    expect(
      resolveOperacaoMode({
        role: 'supervisor',
        sectorNames: ['Operacional', 'Financeiro'],
        primarySectorId: 'fin-id',
        sectors: [
          { id: 'op-id', name: 'Operacional' },
          { id: 'fin-id', name: 'Financeiro' },
        ],
      })
    ).toBe('gestor_financeiro');
  });

  it('mantém gestor operacional para supervisor com Operacional no escopo', () => {
    expect(
      resolveOperacaoMode({
        role: 'supervisor',
        sectorNames: ['Operacional', 'Financeiro'],
      })
    ).toBe('gestor_operacional');
  });
});
