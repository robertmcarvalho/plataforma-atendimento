import { createHash, randomInt, randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { insertLeaderFinancialEntries } from '../lib/leaderFinancialEntries';
import { generateInstallments } from '../lib/financialInstallments';
import { splitSupplyDiscountAmount } from '../lib/supplyDiscountSplit';
import { syncDriverLeaderContext } from '../lib/driverLeaderSync';
import { normalizeNameLike } from '../lib/textNormalization';
import { authenticate } from '../middleware/authenticate';
import { getWorkspaceWhatsAppChannel } from '../lib/channelResolver';
import { writeAuditLog } from '../lib/auditLog';
import { normalizeWaPhoneForStorage, upsertContactByWaPhone } from '../lib/contactByPhone';
import {
  assertPharmaciesInLeaderScope,
  getLeaderManagedPharmacyIds,
  formatLeaderPharmacyAddressLine,
  getDriversForLeaderPortal,
  isDriverInLeaderScope,
} from '../lib/leaderPortalScope';
import { readWorkspaceSetting, upsertWorkspaceSetting } from '../lib/workspaceSettings';
import { listIntakeDemandsForLeader, startLeaderPortalConversation } from '../lib/leaderConversationStart';
import {
  createPreCadastroBundle,
  createTerminationRequestBundle,
} from '../lib/driverLifecycleBundles';
import { fetchLeaderPortalDashboard } from '../lib/leaderPortalDashboard';
import { FinancialEntryStatus, OccurrenceKind } from '@plataforma/operational-notes';
import {
  cancelLeaderPortalFinancialEntry,
  computeLeaderPortalStats,
  findDuplicateOpenOccurrences,
  getLeaderPortalFinancialEntryDetail,
  listLeaderPortalFinancialEntries,
} from '../lib/leaderPortalFinancialEntries';
import { getLeaderId, getLeaderWorkspaceId } from '../lib/leaderPortalRequest';

function resolveOtpSecret(): string {
  const dedicated = process.env.LEADER_WHATSAPP_OTP_SECRET?.trim();
  if (dedicated) return dedicated;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('LEADER_WHATSAPP_OTP_SECRET é obrigatório em produção.');
  }
  const fallback =
    process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    'leader-otp-dev-secret';
  return fallback;
}

async function resolveSectorIdsByName(
  workspaceId: string,
  names: string[]
): Promise<Record<string, string | null>> {
  const out = Object.fromEntries(names.map((n) => [n, null])) as Record<string, string | null>;
  if (!workspaceId) return out;
  const { data, error } = await supabase
    .from('sectors')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .in('name', names);
  if (error) throw new Error(error.message);
  for (const row of data || []) {
    const name = String(row.name || '');
    if (name in out) out[name] = String(row.id);
  }
  return out;
}

function onlyDigits(input: string) {
  return String(input || '').replace(/\D/g, '');
}

function devRoutesEnabled() {
  return process.env.ENABLE_DEV_ROUTES === 'true';
}

function normalizePhoneE164(input: string): string | null {
  const d = onlyDigits(input);
  if (!d) return null;
  if (d.startsWith('55') && d.length >= 12 && d.length <= 13) return `+${d}`;
  if (d.length >= 10 && d.length <= 11) return `+55${d}`;
  return null;
}

function otpSecret() {
  return resolveOtpSecret();
}

function hashOtp(leaderId: string, phoneE164: string, code: string) {
  return createHash('sha256').update(`${otpSecret()}:${leaderId}:${phoneE164}:${code}`).digest('hex');
}

function otpTemplateConfig() {
  return {
    name:
      process.env.LEADER_WHATSAPP_OTP_TEMPLATE_NAME?.trim() ||
      process.env.WHATSAPP_OTP_TEMPLATE_NAME?.trim() ||
      '',
    language:
      process.env.LEADER_WHATSAPP_OTP_TEMPLATE_LANGUAGE?.trim() ||
      process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE?.trim() ||
      'pt_BR',
  };
}

async function sendMetaMessage(workspaceId: string, payload: Record<string, unknown>) {
  const channel = await getWorkspaceWhatsAppChannel(workspaceId);
  const phoneNumberId = String(channel?.external_id || channel?.credentials?.phone_number_id || '').trim();
  const accessToken = String(channel?.credentials?.access_token || '').trim();
  if (!phoneNumberId || !accessToken) {
    throw new Error('Canal WhatsApp do workspace não configurado.');
  }
  const version = process.env.META_GRAPH_VERSION?.trim() || 'v21.0';
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_subcode?: number };
    messages?: Array<{ id?: string }>;
  };
  if (!res.ok) {
    throw new Error(`Meta WhatsApp ${res.status}: ${JSON.stringify(body || res.statusText)}`);
  }
  if (body.error) {
    const msg = body.error.message || JSON.stringify(body.error);
    throw new Error(`Meta WhatsApp: ${msg}`);
  }
  if (!body.messages?.[0]?.id) {
    throw new Error('Meta WhatsApp respondeu sem ID de mensagem (envio não confirmado).');
  }
  return body;
}

async function sendLeaderOtp(workspaceId: string, phoneE164: string, code: string) {
  const to = onlyDigits(phoneE164);
  const template = otpTemplateConfig();
  if (!template.name && process.env.NODE_ENV === 'production') {
    throw new Error(
      'OTP WhatsApp em produção exige template Meta aprovado. Configure LEADER_WHATSAPP_OTP_TEMPLATE_NAME no Cloud Run (categoria authentication/utility com variável para o código).'
    );
  }
  if (template.name) {
    // Templates AUTHENTICATION (copy code) exigem body + botão com o mesmo OTP — ver Meta auth-otp docs.
    const components: Array<Record<string, unknown>> = [
      {
        type: 'body',
        parameters: [{ type: 'text', text: code }],
      },
    ];
    if (process.env.LEADER_WHATSAPP_OTP_COPY_CODE_BUTTON !== 'false') {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: code }],
      });
    }
    return sendMetaMessage(workspaceId, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        components,
      },
    });
  }

  return sendMetaMessage(workspaceId, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: {
      body: `Seu código de verificação da plataforma é ${code}. Ele expira em 5 minutos. Não compartilhe com ninguém.`,
      preview_url: false,
    },
  });
}

