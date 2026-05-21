/**
 * Smoke direto dos jobs de SLA de tickets (sem esperar cron).
 * Uso: npm run smoke:sla-jobs-direct
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

const env = readEnvFile(path.join(process.cwd(), 'apps', 'scheduler-service', '.env'));
const supabaseUrl = process.env.SUPABASE_URL || env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.log('SKIP_SMOKE_NO_SUPABASE_ENV — faltam SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(0);
}

const schedulerJobsPath = path.join(
  process.cwd(),
  'apps',
  'scheduler-service',
  'dist',
  'jobs',
  'ticketsSlaJobs.js'
);
const { registerTicketSlaJobs } = await import(pathToFileURL(schedulerJobsPath).href);

const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const code = `SMOKE-SLA-${String(Date.now()).slice(-8)}`;
let ticketId = null;
let workspaceId = null;

try {
  const workspaceRes = await db.from('workspaces').select('id').eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (workspaceRes.error) throw new Error(workspaceRes.error.message);
  workspaceId = workspaceRes.data?.id || null;
  if (!workspaceId) {
    console.log('SKIP_SMOKE_NO_WORKSPACE — nenhum workspace ativo disponível.');
    process.exit(0);
  }

  const createdAt = new Date(Date.now() - 200 * 60000).toISOString();
  const dueAt = new Date(Date.now() - 30 * 60000).toISOString();

  const ins = await db
    .from('tickets')
    .insert({
      workspace_id: workspaceId,
      ticket_code: code,
      persona: 'driver',
      type: 'payment',
      priority: 'high',
      sla_minutes: 120,
      channel_origin: 'whatsapp',
      status: 'open',
      created_at: createdAt,
      due_at: dueAt,
      context_snap: { smoke: true },
      classifier_version: 'smoke-v1',
    })
    .select('id')
    .single();
  if (ins.error) throw new Error(ins.error.message);
  ticketId = ins.data.id;

  const jobs = registerTicketSlaJobs(db, 'America/Sao_Paulo');
  await jobs.runAlert80Job();
  await jobs.runEscalationJob();
  const supervisors = await db
    .from('users')
    .select('id')
    .eq('role', 'supervisor')
    .eq('is_active', true)
    .limit(1);
  const hasSupervisor = Boolean(supervisors.data?.length);

  await jobs.runDailyReportJob();

  const eventsRes = await db.from('ticket_events').select('event_type').eq('workspace_id', workspaceId).eq('ticket_id', ticketId);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  const types = new Set((eventsRes.data || []).map((r) => r.event_type));
  if (!types.has('sla_80_alert')) throw new Error('Evento sla_80_alert nao gerado.');
  if (!types.has('sla_escalated')) throw new Error('Evento sla_escalated nao gerado.');

  const t = await db.from('tickets').select('status').eq('workspace_id', workspaceId).eq('id', ticketId).maybeSingle();
  if (t.error) throw new Error(t.error.message);
  if (t.data?.status !== 'overdue') throw new Error('Ticket nao foi marcado como overdue.');

  if (hasSupervisor) {
    const daily = await db
      .from('ticket_events')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('event_type', 'sla_daily_report')
      .limit(1)
      .maybeSingle();
    if (daily.error) throw new Error(daily.error.message);
    if (!daily.data?.id) throw new Error('Evento sla_daily_report nao encontrado.');
  } else {
    console.log('WARN: sem supervisor ativo; validacao de relatorio diario foi pulada.');
  }

  console.log('OK: smoke jobs SLA tickets (80%, escalonamento, diario) concluido.');
} catch (e) {
  console.error('Smoke SLA jobs direto falhou:', e?.message || e);
  process.exit(1);
} finally {
  if (ticketId) {
    await db.from('ticket_events').delete().eq('workspace_id', workspaceId).eq('ticket_id', ticketId);
    await db.from('tickets').delete().eq('workspace_id', workspaceId).eq('id', ticketId);
  }
}
