import { supabase } from './supabase';
import { getSystemEmailConfig, type SystemEmailConfig } from './platformSettings';
import { decryptSecret } from './credentialsCrypto';
import {
  getDefaultWorkspaceEmailChannelId,
  getWorkspaceChannelRowForDelivery,
  type WorkspaceChannelRecord,
} from './workspaceChannels';

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  workspaceId?: string | null;
  templateKey: string;
  /** Teste de canal: usa só este canal (e depois env), sem SMTP global da plataforma. */
  channelId?: string;
  useChannelOnly?: boolean;
};

async function logDelivery(
  args: SendEmailArgs,
  status: 'sent' | 'failed',
  errorMessage?: string,
  source: 'platform' | 'workspace' | 'environment' = 'workspace',
  channelId?: string | null
) {
  await supabase.from('email_delivery_log').insert({
    workspace_id: args.workspaceId || null,
    template_key: args.templateKey,
    recipient: args.to,
    status,
    error_message: errorMessage || null,
    metadata: {
      subject: args.subject,
      source,
      channel_id: channelId ?? args.channelId ?? null,
    },
  });
}

function smtpConfigFromChannelRow(row: WorkspaceChannelRecord): SystemEmailConfig | null {
  const c = row.credentials || {};
  const cfg = (row.config || {}) as Record<string, unknown>;
  const from_email = String(c.from_email || cfg.from_email || '').trim();
  const smtp_host = String(c.smtp_host || '').trim();
  if (!from_email || !smtp_host) return null;

  const smtp_port = Number(c.smtp_port || 587);
  let smtp_pass = '';
  if (typeof c.smtp_pass === 'string') {
    if (c.smtp_pass.startsWith('••••')) {
      smtp_pass = '';
    } else if (c.smtp_pass.startsWith('{')) {
      smtp_pass = decryptSecret(c.smtp_pass);
      if (!smtp_pass) throw new Error('Falha ao descriptografar senha SMTP do canal.');
    } else {
      smtp_pass = c.smtp_pass;
    }
  }

  return {
    provider: 'smtp',
    from_email,
    from_name: String(c.from_name || cfg.from_name || ''),
    smtp_host,
    smtp_port,
    smtp_user: String(c.smtp_user || from_email).trim(),
    smtp_pass,
    smtp_secure: Boolean(c.smtp_secure),
  };
}

function smtpConfigFromEnv(): SystemEmailConfig | null {
  const fromEnv = process.env.SMTP_FROM_EMAIL?.trim() || process.env.SMTP_USER?.trim();
  if (!fromEnv || !process.env.SMTP_HOST?.trim()) return null;
  return {
    provider: 'smtp',
    from_email: fromEnv,
    from_name: process.env.SMTP_FROM_NAME?.trim(),
    smtp_host: process.env.SMTP_HOST?.trim(),
    smtp_port: Number(process.env.SMTP_PORT || 587),
    smtp_user: process.env.SMTP_USER?.trim(),
    smtp_pass: process.env.SMTP_PASS?.trim(),
    smtp_secure: process.env.SMTP_SECURE === 'true',
  };
}

function isSmtpConfigUsable(cfg: SystemEmailConfig): boolean {
  if (!cfg.from_email?.trim() || !cfg.smtp_host?.trim()) return false;
  if (cfg.provider === 'smtp' && cfg.smtp_user && !cfg.smtp_pass) return false;
  return true;
}

