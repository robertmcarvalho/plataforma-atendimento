import {
  lookupConfiguredCityPrice,
  motorConfigMeta,
  resolveCommercialMotorConfig,
  type CommercialMotorConfig,
  type MotorConfigMeta,
  type MotorConfigPatch,
} from './commercialMotorConfig';
import { lookupCityDeliveryPrice } from './commercialCopilotTools';
import {
  buildDimensionamentoInputForSimulation,
  buildDimensionamentoInputFromLead,
  calcularDimensionamentoOperacional,
  type DimensionamentoInput,
  type DimensionamentoResultado,
} from './operationalDimensioning';

export type { CommercialMotorConfig, MotorConfigMeta, MotorConfigPatch };

export async function resolveLeadDeliveryPrice(
  workspaceId: string,
  city: string,
  state: string,
  motor: CommercialMotorConfig,
): Promise<{ valor_entrega: number | null; fonte: string }> {
  const configured = lookupConfiguredCityPrice(motor, city, state);
  if (configured != null) {
    return { valor_entrega: configured, fonte: 'config_cidade' };
  }
  const fromPharmacies = await lookupCityDeliveryPrice(workspaceId, city, state);
  if (fromPharmacies.fonte === 'media_farmacias_cidade') {
    return { valor_entrega: fromPharmacies.valor_entrega, fonte: fromPharmacies.fonte };
  }
  return {
    valor_entrega: motor.financeiro.valor_entrega_padrao,
    fonte: fromPharmacies.fonte,
  };
}

export async function runLeadDimensioningWithConfig(
  workspaceId: string,
  lead: Record<string, unknown>,
  motorPatch?: MotorConfigPatch | null,
): Promise<{ dimensionamento: DimensionamentoResultado; motor: CommercialMotorConfig; meta: MotorConfigMeta }> {
  const motor = await resolveCommercialMotorConfig(workspaceId, motorPatch);
  const price = await resolveLeadDeliveryPrice(
    workspaceId,
    String(lead.city || ''),
    String(lead.state || ''),
    motor,
  );
  const input = buildDimensionamentoInputFromLead(lead, motor, {
    preco_cidade: price.valor_entrega,
    strict: true,
  });
  const dimensionamento = calcularDimensionamentoOperacional(input);
  return { dimensionamento, motor, meta: motorConfigMeta(motor) };
}

export async function simulateMotorDimensioning(params: {
  workspaceId: string;
  city: string;
  state: string;
  entregas_media_dia?: number;
  entregas_media_mes?: number;
  perfil_cidade?: DimensionamentoInput['perfil_cidade'];
  valor_entrega_informado?: number;
  motorPatch?: MotorConfigPatch | null;
}): Promise<{
  dimensionamento: DimensionamentoResultado;
  motor: CommercialMotorConfig;
  meta: MotorConfigMeta;
  preco_fonte: string;
}> {
  const motor = await resolveCommercialMotorConfig(params.workspaceId, params.motorPatch);
  const price = params.valor_entrega_informado
    ? { valor_entrega: params.valor_entrega_informado, fonte: 'informado' }
    : await resolveLeadDeliveryPrice(params.workspaceId, params.city, params.state, motor);

  const input = buildDimensionamentoInputForSimulation({
    city: params.city,
    state: params.state,
    motorConfig: motor,
    entregas_media_dia: params.entregas_media_dia,
    entregas_media_mes: params.entregas_media_mes,
    perfil_cidade: params.perfil_cidade,
    valor_entrega_informado: params.valor_entrega_informado,
    preco_cidade: price.valor_entrega,
  });

  return {
    dimensionamento: calcularDimensionamentoOperacional(input),
    motor,
    meta: motorConfigMeta(motor),
    preco_fonte: price.fonte,
  };
}

export function attachConfigToSnapshot<T extends DimensionamentoResultado>(
  dimensionamento: T,
  meta: MotorConfigMeta,
): T & MotorConfigMeta {
  return { ...dimensionamento, ...meta };
}
