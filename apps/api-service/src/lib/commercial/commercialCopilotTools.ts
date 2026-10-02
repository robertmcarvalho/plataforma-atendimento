import { supabase } from '../supabase';
import type { GeminiFunctionDeclaration } from '@plataforma/ai-core';
import {
  buildDimensionamentoInputFromLead,
  calcularDimensionamentoOperacional,
  type DimensionamentoInput,
} from './operationalDimensioning';
import { isCommercialProposalsEnabled } from './commercialAuth';
import { resolveCommercialMotorConfig } from './commercialMotorConfig';
import { resolveLeadDeliveryPrice } from './commercialMotorRuntime';
import { buildLeadScoringResponse } from './scoring';

function obj(props: Record<string, unknown>, required?: string[]): Record<string, unknown> {
  const base: Record<string, unknown> = { type: 'OBJECT', properties: props };
  if (required?.length) base.required = required;
  return base;
}

const strOpt = { type: 'STRING' };

export const COMMERCIAL_COPILOT_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: 'get_commercial_lead_sheet',
    description: 'Ficha completa do lead comercial: dados, estágio, score, valor estimado e snapshot operacional.',
    parameters: obj({
      lead_id: { ...strOpt, description: 'UUID do lead comercial' },
    }, ['lead_id']),
  },
  {
    name: 'suggest_commercial_next_action',
    description: 'Sugere próxima ação comercial com base no estágio, temperatura, viabilidade e atividades recentes.',
    parameters: obj({
      lead_id: { ...strOpt, description: 'UUID do lead comercial' },
    }, ['lead_id']),
  },
  {
    name: 'calculate_operational_dimensioning',
    description:
      'Calcula dimensionamento operacional: entregadores, diárias, viabilidade financeira, escala e proposta textual.',
    parameters: obj({
      lead_id: strOpt,
      entregas_media_dia: { type: 'NUMBER' },
      perfil_cidade: { ...strOpt, description: 'pequena | media | grande' },
      valor_entrega_informado: { type: 'NUMBER' },
    }),
  },
  {
    name: 'get_city_delivery_price',
    description: 'Consulta taxa de entrega cadastrada para uma cidade (média das farmácias ativas).',
    parameters: obj({
      city: strOpt,
      state: strOpt,
    }, ['city', 'state']),
  },
];

export async function lookupCityDeliveryPrice(
  workspaceId: string,
  city: string,
  state: string,
): Promise<{ valor_entrega: number | null; fonte: string; amostra: number }> {
  const { data } = await supabase
    .from('pharmacies')
    .select('delivery_fee_cents, city, state')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');

  const cityKey = city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const uf = state.toUpperCase();
  const matches = (data || []).filter((p) => {
    const pc = String(p.city || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return String(p.state || '').toUpperCase() === uf && pc.includes(cityKey);
  });

  const fees = matches
    .map((p) => Number(p.delivery_fee_cents))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!fees.length) {
    const motor = await resolveCommercialMotorConfig(workspaceId);
    return {
      valor_entrega: motor.financeiro.valor_entrega_padrao,
      fonte: 'valor_padrao_global',
      amostra: 0,
    };
  }

  const avgCents = Math.round(fees.reduce((a, b) => a + b, 0) / fees.length);
  return { valor_entrega: avgCents / 100, fonte: 'media_farmacias_cidade', amostra: fees.length };
}

export async function executeCommercialCopilotTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: { workspaceId: string },
): Promise<unknown> {
  switch (name) {
    case 'get_commercial_lead_sheet':
      return getCommercialLeadSheet(String(rawArgs.lead_id || ''), ctx.workspaceId);
    case 'suggest_commercial_next_action':
      return suggestCommercialNextAction(String(rawArgs.lead_id || ''), ctx.workspaceId);
    case 'calculate_operational_dimensioning':
      return calculateOperationalDimensioningTool(rawArgs, ctx.workspaceId);
    case 'get_city_delivery_price':
      return lookupCityDeliveryPrice(
        ctx.workspaceId,
        String(rawArgs.city || ''),
        String(rawArgs.state || ''),
      );
    default:
      return { error: 'unknown_commercial_tool', name };
  }
}

