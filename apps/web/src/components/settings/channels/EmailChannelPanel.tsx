'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, EyeOff, Mail, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  FormControl,
  formControlFlexClassName,
  formTextareaClassName,
} from '@/components/form/FormControl';
import { SettingsField } from '@/components/settings/settingsFormPanels';
import {
  createChannel,
  listChannels,
  testChannelEmail,
  updateChannel,
  type WorkspaceChannel,
} from '@/lib/integrations/channelsApi';

type Provider = 'smtp' | 'resend' | 'sendgrid';

function parseProvider(raw: string | undefined): Provider {
  if (raw === 'resend' || raw === 'sendgrid') return raw;
  return 'smtp';
}

function hasStoredSmtpPass(credentials: Record<string, unknown> | undefined): boolean {
  const v = credentials?.smtp_pass;
  return typeof v === 'string' && v.length > 0;
}

function hydrateFromChannel(channel: WorkspaceChannel) {
  const cfg = (channel.config || {}) as Record<string, unknown>;
  const cred = (channel.credentials || {}) as Record<string, unknown>;
  return {
    provider: parseProvider(String(channel.provider || 'smtp')),
    fromName: String(cfg.from_name || cred.from_name || channel.display_name || '').trim(),
    fromEmail: String(cfg.from_email || cred.from_email || '').trim(),
    smtpHost: String(cred.smtp_host || '').trim(),
    smtpPort: String(cred.smtp_port || 587),
    smtpUser: String(cred.smtp_user || cred.from_email || '').trim(),
    tls: cred.smtp_secure !== false && cred.smtp_secure !== 'false',
    apiKey: '',
    smtpPass: '',
  };
}

