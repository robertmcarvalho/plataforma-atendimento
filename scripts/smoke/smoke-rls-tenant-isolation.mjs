#!/usr/bin/env node
/**
 * Smoke RLS: usuário authenticated só enxerga linhas do workspace com membership ativa.
 * Testa tabelas da wave 1 (ou RLS_WAVE_TABLES env, separado por vírgula).
 *
 * Uso: npm run smoke:rls-tenant-isolation
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readDbUrl } from '../lib/readDbUrl.mjs';

const WAVE_PRESETS = {
  wave1: 'app_settings,roles,sectors,automation_rules,routing_rules',
  wave2: 'sla_policies,bot_flows,message_templates,api_tokens,audit_logs',
  wave3: 'campaigns,campaign_recipients,campaign_dispatch_logs,automation_runs,bot_sessions',
  wave4: 'leaders,pharmacies,drivers,driver_pharmacy_links,leader_pharmacy_links',
  wave5:
    'conversation_flow_definitions,conversation_flow_versions,conversation_flow_bindings,conversation_flow_sessions,conversation_assignments',
  wave6: 'internal_notes,internal_chat_messages,ticket_events,sla_events,user_sectors',
  wave7:
    'workspace_channels,workspace_memberships,pharmacy_sector_attendants,financial_imports,financial_import_rows',
  wave8: 'financial_exports,financial_installments,email_delivery_log,supply_requests,tickets',
  wave9: 'contacts,conversations,messages,financial_entries,pending_tasks',
  wave10:
    'workspace_profiles,workspace_visible_sectors,workspace_sector_demands,workspace_demand_rules,workspace_flow_messages',
  wave11:
    'commercial_pipeline_stages,commercial_loss_reasons,commercial_field_definitions,commercial_leads,commercial_lead_activities,commercial_proposals,commercial_data_requests,commercial_erp_options',
  wave12:
    'workspace_sla_rules,workspace_out_of_hours_rules,workspace_report_targets,user_channel_queue_assignments,leader_whatsapp_verifications,processed_webhook_events',
  all: [
    'app_settings,roles,sectors,automation_rules,routing_rules',
    'sla_policies,bot_flows,message_templates,api_tokens,audit_logs',
    'campaigns,campaign_recipients,campaign_dispatch_logs,automation_runs,bot_sessions',
    'leaders,pharmacies,drivers,driver_pharmacy_links,leader_pharmacy_links',
    'conversation_flow_definitions,conversation_flow_versions,conversation_flow_bindings,conversation_flow_sessions,conversation_assignments',
    'internal_notes,internal_chat_messages,ticket_events,sla_events,user_sectors',
    'workspace_channels,workspace_memberships,pharmacy_sector_attendants,financial_imports,financial_import_rows',
    'financial_exports,financial_installments,email_delivery_log,supply_requests,tickets',
    'contacts,conversations,messages,financial_entries,pending_tasks',
    'workspace_profiles,workspace_visible_sectors,workspace_sector_demands,workspace_demand_rules,workspace_flow_messages',
    'commercial_pipeline_stages,commercial_loss_reasons,commercial_field_definitions,commercial_leads,commercial_lead_activities,commercial_proposals,commercial_data_requests,commercial_erp_options',
    'workspace_sla_rules,workspace_out_of_hours_rules,workspace_report_targets,user_channel_queue_assignments,leader_whatsapp_verifications,processed_webhook_events',
  ].join(','),
};

const presetArg = process.argv.find((a) => a.startsWith('--preset'));
const wavePreset =
  process.env.RLS_WAVE_PRESET ||
  (presetArg ? presetArg.split('=')[1] ?? process.argv[process.argv.indexOf(presetArg) + 1] : undefined);
const WAVE_TABLES = (wavePreset && WAVE_PRESETS[wavePreset]
  ? WAVE_PRESETS[wavePreset]
  : process.env.RLS_WAVE_TABLES || WAVE_PRESETS.wave1)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

let client;
try {
  client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
} catch (e) {
  if (e instanceof Error && e.message.includes('Missing SUPABASE_DB_URL')) {
    console.log('SKIP_SMOKE_NO_DB_URL');
    process.exit(0);
  }
  throw e;
}

const suffix = Date.now();
const userA = randomUUID();
const userB = randomUUID();

async function asAuthenticated(userId, fn) {
  await client.query('SAVEPOINT rls_smoke');
  try {
    await client.query('SET LOCAL row_security = on');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    return await fn();
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT rls_smoke');
  }
}

try {
  await client.query('BEGIN');

  const wsA = (
    await client.query(
      `INSERT INTO public.workspaces (slug, display_name) VALUES ($1, $2) RETURNING id`,
      [`rls-a-${suffix}`, `RLS A ${suffix}`],
    )
  ).rows[0].id;
  const wsB = (
    await client.query(
      `INSERT INTO public.workspaces (slug, display_name) VALUES ($1, $2) RETURNING id`,
      [`rls-b-${suffix}`, `RLS B ${suffix}`],
    )
  ).rows[0].id;

  await client.query(
    `INSERT INTO public.users (id, email, name) VALUES ($1, $2, $3), ($4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      userA,
      `rls-a-${suffix}@smoke.local`,
      'RLS User A',
      userB,
      `rls-b-${suffix}@smoke.local`,
      'RLS User B',
    ],
  );

  await client.query(
    `INSERT INTO public.workspace_memberships (workspace_id, user_id, is_active)
     VALUES ($1, $2, true), ($3, $4, true)`,
    [wsA, userA, wsB, userB],
  );

  for (const table of WAVE_TABLES) {
    const rls = await client.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace`,
      [table],
    );
    if (!rls.rows[0]?.relrowsecurity) {
      console.log(`SKIP table ${table} — RLS não habilitado`);
      continue;
    }

    const secretA = `rls-secret-a-${suffix}`;
    const secretB = `rls-secret-b-${suffix}`;

    if (table === 'app_settings') {
      await client.query(
        `INSERT INTO public.app_settings (workspace_id, key, value) VALUES ($1, $2, $3::jsonb), ($4, $5, $6::jsonb)`,
        [wsA, `smoke_${suffix}_a`, JSON.stringify({ secret: secretA }), wsB, `smoke_${suffix}_b`, JSON.stringify({ secret: secretB })],
      );
    } else if (table === 'roles') {
      await client.query(
        `INSERT INTO public.roles (workspace_id, name) VALUES ($1, $2), ($3, $4)`,
        [wsA, `Role A ${suffix}`, wsB, `Role B ${suffix}`],
      );
    } else if (table === 'sectors') {
      await client.query(
        `INSERT INTO public.sectors (workspace_id, name) VALUES ($1, $2), ($3, $4)`,
        [wsA, `Sector A ${suffix}`, wsB, `Sector B ${suffix}`],
      );
    } else if (table === 'automation_rules') {
      await client.query(
        `INSERT INTO public.automation_rules (workspace_id, name, trigger_type, event_type, is_active)
         VALUES ($1, $2, 'event', 'smoke', true), ($3, $4, 'event', 'smoke', true)`,
        [wsA, `Auto A ${suffix}`, wsB, `Auto B ${suffix}`],
      );
    } else if (table === 'routing_rules') {
      await client.query(
        `INSERT INTO public.routing_rules (workspace_id, name, priority, is_active, conditions, action)
         VALUES ($1, $2, 1, true, '{}'::jsonb, '{}'::jsonb), ($3, $4, 1, true, '{}'::jsonb, '{}'::jsonb)`,
        [wsA, `Route A ${suffix}`, wsB, `Route B ${suffix}`],
      );
    } else if (table === 'sla_policies') {
      await client.query(
        `INSERT INTO public.sla_policies (workspace_id, name) VALUES ($1, $2), ($3, $4)`,
        [wsA, `SLA A ${suffix}`, wsB, `SLA B ${suffix}`],
      );
    } else if (table === 'bot_flows') {
      await client.query(
        `INSERT INTO public.bot_flows (workspace_id, name) VALUES ($1, $2), ($3, $4)`,
        [wsA, `Bot A ${suffix}`, wsB, `Bot B ${suffix}`],
      );
    } else if (table === 'message_templates') {
      await client.query(
        `INSERT INTO public.message_templates (workspace_id, name, category, body)
         VALUES ($1, $2, 'operational', $3), ($4, $5, 'operational', $6)`,
        [wsA, `Tpl A ${suffix}`, `Body A ${suffix}`, wsB, `Tpl B ${suffix}`, `Body B ${suffix}`],
      );
    } else if (table === 'api_tokens') {
      await client.query(
        `INSERT INTO public.api_tokens (workspace_id, name, token_prefix, token_hash)
         VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
        [wsA, `Token A ${suffix}`, `pa_${suffix}`, `ha_${suffix}`, wsB, `Token B ${suffix}`, `pb_${suffix}`, `hb_${suffix}`],
      );
    } else if (table === 'audit_logs') {
      await client.query(
        `INSERT INTO public.audit_logs (workspace_id, action, entity_type)
         VALUES ($1, $2, 'smoke'), ($3, $4, 'smoke')`,
        [wsA, `action_a_${suffix}`, wsB, `action_b_${suffix}`],
      );
    } else if (table === 'campaigns') {
      await client.query(
        `INSERT INTO public.campaigns (workspace_id, name) VALUES ($1, $2), ($3, $4)`,
        [wsA, `Campaign A ${suffix}`, wsB, `Campaign B ${suffix}`],
      );
    } else if (table === 'campaign_recipients') {
      const campA = (
        await client.query(
          `INSERT INTO public.campaigns (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsA, `Camp A recip ${suffix}`],
        )
      ).rows[0].id;
      const campB = (
        await client.query(
          `INSERT INTO public.campaigns (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsB, `Camp B recip ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.campaign_recipients (workspace_id, campaign_id, wa_phone)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, campA, `+5511999${suffix}1`, wsB, campB, `+5511999${suffix}2`],
      );
    } else if (table === 'campaign_dispatch_logs') {
      const campA = (
        await client.query(
          `INSERT INTO public.campaigns (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsA, `Camp A log ${suffix}`],
        )
      ).rows[0].id;
      const campB = (
        await client.query(
          `INSERT INTO public.campaigns (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsB, `Camp B log ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.campaign_dispatch_logs (workspace_id, campaign_id, action)
         VALUES ($1, $2, 'sent'), ($3, $4, 'sent')`,
        [wsA, campA, wsB, campB],
      );
    } else if (table === 'automation_runs') {
      const ruleA = (
        await client.query(
          `INSERT INTO public.automation_rules (workspace_id, name, trigger_type, event_type, is_active)
           VALUES ($1, $2, 'event', 'smoke', true) RETURNING id`,
          [wsA, `Rule A run ${suffix}`],
        )
      ).rows[0].id;
      const ruleB = (
        await client.query(
          `INSERT INTO public.automation_rules (workspace_id, name, trigger_type, event_type, is_active)
           VALUES ($1, $2, 'event', 'smoke', true) RETURNING id`,
          [wsB, `Rule B run ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.automation_runs (workspace_id, rule_id, status)
         VALUES ($1, $2, 'running'), ($3, $4, 'running')`,
        [wsA, ruleA, wsB, ruleB],
      );
    } else if (table === 'bot_sessions') {
      const contactA = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `+5521988${suffix}1`, `Contact A ${suffix}`],
        )
      ).rows[0].id;
      const contactB = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `+5521988${suffix}2`, `Contact B ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.bot_sessions (workspace_id, contact_id, expires_at)
         VALUES ($1, $2, now() + interval '1 hour'), ($3, $4, now() + interval '1 hour')`,
        [wsA, contactA, wsB, contactB],
      );
    } else if (table === 'leaders') {
      await client.query(
        `INSERT INTO public.leaders (workspace_id, name, phone)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, `Leader A ${suffix}`, `+5531977${suffix}1`, wsB, `Leader B ${suffix}`, `+5531977${suffix}2`],
      );
    } else if (table === 'pharmacies') {
      await client.query(
        `INSERT INTO public.pharmacies (workspace_id, legal_name, trade_name)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, `Pharmacy A LTDA ${suffix}`, `Pharmacy A ${suffix}`, wsB, `Pharmacy B LTDA ${suffix}`, `Pharmacy B ${suffix}`],
      );
    } else if (table === 'drivers') {
      await client.query(
        `INSERT INTO public.drivers (workspace_id, name, phone)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, `Driver A ${suffix}`, `+5541966${suffix}1`, wsB, `Driver B ${suffix}`, `+5541966${suffix}2`],
      );
    } else if (table === 'driver_pharmacy_links') {
      const pharmA = (
        await client.query(
          `INSERT INTO public.pharmacies (workspace_id, legal_name, trade_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `Pharm A link ${suffix}`, `Pharm A ${suffix}`],
        )
      ).rows[0].id;
      const pharmB = (
        await client.query(
          `INSERT INTO public.pharmacies (workspace_id, legal_name, trade_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `Pharm B link ${suffix}`, `Pharm B ${suffix}`],
        )
      ).rows[0].id;
      const driverA = (
        await client.query(
          `INSERT INTO public.drivers (workspace_id, name, phone)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `Driver A link ${suffix}`, `+5541855${suffix}1`],
        )
      ).rows[0].id;
      const driverB = (
        await client.query(
          `INSERT INTO public.drivers (workspace_id, name, phone)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `Driver B link ${suffix}`, `+5541855${suffix}2`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.driver_pharmacy_links (workspace_id, driver_id, pharmacy_id, is_primary)
         VALUES ($1, $2, $3, true), ($4, $5, $6, true)`,
        [wsA, driverA, pharmA, wsB, driverB, pharmB],
      );
    } else if (table === 'leader_pharmacy_links') {
      const leaderA = (
        await client.query(
          `INSERT INTO public.leaders (workspace_id, name, phone)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `Leader A link ${suffix}`, `+5531744${suffix}1`],
        )
      ).rows[0].id;
      const leaderB = (
        await client.query(
          `INSERT INTO public.leaders (workspace_id, name, phone)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `Leader B link ${suffix}`, `+5531744${suffix}2`],
        )
      ).rows[0].id;
      const pharmA = (
        await client.query(
          `INSERT INTO public.pharmacies (workspace_id, legal_name, trade_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `Pharm A lplink ${suffix}`, `Pharm A lp ${suffix}`],
        )
      ).rows[0].id;
      const pharmB = (
        await client.query(
          `INSERT INTO public.pharmacies (workspace_id, legal_name, trade_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `Pharm B lplink ${suffix}`, `Pharm B lp ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.leader_pharmacy_links (workspace_id, leader_id, pharmacy_id)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, leaderA, pharmA, wsB, leaderB, pharmB],
      );
    } else if (table === 'conversation_flow_definitions') {
      await client.query(
        `INSERT INTO public.conversation_flow_definitions (workspace_id, slug, name)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, `flow-a-${suffix}`, `Flow A ${suffix}`, wsB, `flow-b-${suffix}`, `Flow B ${suffix}`],
      );
    } else if (table === 'conversation_flow_versions') {
      const defA = (
        await client.query(
          `INSERT INTO public.conversation_flow_definitions (workspace_id, slug, name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `flow-ver-a-${suffix}`, `Flow Ver A ${suffix}`],
        )
      ).rows[0].id;
      const defB = (
        await client.query(
          `INSERT INTO public.conversation_flow_definitions (workspace_id, slug, name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `flow-ver-b-${suffix}`, `Flow Ver B ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.conversation_flow_versions (workspace_id, definition_id, version_number)
         VALUES ($1, $2, 1), ($3, $4, 1)`,
        [wsA, defA, wsB, defB],
      );
    } else if (table === 'conversation_flow_bindings') {
      const defA = (
        await client.query(
          `INSERT INTO public.conversation_flow_definitions (workspace_id, slug, name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `flow-bind-a-${suffix}`, `Flow Bind A ${suffix}`],
        )
      ).rows[0].id;
      const defB = (
        await client.query(
          `INSERT INTO public.conversation_flow_definitions (workspace_id, slug, name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `flow-bind-b-${suffix}`, `Flow Bind B ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.conversation_flow_bindings (workspace_id, definition_id)
         VALUES ($1, $2), ($3, $4)`,
        [wsA, defA, wsB, defB],
      );
    } else if (table === 'conversation_flow_sessions') {
      const defA = (
        await client.query(
          `INSERT INTO public.conversation_flow_definitions (workspace_id, slug, name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `flow-sess-a-${suffix}`, `Flow Sess A ${suffix}`],
        )
      ).rows[0].id;
      const defB = (
        await client.query(
          `INSERT INTO public.conversation_flow_definitions (workspace_id, slug, name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `flow-sess-b-${suffix}`, `Flow Sess B ${suffix}`],
        )
      ).rows[0].id;
      const verA = (
        await client.query(
          `INSERT INTO public.conversation_flow_versions (workspace_id, definition_id, version_number)
           VALUES ($1, $2, 1) RETURNING id`,
          [wsA, defA],
        )
      ).rows[0].id;
      const verB = (
        await client.query(
          `INSERT INTO public.conversation_flow_versions (workspace_id, definition_id, version_number)
           VALUES ($1, $2, 1) RETURNING id`,
          [wsB, defB],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.conversation_flow_sessions (workspace_id, flow_version_id)
         VALUES ($1, $2), ($3, $4)`,
        [wsA, verA, wsB, verB],
      );
    } else if (table === 'conversation_assignments') {
      const contactA = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `+5521777${suffix}1`, `Assign A ${suffix}`],
        )
      ).rows[0].id;
      const contactB = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `+5521777${suffix}2`, `Assign B ${suffix}`],
        )
      ).rows[0].id;
      const convA = (
        await client.query(
          `INSERT INTO public.conversations (workspace_id, contact_id) VALUES ($1, $2) RETURNING id`,
          [wsA, contactA],
        )
      ).rows[0].id;
      const convB = (
        await client.query(
          `INSERT INTO public.conversations (workspace_id, contact_id) VALUES ($1, $2) RETURNING id`,
          [wsB, contactB],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.conversation_assignments (workspace_id, conversation_id)
         VALUES ($1, $2), ($3, $4)`,
        [wsA, convA, wsB, convB],
      );
    } else if (table === 'internal_notes') {
      const contactA = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `+5521666${suffix}1`, `Note A ${suffix}`],
        )
      ).rows[0].id;
      const contactB = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `+5521666${suffix}2`, `Note B ${suffix}`],
        )
      ).rows[0].id;
      const convA = (
        await client.query(
          `INSERT INTO public.conversations (workspace_id, contact_id) VALUES ($1, $2) RETURNING id`,
          [wsA, contactA],
        )
      ).rows[0].id;
      const convB = (
        await client.query(
          `INSERT INTO public.conversations (workspace_id, contact_id) VALUES ($1, $2) RETURNING id`,
          [wsB, contactB],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.internal_notes (workspace_id, conversation_id, author_id, content)
         VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
        [wsA, convA, userA, `Note A ${suffix}`, wsB, convB, userB, `Note B ${suffix}`],
      );
    } else if (table === 'internal_chat_messages') {
      const contactA = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `+5521555${suffix}1`, `Chat A ${suffix}`],
        )
      ).rows[0].id;
      const contactB = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `+5521555${suffix}2`, `Chat B ${suffix}`],
        )
      ).rows[0].id;
      const convA = (
        await client.query(
          `INSERT INTO public.conversations (workspace_id, contact_id) VALUES ($1, $2) RETURNING id`,
          [wsA, contactA],
        )
      ).rows[0].id;
      const convB = (
        await client.query(
          `INSERT INTO public.conversations (workspace_id, contact_id) VALUES ($1, $2) RETURNING id`,
          [wsB, contactB],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.internal_chat_messages (workspace_id, conversation_id, sender_id, content)
         VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
        [wsA, convA, userA, `Chat A ${suffix}`, wsB, convB, userB, `Chat B ${suffix}`],
      );
    } else if (table === 'sla_events') {
      const contactA = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `+5521444${suffix}1`, `SLA A ${suffix}`],
        )
      ).rows[0].id;
      const contactB = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `+5521444${suffix}2`, `SLA B ${suffix}`],
        )
      ).rows[0].id;
      const convA = (
        await client.query(
          `INSERT INTO public.conversations (workspace_id, contact_id) VALUES ($1, $2) RETURNING id`,
          [wsA, contactA],
        )
      ).rows[0].id;
      const convB = (
        await client.query(
          `INSERT INTO public.conversations (workspace_id, contact_id) VALUES ($1, $2) RETURNING id`,
          [wsB, contactB],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.sla_events (workspace_id, conversation_id, event_type, severity)
         VALUES ($1, $2, 'breach_first_response', 'warning'), ($3, $4, 'breach_first_response', 'warning')`,
        [wsA, convA, wsB, convB],
      );
    } else if (table === 'ticket_events') {
      const ticketA = (
        await client.query(
          `INSERT INTO public.tickets (
             workspace_id, ticket_code, persona, type, priority, sla_minutes, channel_origin, due_at, context_snap
           ) VALUES ($1, $2, 'driver', 'question', 'normal', 480, 'whatsapp', now() + interval '1 day', '{}'::jsonb)
           RETURNING id`,
          [wsA, `TKT-A-${suffix}`],
        )
      ).rows[0].id;
      const ticketB = (
        await client.query(
          `INSERT INTO public.tickets (
             workspace_id, ticket_code, persona, type, priority, sla_minutes, channel_origin, due_at, context_snap
           ) VALUES ($1, $2, 'driver', 'question', 'normal', 480, 'whatsapp', now() + interval '1 day', '{}'::jsonb)
           RETURNING id`,
          [wsB, `TKT-B-${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.ticket_events (workspace_id, ticket_id, event_type)
         VALUES ($1, $2, 'created'), ($3, $4, 'created')`,
        [wsA, ticketA, wsB, ticketB],
      );
    } else if (table === 'user_sectors') {
      const sectorA = (
        await client.query(
          `INSERT INTO public.sectors (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsA, `Sector US A ${suffix}`],
        )
      ).rows[0].id;
      const sectorB = (
        await client.query(
          `INSERT INTO public.sectors (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsB, `Sector US B ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.user_sectors (workspace_id, user_id, sector_id)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, userA, sectorA, wsB, userB, sectorB],
      );
    } else if (table === 'workspace_channels') {
      await client.query(
        `INSERT INTO public.workspace_channels (workspace_id, channel_type, provider, display_name)
         VALUES ($1, 'whatsapp', 'meta', $2), ($3, 'whatsapp', 'meta', $4)`,
        [wsA, `Channel A ${suffix}`, wsB, `Channel B ${suffix}`],
      );
    } else if (table === 'workspace_memberships') {
      // memberships de wsA/userA e wsB/userB já criados no setup deste smoke
    } else if (table === 'pharmacy_sector_attendants') {
      const pharmA = (
        await client.query(
          `INSERT INTO public.pharmacies (workspace_id, legal_name, trade_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `Pharm PSA A ${suffix}`, `Pharm A ${suffix}`],
        )
      ).rows[0].id;
      const pharmB = (
        await client.query(
          `INSERT INTO public.pharmacies (workspace_id, legal_name, trade_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `Pharm PSA B ${suffix}`, `Pharm B ${suffix}`],
        )
      ).rows[0].id;
      const sectorA = (
        await client.query(
          `INSERT INTO public.sectors (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsA, `Sector PSA A ${suffix}`],
        )
      ).rows[0].id;
      const sectorB = (
        await client.query(
          `INSERT INTO public.sectors (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsB, `Sector PSA B ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.pharmacy_sector_attendants (workspace_id, pharmacy_id, sector_id, attendant_id)
         VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
        [wsA, pharmA, sectorA, userA, wsB, pharmB, sectorB, userB],
      );
    } else if (table === 'financial_imports') {
      await client.query(
        `INSERT INTO public.financial_imports (workspace_id, file_name)
         VALUES ($1, $2), ($3, $4)`,
        [wsA, `import-a-${suffix}.csv`, wsB, `import-b-${suffix}.csv`],
      );
    } else if (table === 'financial_import_rows') {
      const importA = (
        await client.query(
          `INSERT INTO public.financial_imports (workspace_id, file_name)
           VALUES ($1, $2) RETURNING id`,
          [wsA, `import-row-a-${suffix}.csv`],
        )
      ).rows[0].id;
      const importB = (
        await client.query(
          `INSERT INTO public.financial_imports (workspace_id, file_name)
           VALUES ($1, $2) RETURNING id`,
          [wsB, `import-row-b-${suffix}.csv`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.financial_import_rows (workspace_id, import_id, gross_amount)
         VALUES ($1, $2, 10.00), ($3, $4, 20.00)`,
        [wsA, importA, wsB, importB],
      );
    } else if (table === 'financial_exports') {
      await client.query(
        `INSERT INTO public.financial_exports (workspace_id) VALUES ($1), ($2)`,
        [wsA, wsB],
      );
    } else if (table === 'financial_installments') {
      const driverA = (
        await client.query(
          `INSERT INTO public.drivers (workspace_id, name, phone)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `Driver FI A ${suffix}`, `+5541333${suffix}1`],
        )
      ).rows[0].id;
      const driverB = (
        await client.query(
          `INSERT INTO public.drivers (workspace_id, name, phone)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `Driver FI B ${suffix}`, `+5541333${suffix}2`],
        )
      ).rows[0].id;
      const entryA = (
        await client.query(
          `INSERT INTO public.financial_entries (
             workspace_id, driver_id, type, total_amount, installment_amount, start_date, created_by
           ) VALUES ($1, $2, 'other', 100.00, 50.00, current_date, $3) RETURNING id`,
          [wsA, driverA, userA],
        )
      ).rows[0].id;
      const entryB = (
        await client.query(
          `INSERT INTO public.financial_entries (
             workspace_id, driver_id, type, total_amount, installment_amount, start_date, created_by
           ) VALUES ($1, $2, 'other', 200.00, 100.00, current_date, $3) RETURNING id`,
          [wsB, driverB, userB],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.financial_installments (workspace_id, entry_id, installment_number, amount, due_date)
         VALUES ($1, $2, 1, 50.00, current_date), ($3, $4, 1, 100.00, current_date)`,
        [wsA, entryA, wsB, entryB],
      );
    } else if (table === 'email_delivery_log') {
      await client.query(
        `INSERT INTO public.email_delivery_log (workspace_id, template_key, recipient)
         VALUES ($1, 'smoke', $2), ($3, 'smoke', $4)`,
        [wsA, `a-${suffix}@smoke.local`, wsB, `b-${suffix}@smoke.local`],
      );
    } else if (table === 'supply_requests') {
      const leaderA = (
        await client.query(
          `INSERT INTO public.leaders (workspace_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `Leader SR A ${suffix}`, `+5531222${suffix}1`],
        )
      ).rows[0].id;
      const leaderB = (
        await client.query(
          `INSERT INTO public.leaders (workspace_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `Leader SR B ${suffix}`, `+5531222${suffix}2`],
        )
      ).rows[0].id;
      const driverA = (
        await client.query(
          `INSERT INTO public.drivers (workspace_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `Driver SR A ${suffix}`, `+5541111${suffix}1`],
        )
      ).rows[0].id;
      const driverB = (
        await client.query(
          `INSERT INTO public.drivers (workspace_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `Driver SR B ${suffix}`, `+5541111${suffix}2`],
        )
      ).rows[0].id;
      const pharmA = (
        await client.query(
          `INSERT INTO public.pharmacies (workspace_id, legal_name, trade_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `Pharm SR A ${suffix}`, `Pharm A ${suffix}`],
        )
      ).rows[0].id;
      const pharmB = (
        await client.query(
          `INSERT INTO public.pharmacies (workspace_id, legal_name, trade_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `Pharm SR B ${suffix}`, `Pharm B ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.supply_requests (workspace_id, leader_id, driver_id, pharmacy_id, item_type)
         VALUES ($1, $2, $3, $4, 'uniform'), ($5, $6, $7, $8, 'uniform')`,
        [wsA, leaderA, driverA, pharmA, wsB, leaderB, driverB, pharmB],
      );
    } else if (table === 'tickets') {
      await client.query(
        `INSERT INTO public.tickets (
           workspace_id, ticket_code, persona, type, priority, sla_minutes, channel_origin, due_at, context_snap
         ) VALUES
         ($1, $2, 'driver', 'question', 'normal', 480, 'whatsapp', now() + interval '1 day', '{}'::jsonb),
         ($3, $4, 'driver', 'question', 'normal', 480, 'whatsapp', now() + interval '1 day', '{}'::jsonb)`,
        [wsA, `TKT-W8-A-${suffix}`, wsB, `TKT-W8-B-${suffix}`],
      );
    } else if (table === 'contacts') {
      await client.query(
        `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, `+5521999${suffix}1`, `Contact W9 A ${suffix}`, wsB, `+5521999${suffix}2`, `Contact W9 B ${suffix}`],
      );
    } else if (table === 'conversations') {
      const contactA = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `+5521888${suffix}1`, `Conv A ${suffix}`],
        )
      ).rows[0].id;
      const contactB = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `+5521888${suffix}2`, `Conv B ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.conversations (workspace_id, contact_id) VALUES ($1, $2), ($3, $4)`,
        [wsA, contactA, wsB, contactB],
      );
    } else if (table === 'messages') {
      const contactA = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `+5521333${suffix}1`, `Msg A ${suffix}`],
        )
      ).rows[0].id;
      const contactB = (
        await client.query(
          `INSERT INTO public.contacts (workspace_id, wa_phone, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `+5521333${suffix}2`, `Msg B ${suffix}`],
        )
      ).rows[0].id;
      const convA = (
        await client.query(
          `INSERT INTO public.conversations (workspace_id, contact_id) VALUES ($1, $2) RETURNING id`,
          [wsA, contactA],
        )
      ).rows[0].id;
      const convB = (
        await client.query(
          `INSERT INTO public.conversations (workspace_id, contact_id) VALUES ($1, $2) RETURNING id`,
          [wsB, contactB],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.messages (workspace_id, conversation_id, direction, type, content)
         VALUES ($1, $2, 'inbound', 'text', $3), ($4, $5, 'inbound', 'text', $6)`,
        [wsA, convA, `Msg A ${suffix}`, wsB, convB, `Msg B ${suffix}`],
      );
    } else if (table === 'financial_entries') {
      const driverA = (
        await client.query(
          `INSERT INTO public.drivers (workspace_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `Driver FE A ${suffix}`, `+5541999${suffix}1`],
        )
      ).rows[0].id;
      const driverB = (
        await client.query(
          `INSERT INTO public.drivers (workspace_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `Driver FE B ${suffix}`, `+5541999${suffix}2`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.financial_entries (
           workspace_id, driver_id, type, total_amount, installment_amount, start_date, created_by
         ) VALUES
         ($1, $2, 'other', 100.00, 100.00, current_date, $3),
         ($4, $5, 'other', 200.00, 200.00, current_date, $6)`,
        [wsA, driverA, userA, wsB, driverB, userB],
      );
    } else if (table === 'pending_tasks') {
      await client.query(
        `INSERT INTO public.pending_tasks (workspace_id, task_type, title)
         VALUES ($1, 'smoke', $2), ($3, 'smoke', $4)`,
        [wsA, `Task A ${suffix}`, wsB, `Task B ${suffix}`],
      );
    } else if (table === 'workspace_profiles') {
      await client.query(
        `INSERT INTO public.workspace_profiles (workspace_id, code, label)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, `prof-a-${suffix}`, `Profile A ${suffix}`, wsB, `prof-b-${suffix}`, `Profile B ${suffix}`],
      );
    } else if (table === 'workspace_visible_sectors') {
      await client.query(
        `INSERT INTO public.workspace_visible_sectors (workspace_id, sector_key, display_name)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, `sec-a-${suffix}`, `Sector A ${suffix}`, wsB, `sec-b-${suffix}`, `Sector B ${suffix}`],
      );
    } else if (table === 'workspace_sector_demands') {
      await client.query(
        `INSERT INTO public.workspace_sector_demands (workspace_id, profile_code, sector_key, demand_key, title)
         VALUES ($1, 'driver', $2, $3, $4), ($5, 'driver', $6, $7, $8)`,
        [
          wsA,
          `sec-a-${suffix}`,
          `dem-a-${suffix}`,
          `Demand A ${suffix}`,
          wsB,
          `sec-b-${suffix}`,
          `dem-b-${suffix}`,
          `Demand B ${suffix}`,
        ],
      );
    } else if (table === 'workspace_demand_rules') {
      await client.query(
        `INSERT INTO public.workspace_demand_rules (workspace_id, demand_key)
         VALUES ($1, $2), ($3, $4)`,
        [wsA, `rule-a-${suffix}`, wsB, `rule-b-${suffix}`],
      );
    } else if (table === 'workspace_flow_messages') {
      await client.query(
        `INSERT INTO public.workspace_flow_messages (workspace_id, message_key, content)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, `msg-a-${suffix}`, `Flow A ${suffix}`, wsB, `msg-b-${suffix}`, `Flow B ${suffix}`],
      );
    } else if (table === 'commercial_pipeline_stages') {
      await client.query(
        `INSERT INTO public.commercial_pipeline_stages (workspace_id, name)
         VALUES ($1, $2), ($3, $4)`,
        [wsA, `Stage A ${suffix}`, wsB, `Stage B ${suffix}`],
      );
    } else if (table === 'commercial_loss_reasons') {
      await client.query(
        `INSERT INTO public.commercial_loss_reasons (workspace_id, name)
         VALUES ($1, $2), ($3, $4)`,
        [wsA, `Loss A ${suffix}`, wsB, `Loss B ${suffix}`],
      );
    } else if (table === 'commercial_field_definitions') {
      await client.query(
        `INSERT INTO public.commercial_field_definitions (workspace_id, slug, label)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, `field-a-${suffix}`, `Field A ${suffix}`, wsB, `field-b-${suffix}`, `Field B ${suffix}`],
      );
    } else if (table === 'commercial_leads') {
      const stageA = (
        await client.query(
          `INSERT INTO public.commercial_pipeline_stages (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsA, `Lead Stage A ${suffix}`],
        )
      ).rows[0].id;
      const stageB = (
        await client.query(
          `INSERT INTO public.commercial_pipeline_stages (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsB, `Lead Stage B ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.commercial_leads (workspace_id, stage_id, owner_id, trade_name, phone, city, state)
         VALUES ($1, $2, $3, $4, $5, 'City A', 'SP'), ($6, $7, $8, $9, $10, 'City B', 'RJ')`,
        [
          wsA,
          stageA,
          userA,
          `Lead A ${suffix}`,
          `+5511888${suffix}1`,
          wsB,
          stageB,
          userB,
          `Lead B ${suffix}`,
          `+5511888${suffix}2`,
        ],
      );
    } else if (table === 'commercial_lead_activities') {
      const stageA = (
        await client.query(
          `INSERT INTO public.commercial_pipeline_stages (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsA, `Act Stage A ${suffix}`],
        )
      ).rows[0].id;
      const stageB = (
        await client.query(
          `INSERT INTO public.commercial_pipeline_stages (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsB, `Act Stage B ${suffix}`],
        )
      ).rows[0].id;
      const leadA = (
        await client.query(
          `INSERT INTO public.commercial_leads (workspace_id, stage_id, owner_id, trade_name, phone, city, state)
           VALUES ($1, $2, $3, $4, $5, 'City A', 'SP') RETURNING id`,
          [wsA, stageA, userA, `Act Lead A ${suffix}`, `+5511777${suffix}1`],
        )
      ).rows[0].id;
      const leadB = (
        await client.query(
          `INSERT INTO public.commercial_leads (workspace_id, stage_id, owner_id, trade_name, phone, city, state)
           VALUES ($1, $2, $3, $4, $5, 'City B', 'RJ') RETURNING id`,
          [wsB, stageB, userB, `Act Lead B ${suffix}`, `+5511777${suffix}2`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.commercial_lead_activities (workspace_id, lead_id, activity_type, title)
         VALUES ($1, $2, 'note', $3), ($4, $5, 'note', $6)`,
        [wsA, leadA, `Activity A ${suffix}`, wsB, leadB, `Activity B ${suffix}`],
      );
    } else if (table === 'commercial_proposals') {
      const stageA = (
        await client.query(
          `INSERT INTO public.commercial_pipeline_stages (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsA, `Prop Stage A ${suffix}`],
        )
      ).rows[0].id;
      const stageB = (
        await client.query(
          `INSERT INTO public.commercial_pipeline_stages (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsB, `Prop Stage B ${suffix}`],
        )
      ).rows[0].id;
      const leadA = (
        await client.query(
          `INSERT INTO public.commercial_leads (workspace_id, stage_id, owner_id, trade_name, phone, city, state)
           VALUES ($1, $2, $3, $4, $5, 'City A', 'SP') RETURNING id`,
          [wsA, stageA, userA, `Prop Lead A ${suffix}`, `+5511666${suffix}1`],
        )
      ).rows[0].id;
      const leadB = (
        await client.query(
          `INSERT INTO public.commercial_leads (workspace_id, stage_id, owner_id, trade_name, phone, city, state)
           VALUES ($1, $2, $3, $4, $5, 'City B', 'RJ') RETURNING id`,
          [wsB, stageB, userB, `Prop Lead B ${suffix}`, `+5511666${suffix}2`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.commercial_proposals (workspace_id, lead_id, package_name)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, leadA, `Package A ${suffix}`, wsB, leadB, `Package B ${suffix}`],
      );
    } else if (table === 'commercial_data_requests') {
      const stageA = (
        await client.query(
          `INSERT INTO public.commercial_pipeline_stages (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsA, `DR Stage A ${suffix}`],
        )
      ).rows[0].id;
      const stageB = (
        await client.query(
          `INSERT INTO public.commercial_pipeline_stages (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [wsB, `DR Stage B ${suffix}`],
        )
      ).rows[0].id;
      const leadA = (
        await client.query(
          `INSERT INTO public.commercial_leads (workspace_id, stage_id, owner_id, trade_name, phone, city, state)
           VALUES ($1, $2, $3, $4, $5, 'City A', 'SP') RETURNING id`,
          [wsA, stageA, userA, `DR Lead A ${suffix}`, `+5511555${suffix}1`],
        )
      ).rows[0].id;
      const leadB = (
        await client.query(
          `INSERT INTO public.commercial_leads (workspace_id, stage_id, owner_id, trade_name, phone, city, state)
           VALUES ($1, $2, $3, $4, $5, 'City B', 'RJ') RETURNING id`,
          [wsB, stageB, userB, `DR Lead B ${suffix}`, `+5511555${suffix}2`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.commercial_data_requests (workspace_id, lead_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 day'), ($4, $5, $6, now() + interval '1 day')`,
        [wsA, leadA, `hash-a-${suffix}`, wsB, leadB, `hash-b-${suffix}`],
      );
    } else if (table === 'commercial_erp_options') {
      const exists = await client.query(`SELECT to_regclass('public.commercial_erp_options') AS reg`);
      if (!exists.rows[0]?.reg) {
        console.log('SKIP table commercial_erp_options — tabela não existe neste DB');
        continue;
      }
      await client.query(
        `INSERT INTO public.commercial_erp_options (workspace_id, name)
         VALUES ($1, $2), ($3, $4)`,
        [wsA, `ERP A ${suffix}`, wsB, `ERP B ${suffix}`],
      );
    } else if (table === 'workspace_sla_rules') {
      await client.query(
        `INSERT INTO public.workspace_sla_rules (workspace_id, demand_key)
         VALUES ($1, $2), ($3, $4)`,
        [wsA, `sla-a-${suffix}`, wsB, `sla-b-${suffix}`],
      );
    } else if (table === 'workspace_out_of_hours_rules') {
      await client.query(
        `INSERT INTO public.workspace_out_of_hours_rules (workspace_id, channel, message)
         VALUES ($1, 'whatsapp', $2), ($3, 'whatsapp', $4)`,
        [wsA, `OOH A ${suffix}`, wsB, `OOH B ${suffix}`],
      );
    } else if (table === 'workspace_report_targets') {
      await client.query(
        `INSERT INTO public.workspace_report_targets (workspace_id) VALUES ($1), ($2)`,
        [wsA, wsB],
      );
    } else if (table === 'user_channel_queue_assignments') {
      const channelA = (
        await client.query(
          `INSERT INTO public.workspace_channels (workspace_id, channel_type, provider, display_name)
           VALUES ($1, 'whatsapp', 'meta', $2) RETURNING id`,
          [wsA, `Channel QA A ${suffix}`],
        )
      ).rows[0].id;
      const channelB = (
        await client.query(
          `INSERT INTO public.workspace_channels (workspace_id, channel_type, provider, display_name)
           VALUES ($1, 'whatsapp', 'meta', $2) RETURNING id`,
          [wsB, `Channel QA B ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.user_channel_queue_assignments (workspace_id, user_id, workspace_channel_id)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [wsA, userA, channelA, wsB, userB, channelB],
      );
    } else if (table === 'leader_whatsapp_verifications') {
      const leaderA = (
        await client.query(
          `INSERT INTO public.leaders (workspace_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
          [wsA, `Leader WA A ${suffix}`, `+5531999${suffix}1`],
        )
      ).rows[0].id;
      const leaderB = (
        await client.query(
          `INSERT INTO public.leaders (workspace_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
          [wsB, `Leader WA B ${suffix}`, `+5531999${suffix}2`],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO public.leader_whatsapp_verifications (workspace_id, leader_id, phone_e164, code_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '1 hour'), ($5, $6, $7, $8, now() + interval '1 hour')`,
        [
          wsA,
          leaderA,
          `+5531999${suffix}1`,
          `code-a-${suffix}`,
          wsB,
          leaderB,
          `+5531999${suffix}2`,
          `code-b-${suffix}`,
        ],
      );
    } else if (table === 'processed_webhook_events') {
      await client.query(
        `INSERT INTO public.processed_webhook_events (workspace_id, meta_message_id, event_type)
         VALUES ($1, $2, 'smoke'), ($3, $4, 'smoke')`,
        [wsA, `wamid-a-${suffix}`, wsB, `wamid-b-${suffix}`],
      );
    } else {
      console.log(`SKIP table ${table} — sem fixture de insert neste smoke`);
      continue;
    }

    const rowsA = await asAuthenticated(userA, async () => {
      const { rows } = await client.query(
        `SELECT workspace_id::text FROM public.${table} WHERE workspace_id IN ($1, $2)`,
        [wsA, wsB],
      );
      return rows.map((r) => r.workspace_id);
    });

    if (!rowsA.includes(wsA)) {
      throw new Error(`RLS bloqueou leitura do próprio workspace A em ${table} (rows=${rowsA.join(',')})`);
    }
    if (rowsA.includes(wsB)) {
      throw new Error(`RLS leak em ${table} para user A: viu workspace B`);
    }

    const rowsB = await asAuthenticated(userB, async () => {
      const { rows } = await client.query(
        `SELECT workspace_id::text FROM public.${table} WHERE workspace_id IN ($1, $2)`,
        [wsA, wsB],
      );
      return rows.map((r) => r.workspace_id);
    });

    if (!rowsB.includes(wsB)) {
      throw new Error(`RLS bloqueou leitura do próprio workspace B em ${table} (rows=${rowsB.join(',')})`);
    }
    if (rowsB.includes(wsA)) {
      throw new Error(`RLS leak em ${table} para user B: viu workspace A`);
    }

    console.log(`ok RLS ${table}`);
  }

  await client.query('ROLLBACK');
  console.log('OK: smoke-rls-tenant-isolation (wave tables + rollback).');
} catch (e) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('smoke-rls-tenant-isolation falhou:', e?.message || e);
  process.exit(1);
} finally {
  await client.end();
}