async function latestWhatsappVerification(leaderId: string) {
  const { data } = await supabase
    .from('leader_whatsapp_verifications')
    .select('*')
    .eq('leader_id', leaderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Record<string, unknown> | null) || null;
}

function whatsappStatus(leader: Record<string, unknown>, latest: Record<string, unknown> | null) {
  const phone = String(leader.phone || latest?.phone_e164 || '').trim() || null;
  const verifiedAt = leader.whatsapp_verified_at ? String(leader.whatsapp_verified_at) : null;
  const revokedAt = leader.whatsapp_session_revoked_at ? String(leader.whatsapp_session_revoked_at) : null;
  const verified = Boolean(verifiedAt && phone && (!revokedAt || new Date(revokedAt) <= new Date(verifiedAt)));

  if (verified) {
    return { status: 'verified', connected: true, phone_e164: phone, verified_at: verifiedAt };
  }

  if (latest?.status === 'pending') {
    const expiresAt = latest.expires_at ? String(latest.expires_at) : null;
    const expired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;
    return {
      status: expired ? 'expired' : 'pending',
      connected: false,
      phone_e164: String(latest.phone_e164 || phone || ''),
      expires_at: expiresAt,
    };
  }

  return { status: 'unlinked', connected: false, phone_e164: phone, verified_at: null };
}

