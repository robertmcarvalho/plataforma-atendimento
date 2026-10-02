const DEFAULT_START = '08:00';
const DEFAULT_END = '18:00';
const DEFAULT_SAT_END = '14:00';
const DEFAULT_HOLIDAY_START = '10:00';
const DEFAULT_HOLIDAY_END = '16:00';

function clampTime(value: unknown, fallback: string): string {
  const v = String(value || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(v) ? v : fallback;
}

function openDay(start: string, end: string) {
  return { is_open: true, intervals: [{ start, end }] };
}

function closedDay() {
  return { is_open: false, intervals: [] as Array<{ start: string; end: string }> };
}

/** Converte horários flat da ficha do lead em delivery_schedule canônico da farmácia. */
export function deliveryScheduleFromLeadCustomFields(
  custom: Record<string, unknown> | undefined | null,
): Record<string, unknown> | null {
  if (!custom || custom.delivery_hours_informed !== true) return null;

  const segSex = custom.delivery_seg_sex !== false;
  const sabado = custom.delivery_sabado !== false;
  const domingo = custom.delivery_domingo === true;
  const feriados = custom.delivery_feriados === true || custom.deliver_on_holidays === true;

  const segSexStart = clampTime(custom.horario_seg_sex_inicio, DEFAULT_START);
  const segSexEnd = clampTime(custom.horario_seg_sex_fim, DEFAULT_END);
  const sabStart = clampTime(custom.horario_sabado_inicio, DEFAULT_START);
  const sabEnd = clampTime(custom.horario_sabado_fim, DEFAULT_SAT_END);
  const domStart = clampTime(custom.horario_domingo_inicio, DEFAULT_START);
  const domEnd = clampTime(custom.horario_domingo_fim, DEFAULT_END);
  const ferStart = clampTime(custom.horario_feriados_inicio, DEFAULT_HOLIDAY_START);
  const ferEnd = clampTime(custom.horario_feriados_fim, DEFAULT_HOLIDAY_END);

  const weekly = {
    monday: segSex ? openDay(segSexStart, segSexEnd) : closedDay(),
    tuesday: segSex ? openDay(segSexStart, segSexEnd) : closedDay(),
    wednesday: segSex ? openDay(segSexStart, segSexEnd) : closedDay(),
    thursday: segSex ? openDay(segSexStart, segSexEnd) : closedDay(),
    friday: segSex ? openDay(segSexStart, segSexEnd) : closedDay(),
    saturday: sabado ? openDay(sabStart, sabEnd) : closedDay(),
    sunday: domingo ? openDay(domStart, domEnd) : closedDay(),
  };

  const hasOpenWeekday = Object.values(weekly).some((d) => d.is_open);
  if (!hasOpenWeekday && !feriados) return null;

  return {
    timezone: 'America/Sao_Paulo',
    weekly,
    holidays: [],
    deliver_on_holidays: feriados,
    holiday_delivery: feriados
      ? { is_open: true, intervals: [{ start: ferStart, end: ferEnd }] }
      : { is_open: false, intervals: [] },
  };
}
