import { enrichLeadWithPharmacyDeliveryHours } from './deliveryScheduleToDimensioning';
import {
  buildDimensionamentoInputFromLead,
  calcularDimensionamentoOperacional,
  reconcileCenarioSelecionado,
  type CenarioOperacionalId,
  type DimensionamentoResultado,
} from './operationalDimensioning';
import { resolveCommercialMotorConfig, motorConfigMeta } from './commercialMotorConfig';
import { attachConfigToSnapshot, resolveLeadDeliveryPrice } from './commercialMotorRuntime';
import { lookupCityDeliveryPrice } from './commercialCopilotTools';
import { computeViability, type ViabilityResult } from './viability';
import { rehydrateOperationalSnapshot } from './commercialSnapshotFinance';
import { assertLeadOperationalReadiness, LeadOperationalNotReadyError } from './leadOperationalReadiness';

export type OperationalSnapshotStored = DimensionamentoResultado & {
  confirmed_at?: string | null;
  config_version?: number;
  config_hash?: string;
  config_applied_at?: string;
};

export type EnhancedViabilityResult = ViabilityResult & {
  dimensionamento: DimensionamentoResultado;
  valor_lead_anual_cents: number;
  dimensionamento_confirmed: boolean;
  config_version?: number;
  config_hash?: string;
  config_applied_at?: string;
};

export function isDimensionamentoConfirmed(snapshot: unknown): snapshot is OperationalSnapshotStored {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const s = snapshot as OperationalSnapshotStored;
  return Boolean(s.confirmed_at && s.perfil_operacao);
}

export async function computeEnhancedViability(
  workspaceId: string,
  lead: Record<string, unknown>,
  volumeOverride?: number,
): Promise<EnhancedViabilityResult> {
  const enrichedLead = await enrichLeadWithPharmacyDeliveryHours(workspaceId, lead);
  assertLeadOperationalReadiness(enrichedLead);

  const city = String(enrichedLead.city || '');
  const state = String(enrichedLead.state || '');
  const volume = volumeOverride ?? Number(enrichedLead.monthly_deliveries ?? 0) ?? 0;

  const motor = await resolveCommercialMotorConfig(workspaceId);
  const price = await resolveLeadDeliveryPrice(workspaceId, city, state, motor);
  const dimInput = buildDimensionamentoInputFromLead(enrichedLead, motor, {
    preco_cidade: price.valor_entrega,
    entregas_media_mes: volume > 0 ? volume : undefined,
    strict: true,
  });
  if (volume > 0 && dimInput.entregas_media_dia === 0) {
    dimInput.entregas_media_dia = Math.max(1, Math.round(volume / (6 * (52 / 12))));
  }

  const dimensionamentoRaw = calcularDimensionamentoOperacional(dimInput);
  const stored = enrichedLead.operational_snapshot as OperationalSnapshotStored | null | undefined;
  const previousCenario = stored?.cenario_selecionado as CenarioOperacionalId | null | undefined;
  reconcileCenarioSelecionado(dimensionamentoRaw, previousCenario);
  if (stored?.proposta_comercial) {
    dimensionamentoRaw.proposta_comercial = stored.proposta_comercial;
  }
  const dimensionamento = rehydrateOperationalSnapshot(dimensionamentoRaw);

  const aethera = await computeViability(
    workspaceId,
    city,
    state,
    volume || dimensionamento.entregas_media_mes,
    motor,
  );

  const estimated_drivers = Math.max(
    aethera.estimated_drivers,
    dimensionamento.quantidade_entregadores_recomendada,
  );

  let status = aethera.status;
  let summary = aethera.summary;

  if (dimensionamento.classificacao_viabilidade === 'nao_viavel') {
    status = 'inviavel';
    summary = `${summary} ${dimensionamento.sugestao_comercial}`;
  } else if (
    dimensionamento.classificacao_viabilidade === 'viavel_com_restricoes' &&
    status === 'viavel'
  ) {
    status = 'atencao';
    summary = `${summary} Viabilidade financeira com restrições — ${dimensionamento.perfil_operacao.replace(/_/g, ' ')}.`;
  } else if (dimensionamento.classificacao_viabilidade === 'viavel') {
    summary = `${summary} Dimensionamento: ${dimensionamento.quantidade_entregadores_recomendada} entregador(es), ${dimensionamento.quantidade_diarias_semana} diária(s)/semana.`;
  }

  const meta = motorConfigMeta(motor);

  return {
    ...aethera,
    status,
    summary,
    estimated_drivers,
    dimensionamento,
    valor_lead_anual_cents: dimensionamento.valor_lead_anual_cents,
    dimensionamento_confirmed: isDimensionamentoConfirmed(stored),
    config_version: meta.config_version,
    config_hash: meta.config_hash,
    config_applied_at: meta.config_applied_at,
  };
}

export { attachConfigToSnapshot } from './commercialMotorRuntime';
export { LeadOperationalNotReadyError } from './leadOperationalReadiness';