export function EmailChannelPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const qc = useQueryClient();
  const { data: all = [], isLoading: channelsLoading } = useQuery({
    queryKey: ['integrations', 'channels'],
    queryFn: listChannels,
  });
  const emailChannel = useMemo(() => all.find((c) => c.channel_type === 'email'), [all]);

  const [provider, setProvider] = useState<Provider>('smtp');
  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [tls, setTls] = useState(true);
  const [showSecret, setShowSecret] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const [alertEmails, setAlertEmails] = useState('');
  const [hydratedChannelId, setHydratedChannelId] = useState<string | null>(null);

  const passwordStored = hasStoredSmtpPass(emailChannel?.credentials);

  useEffect(() => {
    if (!emailChannel) {
      setHydratedChannelId(null);
      return;
    }
    const revision = `${emailChannel.id}:${JSON.stringify(emailChannel.config)}:${JSON.stringify(emailChannel.credentials)}`;
    if (hydratedChannelId === revision) return;
    const h = hydrateFromChannel(emailChannel);
    setProvider(h.provider);
    setFromName(h.fromName);
    setFromEmail(h.fromEmail);
    setSmtpHost(h.smtpHost);
    setSmtpPort(h.smtpPort);
    setSmtpUser(h.smtpUser);
    setTls(h.tls);
    setSmtpPass(h.smtpPass);
    setApiKey(h.apiKey);
    setHydratedChannelId(revision);
  }, [emailChannel, hydratedChannelId]);

  const { data: alertSetting } = useQuery({
    queryKey: ['settings', 'alert_emails'],
    queryFn: async () => {
      try {
        return (await api.get<string[]>('/api/settings/alert_emails')).data;
      } catch {
        return [];
      }
    },
  });

  useEffect(() => {
    if (alertSetting && Array.isArray(alertSetting)) {
      setAlertEmails(alertSetting.join(', '));
    }
  }, [alertSetting]);

  const saveAlerts = async () => {
    const list = alertEmails
      .split(/[,;\n]/)
      .map((e) => e.trim())
      .filter(Boolean);
    await api.put('/api/settings', { key: 'alert_emails', value: list });
    setMsg('Caixas de alerta salvas.');
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!fromEmail.trim()) throw new Error('Informe o e-mail remetente.');
      if (provider === 'smtp') {
        if (!smtpHost.trim()) throw new Error('Informe o host SMTP.');
        if (!smtpUser.trim()) throw new Error('Informe o usuário SMTP.');
        if (!emailChannel && !smtpPass.trim()) throw new Error('Informe a senha SMTP na primeira configuração.');
        if (emailChannel && !passwordStored && !smtpPass.trim()) {
          throw new Error('Informe a senha SMTP na primeira configuração.');
        }
      } else {
        const storedKey =
          typeof emailChannel?.credentials?.api_key === 'string' && String(emailChannel.credentials.api_key).length > 0;
        if (!apiKey.trim() && !storedKey) throw new Error('Informe a API key.');
      }

      const smtpCreds: Record<string, unknown> = {
        smtp_host: smtpHost.trim(),
        smtp_port: Number(smtpPort) || 587,
        smtp_user: smtpUser.trim(),
        smtp_secure: tls,
      };
      if (smtpPass.trim()) smtpCreds.smtp_pass = smtpPass;

      const credentials =
        provider === 'smtp' ? smtpCreds : apiKey.trim() ? { api_key: apiKey.trim() } : {};

      const payload = {
        display_name: fromName.trim() || fromEmail.trim() || 'E-mail do workspace',
        config: { from_name: fromName.trim(), from_email: fromEmail.trim() },
        credentials: { from_email: fromEmail.trim(), from_name: fromName.trim(), ...credentials },
        status: 'active' as const,
        is_active: true,
        is_default: true,
      };
      if (emailChannel) return updateChannel(emailChannel.id, payload);
      return createChannel({
        channel_type: 'email',
        provider: provider === 'smtp' ? 'smtp' : provider,
        ...payload,
      });
    },
    onSuccess: () => {
      setHydratedChannelId(null);
      void qc.invalidateQueries({ queryKey: ['integrations', 'channels'] });
      setMsg('Configuração salva.');
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const handleTest = async () => {
    if (!emailChannel?.id || !testTo.trim()) {
      setMsg('Salve o canal e informe um e-mail de teste.');
      return;
    }
    setTesting('loading');
    setMsg(null);
    try {
      await testChannelEmail(emailChannel.id, testTo.trim());
      setTesting('ok');
    } catch (e: unknown) {
      setTesting('err');
      const ax = e as { response?: { data?: { error?: string } } };
      setMsg(ax.response?.data?.error || 'Falha no envio — verifique credenciais e senha SMTP no painel UOL.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-channel-email/15">
            <Mail className="h-5 w-5 text-channel-email" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">E-mail de envio</h3>
            <p className="text-[11px] text-muted-foreground">
              SMTP ou API para notificações e convites de usuário deste workspace.
            </p>
            {channelsLoading ? (
              <p className="mt-1 text-[10px] text-muted-foreground">Carregando configuração…</p>
            ) : emailChannel && fromEmail ? (
              <p className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-success">
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                <span>
                  Configurado: <span className="font-mono">{fromEmail}</span>
                  {smtpHost ? <span className="text-muted-foreground"> · {smtpHost}</span> : null}
                </span>
              </p>
            ) : emailChannel ? (
              <p className="mt-1 text-[10px] text-warning">Canal criado — complete os campos e salve.</p>
            ) : (
              <p className="mt-1 text-[10px] text-muted-foreground">Nenhum canal de e-mail salvo ainda.</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-6 space-y-4">
        <div>
          <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Provedor</label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(['smtp', 'resend', 'sendgrid'] as const).map((p) => (
              <button
                key={p}
                type="button"
                disabled={!isAdmin}
                onClick={() => setProvider(p)}
                className={cn(
                  'rounded-md border px-3 py-2 text-xs font-medium transition-colors',
                  provider === p ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                )}
              >
                {p === 'smtp' ? 'SMTP' : p === 'resend' ? 'Resend' : 'SendGrid'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SettingsField label="Nome do remetente" value={fromName} onChange={setFromName} readOnly={!isAdmin} />
          <SettingsField label="E-mail remetente" value={fromEmail} onChange={setFromEmail} mono readOnly={!isAdmin} />
        </div>

        {provider === 'smtp' ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SettingsField label="Host SMTP" value={smtpHost} onChange={setSmtpHost} mono readOnly={!isAdmin} />
            <SettingsField label="Porta" value={smtpPort} onChange={setSmtpPort} mono readOnly={!isAdmin} />
            <SettingsField label="Usuário" value={smtpUser} onChange={setSmtpUser} mono readOnly={!isAdmin} />
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Senha</label>
              <div className="mt-1 flex gap-2">
                <FormControl
                  type={showSecret ? 'text' : 'password'}
                  value={smtpPass}
                  onChange={(e) => setSmtpPass(e.target.value)}
                  disabled={!isAdmin}
                  placeholder={passwordStored ? 'Senha salva — deixe em branco para manter' : 'Senha da caixa UOL'}
                  className={cn(formControlFlexClassName, 'font-mono')}
                />
                <button type="button" onClick={() => setShowSecret((s) => !s)} className="rounded-md border border-border px-3">
                  {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">API Key</label>
            <FormControl
              type={showSecret ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={!isAdmin}
              className="mt-1 font-mono text-xs"
            />
          </div>
        )}

        <label className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
          <span className="text-xs">TLS / STARTTLS</span>
          <input type="checkbox" checked={tls} disabled={!isAdmin} onChange={(e) => setTls(e.target.checked)} />
        </label>

        {isAdmin ? (
          <button
            type="button"
            disabled={saveMut.isPending}
            onClick={() => saveMut.mutate()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {saveMut.isPending ? 'Salvando…' : 'Salvar configuração de e-mail'}
          </button>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-background p-6">
        <h4 className="text-sm font-semibold">Alertas de fila</h4>
        <p className="mt-1 text-[11px] text-muted-foreground">E-mails para notificações de fila (vírgula ou quebra de linha).</p>
        <textarea
          value={alertEmails}
          onChange={(e) => setAlertEmails(e.target.value)}
          disabled={!isAdmin}
          className={cn(formTextareaClassName, 'mt-2 min-h-[72px] text-xs')}
        />
        {isAdmin ? (
          <button type="button" onClick={() => void saveAlerts()} className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-sidebar-accent/60">
            Salvar caixas de alerta
          </button>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-background p-6">
        <h4 className="text-sm font-semibold">Teste de envio</h4>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FormControl
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="seu@email.com"
            inputSize="sm"
            className="text-xs"
          />
          <button
            type="button"
            onClick={() => void handleTest()}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            <Send className="h-3 w-3" /> Enviar teste
          </button>
        </div>
        {testing === 'ok' && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> E-mail de teste enviado.
          </p>
        )}
        {testing === 'err' && <p className="mt-2 text-[11px] text-destructive">Falha no envio — verifique credenciais.</p>}
      </div>

      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
    </div>
  );
}
