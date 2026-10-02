import { createHash } from 'node:crypto';
import { z } from 'zod';

export type CidadePerfil = 'pequena' | 'media' | 'grande';

export type ConfiguracoesGlobais = {
  valor_entrega_padrao: number;
  minimo_garantido_semanal: number;
  repasse_entregador_semanal: number;
  margem_minima_semanal: number;
  custo_diaria: number;
};

/** Perfil regional (chave JSON permanece `precos_cidade` por retrocompat). */
export type PerfilRegionalConfig = {
  estado: string;
  cidade: string;
  valor_entrega?: number;
  minimo_garantido_semanal?: number;
  repasse_entregador_semanal?: number;
  custo_diaria?: number;
  margem_minima_semanal?: number;
};

export type FinanceiroFonte = 'workspace_default' | 'regional' | 'lead_override';

export type FinanceiroMeta = {
  fonte: FinanceiroFonte;
  regional_key?: string;
};

export type EscalaOperacionalConfig = {
  jornada_horas: number;
  intervalo_horas: number;
  janela_max_dupla_horas: number;
  horario_default_seg_sex_inicio: string;
  horario_default_seg_sex_fim: string;
  sabado_delta_fim_horas: number;
  domingo_default_inicio: string;
  domingo_default_fim: string;
  folguista_domingo_se_delivery_fechado: boolean;
  rotacao_domingo_min_entregadores: number;
};

export type CommercialMotorConfig = {
  version: 1;
  financeiro: ConfiguracoesGlobais;
  produtividade_por_cidade: Record<CidadePerfil, number>;
  faixas_perfil: {
    muito_baixa_max_dia: number;
    reduzida_max_dia: number;
    intermediaria_max_dia: number;
    padrao_max_dia: number;
  };
  dimensionamento: {
    entregadores_intermediaria: number;
    fator_grande: number;
    diarias_reduzida: number;
    diarias_intermediaria: number;
    diarias_padrao_divisor: number;
    diarias_grande_fator: number;
    diarias_grande_minimo: number;
  };
  horario: {
    seg_sex_horas_amplo: number;
    sabado_horas_amplo: number;
    volume_max_horario_amplo_reduzida: number;
  };
  valor_lead: {
    margem_pct: number;
    semanas_ano: number;
  };
  viabilidade: {
    entregas_por_entregador: number;
    volume_baixo: number;
    volume_alto: number;
  };
  escala_operacional: EscalaOperacionalConfig;
  precos_cidade: PerfilRegionalConfig[];
};

