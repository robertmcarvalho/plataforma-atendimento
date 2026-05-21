import { supabase } from './supabase';
import { enrichPharmacyApiRow } from './pharmacyCommercial';

export type JwtUser = {
  sub: string;
  role?: string;
  permissions?: Record<string, unknown>;
  sector_id?: string | null;
};

export function canViewFinancialData(user: JwtUser): boolean {
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role === 'supervisor' || role === 'financial' || role === 'operational') return true;
  const p = user.permissions as Record<string, Record<string, boolean>> | undefined;
  return p?.financial?.view === true;
}

export function maskCpf(cpf: string | null | undefined): string | null {
  if (!cpf) return null;
  const d = String(cpf).replace(/\D/g, '');
  if (d.length < 4) return '***';
  return `***${d.slice(-4)}`;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = String(phone).replace(/\D/g, '');
  if (d.length < 4) return '***';
  return `***${d.slice(-4)}`;
}

/** Garante que a conversa pertence ao workspace (multi-tenant). */
export async function assertConversationInWorkspace(
  conversationId: string,
  workspaceId: string,
  db: typeof supabase = supabase,
): Promise<boolean> {
  const { data, error } = await db
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export async function loadConversationCopilotContext(
  conversationId: string,
  workspaceId?: string | null,
): Promise<Record<string, unknown> | null> {
  let q = supabase
    .from('conversations')
    .select(
      `
        id, status, priority, tags, summary, opened_at, last_message_at,
        demand_key, sla_applied_from, workspace_channel_id,
        sla_first_response_deadline, sla_first_response_at, sla_first_response_ok,
        sla_treatment_deadline, sla_resolution_deadline, sla_resolved_ok,
        intent_sector_id,
        contacts(id, wa_phone, display_name, profile_type, driver_id, pharmacy_id, leader_id),
        sectors:sectors!sector_id(id, name),
        context_pharmacy:pharmacies!context_pharmacy_id(
          id, trade_name, city, state,
          delivery_fee_cents, delivery_fee_driver_payout_cents,
          minimum_guaranteed_cents, minimum_guaranteed_driver_payout_cents,
          delivery_schedule
        ),
        context_driver:drivers!context_driver_id(id, name, cpf, phone),
        context_leader:leaders!context_leader_id(id, name, phone),
        messages(id, direction, type, content, created_at)
      `,
    )
    .eq('id', conversationId);
  if (workspaceId) q = q.eq('workspace_id', workspaceId);
  const { data, error } = await q.single();

  if (error || !data) return null;

  const messages = (data as { messages?: Array<{ direction?: string; type?: string; content?: string | null; created_at?: string }> })
    .messages;
  const recent = (messages || [])
    .slice(-15)
    .map((m) => ({
      direction: m.direction,
      type: m.type,
      content: (m.content || '').slice(0, 500),
      created_at: m.created_at,
    }));

  const ctx = data as Record<string, unknown>;
  const ctxDriver = ctx.context_driver as { id?: string; name?: string; cpf?: string; phone?: string } | null;
  const contacts = ctx.contacts as {
    wa_phone?: string;
    display_name?: string | null;
    profile_type?: string;
    driver_id?: string | null;
    pharmacy_id?: string | null;
    leader_id?: string | null;
  } | null;

  return {
    conversation: {
      id: ctx.id,
      status: ctx.status,
      priority: ctx.priority,
      tags: ctx.tags,
      summary: ctx.summary,
      opened_at: ctx.opened_at,
      last_message_at: ctx.last_message_at,
      demand_key: ctx.demand_key ?? null,
      sla_applied_from: ctx.sla_applied_from ?? null,
      workspace_channel_id: ctx.workspace_channel_id ?? null,
      intent_sector_id: ctx.intent_sector_id ?? null,
      sla: {
        first_response_deadline: ctx.sla_first_response_deadline ?? null,
        first_response_at: ctx.sla_first_response_at ?? null,
        first_response_ok: ctx.sla_first_response_ok ?? null,
        treatment_deadline: ctx.sla_treatment_deadline ?? null,
        resolution_deadline: ctx.sla_resolution_deadline ?? null,
        resolved_ok: ctx.sla_resolved_ok ?? null,
      },
      sector: ctx.sectors,
      contact: contacts
        ? {
            display_name: contacts.display_name,
            profile_type: contacts.profile_type,
            wa_phone: maskPhone(contacts.wa_phone),
            driver_id: contacts.driver_id ?? null,
            pharmacy_id: contacts.pharmacy_id ?? null,
            leader_id: contacts.leader_id ?? null,
          }
        : null,
      context_driver: ctxDriver
        ? {
            id: ctxDriver.id,
            name: ctxDriver.name,
            cpf: maskCpf(ctxDriver.cpf),
            phone: maskPhone(ctxDriver.phone),
          }
        : null,
      context_pharmacy: ctx.context_pharmacy
        ? enrichPharmacyApiRow(ctx.context_pharmacy as Record<string, unknown>)
        : null,
      context_leader: ctx.context_leader
        ? {
            id: (ctx.context_leader as { id?: string }).id,
            name: (ctx.context_leader as { name?: string }).name,
            phone: maskPhone((ctx.context_leader as { phone?: string }).phone),
          }
        : null,
    },
    recent_messages: recent,
  };
}

function extractCpfDigits(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 11) return digits.slice(-11);
  return null;
}

