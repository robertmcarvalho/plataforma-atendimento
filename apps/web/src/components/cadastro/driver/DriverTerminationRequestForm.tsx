'use client';

import { Calendar, FileText, Truck } from 'lucide-react';
import { CadastroField } from '@/components/cadastro/CadastroPrimitives';
import {
  FormControl,
  formTextareaClassName,
} from '@/components/form/FormControl';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { OpsDriverSearchCombobox } from '@/components/operacao/OpsDriverSearchCombobox';
import { FormSelect } from '@/components/form/FormSelect';

const REASONS = [
  { value: 'driver_request', label: 'Pedido do entregador' },
  { value: 'performance', label: 'Desempenho' },
  { value: 'absence', label: 'Ausência' },
  { value: 'route_ended', label: 'Encerramento de rota' },
  { value: 'other', label: 'Outro' },
] as const;

export type TerminationReason = (typeof REASONS)[number]['value'];

export function DriverTerminationRequestForm({
  leaderId,
  onLeaderIdChange,
  leaders,
  driverId,
  onDriverIdChange,
  drivers,
  lastWorkedAt,
  onLastWorkedAtChange,
  reason,
  onReasonChange,
  notes,
  onNotesChange,
  showLeaderPicker,
  driversLoading,
  driverSearchScope,
}: {
  leaderId: string;
  onLeaderIdChange: (v: string) => void;
  leaders: Array<{ id: string; name: string }>;
  driverId: string;
  onDriverIdChange: (v: string) => void;
  drivers: Array<{ id: string; name: string }>;
  lastWorkedAt: string;
  onLastWorkedAtChange: (v: string) => void;
  reason: TerminationReason;
  onReasonChange: (v: TerminationReason) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  showLeaderPicker?: boolean;
  driversLoading?: boolean;
  driverSearchScope?: 'portfolio';
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {showLeaderPicker ? (
        <CadastroField icon={Truck} label="Líder (em nome de)" required>
          <FormSearchCombobox
            value={leaderId}
            onChange={onLeaderIdChange}
            inputSize="lg"
            placeholder="Buscar líder…"
            options={leaders.map((l) => ({ value: l.id, label: l.name }))}
          />
        </CadastroField>
      ) : null}
      <CadastroField icon={Truck} label="Entregador" required>
        {driverSearchScope ? (
          <OpsDriverSearchCombobox
            scope={driverSearchScope}
            leaderId={leaderId || undefined}
            value={driverId}
            onChange={onDriverIdChange}
            disabled={driversLoading || (showLeaderPicker && !leaderId)}
            placeholder={
              driversLoading
                ? 'Carregando…'
                : showLeaderPicker && !leaderId
                  ? 'Selecione o líder primeiro'
                  : 'Buscar entregador…'
            }
            emptyLabel="Nenhum entregador na carteira"
          />
        ) : (
          <FormSearchCombobox
            value={driverId}
            onChange={onDriverIdChange}
            inputSize="lg"
            disabled={driversLoading}
            placeholder={driversLoading ? 'Carregando…' : 'Buscar entregador…'}
            options={drivers.map((d) => ({ value: d.id, label: d.name }))}
          />
        )}
      </CadastroField>
      <CadastroField icon={Calendar} label="Último dia trabalhado" required>
        <FormControl inputSize="lg" type="date" value={lastWorkedAt} onChange={(e) => onLastWorkedAtChange(e.target.value)} />
      </CadastroField>
      <CadastroField icon={FileText} label="Motivo" required>
        <FormSelect
          value={reason}
          onChange={(v) => onReasonChange(v as TerminationReason)}
          size="lg"
          options={REASONS.map((r) => ({ value: r.value, label: r.label }))}
        />
      </CadastroField>
      <div className="md:col-span-2">
        <CadastroField icon={FileText} label="Observações">
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={3}
            className={formTextareaClassName}
            placeholder="Contexto adicional…"
          />
        </CadastroField>
      </div>
    </div>
  );
}