async function sendViaResend(cfg: SystemEmailConfig, args: SendEmailArgs): Promise<void> {
  const apiKey = cfg.api_key || '';
  if (!apiKey) throw new Error('API key Resend não configurada');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: cfg.from_name ? `${cfg.from_name} <${cfg.from_email}>` : cfg.from_email,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text || args.html.replace(/<[^>]+>/g, ''),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Resend HTTP ${res.status}`);
  }
}

function createSmtpTransport(cfg: SystemEmailConfig) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodemailer = require('nodemailer') as typeof import('nodemailer');
  const port = cfg.smtp_port || 587;
  const secure = port === 465 ? true : Boolean(cfg.smtp_secure);
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure,
    requireTLS: port === 587 && Boolean(cfg.smtp_secure),
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass || '' } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
  });
}

function isRetryableSmtpError(message: string): boolean {
  return /535|authentication failed|ETIMEDOUT|ECONNECTION|ENOTFOUND|response timeout/i.test(message);
}

async function sendViaSmtp(cfg: SystemEmailConfig, args: SendEmailArgs): Promise<void> {
  const mail = {
    from: cfg.from_name ? `${cfg.from_name} <${cfg.from_email}>` : cfg.from_email,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
  };

  const maxAttempts = 3;
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const transport = createSmtpTransport(cfg);
    try {
      await transport.verify();
      await transport.sendMail(mail);
      transport.close();
      return;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      try {
        transport.close();
      } catch {
        /* ignore */
      }
      const msg = lastErr.message || '';
      if (!isRetryableSmtpError(msg) || attempt === maxAttempts) throw lastErr;
      await new Promise((r) => setTimeout(r, 700 * attempt));
    }
  }
  throw lastErr ?? new Error('Falha ao enviar e-mail');
}

/** Mesmo caminho do teste de conexão em Canais → E-mail. */
export async function workspaceEmailChannelSendOpts(
  workspaceId: string
): Promise<Pick<SendEmailArgs, 'channelId' | 'useChannelOnly'>> {
  const channelId = await getDefaultWorkspaceEmailChannelId(workspaceId);
  if (!channelId) return {};
  return { channelId, useChannelOnly: true };
}

async function resolveWorkspaceEmailConfig(
  workspaceId: string,
  channelId?: string
): Promise<{ cfg: SystemEmailConfig; channelId: string } | null> {
  const row = await getWorkspaceChannelRowForDelivery(workspaceId, channelId);
  if (!row || row.channel_type !== 'email') return null;
  const cfg = smtpConfigFromChannelRow(row);
  if (!cfg || !isSmtpConfigUsable(cfg)) return null;
  return { cfg, channelId: row.id };
}

export async function sendTransactionalEmail(args: SendEmailArgs): Promise<void> {
  let cfg: SystemEmailConfig | null = null;
  let source: 'platform' | 'workspace' | 'environment' = 'workspace';
  let deliveryChannelId: string | null = args.channelId || null;

  if (args.channelId) {
    const resolved = await resolveWorkspaceEmailConfig(args.workspaceId ?? '', args.channelId);
    if (resolved) {
      cfg = resolved.cfg;
      deliveryChannelId = resolved.channelId;
      source = 'workspace';
    }
  } else if (!args.useChannelOnly && args.workspaceId) {
    const resolved = await resolveWorkspaceEmailConfig(args.workspaceId);
    if (resolved) {
      cfg = resolved.cfg;
      deliveryChannelId = resolved.channelId;
      source = 'workspace';
    }
  }

  if (!cfg && !args.useChannelOnly) {
    cfg = await getSystemEmailConfig();
    if (cfg) source = 'platform';
  }

  if (!cfg && !args.useChannelOnly) {
    cfg = smtpConfigFromEnv();
    if (cfg) source = 'environment';
  }

  if (!cfg || !isSmtpConfigUsable(cfg)) {
    const msg = 'SMTP não configurado (canal, plataforma ou variáveis de ambiente).';
    await logDelivery(args, 'failed', msg, source, deliveryChannelId);
    throw new Error(msg);
  }

  try {
    if (cfg.provider === 'resend') {
      await sendViaResend(cfg, args);
    } else {
      await sendViaSmtp(cfg, args);
    }
    await logDelivery(args, 'sent', undefined, source, deliveryChannelId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao enviar e-mail';
    await logDelivery(args, 'failed', msg, source, deliveryChannelId);
    throw new Error(msg);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInviteEmailHtml(params: {
  name: string;
  email: string;
  username: string;
  temporaryPassword: string;
  loginUrl: string;
  workspaceName?: string;
  supportEmail?: string;
}): { subject: string; html: string; text: string } {
  const workspaceLabel = params.workspaceName?.trim() || 'Flux Farma';
  const support = params.supportEmail?.trim() || process.env.SMTP_FROM_EMAIL?.trim() || 'atendimento@fluxfarma.com.br';
  const subject = 'Bem-vindo(a) à Aethera — seus dados de acesso';

  const text = [
    `Olá ${params.name},`,
    '',
    `Sua conta na plataforma de atendimento (${workspaceLabel}) foi criada. A partir de agora você pode acompanhar conversas e operar o dia a dia do time por aqui.`,
    '',
    'Como entrar',
    `• Acesse: ${params.loginUrl}`,
    `• E-mail: ${params.email}`,
    `• Senha temporária: ${params.temporaryPassword}`,
    '',
    'Por segurança, defina uma senha nova assim que entrar: Configurações → Perfil → Alterar senha.',
    '',
    'Guarde esta mensagem em local seguro e não compartilhe a senha por WhatsApp ou grupos.',
    '',
    'Se o link não abrir, copie e cole no navegador:',
    params.loginUrl,
    '',
    `Dúvidas? Fale com o administrador do seu workspace ou com o suporte: ${support}`,
    '',
    'Equipe Flux Farma',
  ].join('\n');

  const html = `
    <p>Olá <strong>${escapeHtml(params.name)}</strong>,</p>
    <p>Sua conta na plataforma de atendimento <strong>${escapeHtml(workspaceLabel)}</strong> foi criada. A partir de agora você pode acompanhar conversas e operar o dia a dia do time por aqui.</p>
    <p><strong>Como entrar</strong></p>
    <ul>
      <li><strong>E-mail:</strong> ${escapeHtml(params.email)}</li>
      <li><strong>Senha temporária:</strong> <code>${escapeHtml(params.temporaryPassword)}</code></li>
    </ul>
    <p style="margin:20px 0">
      <a href="${escapeHtml(params.loginUrl)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Entrar na plataforma</a>
    </p>
    <p style="color:#444;font-size:13px">Por segurança, defina uma senha nova assim que entrar: <strong>Configurações → Perfil → Alterar senha</strong>.</p>
    <p style="color:#666;font-size:12px">Se o botão não funcionar, copie e cole no navegador:<br/><a href="${escapeHtml(params.loginUrl)}">${escapeHtml(params.loginUrl)}</a></p>
    <p style="color:#666;font-size:12px;margin-top:24px">Dúvidas? Administrador do workspace ou <a href="mailto:${escapeHtml(support)}">${escapeHtml(support)}</a></p>
    <p style="color:#888;font-size:12px">Equipe Flux Farma</p>
  `;

  return { subject, html, text };
}
