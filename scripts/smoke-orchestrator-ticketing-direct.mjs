/**
 * Smoke direto do modulo de ticketing do orchestrator (sem Pub/Sub).
 * Uso: npm run smoke:orchestrator-ticketing
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

function readEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return vars;
}

const env = readEnvFile(path.join(process.cwd(), 'apps', 'orchestrator-service', '.env'));
const supabaseUrl = process.env.SUPABASE_URL || env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.log('SKIP_SMOKE_NO_SUPABASE_ENV — faltam SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(0);
}

const orchestratorClassifierPath = path.join(
  process.cwd(),
  'apps',
  'orchestrator-service',
  'dist',
  'ticketing',
  'classifier.js'
);
const { processInboundTicketing } = await import(pathToFileURL(orchestratorClassifierPath).href);

const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const suffix = String(Date.now());
const waPhone = `55${suffix.slice(-11).padStart(11, '9')}`;
let contactId = null;
let conversationId = null;
let workspaceId = null;

try {
  const workspaceRes = await db.from('workspaces').select('id').eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (workspaceRes.error) throw new Error(workspaceRes.error.message);
  workspaceId = workspaceRes.data?.id || null;
  if (!workspaceId) {
    console.log('SKIP_SMOKE_NO_WORKSPACE — nenhum workspace ativo disponível.');
    process.exit(0);
  }

  const contactIns = await db
    .from('contacts')
    .insert({
      workspace_id: workspaceId,
      wa_phone: waPhone,
      display_name: `Smoke Ticket ${suffix}`,
      profile_type: 'unknown',
    })
    .select('id')
    .single();
  if (contactIns.error) throw new Error(contactIns.error.message);
  contactId = contactIns.data.id;

  const convIns = await db
    .from('conversations')
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      status: 'open',
      priority: 'normal',
    })
    .select('id')
    .single();
  if (convIns.error) throw new Error(convIns.error.message);
  conversationId = convIns.data.id;

  // Caso humano: deve abrir ticket.
  await processInboundTicketing(db, {
    conversationId,
    workspaceId,
    contactId,
    inboundText: 'meu pagamento pix nao caiu',
    messageId: null,
  });

  const firstTicket = await db
    .from('tickets')
    .select('id, type, priority, sla_minutes')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (firstTicket.error) throw new Error(firstTicket.error.message);
  if (!firstTicket.data?.id) throw new Error('Ticket nao foi criado no caso humano.');
  if (firstTicket.data.type !== 'payment' || firstTicket.data.priority !== 'high' || firstTicket.data.sla_minutes !== 120) {
    throw new Error('Classificacao inesperada para caso de pagamento.');
  }

  // Fecha ticket para testar caso bot-only sem bloquear por ticket aberto.
  const closeRes = await db
    .from('tickets')
    .update({ status: 'resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', firstTicket.data.id);
  if (closeRes.error) throw new Error(closeRes.error.message);

  // Caso bot-only: NAO deve abrir ticket.
  await processInboundTicketing(db, {
    conversationId,
    workspaceId,
    contactId,
    inboundText: 'quando paga meu extrato',
    messageId: null,
  });

  const botOnlyCheck = await db
    .from('tickets')
    .select('id')
    .eq('conversation_id', conversationId)
    .in('status', ['open', 'in_progress'])
    .limit(1)
    .maybeSingle();
  if (botOnlyCheck.error) throw new Error(botOnlyCheck.error.message);
  if (botOnlyCheck.data?.id) throw new Error('Caso bot-only abriu ticket indevidamente.');

  console.log('OK: smoke orchestrator ticketing (classificacao + bot-only) concluido.');
} catch (e) {
  console.error('Smoke orchestrator ticketing falhou:', e?.message || e);
  process.exit(1);
} finally {
  if (conversationId) {
    const ticketRows = await db.from('tickets').select('id').eq('workspace_id', workspaceId).eq('conversation_id', conversationId);
    const ids = (ticketRows.data || []).map((r) => r.id);
    if (ids.length) {
      await db.from('ticket_events').delete().eq('workspace_id', workspaceId).in('ticket_id', ids);
      await db.from('tickets').delete().eq('workspace_id', workspaceId).in('id', ids);
    }
    await db.from('conversations').delete().eq('workspace_id', workspaceId).eq('id', conversationId);
  }
  if (contactId) await db.from('contacts').delete().eq('workspace_id', workspaceId).eq('id', contactId);
}