async function getCommercialLeadSheet(leadId: string, workspaceId: string) {
  if (!leadId) return { error: 'lead_id_required' };
  const { data: lead, error } = await supabase
    .from('commercial_leads')
    .select('*, stage:commercial_pipeline_stages!stage_id(id, name, probability_pct, is_won, is_lost)')
    .eq('workspace_id', workspaceId)
    .eq('id', leadId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!lead) return { error: 'lead_not_found' };

  const stage = lead.stage as { name?: string; is_won?: boolean; is_lost?: boolean } | null;
  const scoring = buildLeadScoringResponse({
    ai_score: lead.ai_score,
    ai_score_set_at: lead.ai_score_set_at,
    ai_score_explanation: lead.ai_score_explanation,
    lead_temperature: lead.lead_temperature,
    updated_at: lead.updated_at,
    last_message_at: lead.last_message_at,
    tags: lead.tags,
    stage_is_won: stage?.is_won,
    stage_is_lost: stage?.is_lost,
  });

  return {
    lead: {
      id: lead.id,
      trade_name: lead.trade_name,
      city: lead.city,
      state: lead.state,
      stage: stage?.name,
      monthly_deliveries: lead.monthly_deliveries,
      deal_value_cents: lead.deal_value_cents,
      contact_name: lead.contact_name,
      phone: lead.phone,
    },
    scoring,
    operational_snapshot: lead.operational_snapshot ?? null,
  };
}

async function suggestCommercialNextAction(leadId: string, workspaceId: string) {
  const sheet = (await getCommercialLeadSheet(leadId, workspaceId)) as Record<string, unknown>;
  if (sheet.error) return sheet;

  const lead = sheet.lead as Record<string, unknown>;
  const scoring = sheet.scoring as { lead_temperature: string; is_stagnant: boolean };
  const stage = String(lead.stage || '').toLowerCase();
  const actions: string[] = [];

  if (scoring.is_stagnant) actions.push('Lead estagnado — agendar contato hoje ou registrar perda.');
  if (scoring.lead_temperature === 'frio') actions.push('Enviar mensagem de reengajamento com proposta de valor.');
  if (scoring.lead_temperature === 'quente' || scoring.lead_temperature === 'urgente') {
    actions.push('Priorizar follow-up e avançar estágio no funil.');
  }

  if (stage.includes('novo') || stage.includes('contato')) {
    actions.push('Qualificar volume de entregas, horários de delivery e ERP.');
  } else if (stage.includes('qualific') || stage.includes('reuni')) {
    actions.push('Agendar reunião de diagnóstico e rodar dimensionamento operacional.');
  } else if (stage.includes('diagn') || stage.includes('proposta')) {
    const proposalsEnabled = await isCommercialProposalsEnabled(workspaceId);
    if (proposalsEnabled) {
      actions.push('Gerar proposta PDF com dimensionamento e enviar via WhatsApp comercial.');
    } else {
      actions.push('Revisar dimensionamento aprovado e avançar estágio no funil.');
    }
  } else if (stage.includes('negoci')) {
    actions.push('Endereçar objeções de preço/mínimo garantido com simulação financeira.');
  } else if (stage.includes('contrato')) {
    actions.push('Enviar link de preenchimento de dados contratuais e validar checklist.');
  }

  if (!actions.length) actions.push('Revisar ficha, atualizar notas e definir próximo passo com prazo.');

  return { lead_id: leadId, stage: lead.stage, temperature: scoring.lead_temperature, next_actions: actions };
}

async function calculateOperationalDimensioningTool(
  rawArgs: Record<string, unknown>,
  workspaceId: string,
) {
  let input: DimensionamentoInput;

  if (rawArgs.lead_id) {
    const { data: lead } = await supabase
      .from('commercial_leads')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', String(rawArgs.lead_id))
      .maybeSingle();
    if (!lead) return { error: 'lead_not_found' };

    const motor = await resolveCommercialMotorConfig(workspaceId);
    const price = await resolveLeadDeliveryPrice(
      workspaceId,
      String(lead.city),
      String(lead.state),
      motor,
    );
    input = buildDimensionamentoInputFromLead(lead as Record<string, unknown>, motor, {
      preco_cidade: price.valor_entrega ?? undefined,
      entregas_media_dia:
        typeof rawArgs.entregas_media_dia === 'number' ? rawArgs.entregas_media_dia : undefined,
      perfil_cidade: rawArgs.perfil_cidade as DimensionamentoInput['perfil_cidade'],
      valor_entrega_informado:
        typeof rawArgs.valor_entrega_informado === 'number'
          ? rawArgs.valor_entrega_informado
          : price.valor_entrega ?? undefined,
    });
  } else {
    return { error: 'lead_id_required' };
  }

  const result = calcularDimensionamentoOperacional(input);
  return result;
}

export function isCommercialCopilotTool(name: string): boolean {
  return COMMERCIAL_COPILOT_TOOL_DECLARATIONS.some((d) => d.name === name);
}
