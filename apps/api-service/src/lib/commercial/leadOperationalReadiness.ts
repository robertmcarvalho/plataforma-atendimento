import type { CidadePerfil } from './commercialMotorConfigCore';

export type OperationalMissingField = {
  field: string;
  label: string;
};

export type OperationalReadinessResult = {
  ready: boolean;
  missing: OperationalMissingField[];
};

const PERFIL_VALUES = new Set<CidadePerfil>(['pequena', 'media', 'grande']);

function isValidTime(value: unknown): boolean {
  return typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim());
}

export function assessLeadOperationalReadiness(lead: Record<string, unknown>): OperationalReadinessResult {
  const missing: OperationalMissingField[] = [];
  const custom = (lead.custom_fields as Record<string, unknown>) || {};

  const monthly = Number(lead.monthly_deliveries ?? 0);
  if (!Number.isFinite(monthly) || monthly <= 0) {
    missing.push({ field: 'monthly_deliveries', label: 'Entregas por mês' });
  }

  if (!String(lead.city || '').trim()) {
    missing.push({ field: 'city', label: 'Cidade' });
  }
  if (!String(lead.state || '').trim()) {
    missing.push({ field: 'state', label: 'UF' });
  }

  const perfil = String(custom.perfil_cidade || '').trim();
  if (!PERFIL_VALUES.has(perfil as CidadePerfil)) {
    missing.push({ field: 'custom_fields.perfil_cidade', label: 'Perfil da cidade' });
  }

  if (custom.delivery_hours_informed !== true) {
    missing.push({ field: 'custom_fields.delivery_hours_informed', label: 'Horários de delivery' });
  }

  const segSex = custom.delivery_seg_sex !== false;
  if (segSex) {
    if (!isValidTime(custom.horario_seg_sex_inicio)) {
      missing.push({ field: 'custom_fields.horario_seg_sex_inicio', label: 'Horário seg–sex (início)' });
    }
    if (!isValidTime(custom.horario_seg_sex_fim)) {
      missing.push({ field: 'custom_fields.horario_seg_sex_fim', label: 'Horário seg–sex (fim)' });
    }
  }

  const sabado = custom.delivery_sabado !== false;
  if (sabado) {
    if (!isValidTime(custom.horario_sabado_inicio)) {
      missing.push({ field: 'custom_fields.horario_sabado_inicio', label: 'Horário sábado (início)' });
    }
    if (!isValidTime(custom.horario_sabado_fim)) {
      missing.push({ field: 'custom_fields.horario_sabado_fim', label: 'Horário sábado (fim)' });
    }
  }

  if (custom.delivery_domingo === true) {
    if (!isValidTime(custom.horario_domingo_inicio)) {
      missing.push({ field: 'custom_fields.horario_domingo_inicio', label: 'Horário domingo (início)' });
    }
    if (!isValidTime(custom.horario_domingo_fim)) {
      missing.push({ field: 'custom_fields.horario_domingo_fim', label: 'Horário domingo (fim)' });
    }
  }

  if (segSex && isValidTime(custom.horario_seg_sex_inicio) && isValidTime(custom.horario_seg_sex_fim)) {
    const a = parseTimeMinutes(String(custom.horario_seg_sex_inicio));
    const b = parseTimeMinutes(String(custom.horario_seg_sex_fim));
    if (b <= a) {
      missing.push({
        field: 'custom_fields.horario_seg_sex_fim',
        label: 'Horário seg–sex (fim deve ser após início)',
      });
    }
  }

  return { ready: missing.length === 0, missing };
}

function parseTimeMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export class LeadOperationalNotReadyError extends Error {
  missing: OperationalMissingField[];

  constructor(missing: OperationalMissingField[]) {
    super('Ficha operacional incompleta para calcular viabilidade.');
    this.name = 'LeadOperationalNotReadyError';
    this.missing = missing;
  }
}

export function assertLeadOperationalReadiness(lead: Record<string, unknown>): void {
  const { ready, missing } = assessLeadOperationalReadiness(lead);
  if (!ready) throw new LeadOperationalNotReadyError(missing);
}
