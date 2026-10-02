import type { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase';
import { BRAZIL_STATES, fetchIbgeCities, fetchViaCep, onlyDigitsGeo } from '../lib/geo/ibge';
import { dataRequestPublicSubmitSchema } from '../lib/commercial/leadSchemas';
import { hashDataRequestToken } from '../lib/commercial/dataRequest';
import { mapLeadRow } from '../lib/commercial/serialize';
import { contractChecklistFromLead, CONTRACT_REQUIRED_FIELD_KEYS } from '../lib/commercial/contractFields';
import { appendLeadActivity } from '../lib/commercial/activities';
import {
  buildLeadContractSnapshot,
  mergeContractOnboarding,
  parseContractOnboarding,
} from '../lib/commercial/contractOnboarding';
import { createCommercialNotification } from '../lib/commercial/commercialNotifications';

const putAttempts = new Map<string, { count: number; resetAt: number }>();
const PUT_LIMIT = 20;
const PUT_WINDOW_MS = 60_000;

function rateLimitPut(ip: string): boolean {
  const now = Date.now();
  const row = putAttempts.get(ip);
  if (!row || now > row.resetAt) {
    putAttempts.set(ip, { count: 1, resetAt: now + PUT_WINDOW_MS });
    return true;
  }
  if (row.count >= PUT_LIMIT) return false;
  row.count += 1;
  return true;
}

async function loadDataRequestByToken(token: string) {
  const tokenHash = hashDataRequestToken(token);
  const { data: req, error } = await supabase
    .from('commercial_data_requests')
    .select('*, lead:commercial_leads(*)')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!req) return null;

  if (req.status === 'pending' && new Date(req.expires_at).getTime() < Date.now()) {
    await supabase
      .from('commercial_data_requests')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', req.id);
    return { ...req, status: 'expired' };
  }
  return req;
}

