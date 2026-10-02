/**
 * Converte delivery_schedule canônico da farmácia em campos flat do dimensionamento comercial.
 */

import { normalizeBusinessHours, type Weekday } from '../businessHours';
import { supabase } from '../supabase';

export { deliveryScheduleFromLeadCustomFields } from './leadDeliverySchedule';

const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

export type DeliveryHoursFlat = {
  horario_seg_sex_inicio: string;
  horario_seg_sex_fim: string;
  horario_sabado_inicio?: string;
  horario_sabado_fim?: string;
  horario_domingo_inicio?: string;
  horario_domingo_fim?: string;
  horario_feriados_inicio?: string;
  horario_feriados_fim?: string;
  delivery_funciona_seg_sex: boolean;
  delivery_funciona_sabado: boolean;
  delivery_funciona_domingo: boolean;
  delivery_funciona_feriados: boolean;
  delivery_hours_informed: boolean;
  delivery_hours_source?: 'pharmacy' | 'lead';
};

function firstInterval(day: { is_open: boolean; intervals: Array<{ start: string; end: string }> }) {
  if (!day.is_open || !day.intervals.length) return null;
  const iv = day.intervals[0];
  return { start: iv.start, end: iv.end };
}

function weekdayRangeSame(
  weekly: Record<Weekday, { is_open: boolean; intervals: Array<{ start: string; end: string }> }>,
): { start: string; end: string } | null {
  const sigs = WEEKDAYS.map((d) => {
    const iv = firstInterval(weekly[d]);
    return iv ? `${iv.start}-${iv.end}` : 'fechado';
  });
  if (sigs.every((s) => s === sigs[0] && s !== 'fechado')) {
    const iv = firstInterval(weekly.monday)!;
    return { start: iv.start, end: iv.end };
  }
  const openDays = WEEKDAYS.filter((d) => weekly[d].is_open && weekly[d].intervals.length);
  if (!openDays.length) return null;
  const ref = firstInterval(weekly[openDays[0]!])!;
  return { start: ref.start, end: ref.end };
}

function parsePharmacyHolidayDelivery(raw: unknown): {
  deliver_on_holidays: boolean;
  start?: string;
  end?: string;
} {
  if (!raw || typeof raw !== 'object') {
    return { deliver_on_holidays: false };
  }
  const o = raw as Record<string, unknown>;
  const deliver_on_holidays = o.deliver_on_holidays === true;
  const hd = o.holiday_delivery;
  if (!deliver_on_holidays || !hd || typeof hd !== 'object') {
    return { deliver_on_holidays: false };
  }
  const row = hd as Record<string, unknown>;
  const iv = Array.isArray(row.intervals) ? row.intervals[0] : null;
  if (!iv || typeof iv !== 'object') {
    return { deliver_on_holidays: false };
  }
  const x = iv as Record<string, unknown>;
  const start = String(x.start || '').trim();
  const end = String(x.end || '').trim();
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    return { deliver_on_holidays: false };
  }
  return { deliver_on_holidays: true, start, end };
}

export function deliveryHoursFromSchedule(raw: unknown): DeliveryHoursFlat | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const cfg = normalizeBusinessHours(raw);
  const segSex = weekdayRangeSame(cfg.weekly);
  const sab = firstInterval(cfg.weekly.saturday);
  const dom = firstInterval(cfg.weekly.sunday);
  const holiday = parsePharmacyHolidayDelivery(o);

  if (!segSex && !sab && !dom && !holiday.deliver_on_holidays) return null;

  return {
    horario_seg_sex_inicio: segSex?.start ?? '08:00',
    horario_seg_sex_fim: segSex?.end ?? '22:00',
    horario_sabado_inicio: sab?.start,
    horario_sabado_fim: sab?.end,
    horario_domingo_inicio: dom?.start,
    horario_domingo_fim: dom?.end,
    horario_feriados_inicio: holiday.start,
    horario_feriados_fim: holiday.end,
    delivery_funciona_seg_sex: Boolean(segSex),
    delivery_funciona_sabado: Boolean(sab),
    delivery_funciona_domingo: Boolean(dom),
    delivery_funciona_feriados: holiday.deliver_on_holidays,
    delivery_hours_informed: true,
    delivery_hours_source: 'pharmacy',
  };
}

export async function enrichLeadWithPharmacyDeliveryHours(
  workspaceId: string,
  lead: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const custom = { ...((lead.custom_fields as Record<string, unknown>) || {}) };
  const pharmacyId =
    (lead.converted_pharmacy_id as string | undefined) ||
    (custom.source_pharmacy_id as string | undefined);

  if (!pharmacyId) return lead;

  const leadAlreadyInformed = custom.delivery_hours_informed === true && custom.delivery_hours_source !== 'pharmacy';

  const { data: pharmacy } = await supabase
    .from('pharmacies')
    .select('delivery_schedule')
    .eq('workspace_id', workspaceId)
    .eq('id', pharmacyId)
    .maybeSingle();

  if (!pharmacy?.delivery_schedule) return lead;

  const fromPharmacy = deliveryHoursFromSchedule(pharmacy.delivery_schedule);
  if (!fromPharmacy) return lead;

  if (leadAlreadyInformed) return lead;

  return {
    ...lead,
    custom_fields: {
      ...custom,
      ...fromPharmacy,
      delivery_seg_sex: fromPharmacy.delivery_funciona_seg_sex,
      delivery_sabado: fromPharmacy.delivery_funciona_sabado,
      delivery_domingo: fromPharmacy.delivery_funciona_domingo,
      delivery_feriados: fromPharmacy.delivery_funciona_feriados,
      ...(fromPharmacy.delivery_funciona_feriados && fromPharmacy.horario_feriados_inicio && fromPharmacy.horario_feriados_fim
        ? {
            horario_feriados_inicio: fromPharmacy.horario_feriados_inicio,
            horario_feriados_fim: fromPharmacy.horario_feriados_fim,
          }
        : {}),
    },
  };
}
