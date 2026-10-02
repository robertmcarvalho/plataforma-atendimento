'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { onApiError } from '@/lib/apiErrorMessage';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';

type Gap = { key: string; label: string };

type Props = {
  driverId: string;
  taskId?: string;
  missingRequired: Gap[];
  onSaved: () => void;
};

export function InboxDriverRegistrationForm({ driverId, taskId, missingRequired, onSaved }: Props) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      for (const g of missingRequired) {
        const v = values[g.key]?.trim();
        if (v) body[g.key] = v;
      }
      if (Object.keys(body).length) await api.patch(`/api/drivers/${driverId}`, body);
      if (taskId && missingRequired.every((g) => values[g.key]?.trim())) {
        await api.patch(`/api/tasks/${taskId}`, { status: 'done' });
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['inbox'] });
      onSaved();
    },
    onError: onApiError(setError, 'Falha ao salvar.'),
  });

  if (!missingRequired.length) {
    return <p className="text-xs text-muted-foreground">Nenhum campo obrigatório pendente.</p>;
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <h4 className="text-xs font-semibold">Completar cadastro</h4>
      {missingRequired.map((g) => (
        <div key={g.key}>
          <label className="text-xs text-muted-foreground">{g.label}</label>
          <FormControl
            value={values[g.key] || ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [g.key]: e.target.value }))}
            className="mt-1"
          />
        </div>
      ))}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="w-full text-xs">
        Salvar campos
      </Button>
    </div>
  );
}