export async function publicCommercialRoutes(app: FastifyInstance) {
  app.get('/geo/states', async (_request, reply) => {
    return reply.send(BRAZIL_STATES);
  });

  app.get('/geo/states/:uf/cities', async (request, reply) => {
    const { uf } = request.params as { uf: string };
    const cities = await fetchIbgeCities(uf).catch(() => []);
    return reply.send(cities);
  });

  app.get('/geo/cep/:cep', async (request, reply) => {
    const { cep } = request.params as { cep: string };
    const digits = onlyDigitsGeo(cep);
    if (digits.length !== 8) return reply.status(400).send({ error: 'CEP inválido' });
    const data = await fetchViaCep(digits).catch(() => ({ not_found: true }));
    return reply.send(data);
  });

  app.get('/data-request/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const row = await loadDataRequestByToken(token);
    if (!row) return reply.status(404).send({ error: 'Link inválido ou expirado' });
    if (row.status === 'cancelled') return reply.status(410).send({ error: 'Solicitação cancelada' });
    if (row.status === 'expired') return reply.status(410).send({ error: 'Link expirado' });

    const lead = (row as { lead?: Record<string, unknown> }).lead || {};
    const checklist = contractChecklistFromLead(lead);
    const onboarding = parseContractOnboarding(lead.contract_onboarding);

    return reply.send({
      status: row.status,
      expires_at: row.expires_at,
      required_fields: row.required_fields || CONTRACT_REQUIRED_FIELD_KEYS,
      lead: {
        trade_name: lead.trade_name,
        legal_name: lead.legal_name,
        city: lead.city,
        state: lead.state,
        contact_name: lead.contact_name,
      },
      contract_checklist: checklist,
      contract_onboarding_status: onboarding.status,
      current: {
        legal_representative_name: lead.legal_representative_name,
        legal_representative_cpf: lead.legal_representative_cpf,
        legal_representative_email: lead.legal_representative_email,
        legal_representative_phone: lead.legal_representative_phone,
        cnpj: lead.cnpj,
        address_cep: lead.address_cep,
        address_street: lead.address_street,
        address_number: lead.address_number,
        address_neighborhood: lead.address_neighborhood,
        address_complement: lead.address_complement,
        contact_expedition_name: lead.contact_expedition_name,
        contact_expedition_phone: lead.contact_expedition_phone,
        contact_financial_name: lead.contact_financial_name,
        contact_financial_phone: lead.contact_financial_phone,
      },
    });
  });

  app.put('/data-request/:token', async (request, reply) => {
    const ip = request.ip || 'unknown';
    if (!rateLimitPut(ip)) return reply.status(429).send({ error: 'Muitas tentativas. Aguarde um minuto.' });

    const { token } = request.params as { token: string };
    const parsed = dataRequestPublicSubmitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }

    const row = await loadDataRequestByToken(token);
    if (!row) return reply.status(404).send({ error: 'Link inválido ou expirado' });
    if (row.status === 'submitted') return reply.status(409).send({ error: 'Formulário já enviado' });
    if (row.status === 'cancelled' || row.status === 'expired') {
      return reply.status(410).send({ error: 'Link não está mais disponível' });
    }

    const leadId = row.lead_id as string;
    const workspaceId = row.workspace_id as string;
    const body = parsed.data;
    const now = new Date().toISOString();

    const { data: currentLead } = await supabase
      .from('commercial_leads')
      .select('contract_onboarding, owner_id, trade_name')
      .eq('workspace_id', workspaceId)
      .eq('id', leadId)
      .maybeSingle();

    const leadUpdate = {
      legal_representative_name: body.legal_representative_name,
      legal_representative_cpf: body.legal_representative_cpf,
      legal_representative_email: body.legal_representative_email,
      legal_representative_phone: body.legal_representative_phone,
      cnpj: body.cnpj,
      address_cep: body.address_cep,
      address_street: body.address_street.trim(),
      address_number: body.address_number.trim(),
      address_neighborhood: body.address_neighborhood.trim(),
      address_complement: body.address_complement?.trim() || null,
      city: body.city,
      state: body.state,
      contact_expedition_name: body.contact_expedition_name,
      contact_expedition_phone: body.contact_expedition_phone,
      contact_financial_name: body.contact_financial_name,
      contact_financial_phone: body.contact_financial_phone,
      updated_at: now,
    };

    const snapshot = buildLeadContractSnapshot({ ...leadUpdate });
    const onboarding = mergeContractOnboarding(currentLead?.contract_onboarding, {
      status: 'lead_submitted',
      lead_submitted_at: now,
      data_request_id: row.id as string,
      lead_snapshot: snapshot,
    });

    const { data: updated, error: updErr } = await supabase
      .from('commercial_leads')
      .update({
        ...leadUpdate,
        contract_onboarding: onboarding,
      })
      .eq('workspace_id', workspaceId)
      .eq('id', leadId)
      .select()
      .single();
    if (updErr) return reply.status(500).send({ error: updErr.message });

    await supabase
      .from('commercial_data_requests')
      .update({ status: 'submitted', submitted_at: now, updated_at: now })
      .eq('id', row.id);

    await appendLeadActivity({
      workspaceId,
      leadId,
      activityType: 'data_request_completed',
      title: 'Formulário de contrato preenchido pelo lead',
      metadata: { data_request_id: row.id },
      createdBy: null,
    });

    const ownerId = currentLead?.owner_id as string | undefined;
    if (ownerId) {
      await createCommercialNotification({
        workspaceId,
        userId: ownerId,
        type: 'contract_form_submitted',
        title: 'Formulário de contrato recebido',
        body: `${String(currentLead?.trade_name || 'Lead')} enviou os dados para contrato.`,
        entityType: 'commercial_leads',
        entityId: leadId,
      }).catch(() => undefined);
    }

    return reply.send({ ok: true, lead: mapLeadRow(updated as Record<string, unknown>) });
  });
}
