import { describe, expect, it } from 'vitest';
import { extractCopilotComposerText } from './extractCopilotComposerText';

describe('extractCopilotComposerText', () => {
  it('extrai apenas a secao de resposta sugerida', () => {
    const full = `## Resumo
Cliente pediu prazo.

## Dados encontrados
- Entregador ativo

## Resposta sugerida para o cliente

Olá! Vou verificar com a equipe e te retorno em breve.

## Alertas
Confirmar farmácia.`;

    expect(extractCopilotComposerText(full)).toBe(
      'Olá! Vou verificar com a equipe e te retorno em breve.'
    );
  });

  it('mantem texto curto sem secoes de analise', () => {
    expect(extractCopilotComposerText('Oi, tudo bem? Já estou verificando.')).toBe(
      'Oi, tudo bem? Já estou verificando.'
    );
  });
});
