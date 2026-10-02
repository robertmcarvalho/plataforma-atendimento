import { DEFAULT_MOTOR_CONFIG } from '../dist/lib/commercial/commercialMotorConfigCore.js';
import { calcularDimensionamentoOperacional } from '../dist/lib/commercial/operationalDimensioning.js';

const entregasDia = Math.max(1, Math.round(200 / (6 * (52 / 12))));
const r = calcularDimensionamentoOperacional({
  cidade: 'Lead',
  estado: 'MG',
  entregas_media_dia: entregasDia,
  entregas_media_mes: 200,
  horario_seg_sex_inicio: '08:00',
  horario_seg_sex_fim: '22:00',
  horario_sabado_inicio: '08:00',
  horario_sabado_fim: '22:00',
  horario_domingo_inicio: '08:00',
  horario_domingo_fim: '20:00',
  delivery_funciona_seg_sex: true,
  delivery_funciona_sabado: true,
  delivery_funciona_domingo: true,
  delivery_hours_informed: true,
  perfil_cidade: 'grande',
  tipo_operacao: 'simulacao',
  motor_config: { ...DEFAULT_MOTOR_CONFIG },
});

console.log(JSON.stringify({
  entregas_dia: entregasDia,
  perfil: r.perfil_operacao,
  entregadores: r.quantidade_entregadores_recomendada,
  diarias: r.quantidade_diarias_semana,
  dias_semana: r.dias_funcionamento_semana,
  receita_sem: r.receita_semanal_estimada,
  custo_mg: r.custo_minimo_garantido_semana,
  custo_diarias: r.custo_diarias_semana,
  repasse: r.repasse_total_entregadores,
  margem_bruta: r.margem_bruta_estimada,
  viabilidade: r.classificacao_viabilidade,
  sugestao_comercial: r.sugestao_comercial,
  turnos: r.sugestao_escala.turnos,
  folgas: r.sugestao_escala.folgas,
  horario_sugerido: r.sugestao_escala.horario_sugerido,
  alertas: r.alertas,
}, null, 2));
