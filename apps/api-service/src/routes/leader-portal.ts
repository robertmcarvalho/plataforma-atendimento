import { createHash, randomInt, randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { generateInstallments } from '../lib/financialInstallments';
import { syncDriverLeaderContext } from '../lib/driverLeaderSync';
import { normalizeNameLike } from '../lib/textNormalization';
import { authenticate } from '../middleware/authenticate';
import { getWorkspaceWhatsAppChannel } from '../lib/channelResolver';
import { writeAuditLog } from '../lib/auditLog';
import {
  assertPharmaciesInLeaderScope,
  getLeaderManagedPharmacyIds,
  getDriversForLeaderPortal,
  isDriverInLeaderScope,
} from '../lib/leaderPortalScope';
import { readWorkspaceSetting, upsertWorkspaceSetting } from '../lib/workspaceSettings';

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
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(`Meta WhatsApp ${res.status}: ${JSON.stringify(detail || res.statusText)}`);
  }
  return res.json().catch(() => ({}));
}

async function sendLeaderOtp(workspaceId: string, phoneE164: string, code: string) {
  const to = onlyDigits(phoneE164);
  const template = otpTemplateConfig();
  if (template.name) {
    return sendMetaMessage(workspaceId, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: code }],
          },
        ],
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

      (request as any).leaderId = leader.id;
      (request as any).leaderWorkspaceId = leader.workspace_id;
    } catch (err) {
      return reply.status(401).send({ error: 'Não autenticado' });
    }
  });

  // GET /api/leader-portal/debug
  app.get('/debug', async (request, reply) => {
    if (!devRoutesEnabled()) return reply.status(404).send({ error: 'Not found' });
    return reply.send({
      user: request.user,
      leaderId: (request as any).leaderId
    });
  });

  // GET /api/leader-portal/me — dados do líder + status de vínculo WhatsApp por OTP
  app.get('/me', async (request, reply) => {
    const leaderId = (request as any).leaderId as string;
    const { data: leader, error } = await supabase
      .from('leaders')
      .select('id, name, phone, workspace_id')
      .eq('id', leaderId)
      .single();

    if (error || !leader) return reply.status(404).send({ error: 'Líder não encontrado' });

    const workspaceId = String((request as any).leaderWorkspaceId || leader.workspace_id || '');
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

  app.post('/whatsapp/otp/start', async (request, reply) => {
    const leaderId = (request as any).leaderId as string;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
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
    const leaderId = (request as any).leaderId as string;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
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
    const contactPayload = {
      wa_phone: onlyDigits(phoneE164),
      display_name: leader.name,
      profile_type: 'leader',
      leader_id: leaderId,
      updated_at: now,
    };
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('leader_id', leaderId)
      .maybeSingle();
    if (existingContact?.id) {
      await supabase.from('contacts').update({ ...contactPayload, workspace_id: workspaceId }).eq('id', existingContact.id);
    } else {
      await supabase.from('contacts').upsert({ ...contactPayload, workspace_id: workspaceId }, { onConflict: 'wa_phone' });
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
    const leaderId = (request as any).leaderId as string;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
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

    const leaderId = (request as any).leaderId as string;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
    if (!workspaceId) return reply.status(412).send({ error: 'Workspace do líder não resolvido.' });

    const leaderRow = await supabase.from('leaders').select('id, name, phone').eq('id', leaderId).single();
    if (leaderRow.error || !leaderRow.data) return reply.status(404).send({ error: 'Líder não encontrado' });

    const content = String((request.body as any)?.content || 'Olá! (simulado)').trim();
    const now = new Date().toISOString();

    let { data: contact } = await supabase
      .from('contacts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('leader_id', leaderId)
      .maybeSingle();
    if (!contact) {
      const wa = String(leaderRow.data.phone || '').trim() || `leader_${leaderId.slice(0, 8)}`;
      const ins = await supabase
        .from('contacts')
        .insert({
          workspace_id: workspaceId,
          wa_phone: wa,
          display_name: leaderRow.data.name,
          profile_type: 'leader',
          leader_id: leaderId,
          updated_at: now,
        })
        .select()
        .single();
      if (ins.error) return reply.status(500).send({ error: ins.error.message });
      contact = ins.data;
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

    const workspaceId = String((request as any).leaderWorkspaceId || '');
    if (!workspaceId) return reply.status(412).send({ error: 'Workspace do líder não resolvido.' });
    await upsertWorkspaceSetting(workspaceId, 'workspace_whatsapp_business_e164', `+${digits}`);
    return reply.send({ ok: true, business_e164: `+${digits}` });
  });

  // GET /api/leader-portal/stats
  app.get('/stats', async (request, reply) => {
    const leaderId = (request as any).leaderId;

    const workspaceId = String((request as any).leaderWorkspaceId || '');
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
        base_revenue: 0,
        bonuses: 0,
        discounts: 0,
        net_estimated: 0,
      });
    }

    // 3. Search for pending financial entries (dummy for now)
    const { count: pendingAbsences } = await supabase
      .from('financial_entries')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .in('pharmacy_id', pharmacyIds)
      .eq('type', 'absence')
      .eq('status', 'pending_approval');

    const { count: pendingDailies } = await supabase
      .from('financial_entries')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .in('pharmacy_id', pharmacyIds)
      .eq('type', 'daily')
      .eq('status', 'pending_approval');

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
      pharmacies_count: pharmacyIds.length,
      drivers_count: driverIds.length,
      pending_absences: pendingAbsences || 0,
      pending_dailies: pendingDailies || 0,
      base_revenue: baseRevenue,
      bonuses: bonuses,
      discounts: discounts,
      net_estimated: baseRevenue + bonuses - discounts
    });
  });

  // GET /api/leader-portal/pharmacies
  app.get('/pharmacies', async (request, reply) => {
    const leaderId = (request as any).leaderId;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
    const pharmacyIds = await getLeaderManagedPharmacyIds(supabase, leaderId, workspaceId);
    if (!pharmacyIds.length) return reply.send([]);

    const { data, error } = await supabase
      .from('pharmacies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('id', pharmacyIds)
      .order('trade_name');

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  // PATCH /api/leader-portal/drivers/:id/schedule — apenas escala (work_schedule)
  app.patch('/drivers/:id/schedule', async (request, reply) => {
    const leaderId = (request as any).leaderId as string;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
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
    const leaderId = (request as any).leaderId as string;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
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
    const leaderId = (request as any).leaderId;

    try {
      const rows = await getDriversForLeaderPortal(supabase, leaderId);
      return reply.send(rows);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao listar entregadores' });
    }
  });

  // GET /api/leader-portal/termination-requests — solicitações recentes de desligamento do líder
  app.get('/termination-requests', async (request, reply) => {
    const leaderId = (request as any).leaderId as string;
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
    const leaderId = (request as any).leaderId as string;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
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

    const { data: driver, error: driverErr } = await supabase
      .from('drivers')
      .select('id, name, phone, status')
      .eq('id', body.data.driver_id)
      .single();
    if (driverErr || !driver) return reply.status(404).send({ error: 'Entregador não encontrado' });
    if (String(driver.status || '') !== 'active') {
      return reply.status(409).send({ error: 'Entregador já está inativo ou bloqueado.' });
    }

    const { data: existing, error: existingErr } = await supabase
      .from('pending_tasks')
      .select('id')
      .eq('task_type', 'driver_termination_request')
      .eq('driver_id', body.data.driver_id)
      .in('status', ['open', 'in_progress'])
      .limit(1)
      .maybeSingle();
    if (existingErr) return reply.status(500).send({ error: existingErr.message });
    if (existing?.id) return reply.status(409).send({ error: 'Já existe uma solicitação de desligamento aberta para este entregador.' });

    const { data: links, error: linksErr } = await supabase
      .from('driver_pharmacy_links')
      .select('pharmacy_id, is_primary, pharmacies(id, trade_name, city)')
      .eq('driver_id', body.data.driver_id)
      .eq('is_active', true);
    if (linksErr) return reply.status(500).send({ error: linksErr.message });

    const activePharmacyIds = Array.from(new Set((links || []).map((l: any) => String(l.pharmacy_id)).filter(Boolean)));
    if (!activePharmacyIds.length) return reply.status(409).send({ error: 'Entregador não possui vínculos ativos.' });

    const sectors = await resolveSectorIdsByName(workspaceId, ['Operacional', 'Financeiro']);
    const requestId = randomUUID();
    const nowIso = new Date().toISOString();
    const baseMetadata = {
      request_id: requestId,
      leader_id: leaderId,
      workspace_id: workspaceId || null,
      driver_id: body.data.driver_id,
      driver_name: driver.name,
      pharmacy_ids: activePharmacyIds,
      pharmacies: (links || []).map((l: any) => ({
        id: l.pharmacy_id,
        is_primary: Boolean(l.is_primary),
        trade_name: l.pharmacies?.trade_name || null,
        city: l.pharmacies?.city || null,
      })),
      last_worked_at: body.data.last_worked_at,
      reason: body.data.reason,
      notes: body.data.notes || null,
      requested_at: nowIso,
    };

    const rows = [
      {
        workspace_id: workspaceId,
        task_type: 'driver_termination_request',
        title: `Desligamento: ${driver.name}`,
        description: 'Solicitação enviada pelo líder. Aprovar para inativar o entregador e encerrar vínculos automaticamente.',
        status: 'open',
        priority: 'high',
        driver_id: body.data.driver_id,
        sector_id: sectors.Operacional,
        source: 'leader_portal',
        metadata: { ...baseMetadata, sector_action: 'operational_approval' },
      },
      {
        workspace_id: workspaceId,
        task_type: 'driver_termination_financial_review',
        title: `Revisar financeiro: ${driver.name}`,
        description: 'Verificar pendências, acertos e descontos após solicitação de desligamento.',
        status: 'open',
        priority: 'normal',
        driver_id: body.data.driver_id,
        sector_id: sectors.Financeiro,
        source: 'leader_portal',
        metadata: { ...baseMetadata, sector_action: 'financial_review' },
      },
    ];

    const { data: inserted, error: insertErr } = await supabase.from('pending_tasks').insert(rows).select('*');
    if (insertErr) return reply.status(500).send({ error: insertErr.message });

    await writeAuditLog({
      actor_id: (request.user as { sub?: string }).sub || null,
      action: 'leader.driver_termination.request',
      entity_type: 'driver',
      entity_id: body.data.driver_id,
      metadata: baseMetadata,
    });

    return reply.status(201).send({ ok: true, request_id: requestId, tasks: inserted || [], pharmacies: baseMetadata.pharmacies });
  });

  // GET /api/leader-portal/pre-registrations — entregadores em pré-cadastro (tag cadastro-pendente)
  app.get('/pre-registrations', async (request, reply) => {
    const leaderId = (request as any).leaderId as string;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
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
    const leaderId = (request as any).leaderId as string;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
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

    let sync: Awaited<ReturnType<typeof syncDriverLeaderContext>>;
    try {
      sync = await syncDriverLeaderContext(supabase, {
        workspace_id: workspaceId,
        phone: body.data.phone,
        name: body.data.name,
        email: body.data.email || null,
        is_leader: false,
        primary_pharmacy_id: primaryPharmacyId,
      });
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha ao sincronizar contexto' });
    }

    const insertRow = {
      workspace_id: workspaceId,
      name: normalizeNameLike(body.data.name),
      cpf: body.data.cpf || null,
      phone: body.data.phone,
      email: body.data.email || null,
      city: body.data.city || null,
      state: body.data.state || null,
      status: 'inactive',
      doc_status: 'pending',
      driver_type: body.data.driver_type,
      primary_pharmacy_id: primaryPharmacyId,
      inherit_from_primary: true,
      override_leader_id: sync.override_leader_id,
      tags: ['cadastro-pendente'],
      notes: body.data.notes || null,
      work_schedule: (body.data.work_schedule as Record<string, unknown> | undefined) || {},
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>;

    const { data: driver, error } = await supabase.from('drivers').insert(insertRow).select().single();
    if (error) {
      const msg = error.message || '';
      if (error.code === '23505' || msg.toLowerCase().includes('unique')) {
        return reply.status(409).send({ error: 'Já existe um entregador com este telefone/CPF' });
      }
      return reply.status(500).send({ error: msg });
    }

    const nowIso = new Date().toISOString();
    const linkRows = uniquePharmacyIds.map((pharmacy_id) => ({
      workspace_id: workspaceId,
      driver_id: driver.id,
      pharmacy_id,
      is_primary: pharmacy_id === primaryPharmacyId,
      is_active: true,
      started_at: nowIso,
      notes: 'Pré-cadastro (portal do líder)',
    }));

    const { error: linkErr } = await supabase.from('driver_pharmacy_links').insert(linkRows);
    if (linkErr) return reply.status(500).send({ error: linkErr.message });

    try {
      await supabase.from('pending_tasks').insert({
        workspace_id: workspaceId,
        task_type: 'driver_registration_completion',
        title: `Finalizar cadastro: ${driver.name}`,
        description: 'Pré-cadastro enviado pelo líder. Validar documentos e ativar cadastro.',
        status: 'open',
        priority: 'normal',
        driver_id: driver.id,
        source: 'leader_portal',
        metadata: {
          leader_id: leaderId,
          pharmacy_ids: uniquePharmacyIds,
          driver_type: body.data.driver_type,
        },
      });
    } catch {
      // sem bloquear o pré-cadastro se a tarefa falhar
    }

    return reply.status(201).send({ driver, pharmacy_ids: uniquePharmacyIds });
  });

  // POST /api/leader-portal/absences
  app.post('/absences', async (request, reply) => {
    const leaderId = (request as any).leaderId as string;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });

    const schema = z.object({
      driver_id: z.string().uuid(),
      pharmacy_id: z.string().uuid().optional(),
      pharmacy_ids: z.array(z.string().uuid()).optional(),
      date: z.string(),
      reason: z.string().optional(),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const pharmacyIds = (() => {
      const ids = new Set<string>();
      if (body.data.pharmacy_id) ids.add(body.data.pharmacy_id);
      for (const id of body.data.pharmacy_ids || []) ids.add(id);
      return Array.from(ids);
    })();

    if (!pharmacyIds.length) return reply.status(400).send({ error: 'Informe pharmacy_id ou pharmacy_ids' });

    const driverOk = await isDriverInLeaderScope(supabase, leaderId, body.data.driver_id);
    if (!driverOk) return reply.status(403).send({ error: 'Entregador fora da sua rede' });
    const pharmaciesOk = await assertPharmaciesInLeaderScope(supabase, leaderId, pharmacyIds, workspaceId);
    if (!pharmaciesOk) return reply.status(403).send({ error: 'Farmácia fora da sua rede' });

    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();

    // Regra de corte de faltas: Segunda até as 11h
    let cycleInfo = 'Ciclo atual';
    if (day > 1 || (day === 1 && hour >= 11)) {
      cycleInfo = 'Próximo ciclo (Atrasado)';
    }

    const user = request.user as { sub: string; role: string };
    const leaderUserId = user.sub;

    const rowsToInsert = pharmacyIds.map((pharmacy_id) => ({
      workspace_id: workspaceId,
      driver_id: body.data.driver_id,
      pharmacy_id,
      type: 'absence',
      description: `Falta em ${body.data.date}: ${body.data.reason || 'Sem observação'} (${cycleInfo})`,
      total_amount: 0,
      installments_count: 1,
      installment_amount: 0,
      status: 'pending_approval',
      start_date: body.data.date,
      created_by: leaderUserId,
    }));

    const { data, error } = await supabase.from('financial_entries').insert(rowsToInsert).select();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ inserted: data || [], count: (data || []).length });
  });
  
  // POST /api/leader-portal/dailies
  app.post('/dailies', async (request, reply) => {
    const leaderId = (request as any).leaderId as string;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
    if (!workspaceId) return reply.status(403).send({ error: 'Workspace do líder não encontrado.' });

    const schema = z.object({
      driver_id: z.string().uuid(),
      pharmacy_id: z.string().uuid().optional(),
      pharmacy_ids: z.array(z.string().uuid()).optional(),
      amount: z.number().positive(),
      date: z.string().optional(),
      description: z.string().optional(),
      notes: z.string().optional(),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const pharmacyIds = (() => {
      const ids = new Set<string>();
      if (body.data.pharmacy_id) ids.add(body.data.pharmacy_id);
      for (const id of body.data.pharmacy_ids || []) ids.add(id);
      return Array.from(ids);
    })();

    if (!pharmacyIds.length) return reply.status(400).send({ error: 'Informe pharmacy_id ou pharmacy_ids' });

    const driverOk = await isDriverInLeaderScope(supabase, leaderId, body.data.driver_id);
    if (!driverOk) return reply.status(403).send({ error: 'Entregador fora da sua rede' });
    const pharmaciesOk = await assertPharmaciesInLeaderScope(supabase, leaderId, pharmacyIds, workspaceId);
    if (!pharmaciesOk) return reply.status(403).send({ error: 'Farmácia fora da sua rede' });

    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    
    // Regra de corte de diárias: Terça e Quinta até as 11h
    let paymentDay = "Próximo ciclo";
    if (day < 2 || (day === 2 && hour < 11)) {
      paymentDay = "Pagamento Terça-feira";
    } else if (day < 4 || (day === 4 && hour < 11)) {
      paymentDay = "Pagamento Quinta-feira";
    }

    const user = request.user as { sub: string, role: string };
    const leaderUserId = user.sub;

    const startDate = body.data.date || new Date().toISOString().split('T')[0];
    const baseDescription = body.data.description || 'Lançamento de diária';
    const notes = body.data.notes ? ` — ${body.data.notes}` : '';

    const rowsToInsert = pharmacyIds.map((pharmacy_id) => ({
      workspace_id: workspaceId,
      driver_id: body.data.driver_id,
      pharmacy_id,
      type: 'daily',
      description: `${baseDescription}${notes} (${paymentDay})`,
      total_amount: body.data.amount,
      installments_count: 1,
      installment_amount: body.data.amount,
      status: 'pending_approval',
      start_date: startDate,
      created_by: leaderUserId,
    }));

    const { data, error } = await supabase.from('financial_entries').insert(rowsToInsert).select();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ inserted: data || [], count: (data || []).length });
  });

  // GET /api/leader-portal/supply-requests
  app.get('/supply-requests', async (request, reply) => {
    const leaderId = (request as any).leaderId;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
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

    const leaderId = (request as any).leaderId;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
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
    const leaderId = (request as any).leaderId as string;
    const workspaceId = String((request as any).leaderWorkspaceId || '');
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
      const totalAmount = itemPrice * (request_data.quantity || 1);

      const user = request.user as { sub: string };

      const { data: finEntry, error: finErr } = await supabase
        .from('financial_entries')
        .insert({
          workspace_id: workspaceId,
          driver_id: request_data.driver_id,
          pharmacy_id: request_data.pharmacy_id,
          type: request_data.item_type === 'uniform' ? 'uniform' : 'bag',
          description: `Desconto de ${request_data.item_type}: ${request_data.quantity}x (${request_data.size || 'N/A'})`,
          total_amount: totalAmount,
          installments_count: 1,
          installment_amount: totalAmount,
          frequency: 'weekly',
          status: 'pending_approval',
          start_date: new Date().toISOString().split('T')[0],
          created_by: user.sub,
        })
        .select('id, start_date, installments_count, installment_amount, frequency')
        .single();

      if (!finErr && finEntry) {
        const instRows = generateInstallments(
          finEntry.id,
          finEntry.start_date,
          finEntry.installments_count ?? 1,
          Number(finEntry.installment_amount),
          finEntry.frequency || 'weekly'
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