function extractUuid(text: string): string | null {
  const m = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

function searchQueryFromMessage(message: string): string {
  const withoutIds = message.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ' ');
  const collapsed = withoutIds.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, 80);
}

export async function gatherEntityToolResults(input: {
  message: string;
  user: JwtUser;
  conversationContext: Record<string, unknown> | null;
  workspaceId?: string;
}): Promise<Record<string, unknown>> {
  const { message, user, conversationContext, workspaceId } = input;
  const out: Record<string, unknown> = {};

  const cpfDigits = extractCpfDigits(message);
  const uuidInMessage = extractUuid(message);
  const q = searchQueryFromMessage(message);

  const driverIdsToFetch = new Set<string>();

  const conv = conversationContext?.conversation as
    | {
        context_driver?: { id?: string } | null;
        contact?: { driver_id?: string | null } | null;
      }
    | undefined;
  if (conv?.context_driver?.id) driverIdsToFetch.add(conv.context_driver.id);
  if (conv?.contact?.driver_id) driverIdsToFetch.add(conv.contact.driver_id);

  if (uuidInMessage) {
    const { data: d } = await supabase.from('drivers').select('id').eq('id', uuidInMessage).maybeSingle();
    if (d?.id) driverIdsToFetch.add(d.id);
  }

  if (cpfDigits) {
    const { data: driversByCpf } = await supabase
      .from('drivers')
      .select('id, name, cpf, phone, primary_pharmacy_id')
      .ilike('cpf', `%${cpfDigits}%`)
      .limit(5);
    if (driversByCpf?.length) {
      out.drivers_cpf_match = driversByCpf.map((r) => ({
        id: r.id,
        name: r.name,
        cpf: maskCpf(r.cpf),
        phone: maskPhone(r.phone),
        primary_pharmacy_id: r.primary_pharmacy_id,
      }));
      driversByCpf.forEach((r) => driverIdsToFetch.add(r.id));
    }
  }

  if (q.length >= 2) {
    const { data: driversByName } = await supabase
      .from('drivers')
      .select('id, name, cpf, phone, primary_pharmacy_id')
      .ilike('name', `%${q}%`)
      .limit(8);
    if (driversByName?.length) {
      out.drivers_name_search = driversByName.map((r) => ({
        id: r.id,
        name: r.name,
        cpf: maskCpf(r.cpf),
        phone: maskPhone(r.phone),
        primary_pharmacy_id: r.primary_pharmacy_id,
      }));
      driversByName.forEach((r) => driverIdsToFetch.add(r.id));
    }

    const { data: pharmacies } = await supabase
      .from('pharmacies')
      .select('id, trade_name, city, phone')
      .ilike('trade_name', `%${q}%`)
      .limit(8);
    if (pharmacies?.length) {
      out.pharmacies = pharmacies.map((r) => ({
        id: r.id,
        trade_name: r.trade_name,
        city: r.city,
        phone: maskPhone(r.phone),
      }));
    }

    const { data: leaders } = await supabase.from('leaders').select('id, name, phone').ilike('name', `%${q}%`).limit(8);
    if (leaders?.length) {
      out.leaders = leaders.map((r) => ({
        id: r.id,
        name: r.name,
        phone: maskPhone(r.phone),
      }));
    }
  }

  if (canViewFinancialData(user) && driverIdsToFetch.size > 0) {
    const ids = Array.from(driverIdsToFetch).slice(0, 3);
    const { data: entries } = await supabase
      .from('financial_entries')
      .select('id, driver_id, type, description, total_amount, status, start_date, created_at')
      .in('driver_id', ids)
      .order('created_at', { ascending: false })
      .limit(12);
    if (entries?.length) {
      out.financial_entries_recent = entries.map((e) => ({
        id: e.id,
        driver_id: e.driver_id,
        type: e.type,
        description: e.description,
        total_amount: e.total_amount,
        status: e.status,
        start_date: e.start_date,
        created_at: e.created_at,
      }));
    }
  } else if (!canViewFinancialData(user) && /\b(financeiro|pagamento|diaria|diária|valor|desconto|faturamento)\b/i.test(message)) {
    out.financial_note = 'Usuario sem permissao para dados financeiros detalhados; nao inclua valores de pagamento.';
  }

  if (workspaceId && driverIdsToFetch.size) {
    const { analyzeDriverRegistrationGaps } = await import('./driverRegistrationCatalog');
    const primaryDriverId = Array.from(driverIdsToFetch)[0];
    out.driver_registration_gaps = await analyzeDriverRegistrationGaps(primaryDriverId, workspaceId);
  }

  return out;
}
