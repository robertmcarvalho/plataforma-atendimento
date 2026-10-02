'use client';

import { BrTimeInput } from '@/components/form/BrInputs';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/utils';

export type CommercialDeliveryHoursValue = {
  delivery_seg_sex: boolean;
  horario_seg_sex_inicio: string;
  horario_seg_sex_fim: string;
  delivery_sabado: boolean;
  horario_sabado_inicio: string;
  horario_sabado_fim: string;
  delivery_domingo: boolean;
  horario_domingo_inicio: string;
  horario_domingo_fim: string;
  delivery_feriados: boolean;
  horario_feriados_inicio: string;
  horario_feriados_fim: string;
  delivery_hours_informed: boolean;
};

const DEFAULT_START = '08:00';
const DEFAULT_END = '18:00';
const DEFAULT_SAT_END = '14:00';
const DEFAULT_HOLIDAY_START = '10:00';
const DEFAULT_HOLIDAY_END = '16:00';

function clampTime(value: string, fallback: string) {
  const v = String(value || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(v) ? v : fallback;
}

export function deliveryHoursFromCustomFields(
  custom: Record<string, string | number | boolean> | undefined,
): CommercialDeliveryHoursValue {
  const c = custom || {};
  const segSex = c.delivery_seg_sex !== false;
  const sabado = c.delivery_sabado !== false;
  const domingo = c.delivery_domingo === true;
  const feriados = c.delivery_feriados === true || c.deliver_on_holidays === true;
  return {
    delivery_seg_sex: segSex,
    horario_seg_sex_inicio: String(c.horario_seg_sex_inicio || DEFAULT_START),
    horario_seg_sex_fim: String(c.horario_seg_sex_fim || DEFAULT_END),
    delivery_sabado: sabado,
    horario_sabado_inicio: String(c.horario_sabado_inicio || DEFAULT_START),
    horario_sabado_fim: String(c.horario_sabado_fim || DEFAULT_SAT_END),
    delivery_domingo: domingo,
    horario_domingo_inicio: String(c.horario_domingo_inicio || DEFAULT_START),
    horario_domingo_fim: String(c.horario_domingo_fim || DEFAULT_END),
    delivery_feriados: feriados,
    horario_feriados_inicio: String(c.horario_feriados_inicio || DEFAULT_HOLIDAY_START),
    horario_feriados_fim: String(c.horario_feriados_fim || DEFAULT_HOLIDAY_END),
    delivery_hours_informed: c.delivery_hours_informed === true,
  };
}

export function deliveryHoursToCustomFields(
  value: CommercialDeliveryHoursValue,
): Record<string, string | boolean> {
  const fields: Record<string, string | boolean> = {
    delivery_seg_sex: value.delivery_seg_sex,
    delivery_sabado: value.delivery_sabado,
    delivery_domingo: value.delivery_domingo,
    delivery_feriados: value.delivery_feriados,
    delivery_hours_informed: true,
  };
  if (value.delivery_seg_sex) {
    fields.horario_seg_sex_inicio = value.horario_seg_sex_inicio;
    fields.horario_seg_sex_fim = value.horario_seg_sex_fim;
  }
  if (value.delivery_sabado) {
    fields.horario_sabado_inicio = value.horario_sabado_inicio;
    fields.horario_sabado_fim = value.horario_sabado_fim;
  }
  if (value.delivery_domingo) {
    fields.horario_domingo_inicio = value.horario_domingo_inicio;
    fields.horario_domingo_fim = value.horario_domingo_fim;
  }
  if (value.delivery_feriados) {
    fields.horario_feriados_inicio = value.horario_feriados_inicio;
    fields.horario_feriados_fim = value.horario_feriados_fim;
  }
  return fields;
}

type RowProps = {
  label: string;
  active: boolean;
  onActiveChange: (on: boolean) => void;
  start: string;
  end: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  disabled?: boolean;
};

function ScheduleRow({
  label,
  active,
  onActiveChange,
  start,
  end,
  onStartChange,
  onEndChange,
  disabled,
}: RowProps) {
  return (
    <tr className="border-t border-border/60">
      <td className="px-3 py-2 font-medium text-sm">{label}</td>
      <td className="px-3 py-2">
        <Switch checked={active} onCheckedChange={onActiveChange} disabled={disabled} />
      </td>
      <td className="px-3 py-2">
        <BrTimeInput
          disabled={disabled || !active}
          value={start}
          onChange={(v) => onStartChange(clampTime(v, start))}
        />
      </td>
      <td className="px-3 py-2">
        <BrTimeInput
          disabled={disabled || !active}
          value={end}
          onChange={(v) => onEndChange(clampTime(v, end))}
        />
      </td>
    </tr>
  );
}

type Props = {
  value: CommercialDeliveryHoursValue;
  onChange: (next: CommercialDeliveryHoursValue) => void;
  disabled?: boolean;
  className?: string;
};

export function CommercialLeadDeliveryHoursEditor({ value, onChange, disabled, className }: Props) {
  const patch = (p: Partial<CommercialDeliveryHoursValue>) => {
    onChange({ ...value, ...p, delivery_hours_informed: true });
  };

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-surface', className)}>
      <table className="w-full text-left text-sm">
        <thead className="bg-background">
          <tr className="text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <th className="px-3 py-2">Período</th>
            <th className="px-3 py-2">Ativo</th>
            <th className="px-3 py-2">Início</th>
            <th className="px-3 py-2">Fim</th>
          </tr>
        </thead>
        <tbody>
          <ScheduleRow
            label="Segunda a sexta"
            active={value.delivery_seg_sex}
            onActiveChange={(on) =>
              patch(
                on
                  ? {
                      delivery_seg_sex: true,
                      horario_seg_sex_inicio: value.horario_seg_sex_inicio || DEFAULT_START,
                      horario_seg_sex_fim: value.horario_seg_sex_fim || DEFAULT_END,
                    }
                  : { delivery_seg_sex: false },
              )
            }
            start={value.horario_seg_sex_inicio}
            end={value.horario_seg_sex_fim}
            onStartChange={(horario_seg_sex_inicio) => patch({ horario_seg_sex_inicio })}
            onEndChange={(horario_seg_sex_fim) => patch({ horario_seg_sex_fim })}
            disabled={disabled}
          />
          <ScheduleRow
            label="Sábado"
            active={value.delivery_sabado}
            onActiveChange={(on) =>
              patch(
                on
                  ? {
                      delivery_sabado: true,
                      horario_sabado_inicio: value.horario_sabado_inicio || DEFAULT_START,
                      horario_sabado_fim: value.horario_sabado_fim || DEFAULT_SAT_END,
                    }
                  : { delivery_sabado: false },
              )
            }
            start={value.horario_sabado_inicio}
            end={value.horario_sabado_fim}
            onStartChange={(horario_sabado_inicio) => patch({ horario_sabado_inicio })}
            onEndChange={(horario_sabado_fim) => patch({ horario_sabado_fim })}
            disabled={disabled}
          />
          <ScheduleRow
            label="Domingo"
            active={value.delivery_domingo}
            onActiveChange={(on) =>
              patch(
                on
                  ? {
                      delivery_domingo: true,
                      horario_domingo_inicio: value.horario_domingo_inicio || DEFAULT_START,
                      horario_domingo_fim: value.horario_domingo_fim || DEFAULT_END,
                    }
                  : { delivery_domingo: false },
              )
            }
            start={value.horario_domingo_inicio}
            end={value.horario_domingo_fim}
            onStartChange={(horario_domingo_inicio) => patch({ horario_domingo_inicio })}
            onEndChange={(horario_domingo_fim) => patch({ horario_domingo_fim })}
            disabled={disabled}
          />
        </tbody>
      </table>
      <div className="border-t border-border/60 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">Funcionamento do delivery em feriados</span>
          <Switch
            checked={value.delivery_feriados}
            disabled={disabled}
            onCheckedChange={(on) =>
              patch(
                on
                  ? {
                      delivery_feriados: true,
                      horario_feriados_inicio: value.horario_feriados_inicio || DEFAULT_HOLIDAY_START,
                      horario_feriados_fim: value.horario_feriados_fim || DEFAULT_HOLIDAY_END,
                    }
                  : { delivery_feriados: false },
              )
            }
          />
        </div>
        {value.delivery_feriados ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <BrTimeInput
              disabled={disabled}
              value={value.horario_feriados_inicio}
              onChange={(horario_feriados_inicio) =>
                patch({ horario_feriados_inicio: clampTime(horario_feriados_inicio, DEFAULT_HOLIDAY_START) })
              }
            />
            <span className="text-muted-foreground">até</span>
            <BrTimeInput
              disabled={disabled}
              value={value.horario_feriados_fim}
              onChange={(horario_feriados_fim) =>
                patch({ horario_feriados_fim: clampTime(horario_feriados_fim, DEFAULT_HOLIDAY_END) })
              }
            />
          </div>
        ) : null}
      </div>
      <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
        Informe os horários reais de delivery. Eles serão usados no dimensionamento — não usamos valores padrão
        silenciosos.
      </p>
    </div>
  );
}
