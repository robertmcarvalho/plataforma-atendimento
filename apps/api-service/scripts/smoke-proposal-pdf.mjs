/**
 * Smoke: preenche template → PDF via Gotenberg (requer docker compose up gotenberg -d).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const { buildProposalDocumentVars } = await import('../src/lib/commercial/proposalDocumentVars.ts');
  const { fillProposalDocx } = await import('../src/lib/commercial/proposalDocxFill.ts');
  const { convertProposalDocxToPdf, isGotenbergAvailable } = await import(
    '../src/lib/commercial/proposalDocxToPdf.ts'
  );

  if (!(await isGotenbergAvailable())) {
    console.error('Gotenberg indisponível. Rode: docker compose up gotenberg -d');
    process.exit(1);
  }

  const vars = buildProposalDocumentVars({
    lead: {
      trade_name: 'FARMACIA TESTE',
      legal_name: 'TESTE LTDA',
      cnpj: '12345678000199',
      contact_name: 'Maria',
    },
    dimensionamento: {
      valor_entrega_utilizado: 5,
      custo_minimo_garantido_semana: 1000,
      quantidade_entregadores_recomendada: 1,
      quantidade_diarias_semana: 0,
      cenario_selecionado: 'enxuto',
      ponto_equilibrio_entregas_semana: 200,
      sugestao_comercial: 'Teste smoke',
    },
  });

  const docx = fillProposalDocx(vars);
  const outDocx = path.join(root, 'assets', 'debug-smoke.docx');
  fs.writeFileSync(outDocx, docx);
  console.log('DOCX', outDocx, docx.length, 'bytes');

  const pdf = await convertProposalDocxToPdf(docx);
  const outPdf = path.join(root, 'assets', 'debug-smoke.pdf');
  fs.writeFileSync(outPdf, pdf);
  console.log('PDF', outPdf, pdf.length, 'bytes');
  if (pdf.length < 10_000) {
    console.error('PDF muito pequeno — possível falha');
    process.exit(1);
  }
  console.log('OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
