export type RangePreset = 'hoje' | '7d' | '30d' | 'mes' | 'mes_anterior' | 'custom';

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'mes', label: 'Mês atual' },
  { id: 'mes_anterior', label: 'Mês anterior' },
  { id: 'custom', label: 'Customizado' },
];

export function rangeForPreset(preset: RangePreset): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  switch (preset) {
    case 'hoje':
      start.setHours(0, 0, 0, 0);
      break;
    case '7d':
      start.setDate(end.getDate() - 7);
      break;
    case '30d':
      start.setDate(end.getDate() - 30);
      break;
    case 'mes':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case 'mes_anterior': {
      const s = new Date(end.getFullYear(), end.getMonth() - 1, 1);
      const e = new Date(end.getFullYear(), end.getMonth(), 0, 23, 59, 59, 999);
      return { start: s, end: e };
    }
    case 'custom':
      start.setDate(end.getDate() - 14);
      break;
  }
  return { start, end };
}

export function presetToQueryParams(preset: RangePreset): Record<string, string> {
  const { start, end } = rangeForPreset(preset);
  start.setSeconds(0, 0);
  end.setSeconds(0, 0);
  return {
    start_date: start.toISOString(),
    end_date: end.toISOString(),
  };
}
