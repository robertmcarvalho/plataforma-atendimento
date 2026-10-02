import PDFDocument from 'pdfkit';
import type { DimensionamentoResultado } from './operationalDimensioning';

type ProposalPdfInput = {
  trade_name: string;
  legal_name?: string | null;
  city: string;
  state: string;
  contact_name: string;
  package_name: string;
  version: number;
  dimensionamento: DimensionamentoResultado;
  setup_cents: number;
  monthly_cents: number;
  generated_at?: Date;
};

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function brlFloat(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Gera PDF da proposta comercial (modelo Flux Farma). */
export function generateCommercialProposalPdf(input: ProposalPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const d = input.dimensionamento;
    const dateStr = (input.generated_at ?? new Date()).toLocaleDateString('pt-BR');

    doc.fontSize(10).fillColor('#666').text('FLUX FARMA · GESTÃO DE ENTREGAS PARA FARMÁCIAS', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(20).fillColor('#111').text('Proposta Comercial', { align: 'left' });
    doc.fontSize(11).fillColor('#444').text(`Versão ${input.version} · ${dateStr}`);
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#111').text('Dados do cliente', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333');
    doc.text(`Nome fantasia: ${input.trade_name}`);
    if (input.legal_name) doc.text(`Razão social: ${input.legal_name}`);
    doc.text(`Local: ${input.city}/${input.state}`);
    doc.text(`Contato: ${input.contact_name}`);
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#111').text(`Pacote: ${input.package_name}`, { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333');
    doc.text(`Mensalidade plataforma: ${brl(input.monthly_cents)}`);
    doc.text(`Taxa por entrega: ${brlFloat(d.valor_entrega_utilizado)}`);
    doc.moveDown(1);

    if (d.cenario_selecionado_titulo) {
      doc.fontSize(11).fillColor('#111').text(`Cenário escolhido: ${d.cenario_selecionado_titulo}`);
      doc.moveDown(0.5);
    }

    doc.fontSize(12).fillColor('#111').text('Custo operacional semanal', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333');
    const mg = d.custo_minimo_garantido_semana ?? 0;
    const diarias = d.custo_diarias_semana ?? 0;
    const totalFarmacia = d.custo_farmacia_semana ?? mg + diarias;
    doc.text(
      `Mínimo garantido (${d.quantidade_entregadores_recomendada} entregador(es)): ${brlFloat(mg)}`,
    );
    doc.text(`Diárias (${d.quantidade_diarias_semana}): ${brlFloat(diarias)}`);
    doc.text(`Total custo farmácia/semana: ${brlFloat(totalFarmacia)}`);
    if (d.modelo_cobranca === 'por_entrega') {
      doc.text(`Taxas potenciais/semana (volume atual): ${brlFloat(d.receita_semanal_estimada)}`);
    }
    if (d.modelo_cobranca) {
      doc.text(
        `Modelo de cobrança: ${d.modelo_cobranca === 'minimo_garantido' ? 'mínimo garantido' : 'por entrega'}`,
      );
    }
    if (d.margem_flux_semana != null) {
      doc.text(`Margem Flux (30%): ${brlFloat(d.margem_flux_semana)}/semana`);
    }
    if (d.margem_flux_mensal != null) {
      doc.text(`Margem Flux/mês: ${brlFloat(d.margem_flux_mensal)}`);
    }
    doc.text(`Valor lead (12m): ${brl(d.valor_lead_anual_cents)}`);
    doc.text(`Ponto de equilíbrio: ${d.ponto_equilibrio_entregas_dia} entregas/dia`);
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#111').text('Investimento inicial', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333');
    doc.text(`Setup: ${brl(input.setup_cents)}`);
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#111').text('Diagnóstico operacional', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333');
    doc.text(`Perfil da operação: ${d.perfil_operacao.replace(/_/g, ' ')}`);
    doc.text(`Entregas médias: ${d.entregas_media_dia}/dia · ${d.entregas_media_mes}/mês`);
    doc.text(`Horário considerado: ${d.horario_delivery_considerado}`);
    doc.text(`Entregadores recomendados: ${d.quantidade_entregadores_recomendada}`);
    doc.text(`Diárias/semana (cobertura): ${d.quantidade_diarias_semana}`);
    doc.text(`Viabilidade: ${d.classificacao_viabilidade.replace(/_/g, ' ')}`);
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#111').text('Escala sugerida', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333');
    doc.text(d.sugestao_escala.resumo);
    for (const t of d.sugestao_escala.turnos) doc.text(`• ${t}`);
    doc.text(d.sugestao_escala.folgas);
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#111').text('Recomendação comercial', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333').text(d.sugestao_comercial, { align: 'justify' });

    if (d.alertas.length) {
      doc.moveDown(1);
      doc.fontSize(11).fillColor('#b45309').text('Alertas');
      doc.fontSize(9).fillColor('#92400e');
      for (const a of d.alertas) doc.text(`⚠ ${a}`);
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#999').text(
      'Documento gerado automaticamente pela plataforma Flux Farma. Valores sujeitos a confirmação comercial e contrato.',
      { align: 'center' },
    );

    doc.end();
  });
}
