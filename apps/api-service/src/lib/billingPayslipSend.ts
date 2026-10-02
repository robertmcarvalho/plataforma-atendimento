import { canonicalBrazilWaPhone } from '@plataforma/channel-runtime';
import { supabase } from './supabase';
import { resolveWhatsAppSendConfig, sendWhatsAppCloudMessage } from './channelResolver';
import {
  buildDriverPayslip,
  generatePayslipToken,
  hashPayslipToken,
  loadPayslipTemplateConfig,
  payslipTtlDays,
  resolvePayslipPublicUrl,
  buildPayslipTemplateParameters,
  type DriverPayslip,
  type PayslipTrack,
} from './billingPayslip';

export type PayslipSendResult = {
  payslip: DriverPayslip;
  token: string;
  public_url: string;
  expires_at: string;
  whatsapp_sent: boolean;
  whatsapp_skipped_reason: string | null;
};

async function revokeActiveTokens(workspaceId: string, payableId: string) {
  await supabase
    .from('billing_payslip_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('payable_id', payableId)
    .is('revoked_at', null);
}

export async function issuePayslipToken(input: {
  workspaceId: string;
  payableId: string;
  driverId: string;
  cycleId: string | null;
  track: PayslipTrack;
  createdBy: string | null;
}): Promise<{ token: string; expiresAt: string; publicUrl: string }> {
  await revokeActiveTokens(input.workspaceId, input.payableId);
  const { token, tokenHash } = generatePayslipToken();
  const expiresAt = new Date(Date.now() + payslipTtlDays() * 24 * 60 * 60 * 1000).toISOString();
  const row = {
    workspace_id: input.workspaceId,
    payable_id: input.payableId,
    driver_id: input.driverId,
    billing_cycle_id: input.cycleId,
    track: input.track,
    token_hash: tokenHash,
    expires_at: expiresAt,
    created_by: input.createdBy,
  };
  let { error } = await supabase.from('billing_payslip_tokens').insert(row);
  if (error && input.createdBy) {
    const retry = await supabase.from('billing_payslip_tokens').insert({ ...row, created_by: null });
    error = retry.error;
  }
  if (error) throw new Error(error.message);
  return { token, expiresAt, publicUrl: resolvePayslipPublicUrl(token) };
}

export { buildPayslipTemplateParameters };

export async function sendDriverPayslip(input: {
  workspaceId: string;
  payableId: string;
  createdBy: string | null;
}): Promise<PayslipSendResult> {
  const payslip = await buildDriverPayslip({ workspaceId: input.workspaceId, payableId: input.payableId });
  if (!payslip) throw new Error('Holerite não encontrado para este título');

  const issued = await issuePayslipToken({
    workspaceId: input.workspaceId,
    payableId: input.payableId,
    driverId: payslip.driver.id,
    cycleId: payslip.cycle.id,
    track: payslip.track,
    createdBy: input.createdBy,
  });

  const withLink: DriverPayslip = {
    ...payslip,
    send: {
      ...payslip.send,
      public_url: issued.publicUrl,
      expires_at: issued.expiresAt,
      revoked: false,
    },
  };

  const phone = payslip.driver.phone ? canonicalBrazilWaPhone(payslip.driver.phone) : '';
  if (!phone) {
    return {
      payslip: withLink,
      token: issued.token,
      public_url: issued.publicUrl,
      expires_at: issued.expiresAt,
      whatsapp_sent: false,
      whatsapp_skipped_reason: 'Entregador sem telefone no cadastro. Link gerado para copiar.',
    };
  }

  const template = await loadPayslipTemplateConfig(input.workspaceId);
  const config = await resolveWhatsAppSendConfig(input.workspaceId);
  if (!config) {
    return {
      payslip: withLink,
      token: issued.token,
      public_url: issued.publicUrl,
      expires_at: issued.expiresAt,
      whatsapp_sent: false,
      whatsapp_skipped_reason: 'Canal WhatsApp não configurado neste workspace.',
    };
  }

  const parameters = buildPayslipTemplateParameters(withLink, issued.publicUrl);
  try {
    await sendWhatsAppCloudMessage(
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language },
          components: [
            {
              type: 'body',
              parameters: parameters.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      },
      config
    );
    await supabase
      .from('billing_payslip_tokens')
      .update({ last_sent_at: new Date().toISOString(), last_send_error: null })
      .eq('workspace_id', input.workspaceId)
      .eq('token_hash', hashPayslipToken(issued.token));
    return {
      payslip: { ...withLink, send: { ...withLink.send, last_sent_at: new Date().toISOString(), can_send: true } },
      token: issued.token,
      public_url: issued.publicUrl,
      expires_at: issued.expiresAt,
      whatsapp_sent: true,
      whatsapp_skipped_reason: null,
    };
  } catch (err: unknown) {
    const detail =
      err && typeof err === 'object' && 'detail' in err
        ? JSON.stringify((err as { detail?: unknown }).detail)
        : err instanceof Error
          ? err.message
          : 'Falha no envio WhatsApp';
    await supabase
      .from('billing_payslip_tokens')
      .update({ last_send_error: detail.slice(0, 2000) })
      .eq('workspace_id', input.workspaceId)
      .eq('token_hash', hashPayslipToken(issued.token));
    return {
      payslip: withLink,
      token: issued.token,
      public_url: issued.publicUrl,
      expires_at: issued.expiresAt,
      whatsapp_sent: false,
      whatsapp_skipped_reason: `WhatsApp não enviado (template Meta ${template.name}). Confira se o modelo está aprovado. Link gerado. Detalhe: ${detail.slice(0, 280)}`,
    };
  }
}

export async function revokePayslipTokens(workspaceId: string, payableId: string) {
  await revokeActiveTokens(workspaceId, payableId);
}

export async function loadPublicPayslip(token: string): Promise<DriverPayslip | null> {
  const tokenHash = hashPayslipToken(token);
  const { data: row, error } = await supabase
    .from('billing_payslip_tokens')
    .select('workspace_id, payable_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) return null;

  const payslip = await buildDriverPayslip({
    workspaceId: String(row.workspace_id),
    payableId: String(row.payable_id),
  });
  if (!payslip) return null;

  await supabase
    .from('billing_payslip_tokens')
    .update({ last_viewed_at: new Date().toISOString() })
    .eq('token_hash', tokenHash);

  return {
    ...payslip,
    send: {
      ...payslip.send,
      public_url: resolvePayslipPublicUrl(token),
      expires_at: String(row.expires_at),
      revoked: false,
    },
  };
}