export const DEFAULT_ESCALA_OPERACIONAL: EscalaOperacionalConfig = {
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

export const DEFAULT_MOTOR_CONFIG: CommercialMotorConfig = {
  version: 1,
  financeiro: {
    valor_entrega_padrao: 8,
    minimo_garantido_semanal: 1000,
    repasse_entregador_semanal: 700,
    margem_minima_semanal: 300,
    custo_diaria: 250,
  },
  produtividade_por_cidade: {
    pequena: 30,
    media: 25,
    grande: 20,
  },
  faixas_perfil: {
    muito_baixa_max_dia: 15,
    reduzida_max_dia: 25,
    intermediaria_max_dia: 50,
    padrao_max_dia: 100,
  },
  dimensionamento: {
    entregadores_intermediaria: 2,
    fator_grande: 1.175,
    diarias_reduzida: 0,
    diarias_intermediaria: 2,
    diarias_padrao_divisor: 3,
    diarias_grande_fator: 0.2,
    diarias_grande_minimo: 2,
  },
  horario: {
    seg_sex_horas_amplo: 12,
    sabado_horas_amplo: 10,
    volume_max_horario_amplo_reduzida: 25,
  },
  valor_lead: {
    margem_pct: 0.3,
    semanas_ano: 52,
  },
  viabilidade: {
    entregas_por_entregador: 150,
    volume_baixo: 80,
    volume_alto: 700,
  },
  escala_operacional: DEFAULT_ESCALA_OPERACIONAL,
  precos_cidade: [],
};

const cidadePerfilSchema = z.enum(['pequena', 'media', 'grande']);

const financeiroSchema = z.object({
  valor_entrega_padrao: z.number().positive(),
  minimo_garantido_semanal: z.number().positive(),
  repasse_entregador_semanal: z.number().positive(),
  margem_minima_semanal: z.number().min(0),
  custo_diaria: z.number().positive(),
});

const motorConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    financeiro: financeiroSchema,
    produtividade_por_cidade: z.object({
      pequena: z.number().positive(),
      media: z.number().positive(),
      grande: z.number().positive(),
    }),
    faixas_perfil: z
      .object({
        muito_baixa_max_dia: z.number().min(0),
        reduzida_max_dia: z.number().positive(),
        intermediaria_max_dia: z.number().positive(),
        padrao_max_dia: z.number().positive(),
      })
      .refine(
        (f) =>
          f.muito_baixa_max_dia < f.reduzida_max_dia &&
          f.reduzida_max_dia < f.intermediaria_max_dia &&
          f.intermediaria_max_dia < f.padrao_max_dia,
        'Faixas de perfil devem ser crescentes.',
      ),
    dimensionamento: z.object({
      entregadores_intermediaria: z.number().int().min(1),
      fator_grande: z.number().positive(),
      diarias_reduzida: z.number().int().min(0),
      diarias_intermediaria: z.number().int().min(0),
      diarias_padrao_divisor: z.number().positive(),
      diarias_grande_fator: z.number().min(0),
      diarias_grande_minimo: z.number().int().min(0),
    }),
    horario: z.object({
      seg_sex_horas_amplo: z.number().positive(),
      sabado_horas_amplo: z.number().positive(),
      volume_max_horario_amplo_reduzida: z.number().min(0),
    }),
    valor_lead: z.object({
      margem_pct: z.number().min(0).max(1),
      semanas_ano: z.number().int().positive(),
    }),
    viabilidade: z.object({
      entregas_por_entregador: z.number().positive(),
      volume_baixo: z.number().min(0),
      volume_alto: z.number().positive(),
    }),
    escala_operacional: z
      .object({
        jornada_horas: z.number().positive().max(12),
        intervalo_horas: z.number().min(0.5).max(3),
        janela_max_dupla_horas: z.number().positive(),
        horario_default_seg_sex_inicio: z.string().regex(/^\d{2}:\d{2}$/),
        horario_default_seg_sex_fim: z.string().regex(/^\d{2}:\d{2}$/),
        sabado_delta_fim_horas: z.number().min(-6).max(0),
        domingo_default_inicio: z.string().regex(/^\d{2}:\d{2}$/),
        domingo_default_fim: z.string().regex(/^\d{2}:\d{2}$/),
        folguista_domingo_se_delivery_fechado: z.boolean(),
        rotacao_domingo_min_entregadores: z.number().int().min(2),
      })
      .default(DEFAULT_ESCALA_OPERACIONAL),
    precos_cidade: z
      .array(
        z
          .object({
            estado: z.string().min(2).max(2).transform((v) => v.toUpperCase()),
            cidade: z.string().min(1).transform((v) => v.trim()),
            valor_entrega: z.number().positive().optional(),
            minimo_garantido_semanal: z.number().positive().optional(),
            repasse_entregador_semanal: z.number().positive().optional(),
            custo_diaria: z.number().positive().optional(),
            margem_minima_semanal: z.number().min(0).optional(),
          })
          .refine(
            (p) =>
              p.valor_entrega != null ||
              p.minimo_garantido_semanal != null ||
              p.repasse_entregador_semanal != null ||
              p.custo_diaria != null ||
              p.margem_minima_semanal != null,
            'Perfil regional deve ter ao menos um campo financeiro ou valor_entrega.',
          ),
      )
      .default([]),
  })
  .strict();

export const motorConfigPatchSchema = motorConfigSchema.deepPartial();

export type MotorConfigPatch = z.infer<typeof motorConfigPatchSchema>;

export const motorSimulateSchema = z.object({
  city: z.string().min(1),
  state: z.string().min(2).max(2).transform((v) => v.toUpperCase()),
  entregas_media_dia: z.number().min(0).optional(),
  entregas_media_mes: z.number().int().min(0).optional(),
  perfil_cidade: cidadePerfilSchema.optional(),
  valor_entrega_informado: z.number().positive().optional(),
  motor_config: motorConfigPatchSchema.optional(),
});

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key as keyof T];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      out[key as keyof T] = deepMerge(
        current as Record<string, unknown>,
        value as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      out[key as keyof T] = value as T[keyof T];
    }
  }
  return out;
}

