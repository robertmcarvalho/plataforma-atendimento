'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/store/auth';
import { SettingsField } from '@/components/settings/settingsFormPanels';
import { BrPhoneInput } from '@/components/form/BrInputs';
import { FormControl } from '@/components/form/FormControl';
import { normalizeBrazilPhone } from '@/lib/brFormat';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { changeMyPassword } from '@/lib/users/usersApi';

export function SettingsProfilePanel() {
  const qc = useQueryClient();
  const refreshUser = useAuth((s) => s.refreshUser);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; message: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordNote, setPasswordNote] = useState<{ tone: 'ok' | 'err'; message: string } | null>(null);

  const { data: me, isLoading, isError } = useQuery({
    queryKey: ['auth-me-profile'],
    queryFn: async () => (await api.get<Record<string, unknown>>('/api/auth/me')).data,
    staleTime: 30_000,
  });

  const mustChangePassword = Boolean(me?.must_change_password);

  useEffect(() => {
    if (!me) return;
    setName(String(me.name || '').trim());
    setEmail(String(me.email || ''));
    setPhone(me.phone != null ? String(me.phone) : '');
  }, [me]);

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      const trimmedName = name.trim();
      const normalizedPhone = normalizeBrazilPhone(phone) || null;
      const payload: Record<string, unknown> = { phone: normalizedPhone };
      if (trimmedName.length >= 2) payload.name = trimmedName;
      await api.patch('/api/users/me', payload);
      await refreshUser();
      await qc.invalidateQueries({ queryKey: ['auth-me-profile'] });
      setNote({ tone: 'ok', message: 'Perfil atualizado.' });
    } catch (e: unknown) {
      setNote({ tone: 'err', message: apiErrorMessage(e, 'Falha ao salvar.') });
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async () => {
    setPasswordNote(null);
    if (newPassword.length < 8) {
      setPasswordNote({ tone: 'err', message: 'A nova senha deve ter pelo menos 8 caracteres.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordNote({ tone: 'err', message: 'A confirmação não coincide com a nova senha.' });
      return;
    }
    setSavingPassword(true);
    try {
      await changeMyPassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await qc.invalidateQueries({ queryKey: ['auth-me-profile'] });
      setPasswordNote({ tone: 'ok', message: 'Senha alterada com sucesso.' });
    } catch (e: unknown) {
      setPasswordNote({ tone: 'err', message: apiErrorMessage(e, 'Falha ao alterar senha.') });
      requestAnimationFrame(() => {
        document.getElementById('profile-password-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    } finally {
      setSavingPassword(false);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }
  if (isError || !me) {
    return <p className="text-sm text-destructive">Não foi possível carregar o perfil.</p>;
  }

  return (
    <div className="space-y-8">
      {mustChangePassword ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
          Defina uma senha nova para continuar com segurança. Use o formulário abaixo em{' '}
          <strong>Alterar senha</strong>.
        </div>
      ) : null}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Dados pessoais</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SettingsField label="Nome" value={name} onChange={setName} />
          <SettingsField label="E-mail" value={email} readOnly />
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Telefone</label>
            <BrPhoneInput value={phone} onChange={setPhone} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
          {note ? (
            <p
              className={`text-xs font-medium ${note.tone === 'err' ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}
            >
              {note.message}
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">Alteração de e-mail deve ser solicitada ao administrador do workspace.</p>
      </section>

      <section id="profile-password-section" className="space-y-4 border-t border-border pt-6">
        <h3 className="text-sm font-semibold text-foreground">Alterar senha</h3>
        <div className="grid max-w-md grid-cols-1 gap-4">
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Senha atual</label>
            <FormControl
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Nova senha</label>
            <FormControl
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Confirmar nova senha</label>
            <FormControl
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={savingPassword || !currentPassword || !newPassword}
            onClick={() => void savePassword()}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-sidebar-accent/60 disabled:opacity-50"
          >
            {savingPassword ? 'Salvando…' : 'Atualizar senha'}
          </button>
          {passwordNote ? (
            <p
              className={`text-xs font-medium ${passwordNote.tone === 'err' ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}
            >
              {passwordNote.message}
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres na nova senha.</p>
      </section>
    </div>
  );
}
