import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import { injectValuesIntoDocxZip } from '../src/lib/commercial/docxInjectFieldValues.ts';
import { proposalVarsToMergeTags, buildProposalDocumentVars } from '../src/lib/commercial/proposalDocumentVars.ts';

const templatePath = path.join('assets', 'proposals', 'Proposta_Royal_Farma.v1.docx');
const buf = fs.readFileSync(templatePath);

const d = {
  valor_entrega_utilizado: 5,
  custo_minimo_garantido_semana: 1000,
  quantidade_entregadores_recomendada: 1,
  quantidade_diarias_semana: 0,
  cenario_selecionado: 'enxuto',
  ponto_equilibrio_entregas_semana: 250,
  sugestao_comercial: 'Teste',
};
const vars = buildProposalDocumentVars({
  lead: { trade_name: 'FARMACIA TESTE XYZ', legal_name: 'TESTE LTDA', cnpj: '12345678000199', contact_name: 'Maria' },
  dimensionamento: d,
});
const tags = proposalVarsToMergeTags(vars);

const filled = injectValuesIntoDocxZip(new PizZip(buf), tags).generate({ type: 'nodebuffer' });
const filledXml = new PizZip(filled).file('word/document.xml')?.asText() ?? '';
const filledTexts = [...filledXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);

console.log('XML contém FARMACIA TESTE XYZ?', filledTexts.some((t) => t.includes('FARMACIA TESTE')));
console.log('XML ainda ROYAL FARMA?', filledTexts.some((t) => t === 'ROYAL FARMA'));

fs.writeFileSync('assets/debug-filled.docx', filled);
