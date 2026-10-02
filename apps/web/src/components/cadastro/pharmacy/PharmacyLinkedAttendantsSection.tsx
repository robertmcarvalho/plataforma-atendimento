'use client';

import { Crown, Headphones } from 'lucide-react';
import { CadastroField } from '@/components/cadastro/CadastroPrimitives';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';

export type PharmacyAttendantOption = { id: string; name: string };
export type PharmacyLeaderOption = { id: string; name: string };

type Props = {
  leaders: PharmacyLeaderOption[];
  leaderId: string;
  onLeaderChange: (id: string) => void;
  attendants: PharmacyAttendantOption[];
  sectors: Array<{ id: string; name: string }>;
  primaryId: string;
  secondaryId: string;
  sectorMap: Record<string, string>;
  onPrimaryChange: (id: string) => void;
  onSecondaryChange: (id: string) => void;
  onSectorChange: (sectorId: string, attendantId: string) => void;
  disabled?: boolean;
};

/** Layout Revive `FarmaciaCadastro` — seção Vínculos & atendimento. */
export function PharmacyLinkedAttendantsSection({
  leaders,
  leaderId,
  onLeaderChange,
  attendants,
  sectors,
  primaryId,
  secondaryId,
  sectorMap,
  onPrimaryChange,
  onSecondaryChange,
  onSectorChange,
  disabled,
}: Props) {
  const leaderOptions = [
    { value: '', label: 'Selecione o líder' },
    ...leaders.map((l) => ({ value: l.id, label: l.name })),
  ];
  const attendantOptions = [
    { value: '', label: 'Selecione o atendente' },
    ...attendants.map((a) => ({ value: a.id, label: a.name })),
  ];
  const sectorAttendantOptions = [
    { value: '', label: 'Atendente opcional' },
    ...attendants.map((a) => ({ value: a.id, label: a.name })),
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <CadastroField icon={Crown} label="Líder responsável" required>
          <FormSearchCombobox
            value={leaderId}
            onChange={onLeaderChange}
            disabled={disabled}
            inputSize="lg"
            placeholder="Buscar líder…"
            options={leaderOptions.filter((o) => o.value)}
          />
        </CadastroField>
        <div />
        <CadastroField icon={Headphones} label="Atendente principal" required>
          <FormSearchCombobox
            value={primaryId}
            onChange={onPrimaryChange}
            disabled={disabled}
            inputSize="lg"
            placeholder="Buscar atendente…"
            options={attendantOptions.filter((o) => o.value)}
          />
        </CadastroField>
        <CadastroField icon={Headphones} label="Atendente secundário">
          <FormSearchCombobox
            value={secondaryId}
            onChange={onSecondaryChange}
            disabled={disabled}
            inputSize="lg"
            placeholder="Buscar atendente…"
            options={attendantOptions.filter((o) => o.value)}
          />
        </CadastroField>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
          Atendentes opcionais por setor
        </div>
        {sectors.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhum setor ativo encontrado.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {sectors.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-md border border-border bg-background p-3">
                <span className="w-36 shrink-0 text-xs font-medium">{s.name}</span>
                <FormSearchCombobox
                  value={sectorMap[s.id] || ''}
                  onChange={(v) => onSectorChange(s.id, v)}
                  disabled={disabled}
                  inputSize="md"
                  className="min-w-0 flex-1"
                  placeholder="Buscar atendente…"
                  options={sectorAttendantOptions.filter((o) => o.value)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
