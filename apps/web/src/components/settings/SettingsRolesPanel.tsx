'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formTextareaClassName } from '@/components/form/FormControl';
import api from '@/lib/api';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/utils';
import {
  permissionActionLabelPt,
  permissionModuleLabelPt,
  roleDisplayNamePt,
} from '@/lib/roleLabels';

type RoleRow = { id: string; name: string; permissions: Record<string, unknown> };

type MfaPolicy = {
  roles_editing: { json_editor_enabled: boolean; note: string };
};

function clonePermissions(p: Record<string, unknown> | undefined | null): Record<string, unknown> {
  try {
    return structuredClone(p || {}) as Record<string, unknown>;
  } catch {
    return { ...(p || {}) } as Record<string, unknown>;
  }
}

function isAdminAll(permissions: Record<string, unknown> | undefined | null): boolean {
  return permissions?.all === true;
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 0) return false;
  return keys.every((k) => typeof o[k] === 'boolean');
}

function PermissionToggleRow({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2',
        disabled && 'cursor-not-allowed opacity-60'
      )}
    >
      <span className="text-xs text-foreground">{label}</span>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </label>
  );
}

export function SettingsRolesPanel() {
  const qc = useQueryClient();
  const { data: policy } = useQuery({
    queryKey: ['auth-mfa-policy'],
    queryFn: async () => (await api.get<MfaPolicy>('/api/auth/mfa-policy')).data,
    staleTime: 300_000,
  });

  const jsonEditorEnabled = policy?.roles_editing?.json_editor_enabled !== false;

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await api.get<RoleRow[]>('/api/roles')).data,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [permDraft, setPermDraft] = useState<Record<string, unknown>>({});
  const [jsonDraft, setJsonDraft] = useState('');
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async ({ id, permissions }: { id: string; permissions: Record<string, unknown> }) => {
      await api.patch(`/api/roles/${id}`, { permissions });
    },
    onSuccess: async () => {
      setNote('Permissões guardadas.');
      setEditingId(null);
      setShowAdvancedJson(false);
      await qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: () => setNote('Falha ao gravar (verifique o JSON e as permissões).'),
  });

  const startEdit = (r: RoleRow) => {
    if (r.name === 'admin' && isAdminAll(r.permissions)) {
      setNote(null);
      return;
    }
    setEditingId(r.id);
    setPermDraft(clonePermissions(r.permissions));
    setJsonDraft(JSON.stringify(r.permissions || {}, null, 2));
    setShowAdvancedJson(false);
    setNote(null);
  };

  const setBoolAt = (moduleKey: string, actionKey: string, value: boolean) => {
    setPermDraft((prev) => {
      const next = clonePermissions(prev);
      const mod = next[moduleKey];
      if (mod && typeof mod === 'object' && !Array.isArray(mod)) {
        (mod as Record<string, unknown>)[actionKey] = value;
      } else {
        next[moduleKey] = { [actionKey]: value };
      }
      return next;
    });
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando perfis…</p>;
  }

  return (
    <div className="mt-8 space-y-4 border-t border-border pt-6">
      <p className="text-sm font-semibold text-foreground">Perfis e permissões</p>
      <p className="text-xs text-muted-foreground">
        Ajuste o acesso por perfil com os interruptores abaixo. Alterações ficam registadas em{' '}
        <span className="font-semibold">Auditoria</span> e só devem ser feitas com rollout planeado.
      </p>
      {!jsonEditorEnabled && policy?.roles_editing?.note ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100">
          <span className="font-semibold">Política: </span>
          {policy.roles_editing.note}
        </div>
      ) : null}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      <div className="space-y-3">
        {roles.map((r) => {
          const adminLocked = r.name === 'admin' && isAdminAll(r.permissions);
          const isEditing = editingId === r.id && !adminLocked;

          return (
            <div key={r.id} className="rounded-xl border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{roleDisplayNamePt(r.name)}</span>
                {adminLocked ? (
                  <span className="text-[10px] font-medium text-muted-foreground">Acesso total (somente leitura)</span>
                ) : isEditing ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs"
                      onClick={() => {
                        setEditingId(null);
                        setShowAdvancedJson(false);
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={saveMut.isPending}
                      className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                      onClick={() => {
                        if (showAdvancedJson && jsonEditorEnabled) {
                          try {
                            const permissions = JSON.parse(jsonDraft) as Record<string, unknown>;
                            if (typeof permissions !== 'object' || permissions === null) throw new Error('invalid');
                            saveMut.mutate({ id: r.id, permissions });
                          } catch {
                            setNote('JSON inválido.');
                          }
                        } else {
                          saveMut.mutate({ id: r.id, permissions: permDraft });
                        }
                      }}
                    >
                      Salvar
                    </button>
                  </div>
                ) : (
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => startEdit(r)}>
                    Editar permissões
                  </button>
                )}
              </div>

              {adminLocked ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  O perfil Administrador possui acesso integral ao sistema. Não é possível alterar permissões por aqui.
                </p>
              ) : isEditing ? (
                <div className="mt-3 space-y-4">
                  {Object.entries(permDraft)
                    .filter(([k]) => k !== 'all')
                    .map(([moduleKey, modVal]) => {
                      if (!isBooleanRecord(modVal)) return null;
                      return (
                        <div key={moduleKey} className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {permissionModuleLabelPt(moduleKey)}
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {Object.entries(modVal).map(([actionKey, on]) => (
                              <PermissionToggleRow
                                key={`${moduleKey}.${actionKey}`}
                                label={permissionActionLabelPt(moduleKey, actionKey)}
                                checked={Boolean(on)}
                                onChange={(v) => setBoolAt(moduleKey, actionKey, v)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}

                  {jsonEditorEnabled ? (
                    <div className="border-t border-border pt-3">
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => {
                          setShowAdvancedJson((s) => {
                            const next = !s;
                            if (next) setJsonDraft(JSON.stringify(permDraft, null, 2));
                            return next;
                          });
                        }}
                      >
                        {showAdvancedJson ? 'Ocultar modo avançado (JSON)' : 'Modo avançado (JSON)'}
                      </button>
                      {showAdvancedJson ? (
                        <textarea
                          value={jsonDraft}
                          onChange={(e) => setJsonDraft(e.target.value)}
                          rows={10}
                          className={cn(formTextareaClassName, 'mt-2 p-2 font-mono text-[11px]')}
                        />
                      ) : null}
                      {showAdvancedJson ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Ao salvar com o JSON aberto, o conteúdo do editor substitui os interruptores.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-muted/30 p-2 font-mono text-[10px] text-subtle-foreground">
                  {JSON.stringify(r.permissions || {}, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
