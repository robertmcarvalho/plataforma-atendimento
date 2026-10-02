'use client';

import { useEffect, useState } from 'react';
import { Play, Plus, Trash2 } from 'lucide-react';
import { CadastroField, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import { BrCurrencyInput } from '@/components/form/BrInputs';
import { FormControl, formControlClassName, formControlSizes, formControlTimeClassName } from '@/components/form/FormControl';
import { useMotorConfig, usePutMotorConfig, useSimulateMotorConfig } from '@/lib/commercial/useCommercialQueries';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import type { CommercialMotorConfig, MotorSimulateResponse } from '@/lib/commercial/commercialMotorTypes';
import { Button, buttonVariants } from '@/components/ui/button';
import { CommercialListSkeleton } from '@/components/commercial/CommercialSkeleton';
import { cn } from '@/lib/utils';

function NumInput({
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <FormControl
      inputSize="md"
      type="number"
      step={step}
      min={min}
      max={max}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function CommercialMotorSettingsPanel() {
  const { data, isLoading } = useMotorConfig();
  const putConfig = usePutMotorConfig();
  const simulate = useSimulateMotorConfig();

  const [draft, setDraft] = useState<CommercialMotorConfig | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [simCity, setSimCity] = useState('Belo Horizonte');
  const [simState, setSimState] = useState('MG');
  const [simVolume, setSimVolume] = useState('600');
  const [simResult, setSimResult] = useState<MotorSimulateResponse | null>(null);

  useEffect(() => {
    if (data?.config && !draft) {
      const cfg = structuredClone(data.config);
      if (!cfg.escala_operacional) {
        cfg.escala_operacional = {
          jornada_horas: 8,
          intervalo_horas: 1,
          janela_max_dupla_horas: 14,
          horario_default_seg_sex_inicio: '08:00',
          horario_default_seg_sex_fim: '22:00',
          sabado_delta_fim_horas: -2,
          domingo_default_inicio: '10:00',
          domingo_default_fim: '20:00',
          folguista_domingo_se_delivery_fechado: true,
          rotacao_domingo_min_entregadores: 3,
        };
      }
      setDraft(cfg);
    }
  }, [data, draft]);

  if (isLoading || !draft) return <CommercialListSkeleton rows={6} />;

  const patchFinanceiro = (key: keyof CommercialMotorConfig['financeiro'], value: number | null) => {
    setDraft({ ...draft, financeiro: { ...draft.financeiro, [key]: value ?? 0 } });
  };

  const moneyInputClass = cn(formControlClassName, formControlSizes.md);

  const save = async () => {
    setMsg(null);
    try {
      await putConfig.mutateAsync(draft);
      setMsg('Parâmetros do motor salvos.');
    } catch (e) {
      setMsg(apiErrorMessage(e));
    }
  };

  const runSimulate = async () => {
    setSimResult(null);
    try {
      const result = await simulate.mutateAsync({
        city: simCity.trim(),
        state: simState.trim().toUpperCase(),
        entregas_media_mes: Number(simVolume) || 0,
      });
      setSimResult(result);
    } catch (e) {
      setMsg(apiErrorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      {data?.is_default ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Usando parâmetros padrão da plataforma. Salve para personalizar este workspace.
        </p>
      ) : null}

      <CadastroSection title="Financeiro" desc="Valores base para dimensionamento e viabilidade.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CadastroField label="Valor entrega padrão">
            <BrCurrencyInput
              className={moneyInputClass}
              value={draft.financeiro.valor_entrega_padrao}
              onChange={(v) => patchFinanceiro('valor_entrega_padrao', v)}
            />
          </CadastroField>
          <CadastroField label="Mínimo garantido/semana">
            <BrCurrencyInput
              className={moneyInputClass}
              value={draft.financeiro.minimo_garantido_semanal}
              onChange={(v) => patchFinanceiro('minimo_garantido_semanal', v)}
            />
          </CadastroField>
          <CadastroField label="Repasse entregador/semana">
            <BrCurrencyInput
              className={moneyInputClass}
              value={draft.financeiro.repasse_entregador_semanal}
              onChange={(v) => patchFinanceiro('repasse_entregador_semanal', v)}
            />
          </CadastroField>
          <CadastroField label="Margem mínima/semana">
            <BrCurrencyInput
              className={moneyInputClass}
              value={draft.financeiro.margem_minima_semanal}
              onChange={(v) => patchFinanceiro('margem_minima_semanal', v)}
            />
          </CadastroField>
          <CadastroField label="Custo diária">
            <BrCurrencyInput
              className={moneyInputClass}
              value={draft.financeiro.custo_diaria}
              onChange={(v) => patchFinanceiro('custo_diaria', v)}
            />
          </CadastroField>
        </div>
      </CadastroSection>

      <CadastroSection title="Produtividade por perfil de cidade" desc="Entregas/dia por entregador.">
        <div className="grid gap-4 sm:grid-cols-3">
          <CadastroField label="Pequena">
            <NumInput
              value={draft.produtividade_por_cidade.pequena}
              onChange={(v) =>
                setDraft({ ...draft, produtividade_por_cidade: { ...draft.produtividade_por_cidade, pequena: v } })
              }
              min={1}
            />
          </CadastroField>
          <CadastroField label="Média">
            <NumInput
              value={draft.produtividade_por_cidade.media}
              onChange={(v) =>
                setDraft({ ...draft, produtividade_por_cidade: { ...draft.produtividade_por_cidade, media: v } })
              }
              min={1}
            />
          </CadastroField>
          <CadastroField label="Grande">
            <NumInput
              value={draft.produtividade_por_cidade.grande}
              onChange={(v) =>
                setDraft({ ...draft, produtividade_por_cidade: { ...draft.produtividade_por_cidade, grande: v } })
              }
              min={1}
            />
          </CadastroField>
        </div>
      </CadastroSection>

      <CadastroSection title="Viabilidade Aethera" desc="Limites de volume mensal e capacidade.">
        <div className="grid gap-4 sm:grid-cols-3">
          <CadastroField label="Entregas/entregador (mês)">
            <NumInput
              value={draft.viabilidade.entregas_por_entregador}
              onChange={(v) => setDraft({ ...draft, viabilidade: { ...draft.viabilidade, entregas_por_entregador: v } })}
              min={1}
            />
          </CadastroField>
          <CadastroField label="Volume baixo (alerta)">
            <NumInput
              value={draft.viabilidade.volume_baixo}
              onChange={(v) => setDraft({ ...draft, viabilidade: { ...draft.viabilidade, volume_baixo: v } })}
              min={0}
            />
          </CadastroField>
          <CadastroField label="Volume alto (alerta)">
            <NumInput
              value={draft.viabilidade.volume_alto}
              onChange={(v) => setDraft({ ...draft, viabilidade: { ...draft.viabilidade, volume_alto: v } })}
              min={1}
            />
          </CadastroField>
        </div>
      </CadastroSection>

      <CadastroSection
        title="Escala operacional"
        desc="Jornada padrão (8h + 1h intervalo), defaults de horário e regras de domingo."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CadastroField label="Jornada (h)">
            <NumInput
              value={draft.escala_operacional?.jornada_horas ?? 8}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  escala_operacional: { ...draft.escala_operacional!, jornada_horas: v },
                })
              }
              min={4}
              max={12}
            />
          </CadastroField>
          <CadastroField label="Intervalo (h)">
            <NumInput
              value={draft.escala_operacional?.intervalo_horas ?? 1}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  escala_operacional: { ...draft.escala_operacional!, intervalo_horas: v },
                })
              }
              step={0.5}
              min={0.5}
              max={3}
            />
          </CadastroField>
          <CadastroField label="Janela máx. 2 entregadores (h)">
            <NumInput
              value={draft.escala_operacional?.janela_max_dupla_horas ?? 14}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  escala_operacional: { ...draft.escala_operacional!, janela_max_dupla_horas: v },
                })
              }
              min={8}
              max={18}
            />
          </CadastroField>
          <CadastroField label="Default seg–sex início">
            <input
              type="time"
              value={draft.escala_operacional?.horario_default_seg_sex_inicio ?? '08:00'}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  escala_operacional: {
                    ...draft.escala_operacional!,
                    horario_default_seg_sex_inicio: e.target.value,
                  },
                })
              }
              className={formControlTimeClassName}
            />
          </CadastroField>
          <CadastroField label="Default seg–sex fim">
            <input
              type="time"
              value={draft.escala_operacional?.horario_default_seg_sex_fim ?? '22:00'}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  escala_operacional: {
                    ...draft.escala_operacional!,
                    horario_default_seg_sex_fim: e.target.value,
                  },
                })
              }
              className={formControlTimeClassName}
            />
          </CadastroField>
          <CadastroField label="Sábado Δ fim (h)">
            <NumInput
              value={draft.escala_operacional?.sabado_delta_fim_horas ?? -2}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  escala_operacional: { ...draft.escala_operacional!, sabado_delta_fim_horas: v },
                })
              }
              max={0}
              min={-6}
            />
          </CadastroField>
          <CadastroField label="Rotação domingo a partir de (entregadores)">
            <NumInput
              value={draft.escala_operacional?.rotacao_domingo_min_entregadores ?? 3}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  escala_operacional: { ...draft.escala_operacional!, rotacao_domingo_min_entregadores: v },
                })
              }
              min={2}
              max={10}
            />
          </CadastroField>
          <CadastroField label="Domingo fechado → folguista">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.escala_operacional?.folguista_domingo_se_delivery_fechado ?? true}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    escala_operacional: {
                      ...draft.escala_operacional!,
                      folguista_domingo_se_delivery_fechado: e.target.checked,
                    },
                  })
                }
              />
              Usar diarista/folguista
            </label>
          </CadastroField>
        </div>
      </CadastroSection>

      <CadastroSection title="Valor do lead" desc="Projeção anual usada na proposta comercial.">
        <div className="grid gap-4 sm:grid-cols-2">
          <CadastroField label="Margem sobre receita anual (%)">
            <NumInput
              value={Math.round(draft.valor_lead.margem_pct * 1000) / 10}
              onChange={(v) => setDraft({ ...draft, valor_lead: { ...draft.valor_lead, margem_pct: v / 100 } })}
              step={0.1}
              min={0}
              max={100}
            />
          </CadastroField>
          <CadastroField label="Semanas/ano">
            <NumInput
              value={draft.valor_lead.semanas_ano}
              onChange={(v) => setDraft({ ...draft, valor_lead: { ...draft.valor_lead, semanas_ano: v } })}
              min={1}
            />
          </CadastroField>
        </div>
      </CadastroSection>

      <CadastroSection
        title="Perfis regionais"
        desc="Campos em branco herdam o default do workspace. Sobrescrevem preço e parâmetros financeiros por cidade."
      >
        <ul className="space-y-2">
          {draft.precos_cidade.map((row, index) => (
            <li key={`${row.estado}-${row.cidade}-${index}`} className="rounded-lg border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-4">
                <FormControl
                  value={row.estado}
                  maxLength={2}
                  onChange={(e) => {
                    const next = [...draft.precos_cidade];
                    next[index] = { ...row, estado: e.target.value.toUpperCase() };
                    setDraft({ ...draft, precos_cidade: next });
                  }}
                  placeholder="UF"
                  className="uppercase"
                />
                <FormControl
                  value={row.cidade}
                  onChange={(e) => {
                    const next = [...draft.precos_cidade];
                    next[index] = { ...row, cidade: e.target.value };
                    setDraft({ ...draft, precos_cidade: next });
                  }}
                  placeholder="Cidade"
                  className="sm:col-span-2"
                />
                <button
                  type="button"
                  className="rounded p-2 text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    setDraft({ ...draft, precos_cidade: draft.precos_cidade.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <CadastroField label="Valor entrega">
                  <BrCurrencyInput
                    className={moneyInputClass}
                    value={row.valor_entrega ?? null}
                    onChange={(v) => {
                      const next = [...draft.precos_cidade];
                      next[index] = { ...row, valor_entrega: v != null && v > 0 ? v : undefined };
                      setDraft({ ...draft, precos_cidade: next });
                    }}
                  />
                </CadastroField>
                <CadastroField label="Mín. garantido/sem">
                  <BrCurrencyInput
                    className={moneyInputClass}
                    value={row.minimo_garantido_semanal ?? null}
                    onChange={(v) => {
                      const next = [...draft.precos_cidade];
                      next[index] = { ...row, minimo_garantido_semanal: v != null && v > 0 ? v : undefined };
                      setDraft({ ...draft, precos_cidade: next });
                    }}
                  />
                </CadastroField>
                <CadastroField label="Repasse/sem">
                  <BrCurrencyInput
                    className={moneyInputClass}
                    value={row.repasse_entregador_semanal ?? null}
                    onChange={(v) => {
                      const next = [...draft.precos_cidade];
                      next[index] = { ...row, repasse_entregador_semanal: v != null && v > 0 ? v : undefined };
                      setDraft({ ...draft, precos_cidade: next });
                    }}
                  />
                </CadastroField>
                <CadastroField label="Custo diária">
                  <BrCurrencyInput
                    className={moneyInputClass}
                    value={row.custo_diaria ?? null}
                    onChange={(v) => {
                      const next = [...draft.precos_cidade];
                      next[index] = { ...row, custo_diaria: v != null && v > 0 ? v : undefined };
                      setDraft({ ...draft, precos_cidade: next });
                    }}
                  />
                </CadastroField>
                <CadastroField label="Margem mín./sem">
                  <BrCurrencyInput
                    className={moneyInputClass}
                    value={row.margem_minima_semanal ?? null}
                    onChange={(v) => {
                      const next = [...draft.precos_cidade];
                      next[index] = { ...row, margem_minima_semanal: v != null && v >= 0 ? v : undefined };
                      setDraft({ ...draft, precos_cidade: next });
                    }}
                  />
                </CadastroField>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          onClick={() =>
            setDraft({
              ...draft,
              precos_cidade: [...draft.precos_cidade, { estado: 'MG', cidade: '' }],
            })
          }
        >
          <Plus className="h-4 w-4" />
          Adicionar perfil regional
        </button>
      </CadastroSection>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
          Modo avançado (faixas, dimensionamento, horários)
        </label>
      </div>

      {advanced ? (
        <CadastroSection title="Parâmetros avançados">
          <div className="space-y-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Faixas de perfil (entregas/dia)</p>
            <div className="grid gap-4 sm:grid-cols-4">
              {(
                [
                  ['muito_baixa_max_dia', 'Muito baixa ≤'],
                  ['reduzida_max_dia', 'Reduzida ≤'],
                  ['intermediaria_max_dia', 'Intermediária ≤'],
                  ['padrao_max_dia', 'Padrão ≤'],
                ] as const
              ).map(([key, label]) => (
                <CadastroField key={key} label={label}>
                  <NumInput
                    value={draft.faixas_perfil[key]}
                    onChange={(v) =>
                      setDraft({ ...draft, faixas_perfil: { ...draft.faixas_perfil, [key]: v } })
                    }
                    min={0}
                  />
                </CadastroField>
              ))}
            </div>

            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dimensionamento</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <CadastroField label="Entregadores (intermediária)">
                <NumInput
                  value={draft.dimensionamento.entregadores_intermediaria}
                  onChange={(v) =>
                    setDraft({ ...draft, dimensionamento: { ...draft.dimensionamento, entregadores_intermediaria: v } })
                  }
                  min={1}
                />
              </CadastroField>
              <CadastroField label="Fator perfil grande">
                <NumInput
                  value={draft.dimensionamento.fator_grande}
                  onChange={(v) =>
                    setDraft({ ...draft, dimensionamento: { ...draft.dimensionamento, fator_grande: v } })
                  }
                  step={0.001}
                  min={1}
                />
              </CadastroField>
              <CadastroField label="Divisor diárias (padrão)">
                <NumInput
                  value={draft.dimensionamento.diarias_padrao_divisor}
                  onChange={(v) =>
                    setDraft({ ...draft, dimensionamento: { ...draft.dimensionamento, diarias_padrao_divisor: v } })
                  }
                  min={1}
                />
              </CadastroField>
            </div>

            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Horário amplo</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <CadastroField label="Seg–sex (horas)">
                <NumInput
                  value={draft.horario.seg_sex_horas_amplo}
                  onChange={(v) => setDraft({ ...draft, horario: { ...draft.horario, seg_sex_horas_amplo: v } })}
                  min={1}
                />
              </CadastroField>
              <CadastroField label="Sábado (horas)">
                <NumInput
                  value={draft.horario.sabado_horas_amplo}
                  onChange={(v) => setDraft({ ...draft, horario: { ...draft.horario, sabado_horas_amplo: v } })}
                  min={1}
                />
              </CadastroField>
              <CadastroField label="Volume máx. alerta">
                <NumInput
                  value={draft.horario.volume_max_horario_amplo_reduzida}
                  onChange={(v) =>
                    setDraft({ ...draft, horario: { ...draft.horario, volume_max_horario_amplo_reduzida: v } })
                  }
                  min={0}
                />
              </CadastroField>
            </div>
          </div>
        </CadastroSection>
      ) : null}

      <CadastroSection title="Simulador" desc="Teste o motor sem salvar lead.">
        <div className="grid gap-4 sm:grid-cols-4">
          <CadastroField label="Cidade">
            <FormControl inputSize="md" value={simCity} onChange={(e) => setSimCity(e.target.value)} />
          </CadastroField>
          <CadastroField label="UF">
            <FormControl
              inputSize="md"
              value={simState}
              maxLength={2}
              onChange={(e) => setSimState(e.target.value.toUpperCase())}
              className="uppercase"
            />
          </CadastroField>
          <CadastroField label="Entregas/mês">
            <FormControl
              inputSize="md"
              value={simVolume}
              onChange={(e) => setSimVolume(e.target.value)}
              type="number"
              min={0}
            />
          </CadastroField>
          <div className="flex items-end">
            <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={() => void runSimulate()} disabled={simulate.isPending}>
              <Play className="h-4 w-4" />
              Simular
            </button>
          </div>
        </div>
        {simResult ? (
          <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p>
              <strong>Perfil:</strong> {simResult.dimensionamento.perfil_operacao.replace(/_/g, ' ')} ·{' '}
              <strong>Entregadores:</strong> {simResult.dimensionamento.quantidade_entregadores_recomendada} ·{' '}
              <strong>Diárias/sem:</strong> {simResult.dimensionamento.quantidade_diarias_semana}
            </p>
            <p className="mt-1 text-muted-foreground">
              Viabilidade: {simResult.dimensionamento.classificacao_viabilidade.replace(/_/g, ' ')} · Preço:{' '}
              {simResult.dimensionamento.valor_entrega_utilizado.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              })}{' '}
              ({simResult.preco_fonte}) · Hash config:{' '}
              {simResult.meta.config_hash}
            </p>
            {simResult.dimensionamento.alertas.length ? (
              <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                {simResult.dimensionamento.alertas.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CadastroSection>

      {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}

      <div className="flex justify-end">
        <button type="button" className={buttonVariants()} onClick={() => void save()} disabled={putConfig.isPending}>
          Salvar parâmetros do motor
        </button>
      </div>
    </div>
  );
}
