import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import { DEFAULT_MOTOR_CONFIG } from './commercialMotorConfigCore';
import { injectMergeFieldDisplayValues } from './docxInjectFieldValues';
import { calcularDimensionamentoOperacional } from './operationalDimensioning';
import { proposalVarsToMergeTags, buildProposalDocumentVars } from './proposalDocumentVars';
import { slimDocxBuffer } from './proposalDocxSlim';

const templatePath = path.join(
  __dirname,
  '../../../assets/proposals/Proposta_Royal_Farma.v1.docx',
);

describe('injectMergeFieldDisplayValues', () => {
  it('preserva o run de fechamento do campo (XML válido)', () => {
    const template = slimDocxBuffer(fs.readFileSync(templatePath));
    const dimensionamento = calcularDimensionamentoOperacional({
      cidade: 'Belo Horizonte',
      estado: 'MG',
      entregas_media_dia: 20,
      horario_seg_sex_inicio: '10:00',
      horario_seg_sex_fim: '19:00',
      horario_sabado_inicio: '08:00',
      horario_sabado_fim: '12:00',
      delivery_funciona_seg_sex: true,
      delivery_funciona_sabado: true,
      delivery_funciona_domingo: false,
      perfil_cidade: 'media',
      tipo_operacao: 'simulacao',
      motor_config: { ...DEFAULT_MOTOR_CONFIG },
    });
    const vars = buildProposalDocumentVars({
      lead: { trade_name: 'FARMACIA TESTE', legal_name: 'LTDA', cnpj: '12345678000199', contact_name: 'A' },
      dimensionamento,
    });
    const xml = injectMergeFieldDisplayValues(
      new PizZip(template).file('word/document.xml')!.asText(),
      proposalVarsToMergeTags(vars),
    );
    assert.equal(xml.includes('</w:r>w:fldCharType="end"'), false);
    assert.equal(xml.includes('</w:r><w:rPr'), false);
    assert.match(xml, /<w:r[\s/>][^>]*>[\s\S]*?w:fldCharType="end"/);
    assert.ok(xml.includes('FARMACIA TESTE'));
  });
});