export async function leaderPortalRoutes(app: FastifyInstance) {
  // Middleware to ensure the user is a leader and load the leaderId
  app.addHook('preHandler', async (request, reply) => {
    try {
      await authenticate(request, reply);
      const user = request.user as { sub: string; role: string; platform_role?: string };
      const role = String(user.role || '').toLowerCase();
      const platformRole = String(user.platform_role || '').toLowerCase();
      if (role !== 'leader' && !['platform_admin', 'platform_owner'].includes(platformRole)) {
        return reply.status(403).send({ error: 'Acesso restrito ao portal do líder.' });
      }

      // Get the leader profile linked to the user
      const { data: leader, error } = await supabase
        .from('leaders')
        .select('id, workspace_id')
        .eq('user_id', user.sub)
        .single();

      if (error || !leader) {
        console.error('Leader profile not found for user:', user.sub, error);
        return reply.status(403).send({ error: 'Acesso negado. Perfil de líder não encontrado para este usuário.' });
      }

      request.leaderId = String(leader.id);
      request.leaderWorkspaceId = String(leader.workspace_id);
    } catch (err) {
      return reply.status(401).send({ error: 'Não autenticado' });
    }
  });

  // GET /api/leader-portal/debug
  app.get('/debug', async (request, reply) => {
    if (!devRoutesEnabled()) return reply.status(404).send({ error: 'Not found' });
    return reply.send({
      user: request.user,
      leaderId: getLeaderId(request)
    });
  });

  // GET /api/leader-portal/me — dados do líder + status de vínculo WhatsApp por OTP
  app.get('/me', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const { data: leader, error } = await supabase
      .from('leaders')
      .select('id, name, phone, workspace_id, whatsapp_verified_at, whatsapp_session_revoked_at')
      .eq('id', leaderId)
      .single();

    if (error || !leader) return reply.status(404).send({ error: 'Líder não encontrado' });

    const workspaceId = getLeaderWorkspaceId(request, String(leader.workspace_id || ''));
    const settingVal = workspaceId
      ? await readWorkspaceSetting(workspaceId, 'workspace_whatsapp_business_e164').catch(() => null)
      : null;
    const envVal = process.env.WORKSPACE_WHATSAPP_BUSINESS_E164?.trim() || '';
    const businessE164 = (typeof settingVal === 'string' ? settingVal : envVal) || '';
    const latest = await latestWhatsappVerification(leaderId).catch(() => null);
    const status = whatsappStatus(leader as Record<string, unknown>, latest);

    return reply.send({
      leader: { id: leader.id, name: leader.name, phone: leader.phone || null },
      whatsapp: {
        ...status,
        business_e164: businessE164 || null,
      },
    });
  });

  app.get('/intake/demands', async (request, reply) => {
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });

    const q = request.query as { sector_id?: string; driver_id?: string };
    const sectorId = String(q.sector_id || '').trim();
    if (!sectorId) return reply.status(400).send({ error: 'Informe sector_id.' });

    const driverId = q.driver_id?.trim() || null;
    try {
      const result = await listIntakeDemandsForLeader({
        workspaceId,
        sectorId,
        driverId,
      });
      return reply.send(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao listar demandas.';
      return reply.status(400).send({ error: msg });
    }
  });

  app.post('/conversations/start', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    const user = request.user as { sub: string };
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });

    const parsed = z
      .object({
        pharmacy_id: z.string().uuid(),
        driver_id: z.string().uuid().nullable().optional(),
        sector_id: z.string().uuid(),
        demand_key: z.string().min(1),
        initial_message: z.string().min(1).optional(),
      })
      .safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }

    try {
      const result = await startLeaderPortalConversation({
        leaderId,
        userId: user.sub,
        workspaceId,
        pharmacy_id: parsed.data.pharmacy_id,
        driver_id: parsed.data.driver_id ?? null,
        sector_id: parsed.data.sector_id,
        demand_key: parsed.data.demand_key,
        initial_message: parsed.data.initial_message,
      });

      await writeAuditLog({
        actor_id: user.sub,
        action: 'leader.conversation.start',
        entity_type: 'conversation',
        entity_id: result.conversation.id,
        metadata: {
          pharmacy_id: parsed.data.pharmacy_id,
          driver_id: parsed.data.driver_id ?? null,
          sector_id: parsed.data.sector_id,
          demand_key: parsed.data.demand_key,
        },
      });

      return reply.status(201).send({
        id: result.conversation.id,
        status: result.conversation.status,
        sector_name: result.sector_name,
        demand_key: parsed.data.demand_key,
        demand_title: result.demand_title,
        pharmacy_label: result.pharmacy_label,
        driver_name: result.driver_name,
        demand_profile: result.demand_profile,
      });
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message || 'Falha ao iniciar conversa.' });
    }
  });

  app.post('/whatsapp/otp/start', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });

    const parsed = z.object({ phone_e164: z.string().min(8) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Informe phone_e164 válido.' });

    const phoneE164 = normalizePhoneE164(parsed.data.phone_e164);
    if (!phoneE164) return reply.status(400).send({ error: 'Número inválido. Use DDD + telefone ou E.164.' });

    const since = new Date(Date.now() - 15 * 60000).toISOString();
    const { count } = await supabase
      .from('leader_whatsapp_verifications')
      .select('id', { count: 'exact', head: true })
      .eq('leader_id', leaderId)
      .gte('created_at', since);
    if ((count || 0) >= 3) {
      return reply.status(429).send({ error: 'Muitas tentativas. Aguarde alguns minutos para reenviar o código.' });
    }

    await supabase
      .from('leader_whatsapp_verifications')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('leader_id', leaderId)
      .eq('status', 'pending');

    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 5 * 60000).toISOString();
    const { data: verification, error } = await supabase
      .from('leader_whatsapp_verifications')
      .insert({
        workspace_id: workspaceId,
        leader_id: leaderId,
        phone_e164: phoneE164,
        code_hash: hashOtp(leaderId, phoneE164, code),
        expires_at: expiresAt,
        status: 'pending',
      })
      .select('id, phone_e164, expires_at, status')
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    try {
      await sendLeaderOtp(workspaceId, phoneE164, code);
    } catch (e) {
      await supabase
        .from('leader_whatsapp_verifications')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', verification.id);
      return reply.status(502).send({ error: e instanceof Error ? e.message : 'Falha ao enviar OTP via WhatsApp.' });
    }

    await writeAuditLog({
      actor_id: (request.user as { sub?: string }).sub || null,
      action: 'leader.whatsapp_otp.start',
      entity_type: 'leader',
      entity_id: leaderId,
      metadata: { phone_e164: phoneE164, workspace_id: workspaceId },
    });

    return reply.send({
      ok: true,
      status: 'pending',
      phone_e164: phoneE164,
      expires_at: expiresAt,
      debug_code: devRoutesEnabled() ? code : undefined,
    });
  });

  app.post('/whatsapp/otp/verify', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Código inválido.' });

    const { data: verification, error } = await supabase
      .from('leader_whatsapp_verifications')
      .select('*')
      .eq('leader_id', leaderId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!verification) return reply.status(404).send({ error: 'Nenhum código pendente. Solicite um novo código.' });

    const row = verification as Record<string, unknown>;
    if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
      await supabase
        .from('leader_whatsapp_verifications')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', row.id);
      return reply.status(410).send({ error: 'Código expirado. Solicite um novo código.' });
    }

    const attempts = Number(row.attempts || 0);
    const phoneE164 = String(row.phone_e164);
    const ok = String(row.code_hash) === hashOtp(leaderId, phoneE164, parsed.data.code);
    if (!ok) {
      const nextAttempts = attempts + 1;
      await supabase
        .from('leader_whatsapp_verifications')
        .update({
          attempts: nextAttempts,
          status: nextAttempts >= 5 ? 'failed' : 'pending',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      return reply.status(400).send({
        error: nextAttempts >= 5 ? 'Muitas tentativas inválidas. Solicite um novo código.' : 'Código incorreto.',
      });
    }

    const now = new Date().toISOString();
    const updLeader = await supabase
      .from('leaders')
      .update({
        phone: phoneE164,
        whatsapp_verified_at: now,
        whatsapp_session_revoked_at: null,
        updated_at: now,
      })
      .eq('id', leaderId)
      .select('id, name, phone')
      .single();
    if (updLeader.error) return reply.status(500).send({ error: updLeader.error.message });

    await supabase
      .from('leader_whatsapp_verifications')
      .update({ status: 'verified', verified_at: now, updated_at: now })
      .eq('id', row.id);

    const leader = updLeader.data;
    const leaderWaPhone = normalizeWaPhoneForStorage(onlyDigits(phoneE164)) || onlyDigits(phoneE164);
    const { data: existingByLeaderRows } = await supabase
      .from('contacts')
      .select('id, wa_phone')
      .eq('workspace_id', workspaceId)
      .eq('leader_id', leaderId)
      .order('updated_at', { ascending: false });
    const existingByLeader = (existingByLeaderRows || [])[0] ?? null;
    try {
      if (existingByLeader?.id) {
        const { error: updErr } = await supabase
          .from('contacts')
          .update({
            wa_phone: leaderWaPhone,
            display_name: leader.name,
            profile_type: 'leader',
            leader_id: leaderId,
            updated_at: now,
          })
          .eq('id', existingByLeader.id);
        if (updErr?.code === '23505') {
          // Phone already owned by another contact — detach this row and attach leader to the phone row.
          await supabase
            .from('contacts')
            .update({ leader_id: null, updated_at: now })
            .eq('id', existingByLeader.id);
          await upsertContactByWaPhone(supabase, workspaceId, leaderWaPhone, {
            display_name: leader.name,
            profile_type: 'leader',
            leader_id: leaderId,
          });
        } else if (updErr) {
          throw new Error(updErr.message);
        }
        // Detach duplicate +E.164 / digits twin rows for the same leader.
        for (const twin of existingByLeaderRows || []) {
          if (String(twin.id) === String(existingByLeader.id)) continue;
          await supabase
            .from('contacts')
            .update({ leader_id: null, updated_at: now })
            .eq('id', twin.id);
        }
      } else {
        await upsertContactByWaPhone(supabase, workspaceId, leaderWaPhone, {
          display_name: leader.name,
          profile_type: 'leader',
          leader_id: leaderId,
        });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Falha ao sincronizar contato do líder';
      return reply.status(500).send({ error: message });
    }

    await writeAuditLog({
      actor_id: (request.user as { sub?: string }).sub || null,
      action: 'leader.whatsapp_otp.verify',
      entity_type: 'leader',
      entity_id: leaderId,
      metadata: { phone_e164: phoneE164, workspace_id: workspaceId },
    });

    return reply.send({ ok: true, status: 'verified', phone_e164: phoneE164, verified_at: now });
  });

  app.post('/whatsapp/reconnect', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });
    const { data: leader } = await supabase.from('leaders').select('phone').eq('id', leaderId).single();
    const body = request.body as { phone_e164?: string } | null;
    const phone = normalizePhoneE164(body?.phone_e164 || String(leader?.phone || ''));
    if (!phone) return reply.status(400).send({ error: 'Informe um telefone válido para reconectar.' });

    await supabase
      .from('leaders')
      .update({ whatsapp_session_revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', leaderId);

    await writeAuditLog({
      actor_id: (request.user as { sub?: string }).sub || null,
      action: 'leader.whatsapp_reconnect',
      entity_type: 'leader',
      entity_id: leaderId,
      metadata: { phone_e164: phone, workspace_id: workspaceId },
    });

    const since = new Date(Date.now() - 15 * 60000).toISOString();
    const { count } = await supabase
      .from('leader_whatsapp_verifications')
      .select('id', { count: 'exact', head: true })
      .eq('leader_id', leaderId)
      .gte('created_at', since);
    if ((count || 0) >= 3) {
      return reply.status(429).send({ error: 'Muitas tentativas. Aguarde alguns minutos para reenviar o código.' });
    }

    await supabase
      .from('leader_whatsapp_verifications')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('leader_id', leaderId)
      .eq('status', 'pending');

    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 5 * 60000).toISOString();
    const { data: verification, error } = await supabase
      .from('leader_whatsapp_verifications')
      .insert({
        workspace_id: workspaceId,
        leader_id: leaderId,
        phone_e164: phone,
        code_hash: hashOtp(leaderId, phone, code),
        expires_at: expiresAt,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    try {
      await sendLeaderOtp(workspaceId, phone, code);
    } catch (e) {
      await supabase
        .from('leader_whatsapp_verifications')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', verification.id);
      return reply.status(502).send({ error: e instanceof Error ? e.message : 'Falha ao enviar OTP via WhatsApp.' });
    }

    return reply.send({
      ok: true,
      status: 'pending',
      phone_e164: phone,
      expires_at: expiresAt,
      debug_code: devRoutesEnabled() ? code : undefined,
    });
  });

  // POST /api/leader-portal/whatsapp/dev-simulate-inbound — simula um inbound para validar "conexão" no portal
  // Útil quando o webhook da Meta não está apontando para o ambiente local.
  app.post('/whatsapp/dev-simulate-inbound', async (request, reply) => {
    if (!devRoutesEnabled()) return reply.status(404).send({ error: 'Not found' });

    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(412).send({ error: 'Workspace do líder não resolvido.' });

    const leaderRow = await supabase.from('leaders').select('id, name, phone').eq('id', leaderId).single();
    if (leaderRow.error || !leaderRow.data) return reply.status(404).send({ error: 'Líder não encontrado' });

    const inboundBody = z.object({ content: z.string().optional() }).safeParse(request.body);
    const content = String(inboundBody.success ? inboundBody.data.content : 'Olá! (simulado)').trim() || 'Olá! (simulado)';
    const now = new Date().toISOString();

    let { data: contact } = await supabase
      .from('contacts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('leader_id', leaderId)
      .maybeSingle();
    if (!contact) {
      const wa =
        normalizeWaPhoneForStorage(String(leaderRow.data.phone || '')) ||
        `leader_${leaderId.slice(0, 8)}`;
      try {
        const upserted = await upsertContactByWaPhone(supabase, workspaceId, wa, {
          display_name: leaderRow.data.name,
          profile_type: 'leader',
          leader_id: leaderId,
        });
        contact = upserted.contact;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Falha ao resolver contato';
        return reply.status(500).send({ error: message });
      }
    }

    let { data: conv } = await supabase
      .from('conversations')
      .select('id, status')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contact.id)
      .neq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conv) {
      const ins = await supabase
        .from('conversations')
        .insert({
          workspace_id: workspaceId,
          contact_id: contact.id,
          status: 'open',
          priority: 'normal',
          opened_at: now,
          last_message_at: now,
          context_leader_id: leaderId,
        })
        .select('id, status')
        .single();
      if (ins.error) return reply.status(500).send({ error: ins.error.message });
      conv = ins.data;
    }

    const msgIns = await supabase.from('messages').insert({
      workspace_id: workspaceId,
      conversation_id: conv.id,
      direction: 'inbound',
      type: 'text',
      content,
      status: 'sent',
      created_at: now,
    });
    if (msgIns.error) return reply.status(500).send({ error: msgIns.error.message });

    await supabase.from('conversations').update({ last_message_at: now, updated_at: now }).eq('id', conv.id);

    return reply.send({ ok: true, conversation_id: conv.id });
  });

  // POST /api/leader-portal/whatsapp/dev-set-business — define o número do WhatsApp do negócio (apenas dev)
  app.post('/whatsapp/dev-set-business', async (request, reply) => {
    if (!devRoutesEnabled()) return reply.status(404).send({ error: 'Not found' });

    const schema = z.object({ business_e164: z.string().min(8) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Informe business_e164' });

    const digits = onlyDigits(parsed.data.business_e164);
    if (!digits || digits.length < 10) return reply.status(400).send({ error: 'Número inválido' });

    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(412).send({ error: 'Workspace do líder não resolvido.' });
    await upsertWorkspaceSetting(workspaceId, 'workspace_whatsapp_business_e164', `+${digits}`);
    return reply.send({ ok: true, business_e164: `+${digits}` });
  });

  // GET /api/leader-portal/dashboard — tarefas e assinaturas pendentes da equipe
  app.get('/dashboard', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(412).send({ error: 'Workspace do líder não resolvido.' });

    try {
      const payload = await fetchLeaderPortalDashboard(supabase, leaderId, workspaceId);
      return reply.send(payload);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao carregar painel' });
    }
  });

  // GET /api/leader-portal/stats
  app.get('/stats', async (request, reply) => {
    const leaderId = getLeaderId(request);

    const workspaceId = getLeaderWorkspaceId(request);
    const pharmacyIds = await getLeaderManagedPharmacyIds(supabase, leaderId, workspaceId);

    let driverIds: string[] = [];
    if (pharmacyIds.length) {
      const { data: driverLinks } = await supabase
        .from('driver_pharmacy_links')
        .select('driver_id')
        .in('pharmacy_id', pharmacyIds)
        .eq('is_active', true);
      driverIds = Array.from(new Set(driverLinks?.map((d) => d.driver_id) || []));
    }

    if (!pharmacyIds.length) {
      return reply.send({
        pharmacies_count: 0,
        drivers_count: 0,
        pending_absences: 0,
        pending_dailies: 0,
        open_entries: 0,
        base_revenue: 0,
        bonuses: 0,
        discounts: 0,
        net_estimated: 0,
      });
    }

    const portalStats = await computeLeaderPortalStats(supabase, {
      workspaceId,
      pharmacyIds,
      driversCount: driverIds.length,
    });

    // 4. Financial Sums
    const { data: revenueData } = driverIds.length
      ? await supabase
          .from('financial_import_rows')
          .select('gross_amount')
          .eq('workspace_id', workspaceId)
          .in('driver_id', driverIds)
      : { data: [] as { gross_amount?: unknown }[] };

    const baseRevenue = revenueData?.reduce((acc, curr) => acc + Number(curr.gross_amount), 0) || 0;

    const { data: entriesData } = driverIds.length
      ? await supabase
          .from('financial_entries')
          .select('type, total_amount')
          .eq('workspace_id', workspaceId)
          .in('driver_id', driverIds)
          .eq('status', 'approved')
      : { data: [] as { type?: string; total_amount?: unknown }[] };
    
    const bonuses = entriesData?.filter(e => e.type === 'daily').reduce((acc, curr) => acc + Number(curr.total_amount), 0) || 0;
    const discounts = entriesData?.filter(e => ['absence', 'uniform', 'bag'].includes(e.type)).reduce((acc, curr) => acc + Number(curr.total_amount), 0) || 0;

    return reply.send({
      ...portalStats,
      base_revenue: baseRevenue,
      bonuses: bonuses,
      discounts: discounts,
      net_estimated: baseRevenue + bonuses - discounts
    });
  });

  // GET /api/leader-portal/pharmacies
  app.get('/pharmacies', async (request, reply) => {
    const leaderId = getLeaderId(request);
    const workspaceId = getLeaderWorkspaceId(request);
    const pharmacyIds = await getLeaderManagedPharmacyIds(supabase, leaderId, workspaceId);
    if (!pharmacyIds.length) return reply.send([]);

    const { data, error } = await supabase
      .from('pharmacies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('id', pharmacyIds)
      .order('trade_name');

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(
      (data || []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          ...r,
          address_line: formatLeaderPharmacyAddressLine(r),
        };
      })
    );
  });

  // PATCH /api/leader-portal/drivers/:id/schedule — apenas escala (work_schedule)
  app.patch('/drivers/:id/schedule', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });
    const { id } = request.params as { id: string };

    const schema = z.object({
      work_schedule: z.record(z.unknown()),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Envie apenas work_schedule (objeto)' });

    const ok = await isDriverInLeaderScope(supabase, leaderId, id);
    if (!ok) return reply.status(403).send({ error: 'Entregador fora da sua rede' });

    const { data, error } = await supabase
      .from('drivers')
      .update({
        work_schedule: body.data.work_schedule as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // GET /api/leader-portal/drivers/:id — ficha completa (somente leitura na UI; escala via PATCH acima)
  app.get('/drivers/:id', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });
    const { id } = request.params as { id: string };

    const ok = await isDriverInLeaderScope(supabase, leaderId, id);
    if (!ok) return reply.status(403).send({ error: 'Entregador fora da sua rede' });

    const { data, error } = await supabase
      .from('drivers')
      .select(
        `
        *,
        primary_pharmacy:pharmacies!primary_pharmacy_id(id, trade_name, city),
        driver_pharmacy_links(is_primary, is_active, pharmacies(id, trade_name, city))
      `
      )
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();

    if (error) return reply.status(404).send({ error: 'Entregador não encontrado' });
    return reply.send(data);
  });

  // GET /api/leader-portal/drivers
  app.get('/drivers', async (request, reply) => {
    const leaderId = getLeaderId(request);

    try {
      const rows = await getDriversForLeaderPortal(supabase, leaderId);
      return reply.send(rows);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao listar entregadores' });
    }
  });

  // GET /api/leader-portal/document-alerts — alertas de vencimento CNH/certificado
  app.get('/document-alerts', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const leaderUserId = (request.user as { sub: string }).sub;

    const { data, error } = await supabase
      .from('pending_tasks')
      .select('*, driver:drivers(id, name, phone, status, cnh_expires_at, has_digital_certificate, digital_certificate_expires_at)')
      .in('task_type', ['driver_doc_expiry_warning', 'driver_doc_expired'])
      .in('status', ['open', 'in_progress'])
      .or(`assignee_id.eq.${leaderUserId},metadata->>leader_id.eq.${leaderId}`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  // GET /api/leader-portal/termination-requests — solicitações recentes de desligamento do líder
  app.get('/termination-requests', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const { data, error } = await supabase
      .from('pending_tasks')
      .select('*, driver:drivers(id, name, phone, status)')
      .in('task_type', ['driver_termination_request', 'driver_termination_financial_review'])
      .eq('metadata->>leader_id', leaderId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  // POST /api/leader-portal/termination-requests — cria demanda de Desligamento para Operacional e Financeiro
  app.post('/termination-requests', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    const schema = z.object({
      driver_id: z.string().uuid(),
      last_worked_at: z.string().min(8),
      reason: z.enum(['driver_request', 'performance', 'absence', 'route_ended', 'other']),
      notes: z.string().trim().max(2000).optional().nullable(),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const ok = await isDriverInLeaderScope(supabase, leaderId, body.data.driver_id);
    if (!ok) return reply.status(403).send({ error: 'Entregador fora da sua rede' });

    try {
      const result = await createTerminationRequestBundle(supabase, {
        workspaceId,
        driverId: body.data.driver_id,
        leaderId,
        initiatedBy: (request.user as { sub?: string }).sub || null,
        source: 'leader_portal',
      last_worked_at: body.data.last_worked_at,
      reason: body.data.reason,
      notes: body.data.notes || null,
      });

    await writeAuditLog({
      actor_id: (request.user as { sub?: string }).sub || null,
      action: 'leader.driver_termination.request',
      entity_type: 'driver',
      entity_id: body.data.driver_id,
        metadata: { request_id: result.request_id, leader_id: leaderId },
      });

      return reply.status(201).send(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao criar solicitação';
      const status =
        msg.includes('Já existe') || msg.includes('inativo') ? 409 : msg.includes('não encontrado') ? 404 : 500;
      return reply.status(status).send({ error: msg });
    }
  });

  // GET /api/leader-portal/pre-registrations — entregadores em pré-cadastro (tag cadastro-pendente)
  app.get('/pre-registrations', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    const pharmacyIds = await getLeaderManagedPharmacyIds(supabase, leaderId, workspaceId);
    if (!pharmacyIds.length) return reply.send([]);

    const { data: links, error: lErr } = await supabase
      .from('driver_pharmacy_links')
      .select('driver_id')
      .in('pharmacy_id', pharmacyIds)
      .eq('is_active', true);
    if (lErr) return reply.status(500).send({ error: lErr.message });

    const driverIds = Array.from(new Set((links || []).map((l: any) => l.driver_id).filter(Boolean)));
    if (!driverIds.length) return reply.send([]);

    const { data: drivers, error } = await supabase
      .from('drivers')
      .select('id, name, phone, email, city, state, status, driver_type, work_schedule, primary_pharmacy_id, tags, created_at')
      .in('id', driverIds)
      .contains('tags', ['cadastro-pendente'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(drivers || []);
  });

  // POST /api/leader-portal/pre-registrations — cria entregador "inativo/pending" + vínculos + tarefa
  app.post('/pre-registrations', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });
    const schema = z.object({
      name: z.string().min(2),
      cpf: z.string().optional().nullable(),
      phone: z.string().min(10),
      email: z.string().email().optional().nullable(),
      city: z.string().optional().nullable(),
      state: z.string().optional().nullable(),
      driver_type: z.enum(['fixed', 'daily']).default('fixed'),
      work_schedule: z.record(z.unknown()).optional(),
      pharmacy_ids: z.array(z.string().uuid()).min(1),
      primary_pharmacy_id: z.string().uuid().optional().nullable(),
      notes: z.string().optional().nullable(),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const managed = new Set(await getLeaderManagedPharmacyIds(supabase, leaderId, workspaceId));
    if (!managed.size) return reply.status(403).send({ error: 'Nenhuma farmácia vinculada ao líder' });

    const uniquePharmacyIds = Array.from(new Set(body.data.pharmacy_ids.filter(Boolean)));
    const primaryPharmacyId = body.data.primary_pharmacy_id || uniquePharmacyIds[0] || null;
    if (!primaryPharmacyId) return reply.status(400).send({ error: 'Informe pharmacy_ids' });

    for (const pid of uniquePharmacyIds) {
      if (!managed.has(pid)) return reply.status(403).send({ error: 'Farmácia fora da sua rede' });
    }
    if (!managed.has(primaryPharmacyId)) return reply.status(403).send({ error: 'Farmácia primária fora da sua rede' });

    try {
      const result = await createPreCadastroBundle(supabase, {
        workspaceId,
        leaderId,
        initiatedBy: (request.user as { sub?: string }).sub || null,
        source: 'leader_portal',
        name: body.data.name,
      cpf: body.data.cpf || null,
      phone: body.data.phone,
      email: body.data.email || null,
      city: body.data.city || null,
      state: body.data.state || null,
      driver_type: body.data.driver_type,
        work_schedule: body.data.work_schedule as Record<string, unknown> | undefined,
        pharmacy_ids: uniquePharmacyIds,
      primary_pharmacy_id: primaryPharmacyId,
      notes: body.data.notes || null,
      });
      return reply.status(201).send({
        driver: result.driver,
        pharmacy_ids: result.pharmacy_ids,
        tasks: result.tasks,
        request_id: result.request_id,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha no pré-cadastro';
      const status = msg.includes('Já existe') ? 409 : 500;
      return reply.status(status).send({ error: msg });
    }
  });

  const leaderFinancialListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status_group: z.enum(['open', 'all', 'done', 'cancelled']).optional(),
    occurrence_type: z
      .enum(['all', 'contracted_daily', 'coverage_daily', 'unexcused', 'day_off'])
      .optional(),
    date_field: z.enum(['event', 'created']).optional(),
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    pharmacy_id: z.string().uuid().optional(),
    driver_id: z.string().uuid().optional(),
  });

  // GET /api/leader-portal/financial-entries/duplicate-check
  app.get('/financial-entries/duplicate-check', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });

    const parsed = z
      .object({
        driver_id: z.string().uuid(),
        event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        pharmacy_id: z.string().uuid(),
      })
      .safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Parâmetros inválidos', details: parsed.error.flatten() });

    const pharmacyIds = await getLeaderManagedPharmacyIds(supabase, leaderId, workspaceId);
    try {
      const duplicates = await findDuplicateOpenOccurrences(supabase, {
        workspaceId,
        pharmacyIds,
        driverId: parsed.data.driver_id,
        eventDate: parsed.data.event_date,
        pharmacyId: parsed.data.pharmacy_id,
      });
      return reply.send({ duplicates });
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao verificar duplicatas' });
    }
  });

  // GET /api/leader-portal/financial-entries — acompanhamento de ocorrências / diárias
  app.get('/financial-entries', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });

    const parsed = leaderFinancialListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Parâmetros inválidos', details: parsed.error.flatten() });

    const pharmacyIds = await getLeaderManagedPharmacyIds(supabase, leaderId, workspaceId);
    try {
      const result = await listLeaderPortalFinancialEntries(supabase, {
        workspaceId,
        pharmacyIds,
        page: parsed.data.page,
        limit: parsed.data.limit,
        status_group: parsed.data.status_group ?? 'open',
        occurrence_type: parsed.data.occurrence_type,
        date_field: parsed.data.date_field ?? 'event',
        date_from: parsed.data.date_from,
        date_to: parsed.data.date_to,
        pharmacy_id: parsed.data.pharmacy_id,
        driver_id: parsed.data.driver_id,
      });
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao listar lançamentos' });
    }
  });

  // GET /api/leader-portal/financial-entries/:id — detalhe read-only
  app.get('/financial-entries/:id', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });

    const { id } = request.params as { id: string };
    const pharmacyIds = await getLeaderManagedPharmacyIds(supabase, leaderId, workspaceId);
    const user = request.user as { sub: string };

    try {
      const detail = await getLeaderPortalFinancialEntryDetail(supabase, {
        workspaceId,
        pharmacyIds,
        entryId: id,
        actorUserId: user.sub,
      });
      if (!detail) return reply.status(404).send({ error: 'Lançamento não encontrado' });
      return reply.send(detail);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao carregar detalhe' });
    }
  });

  // POST /api/leader-portal/financial-entries/:id/cancel
  app.post('/financial-entries/:id/cancel', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });

    const { id } = request.params as { id: string };
    const body = z
      .object({
        cancel_reason: z.string().trim().min(10, 'Informe o motivo do cancelamento (mínimo 10 caracteres).'),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const pharmacyIds = await getLeaderManagedPharmacyIds(supabase, leaderId, workspaceId);
    const user = request.user as { sub: string };

    try {
      const result = await cancelLeaderPortalFinancialEntry(supabase, {
        workspaceId,
        pharmacyIds,
        entryId: id,
        cancelReason: body.data.cancel_reason,
        actorId: user.sub,
        leaderId,
      });
      return reply.send(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao cancelar lançamento';
      const status =
        msg.includes('não encontrado') || msg.includes('fora da sua rede') ? 404 : msg.includes('Só é possível') ? 400 : 500;
      return reply.status(status).send({ error: msg });
    }
  });

  // POST /api/leader-portal/occurrences — falta/folga + cobertura (Parte A)
  app.post('/occurrences', async (request, reply) => {
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });

    const schema = z.object({
      driver_id: z.string().uuid(),
      pharmacy_ids: z.array(z.string().uuid()).min(1),
      event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      shift: z.enum(['full', 'morning', 'afternoon', 'night']).optional(),
      occurrence_kind: z.enum(['unexcused', 'day_off', 'contracted_daily']),
      has_coverage: z.boolean(),
      coverage: z
        .object({
          covering_driver_id: z.string().uuid(),
          amount: z.number().positive(),
          notes: z.string().optional(),
        })
        .optional(),
      contracted_daily: z
        .object({
          amount: z.number().positive(),
          notes: z.string().optional(),
        })
        .optional(),
      reason: z.string().optional(),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const driverOk = await isDriverInLeaderScope(supabase, leaderId, body.data.driver_id);
    if (!driverOk) return reply.status(403).send({ error: 'Entregador fora da sua rede' });
    const pharmaciesOk = await assertPharmaciesInLeaderScope(supabase, leaderId, body.data.pharmacy_ids, workspaceId);
    if (!pharmaciesOk) return reply.status(403).send({ error: 'Farmácia fora da sua rede' });

    const user = request.user as { sub: string; role: string };

    try {
      const { insertOccurrence } = await import('../lib/leaderOccurrences.js');
      const result = await insertOccurrence(supabase, {
        workspace_id: workspaceId,
        created_by: user.sub,
        driver_id: body.data.driver_id,
        pharmacy_ids: body.data.pharmacy_ids,
        event_date: body.data.event_date,
        shift: body.data.shift,
        occurrence_kind: body.data.occurrence_kind,
        has_coverage: body.data.has_coverage,
        coverage: body.data.coverage,
        contracted_daily: body.data.contracted_daily,
        reason: body.data.reason,
        source: 'leader',
      });
      return reply.send({
        absence_entries: result.absence_entries,
        coverage_daily_entries: result.coverage_daily_entries,
        count: result.absence_entries.length + result.coverage_daily_entries.length,
        installments_created: result.installments_created,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao registrar ocorrência';
      const status =
        msg.includes('Ciclo') ||
        msg.includes('futuro') ||
        msg.includes('cobridor') ||
        msg.includes('Valor') ||
        msg.includes('Diária contratada')
          ? 400
          : 500;
      return reply.status(status).send({ error: msg });
    }
  });

  // POST /api/leader-portal/absences — descontinuado
  app.post('/absences', async (_request, reply) => {
    return reply.status(410).send({
      error: 'Endpoint descontinuado. Use POST /api/leader-portal/occurrences.',
    });
  });

  // POST /api/leader-portal/dailies — descontinuado
  app.post('/dailies', async (_request, reply) => {
    return reply.status(410).send({
      error: 'Endpoint descontinuado. Use POST /api/leader-portal/occurrences.',
    });
  });

  // GET /api/leader-portal/supply-requests
  app.get('/supply-requests', async (request, reply) => {
    const leaderId = getLeaderId(request);
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });
    const { data, error } = await supabase
      .from('supply_requests')
      .select('*, drivers(name), pharmacies(trade_name)')
      .eq('workspace_id', workspaceId)
      .eq('leader_id', leaderId)
      .order('created_at', { ascending: false });

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // POST /api/leader-portal/reminders/test — disparar lembretes manualmente
  app.post('/reminders/test', async (request, reply) => {
    if (!devRoutesEnabled()) return reply.status(404).send({ error: 'Not found' });
    const { sendCycleReminders } = await import('../services/reminders');
    await sendCycleReminders();
    return reply.send({ success: true });
  });

  // POST /api/leader-portal/supply-requests
  app.post('/supply-requests', async (request, reply) => {
    const schema = z.object({
      driver_id: z.string().uuid(),
      pharmacy_id: z.string().uuid(),
      item_type: z.enum(['uniform', 'bag']),
      size: z.string().optional(),
      quantity: z.number().int().positive().default(1),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const leaderId = getLeaderId(request);
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });

    const driverOk = await isDriverInLeaderScope(supabase, leaderId, body.data.driver_id);
    if (!driverOk) return reply.status(403).send({ error: 'Entregador fora da sua rede' });
    const pharmaciesOk = await assertPharmaciesInLeaderScope(supabase, leaderId, [body.data.pharmacy_id], workspaceId);
    if (!pharmaciesOk) return reply.status(403).send({ error: 'Farmácia fora da sua rede' });

    const { data, error } = await supabase
      .from('supply_requests')
      .insert({
        workspace_id: workspaceId,
        leader_id: leaderId,
        driver_id: body.data.driver_id,
        pharmacy_id: body.data.pharmacy_id,
        item_type: body.data.item_type,
        size: body.data.size,
        quantity: body.data.quantity,
        status: 'pending',
      })
      .select().single();

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // PATCH /api/leader-portal/supply-requests/:id — atualizar status/rastreio
  app.patch('/supply-requests/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const leaderId = getLeaderId(request) as string;
    const workspaceId = getLeaderWorkspaceId(request);
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });
    const schema = z.object({
      status: z.enum(['pending', 'dispatched', 'delivered', 'canceled']),
      tracking_url: z.string().optional(),
      delivery_forecast: z.string().optional(),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const { data: request_data, error: fetchErr } = await supabase
      .from('supply_requests')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('leader_id', leaderId)
      .eq('id', id)
      .single();

    if (fetchErr || !request_data) return reply.status(404).send({ error: 'Solicitação não encontrada' });

    const { data, error } = await supabase
      .from('supply_requests')
      .update(body.data)
      .eq('workspace_id', workspaceId)
      .eq('leader_id', leaderId)
      .eq('id', id)
      .select().single();

    if (error) return reply.status(500).send({ error: error.message });

    // Se marcou como entregue, gera o lançamento financeiro automático para desconto
    if (body.data.status === 'delivered' && request_data.status !== 'delivered') {
      const itemPrice = request_data.item_type === 'uniform' ? 50 : 150; // Valores fictícios
      const grossTotal = itemPrice * (request_data.quantity || 1);
      const { grossAmount, driverAmount } = splitSupplyDiscountAmount(grossTotal);

      const user = request.user as { sub: string };

      const { data: finEntry, error: finErr } = await supabase
        .from('financial_entries')
        .insert({
          workspace_id: workspaceId,
          driver_id: request_data.driver_id,
          pharmacy_id: request_data.pharmacy_id,
          type: request_data.item_type === 'uniform' ? 'uniform' : 'bag',
          description: `Desconto de ${request_data.item_type}: ${request_data.quantity}x (${request_data.size || 'N/A'}) — split 50% Coop / 50% entregador`,
          gross_amount: grossAmount,
          total_amount: driverAmount,
          installments_count: 1,
          installment_amount: driverAmount,
          frequency: 'weekly',
          status: 'pending_approval',
          start_date: new Date().toISOString().split('T')[0],
          created_by: user.sub,
        })
        .select('id, start_date, installments_count, installment_amount, frequency')
        .single();

      if (!finErr && finEntry) {
        const finType = request_data.item_type === 'uniform' ? 'uniform' : 'bag';
        const instRows = generateInstallments(
          finEntry.id,
          finEntry.start_date,
          finEntry.installments_count ?? 1,
          Number(finEntry.installment_amount),
          finEntry.frequency || 'weekly',
          finType
        );
        await supabase.from('financial_installments').insert(instRows.map((row) => ({ ...row, workspace_id: workspaceId })));
        await supabase
          .from('supply_requests')
          .update({ financial_entry_id: finEntry.id })
          .eq('workspace_id', workspaceId)
          .eq('leader_id', leaderId)
          .eq('id', id);
      }
    }

    return reply.send(data);
  });
}
