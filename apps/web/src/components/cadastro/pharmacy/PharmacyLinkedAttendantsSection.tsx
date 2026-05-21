'use client';

import { Headphones } from 'lucide-react';
import { CadastroField } from '@/components/cadastro/CadastroPrimitives';

export type PharmacyAttendantOption = { id: string; name: string };

type Props = {
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

export function PharmacyLinkedAttendantsSection({
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
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <CadastroField icon={Headphones} label="Atendente principal (fila padrão)">
          <select
            value={primaryId}
            onChange={(e) => onPrimaryChange(e.target.value)}
            disabled={disabled}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 disabled:opacity-50"
          >
            <option value="">Selecione…</option>
            {attendants.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </CadastroField>
        <CadastroField icon={Headphones} label="Atendente secundário">
          <select
            value={secondaryId}
            onChange={(e) => onSecondaryChange(e.target.value)}
            disabled={disabled}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 disabled:opacity-50"
          >
            <option value="">Selecione…</option>
            {attendants.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </CadastroField>
      </div>

      {sectors.length === 0 ? (
        <div className="text-sm text-muted-foreground">Nenhum setor ativo encontrado.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sectors.map((s) => (
            <div key={s.id} className="rounded-lg border border-border bg-background p-3">
              <div className="text-xs font-semibold text-foreground">{s.name}</div>
              <select
                value={sectorMap[s.id] || ''}
                onChange={(e) => onSectorChange(s.id, e.target.value)}
                disabled={disabled}
                className="mt-2 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 disabled:opacity-50"
              >
                <option value="">(Sem atendente)</option>
                {attendants.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
