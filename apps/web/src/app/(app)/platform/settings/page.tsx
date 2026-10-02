'use client';

import { platformPageApi } from '@/lib/platform/platformPageApi';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, Mail } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormControl } from '@/components/form/FormControl';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { reviveTableHeadRowClassName, reviveTableShellClassName } from '@/lib/reviveSurfaces';

type SystemEmail = {
  configured: boolean;
  from_email?: string;
  from_name?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
};

type DeliveryLogRow = {
  id: string;
  template_key: string;
  recipient: string;
  status: string;
  metadata?: { source?: string };
  created_at: string;
};

export default function PlatformSettingsPage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const platformRole = String(user?.platform_role || '');

  const emailQuery = useQuery({
    queryKey: ['platform-system-email'],
    queryFn: async () => await platformPageApi.fetchSystemEmail(),
    enabled: platformRole.includes('platform'),
  });

  const logQuery = useQuery({
    queryKey: ['platform-email-log'],
    queryFn: async () => await platformPageApi.fetchEmailDeliveryLog(40),
    enabled: platformRole.includes('platform'),
  });

  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');

  useEffect(() => {
    if (!emailQuery.data) return;
    setFromEmail(emailQuery.data.from_email || '');
    setFromName(emailQuery.data.from_name || '');
    setSmtpHost(emailQuery.data.smtp_host || '');
    setSmtpPort(String(emailQuery.data.smtp_port || 587));
    setSmtpUser(emailQuery.data.smtp_user || '');
  }, [emailQuery.data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      await platformPageApi.putSystemEmail({
        provider: 'smtp',
        from_email: fromEmail,
        from_name: fromName,
        smtp_host: smtpHost,
        smtp_port: Number(smtpPort),
        smtp_user: smtpUser,
        smtp_pass: smtpPass || undefined,
        smtp_secure: true,
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform-system-email'] }),
  });

  if (!platformRole.includes('platform')) {
    return <div className="p-8 text-sm text-muted-foreground">Acesso restrito à administração da plataforma.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <Link href="/platform/workspaces" className="mb-4 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Workspaces
      </Link>
      <PageHeader icon={Mail} eyebrow="Plataforma" title="E-mail do sistema" description="SMTP global e log de entregas." />

      <section className="mt-6 space-y-3 rounded-xl border border-border bg-surface p-6">
        <h3 className="text-sm font-semibold">Configuração SMTP</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="From e-mail" value={fromEmail} onChange={setFromEmail} />
          <Field label="From nome" value={fromName} onChange={setFromName} />
          <Field label="SMTP host" value={smtpHost} onChange={setSmtpHost} />
          <Field label="SMTP port" value={smtpPort} onChange={setSmtpPort} />
          <Field label="SMTP user" value={smtpUser} onChange={setSmtpUser} />
          <Field label="SMTP pass" value={smtpPass} onChange={setSmtpPass} type="password" />
        </div>
        <button
          type="button"
          disabled={saveMut.isPending}
          onClick={() => void saveMut.mutate()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {saveMut.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </section>

      <section className={cn(reviveTableShellClassName, 'mt-6 p-6')}>
        <h3 className="mb-3 text-sm font-semibold">Log de entregas</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className={reviveTableHeadRowClassName}>
              <th className="py-2">Quando</th>
              <th className="py-2">Template</th>
              <th className="py-2">Para</th>
              <th className="py-2">Status</th>
              <th className="py-2">Origem</th>
            </tr>
          </thead>
          <tbody>
            {(logQuery.data || []).map((row) => (
              <tr key={row.id} className="border-b border-border/40">
                <td className="py-2 font-mono text-[10px]">{new Date(row.created_at).toLocaleString('pt-BR')}</td>
                <td className="py-2">{row.template_key}</td>
                <td className="py-2">{row.recipient}</td>
                <td className="py-2">{row.status}</td>
                <td className="py-2">{row.metadata?.source || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <FormControl type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1" />
    </label>
  );
}
