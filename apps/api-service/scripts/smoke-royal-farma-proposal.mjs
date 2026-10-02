/**
 * Smoke: vars → DOCX preenchido (sem Gotenberg).
 */
async function main() {
  const { buildProposalDocumentVars } = await import('../src/lib/commercial/proposalDocumentVars.ts');
  const { fillProposalDocx } = await import('../src/lib/commercial/proposalDocxFill.ts');

  const d = {
    valor_entrega_utilizado: 5,
    custo_minimo_garantido_semana: 1000,
    quantidade_entregadores_recomendada: 1,
    quantidade_diarias_semana: 0,
    cenario_selecionado: 'enxuto',
    ponto_equilibrio_entregas_semana: 250,
    sugestao_comercial: 'Teste',
  };

  const v = buildProposalDocumentVars({
    lead: { trade_name: 'T', legal_name: 'R', cnpj: '12345678000199', contact_name: 'C' },
    dimensionamento: d,
    propostaComercial: { setup_cents: 1000000, setup_pagamento: 'a_vista' },
  });

  if (v.qt_entregas !== '200') {
    console.error('qt_entregas esperado 200, obteve', v.qt_entregas);
    process.exit(1);
  }

  const docx = fillProposalDocx(v);
  console.log('OK docx bytes', docx.length, 'qt_entregas', v.qt_entregas);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
