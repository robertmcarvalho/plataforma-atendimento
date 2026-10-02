'use client';

import { CheckCircle2, AlertTriangle, ChevronDown } from 'lucide-react';
import { BrCentsInput } from '@/components/form/BrCentsInput';
import { BrCurrencyInput } from '@/components/form/BrInputs';
import { FormControl, formControlClassName, formControlSizes, formTextareaClassName } from '@/components/form/FormControl';
import { formatDealValueCents } from '@/lib/commercial/commercialFormat';
import {
  custoFarmaciaFromSnapshot,
  isMinimoGarantido,
  margemFluxDisplay,
  valorLeadDisplayCents,
  cenarioShortLabel,
} from '@/lib/commercial/commercialFinanceDisplay';
import type {
  CommercialLead,
  CenarioOperacionalProposta,
  OperationalDimensioningResult,
  PropostaComercialSnapshot,
  ViabilityResult,
} from '@/lib/commercial/types';
import { commercialReviveSectionClassName } from '@/components/commercial/CommercialRevivePrimitives';
import { Button } from '@/components/ui/button';
import { reviveTableHeadRowClassName, reviveTableShellClassName } from '@/lib/reviveSurfaces';
import { cn } from '@/lib/utils';

const viabilitySectionClassName = commercialReviveSectionClassName;
const viabilityNestedPanelClassName = 'rounded-xl border border-border bg-background/40 p-4';

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function perfilCidadeLabel(raw: unknown): string {
  const v = String(raw || '');
  if (v === 'pequena') return 'Pequena';
  if (v === 'media') return 'Média';
  if (v === 'grande') return 'Grande';
  return '—';
}

function classificacaoLabel(raw: string): string {
  if (raw === 'viavel') return 'Viável';
  if (raw === 'viavel_com_restricoes') return 'Viável com restrições';
  if (raw === 'nao_viavel') return 'Inviável neste volume';
  return raw.replace(/_/g, ' ');
}

function modeloLabel(modelo?: string): string {
  if (modelo === 'minimo_garantido') return 'Mínimo garantido';
  if (modelo === 'por_entrega') return 'Por entrega';
  return '—';
}

function estruturaLabel(entregadores: number, diarias: number): string {
  const e = entregadores === 1 ? '1 entregador' : `${entregadores} entregadores`;
  const d = diarias === 1 ? '1 diária' : `${diarias} diárias`;
  return `${e} + ${d}`;
}

function custoFarmacia(c: {
  custo_farmacia_semana?: number;
  custo_minimo_garantido_semana?: number;
  custo_diarias_semana?: number;
}) {
  return custoFarmaciaFromSnapshot(c);
}

type Props = {
  viability: ViabilityResult;
  dimensionamento: OperationalDimensioningResult;
  lead?: CommercialLead;
  confirmed?: boolean;
  confirmedAt?: string | null;
  onSelectScenario?: (cenarioId: 'enxuto' | 'enxuto_domingo' | 'integral') => void;
  selectingScenario?: boolean;
  propostaComercial?: PropostaComercialSnapshot | null;
  onPropostaComercialChange?: (patch: Partial<PropostaComercialSnapshot>) => void;
  onSavePropostaComercial?: () => void;
  savingPropostaComercial?: boolean;
  proposalsEnabled?: boolean;
  minimoGarantidoOverride?: number | null;
  onMinimoGarantidoOverrideChange?: (value: number | null) => void;
  onMinimoGarantidoOverrideBlur?: () => void;
  taxaEntregaOverride?: number | null;
  onTaxaEntregaOverrideChange?: (value: number | null) => void;
  onTaxaEntregaOverrideBlur?: () => void;
};