export function mergeMotorConfig(
  base: CommercialMotorConfig,
  patch?: MotorConfigPatch | null,
): CommercialMotorConfig {
  if (!patch) return base;
  const merged = deepMerge(base as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  return motorConfigSchema.parse(merged);
}

export function parseMotorConfig(raw: unknown): CommercialMotorConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_MOTOR_CONFIG;
  const merged = deepMerge(
    DEFAULT_MOTOR_CONFIG as unknown as Record<string, unknown>,
    raw as Record<string, unknown>,
  );
  return motorConfigSchema.parse(merged);
}

export function hashMotorConfig(config: CommercialMotorConfig): string {
  const stable = JSON.stringify(config, Object.keys(config).sort());
  return createHash('sha256').update(stable).digest('hex').slice(0, 16);
}

function normalizeCityKey(city: string) {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function lookupConfiguredRegionalProfile(
  config: CommercialMotorConfig,
  city: string,
  state: string,
): PerfilRegionalConfig | null {
  const cityKey = normalizeCityKey(city);
  const uf = state.toUpperCase().trim();
  const hit = config.precos_cidade.find(
    (p) => p.estado === uf && normalizeCityKey(p.cidade) === cityKey,
  );
  return hit ?? null;
}

export function lookupConfiguredCityPrice(
  config: CommercialMotorConfig,
  city: string,
  state: string,
): number | null {
  return lookupConfiguredRegionalProfile(config, city, state)?.valor_entrega ?? null;
}

function positiveNumber(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Resolve parâmetros financeiros: lead override > regional > workspace default. */
export function resolveFinanceiroParaLead(params: {
  motor: CommercialMotorConfig;
  cidade: string;
  estado: string;
  leadCustomFields?: Record<string, unknown>;
}): { financeiro: ConfiguracoesGlobais; meta: FinanceiroMeta } {
  const base = { ...params.motor.financeiro };
  const regional = lookupConfiguredRegionalProfile(params.motor, params.cidade, params.estado);
  const custom = params.leadCustomFields ?? {};

  let financeiro = { ...base };
  let fonte: FinanceiroFonte = 'workspace_default';
  let regional_key: string | undefined;

  if (regional) {
    regional_key = `${regional.estado}/${regional.cidade}`;
    if (regional.minimo_garantido_semanal != null) {
      financeiro.minimo_garantido_semanal = regional.minimo_garantido_semanal;
    }
    if (regional.repasse_entregador_semanal != null) {
      financeiro.repasse_entregador_semanal = regional.repasse_entregador_semanal;
    }
    if (regional.custo_diaria != null) {
      financeiro.custo_diaria = regional.custo_diaria;
    }
    if (regional.margem_minima_semanal != null) {
      financeiro.margem_minima_semanal = regional.margem_minima_semanal;
    }
    if (regional.valor_entrega != null) {
      financeiro.valor_entrega_padrao = regional.valor_entrega;
    }
    fonte = 'regional';
  }

  const mgLead = positiveNumber(custom.minimo_garantido_semanal_informado);
  const repasseLead = positiveNumber(custom.repasse_entregador_semanal_informado);
  const diariaLead = positiveNumber(custom.custo_diaria_informado);
  const margemLead = positiveNumber(custom.margem_minima_semanal_informado);
  const taxaLead = positiveNumber(custom.valor_entrega_informado);

  if (mgLead != null) financeiro.minimo_garantido_semanal = mgLead;
  if (repasseLead != null) financeiro.repasse_entregador_semanal = repasseLead;
  if (diariaLead != null) financeiro.custo_diaria = diariaLead;
  if (margemLead != null) financeiro.margem_minima_semanal = margemLead;
  if (taxaLead != null) financeiro.valor_entrega_padrao = taxaLead;

  if (mgLead != null || repasseLead != null || diariaLead != null || margemLead != null || taxaLead != null) {
    fonte = 'lead_override';
  }

  return { financeiro, meta: { fonte, regional_key } };
}

export type MotorConfigMeta = {
  config_version: number;
  config_hash: string;
  config_applied_at: string;
};

export function motorConfigMeta(config: CommercialMotorConfig): MotorConfigMeta {
  return {
    config_version: config.version,
    config_hash: hashMotorConfig(config),
    config_applied_at: new Date().toISOString(),
  };
}