export function CommercialDimensioningPreview({
  viability,
  dimensionamento,
  lead,
  confirmed,
  confirmedAt,
  onSelectScenario,
  selectingScenario,
  propostaComercial,
  onPropostaComercialChange,
  onSavePropostaComercial,
  savingPropostaComercial,
  proposalsEnabled = true,
  minimoGarantidoOverride,
  onMinimoGarantidoOverrideChange,
  onMinimoGarantidoOverrideBlur,
  taxaEntregaOverride,
  onTaxaEntregaOverrideChange,
  onTaxaEntregaOverrideBlur,
}: Props) {
  const d = dimensionamento;
  const custom = lead?.custom_fields || {};
  const selectedId = d.cenario_selecionado ?? null;
  const dual = (d.cenarios_alternativos?.length ?? 0) >= 2;
  const cenarios = d.cenarios_alternativos ?? [];
  const showPropostaComercial = proposalsEnabled && !confirmed;
  const canSavePropostaComercial = Boolean(selectedId || !dual);

  const setupPagamento = propostaComercial?.setup_pagamento ?? 'a_vista';

  return (
    <div className="space-y-4">
      <StatusBanner viability={viability} confirmed={confirmed} confirmedAt={confirmedAt} cenarioTitulo={d.cenario_selecionado_titulo} />

      {dual ? (
        <>
          <ScenarioComparisonTable
            cenarios={cenarios}
            selectedId={selectedId}
            confirmed={confirmed}
            onSelectScenario={onSelectScenario}
            selectingScenario={selectingScenario}
            receitaSemanal={d.receita_semanal_estimada}
          />
          <ScenarioOperationalSummary cenarios={cenarios} selectedId={selectedId} />
        </>
      ) : null}

      <SelectedScenarioBreakdown dimensionamento={d} />

      {d.financeiro_aplicado ? (
        <p className="text-xs text-muted-foreground">
          Mín. garantido aplicado:{' '}
          <span className="font-mono text-foreground">
            {brl(d.financeiro_aplicado.minimo_garantido_semanal)}
          </span>
          /entregador/sem
          {d.financeiro_fonte === 'regional' && d.financeiro_regional_key
            ? ` (perfil regional — ${d.financeiro_regional_key})`
            : d.financeiro_fonte === 'lead_override'
              ? ' (informado na ficha)'
              : ' (padrão do workspace)'}
          {' · '}
          Taxa aplicada:{' '}
          <span className="font-mono text-foreground">{brl(d.valor_entrega_utilizado)}</span>
          {typeof custom.valor_entrega_informado === 'number'
            ? ' (informada na ficha)'
            : d.financeiro_fonte === 'regional' && d.financeiro_regional_key
              ? ` (perfil regional — ${d.financeiro_regional_key})`
              : ' (padrão do workspace ou cidade)'}
        </p>
      ) : null}

      {!confirmed && (onMinimoGarantidoOverrideChange || onTaxaEntregaOverrideChange) ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {onMinimoGarantidoOverrideChange ? (
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Mínimo garantido informado (opcional, por entregador/semana)</span>
              <BrCurrencyInput
                value={minimoGarantidoOverride}
                onChange={onMinimoGarantidoOverrideChange}
                onBlur={onMinimoGarantidoOverrideBlur}
                className={cn(formControlClassName, formControlSizes.md, 'mt-1 max-w-xs')}
                placeholder="Herda do perfil regional ou workspace"
              />
            </label>
          ) : null}
          {onTaxaEntregaOverrideChange ? (
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Taxa de entrega informada (opcional, por entrega)</span>
              <BrCurrencyInput
                value={taxaEntregaOverride}
                onChange={onTaxaEntregaOverrideChange}
                onBlur={onTaxaEntregaOverrideBlur}
                className={cn(formControlClassName, formControlSizes.md, 'mt-1 max-w-xs')}
                placeholder="Herda do perfil regional ou workspace"
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {showPropostaComercial && onPropostaComercialChange ? (
        <section className={viabilitySectionClassName}>
          <h3 className="text-sm font-semibold">Proposta comercial</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {dual && !selectedId
              ? 'Informe o setup abaixo. Para salvar no lead, escolha um dos cenários na tabela acima.'
              : 'Informe o setup após escolher o cenário. Valores calculados pelo motor podem ser ajustados abaixo, se necessário.'}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="text-xs text-muted-foreground">Nome do pacote</span>
              <FormControl
                value={propostaComercial?.package_name ?? 'Pacote padrão'}
                onChange={(e) => onPropostaComercialChange({ package_name: e.target.value })}
                className="mt-1 px-2"
              />
            </label>
            <label className="text-sm">
              <span className="text-xs text-muted-foreground">Valor setup</span>
              <div className="mt-1">
                <BrCentsInput
                  value={propostaComercial?.sem_setup ? 0 : (propostaComercial?.setup_cents ?? 0)}
                  disabled={propostaComercial?.sem_setup}
                  onChange={(cents) =>
                    onPropostaComercialChange({
                      setup_cents: cents ?? 0,
                      sem_setup: false,
                    })
                  }
                  className="mt-1 px-2"
                />
              </div>
            </label>
            <fieldset className="text-sm sm:col-span-2">
              <legend className="text-xs text-muted-foreground">Pagamento do setup</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="setup_pagamento"
                    checked={setupPagamento === 'a_vista'}
                    disabled={propostaComercial?.sem_setup}
                    onChange={() => onPropostaComercialChange({ setup_pagamento: 'a_vista', setup_parcelas: null })}
                  />
                  À vista
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="setup_pagamento"
                    checked={setupPagamento === 'parcelado'}
                    disabled={propostaComercial?.sem_setup}
                    onChange={() =>
                      onPropostaComercialChange({ setup_pagamento: 'parcelado', setup_parcelas: propostaComercial?.setup_parcelas ?? 2 })
                    }
                  />
                  Parcelado
                </label>
              </div>
              {setupPagamento === 'parcelado' && !propostaComercial?.sem_setup ? (
                <label className="mt-2 block text-xs">
                  <span className="text-muted-foreground">Número de parcelas (mín. 2)</span>
                  <FormControl
                    type="number"
                    min={2}
                    max={24}
                    value={propostaComercial?.setup_parcelas ?? 2}
                    onChange={(e) =>
                      onPropostaComercialChange({
                        setup_parcelas: Math.max(2, Number(e.target.value) || 2),
                      })
                    }
                    inputSize="sm"
                    className="mt-1 w-24 px-2"
                  />
                </label>
              ) : null}
            </fieldset>
            <label className="flex items-end gap-2 text-sm">
              <input
                type="checkbox"
                checked={propostaComercial?.sem_setup ?? false}
                onChange={(e) =>
                  onPropostaComercialChange({
                    sem_setup: e.target.checked,
                    setup_cents: e.target.checked ? 0 : propostaComercial?.setup_cents ?? 0,
                  })
                }
                className="rounded border-input"
              />
              <span className="text-xs text-muted-foreground">Sem setup / isento</span>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="text-xs text-muted-foreground">O que inclui o setup (opcional)</span>
              <textarea
                value={propostaComercial?.setup_observacao ?? ''}
                onChange={(e) => onPropostaComercialChange({ setup_observacao: e.target.value })}
                rows={2}
                className={cn(formTextareaClassName, 'mt-1 px-2')}
              />
            </label>
          </div>

          <details className={cn('mt-3', viabilityNestedPanelClassName)}>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Ajustes comerciais (opcional)
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="text-xs text-muted-foreground">Valor lead override (12 meses)</span>
                <BrCurrencyInput
                  value={
                    propostaComercial?.valor_lead_override_cents != null
                      ? propostaComercial.valor_lead_override_cents / 100
                      : null
                  }
                  onChange={(v) =>
                    onPropostaComercialChange({
                      valor_lead_override_cents: v != null ? Math.round(v * 100) : null,
                    })
                  }
                  placeholder={formatDealValueCents(d.valor_lead_anual_cents)}
                  className={cn(formControlClassName, formControlSizes.md, 'mt-1 px-2')}
                />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="text-xs text-muted-foreground">Motivo do ajuste</span>
                <FormControl
                  value={propostaComercial?.override_motivo ?? ''}
                  onChange={(e) => onPropostaComercialChange({ override_motivo: e.target.value })}
                  className="mt-1 px-2"
                />
              </label>
            </div>
          </details>

          {onSavePropostaComercial ? (
            <Button
              type="button"
              size="xs"
              className="mt-3"
              onClick={onSavePropostaComercial}
              disabled={savingPropostaComercial || !canSavePropostaComercial}
              title={dual && !selectedId ? 'Selecione o Cenário A ou B antes de salvar' : undefined}
            >
              {savingPropostaComercial ? 'Salvando…' : 'Salvar proposta comercial'}
            </Button>
          ) : null}
        </section>
      ) : null}

      {!dual ? <SingleScenarioSummary dimensionamento={d} /> : null}

      <CollapsibleSection title="Dados informados na ficha">
        {lead ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Info label="Entregas/mês" value={lead.monthly_deliveries?.toLocaleString('pt-BR') ?? '—'} />
            <Info label="Perfil da cidade" value={perfilCidadeLabel(custom.perfil_cidade)} />
            <div className="sm:col-span-2">
              <Info label="Horários de delivery informados" value={d.horario_delivery_considerado ?? '—'} />
            </div>
            <Info label="Taxa por entrega" value={brl(d.valor_entrega_utilizado)} />
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Capacidade Flux Farma na região">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Info label="Líder disponível" value={viability.leader_available ? 'Sim' : 'Não'} />
          <Info label="Líderes na região" value={String(viability.leaders_in_city ?? '—')} />
          <Info label="Entregadores Flux Farma" value={String(viability.aethera_drivers_in_city ?? '—')} />
        </dl>
      </CollapsibleSection>

      {d.alertas.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
          {d.alertas.map((a) => (
            <li key={a}>⚠ {a}</li>
          ))}
        </ul>
      ) : null}

      <CollapsibleSection title="Texto completo da proposta" defaultOpen={false}>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{d.proposta_textual}</pre>
      </CollapsibleSection>
    </div>
  );
}

function StatusBanner({
  viability,
  confirmed,
  confirmedAt,
  cenarioTitulo,
}: {
  viability: ViabilityResult;
  confirmed?: boolean;
  confirmedAt?: string | null;
  cenarioTitulo?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        viability.status === 'viavel' && 'border-success/40 bg-success/5',
        viability.status === 'atencao' && 'border-warning/40 bg-warning/5',
        viability.status === 'inviavel' && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <p className="text-sm font-semibold">{classificacaoLabel(viability.status === 'inviavel' ? 'nao_viavel' : viability.status === 'atencao' ? 'viavel_com_restricoes' : 'viavel')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{viability.summary}</p>
      {confirmed ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Análise aprovada{confirmedAt ? ` em ${new Date(confirmedAt).toLocaleString('pt-BR')}` : ''}
          {cenarioTitulo ? ` · ${cenarioTitulo}` : ''}
        </p>
      ) : (
        <p className="mt-2 flex items-center gap-1 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5" />
          {cenarioTitulo
            ? `Cenário selecionado: ${cenarioTitulo} — salve a proposta comercial e aprove antes do PDF`
            : 'Escolha o cenário, informe o setup e aprove a análise antes de gerar o PDF'}
        </p>
      )}
    </div>
  );
}

function ScenarioComparisonTable({
  cenarios,
  selectedId,
  confirmed,
  onSelectScenario,
  selectingScenario,
  receitaSemanal,
}: {
  cenarios: CenarioOperacionalProposta[];
  selectedId: 'enxuto' | 'enxuto_domingo' | 'integral' | null;
  confirmed?: boolean;
  onSelectScenario?: (id: 'enxuto' | 'enxuto_domingo' | 'integral') => void;
  selectingScenario?: boolean;
  receitaSemanal: number;
}) {
  const cols = cenarios.slice(0, 3);
  if (cols.length < 2) return null;

  const anyPorEntrega = cols.some((c) => c.modelo_cobranca === 'por_entrega');

  const rows: { label: string; render: (c: CenarioOperacionalProposta) => string }[] = [
    { label: 'Horário', render: (c) => c.horario_delivery_considerado },
    {
      label: 'Estrutura',
      render: (c) => estruturaLabel(c.quantidade_entregadores_recomendada, c.quantidade_diarias_semana),
    },
    { label: 'Custo farmácia/semana', render: (c) => brl(custoFarmacia(c)) },
    ...(anyPorEntrega
      ? [
          {
            label: 'Taxas potenciais/semana',
            render: (c: CenarioOperacionalProposta) =>
              c.modelo_cobranca === 'por_entrega' ? brl(receitaSemanal) : '— (regime MG)',
          },
        ]
      : []),
    { label: 'Modelo de cobrança', render: (c) => modeloLabel(c.modelo_cobranca) },
    { label: 'Margem Flux (30%)', render: (c) => brl(margemFluxDisplay(c) || 0) },
    {
      label: 'Valor lead (12m)',
      render: (c) => formatDealValueCents(valorLeadDisplayCents(c) || undefined),
    },
    {
      label: 'Vai na proposta',
      render: (c) => (selectedId === c.id ? 'Sim — selecionado' : c.recomendado ? 'Sugerido' : 'Alternativa'),
    },
  ];

  return (
    <section className={cn(reviveTableShellClassName, 'overflow-x-auto')}>
      <h3 className="border-b border-border bg-surface px-4 py-3 text-sm font-semibold tracking-tight">
        Comparativo de cenários — escolha o que vai na proposta
      </h3>
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className={reviveTableHeadRowClassName}>
            <th className="px-3 py-2 font-medium"> </th>
            {cols.map((c) => (
              <th
                key={c.id}
                className={cn(
                  'px-3 py-2 font-medium',
                  selectedId === c.id && 'bg-primary/5 text-primary',
                )}
              >
                {cenarioShortLabel(c.id)}
                {c.recomendado ? ' · sugerido' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-border/60">
              <td className="px-3 py-2 text-xs text-muted-foreground">{row.label}</td>
              {cols.map((c) => (
                <td
                  key={c.id}
                  className={cn('px-3 py-2 font-medium', selectedId === c.id && 'bg-primary/5')}
                >
                  {row.render(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!confirmed && onSelectScenario ? (
        <div className="flex flex-wrap gap-2 border-t border-border p-3">
          {cols.map((c) => (
            <Button
              key={c.id}
              type="button"
              size="xs"
              disabled={selectingScenario || selectedId === c.id}
              onClick={() => onSelectScenario(c.id)}
              variant={selectedId === c.id ? 'secondary' : 'default'}
              className={selectedId === c.id ? 'bg-success/15 text-success hover:bg-success/20' : undefined}
            >
              {selectedId === c.id ? 'Selecionado' : `Usar ${cenarioShortLabel(c.id)}`}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ScenarioOperationalSummary({
  cenarios,
  selectedId,
}: {
  cenarios: CenarioOperacionalProposta[];
  selectedId: 'enxuto' | 'enxuto_domingo' | 'integral' | null;
}) {
  const cols = cenarios.slice(0, 3);
  if (cols.length < 2) return null;

  return (
    <section className={cn('grid gap-3', cols.length >= 3 ? 'lg:grid-cols-3' : 'sm:grid-cols-2')}>
      {cols.map((c) => (
        <div
          key={c.id}
          className={cn(
            'rounded-xl border border-border bg-surface p-4',
            selectedId === c.id && 'border-primary/40 bg-primary/5',
          )}
        >
          <h4 className="text-xs font-semibold">
            Resumo operacional — {cenarioShortLabel(c.id)}
            {c.recomendado ? ' · sugerido' : ''}
          </h4>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>
              • {c.quantidade_entregadores_recomendada} entregador
              {c.quantidade_entregadores_recomendada === 1 ? '' : 'es'} · {c.quantidade_diarias_semana}{' '}
              {c.quantidade_diarias_semana === 1 ? 'diária' : 'diárias'}/semana
            </li>
            <li>• Horário: {c.horario_delivery_considerado}</li>
            <li className="text-foreground/90">• {c.sugestao_comercial}</li>
          </ul>
        </div>
      ))}
    </section>
  );
}

function SelectedScenarioBreakdown({ dimensionamento }: { dimensionamento: OperationalDimensioningResult }) {
  const d = dimensionamento;
  const mg = d.custo_minimo_garantido_semana ?? 0;
  const diarias = d.custo_diarias_semana ?? 0;
  const total = custoFarmacia(d);
  const ent = d.quantidade_entregadores_recomendada;
  const diaCount = d.quantidade_diarias_semana;
  const isMg = isMinimoGarantido(d.modelo_cobranca);
  const margemSem = margemFluxDisplay(d);
  const valorLeadCents = valorLeadDisplayCents(d);

  return (
    <section className={viabilitySectionClassName}>
      <h3 className="text-sm font-semibold">
        Custo semanal — {d.cenario_selecionado_titulo ?? 'cenário aplicado'}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {isMg
          ? 'No mínimo garantido a farmácia paga MG + diárias de folguista. As taxas do volume atual não entram na cobrança nem na margem Flux.'
          : 'Cobrança por entrega quando o volume de taxas cobre a operação.'}
      </p>
      <dl className="mt-3 space-y-2 text-sm">
        <BreakdownRow
          label={`Mínimo garantido (${ent} × ${brl(ent > 0 ? mg / ent : mg)})`}
          value={brl(mg)}
        />
        <BreakdownRow label={`Diárias folguista (${diaCount} × ${brl(diaCount > 0 ? diarias / diaCount : diarias)})`} value={brl(diarias)} />
        <BreakdownRow label="Total custo farmácia/semana" value={brl(total)} strong />
        {!isMg ? (
          <BreakdownRow label="Taxas potenciais/semana (volume atual)" value={brl(d.receita_semanal_estimada)} muted />
        ) : null}
        <BreakdownRow label="Modelo de cobrança" value={modeloLabel(d.modelo_cobranca)} />
        <BreakdownRow
          label="Margem Flux (30%)"
          value={brl(margemSem)}
          hint={isMg ? '30% sobre o custo farmácia/semana' : '30% sobre as taxas cobradas'}
        />
        <BreakdownRow label="Valor lead (12m)" value={formatDealValueCents(valorLeadCents)} strong />
        {d.modelo_cobranca === 'minimo_garantido' && d.ponto_equilibrio_entregas_dia != null ? (
          <p className="text-xs text-muted-foreground">
            Com o volume atual, a cobrança permanece no mínimo garantido até ~{d.ponto_equilibrio_entregas_dia}{' '}
            entregas/dia.
          </p>
        ) : null}
      </dl>
      {d.sugestao_comercial ? (
        <p className="mt-3 text-xs text-muted-foreground">{d.sugestao_comercial}</p>
      ) : null}
    </section>
  );
}

function SingleScenarioSummary({ dimensionamento }: { dimensionamento: OperationalDimensioningResult }) {
  const d = dimensionamento;
  return (
    <section className={viabilitySectionClassName}>
      <h3 className="text-sm font-semibold">Resumo operacional</h3>
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        <Info label="Entregadores" value={String(d.quantidade_entregadores_recomendada)} />
        <Info label="Diárias/semana" value={String(d.quantidade_diarias_semana)} />
        <Info label="Viabilidade" value={classificacaoLabel(d.classificacao_viabilidade)} />
        <Info label="Horário considerado" value={d.horario_delivery_considerado ?? '—'} />
      </dl>
    </section>
  );
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className={cn(viabilitySectionClassName, 'p-0')} open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-medium">
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        {title}
      </summary>
      <div className="border-t border-border px-5 py-4">{children}</div>
    </details>
  );
}

function BreakdownRow({
  label,
  value,
  strong,
  muted,
  hint,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  hint?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', muted && 'text-muted-foreground')}>
      <div className="flex justify-between gap-3">
        <dt className="text-xs">{label}</dt>
        <dd className={cn('text-sm', strong && 'font-semibold')}>{value}</dd>
      </div>
      {hint ? <dd className="text-[10px] text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
