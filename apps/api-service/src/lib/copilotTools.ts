import { z } from 'zod';
import type { GeminiFunctionDeclaration, GeminiTool } from '@plataforma/ai-core';
import { supabase } from './supabase';
import { canViewFinancialData, maskCpf, maskPhone, type JwtUser } from './copilotContext';
import { buildMonthlyDriverSummary, buildWeeklyDriverSummary } from './financialSummaries';
import { buildPharmaciesWithDriversForLeader } from './leaderPortalScope';
import { analyzeDriverRegistrationGaps, getDriverRegistrationRequirements } from './driverRegistrationCatalog';
import {
  COMMERCIAL_COPILOT_TOOL_DECLARATIONS,
  executeCommercialCopilotTool,
  isCommercialCopilotTool,
} from './commercial/commercialCopilotTools';

export const LIST_LIMIT_MAX = 25;

export type CopilotToolContext = {
  user: JwtUser;
  workspaceId?: string;
};

function extractCpfDigits(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 11) return digits.slice(-11);
  return null;
}

function extractUuid(text: string): string | null {
  const m = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

/** Gemini REST Schema subset (uppercase type enums). */
function obj(props: Record<string, unknown>, required?: string[]): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: 'OBJECT',
    properties: props,
  };
  if (required?.length) base.required = required;
  return base;
}

const strOpt = { type: 'STRING' };
const strReq = { type: 'STRING' };

export const COPILOT_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: 'count_drivers',
    description:
      'Conta entregadores com filtros opcionais (status, driver_type fixo/diaria, cidade, estado, farmacia primaria, lider).',
    parameters: obj({
      status: { ...strOpt, description: 'active | inactive | blocked' },
      driver_type: { ...strOpt, description: 'fixed | daily' },
      city: strOpt,
      state: strOpt,
      leader_id: { ...strOpt, description: 'UUID do lider (override ou farmacia primaria)' },
      primary_pharmacy_id: { ...strOpt, description: 'UUID da farmacia primaria' },
    }),
  },
  {
    name: 'list_drivers',
    description: 'Lista entregadores (max 25) com filtros e busca parcial por nome.',
    parameters: obj({
      status: strOpt,
      name_search: strOpt,
      city: strOpt,
      state: strOpt,
      limit: { type: 'INTEGER', description: `1-${LIST_LIMIT_MAX}` },
    }),
  },
  {
    name: 'count_pharmacies',
    description: 'Conta farmacias com filtros.',
    parameters: obj({
      status: strOpt,
      city: strOpt,
      state: strOpt,
      leader_id: strOpt,
    }),
  },
  {
    name: 'list_pharmacies',
    description: 'Lista farmacias (max 25) com filtros.',
    parameters: obj({
      status: strOpt,
      name_search: strOpt,
      city: strOpt,
      state: strOpt,
      leader_id: strOpt,
      limit: { type: 'INTEGER' },
    }),
  },
  {
    name: 'count_leaders',
    description: 'Conta lideres.',
    parameters: obj({
      status: strOpt,
    }),
  },
  {
    name: 'list_leaders',
    description: 'Lista lideres (max 25).',
    parameters: obj({
      status: strOpt,
      name_search: strOpt,
      limit: { type: 'INTEGER' },
    }),
  },
  {
    name: 'count_tickets',
    description: 'Conta chamados/tickets operacionais.',
    parameters: obj({
      status: strOpt,
      sector_id: strOpt,
      contact_id: strOpt,
      since_iso: strOpt,
      until_iso: strOpt,
    }),
  },
  {
    name: 'list_tickets',
    description: 'Lista tickets (max 25).',
    parameters: obj({
      status: strOpt,
      contact_id: strOpt,
      driver_id: strOpt,
      limit: { type: 'INTEGER' },
    }),
  },
  {
    name: 'count_conversations',
    description: 'Conta conversas no inbox.',
    parameters: obj({
      status: strOpt,
      sector_id: strOpt,
      has_tag: strOpt,
      since_iso: strOpt,
    }),
  },
  {
    name: 'count_financial_entries',
    description: 'Conta lancamentos financeiros (requer permissao financeira).',
    parameters: obj({
      status: strOpt,
      type: strOpt,
      driver_id: strOpt,
      since_iso: strOpt,
      until_iso: strOpt,
    }),
  },
  {
    name: 'financial_summary_driver',
    description: 'Resumo financeiro mensal por entregador (mes YYYY-MM). Requer permissao financeira.',
    parameters: obj(
      {
        driver_id: { ...strReq, description: 'UUID do entregador' },
        month: { ...strOpt, description: 'YYYY-MM (default: mes atual UTC)' },
      },
      ['driver_id'],
    ),
  },
  {
    name: 'financial_weekly_summary_driver',
    description: 'Resumo financeiro semanal/ciclo conforme regras do setor. Requer permissao financeira.',
    parameters: obj(
      {
        driver_id: strReq,
        reference_date: { ...strOpt, description: 'YYYY-MM-DD opcional (default hoje UTC)' },
      },
      ['driver_id'],
    ),
  },
  {
    name: 'find_driver',
    description: 'Busca entregador por nome parcial, CPF ou UUID.',
    parameters: obj({ query: strReq }, ['query']),
  },
  {
    name: 'find_pharmacy',
    description: 'Busca farmacia por nome fantasia parcial ou UUID.',
    parameters: obj({ query: strReq }, ['query']),
  },
  {
    name: 'find_leader',
    description: 'Busca lider por nome parcial ou UUID.',
    parameters: obj({ query: strReq }, ['query']),
  },
  {
    name: 'get_driver_sheet',
    description:
      'Carrega a ficha completa do entregador (cadastro, farmacia primaria, atendente/lider override, vinculos N:N, ultimos lancamentos financeiros se houver permissao). Use driver_id UUID (obtido por find_driver ou contexto).',
    parameters: obj({ driver_id: strReq }, ['driver_id']),
  },
  {
    name: 'get_pharmacy_sheet',
    description:
      'Carrega a ficha completa da farmacia (cadastro, contatos, atendentes prim/sec, lider, vinculos de entregadores, setores-atendentes quando existir). pharmacy_id UUID.',
    parameters: obj({ pharmacy_id: strReq }, ['pharmacy_id']),
  },
  {
    name: 'get_leader_sheet',
    description:
      'Carrega a ficha completa do lider (cadastro, farmacias vinculadas, lista de entregadores ativos por farmacia na rede). leader_id UUID.',
    parameters: obj({ leader_id: strReq }, ['leader_id']),
  },
  {
    name: 'list_financial_entries',
    description:
      'Lista lancamentos financeiros recentes (max 25), filtros opcionais. Requer permissao financeira.',
    parameters: obj({
      driver_id: strOpt,
      status: strOpt,
      type: strOpt,
      since_iso: strOpt,
      until_iso: strOpt,
      limit: { type: 'INTEGER', description: `1-${LIST_LIMIT_MAX}` },
    }),
  },
  {
    name: 'get_driver_registration_requirements',
    description:
      'Lista campos necessarios para cadastro completo de entregador (formulario web + triagem do webhook). Use antes de orientar o atendente sobre o que pedir ao contato.',
    parameters: obj({}),
  },
  {
    name: 'analyze_driver_registration_gaps',
    description:
      'Compara a ficha do entregador no sistema com os campos obrigatorios e retorna o que falta preencher. Use quando o atendente perguntar o que falta no cadastro.',
    parameters: obj({ driver_id: strReq }, ['driver_id']),
  },
];

export function copilotToolDeclarations(commercialMode = false): GeminiFunctionDeclaration[] {
  return commercialMode
    ? [...COPILOT_TOOL_DECLARATIONS, ...COMMERCIAL_COPILOT_TOOL_DECLARATIONS]
    : COPILOT_TOOL_DECLARATIONS;
}

export const COPILOT_GEMINI_TOOLS: GeminiTool[] = [{ functionDeclarations: COPILOT_TOOL_DECLARATIONS }];

const countDriversSchema = z.object({
  status: z.enum(['active', 'inactive', 'blocked']).optional(),
  driver_type: z.enum(['fixed', 'daily']).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  leader_id: z.string().uuid().optional(),
  primary_pharmacy_id: z.string().uuid().optional(),
});

const listDriversSchema = z.object({
  status: z.enum(['active', 'inactive', 'blocked']).optional(),
  name_search: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LIST_LIMIT_MAX).optional(),
});

async function countDrivers(args: z.infer<typeof countDriversSchema>): Promise<Record<string, unknown>> {
  let q = supabase.from('drivers').select('*', { count: 'exact', head: true });
  if (args.status) q = q.eq('status', args.status);
  if (args.driver_type) q = q.eq('driver_type', args.driver_type);
  if (args.city) q = q.eq('city', args.city);
  if (args.state) q = q.eq('state', args.state);
  if (args.primary_pharmacy_id) q = q.eq('primary_pharmacy_id', args.primary_pharmacy_id);
  if (args.leader_id) {
    const { data: pharms } = await supabase.from('pharmacies').select('id').eq('leader_id', args.leader_id);
    const pids = (pharms || []).map((p: { id: string }) => p.id);
    const orParts = [`override_leader_id.eq.${args.leader_id}`];
    if (pids.length) orParts.push(`primary_pharmacy_id.in.(${pids.join(',')})`);
    q = q.or(orParts.join(','));
  }
  const { count, error } = await q;
  if (error) return { error: error.message };
  return { count: count ?? 0 };
}

async function listDrivers(args: z.infer<typeof listDriversSchema>): Promise<Record<string, unknown>> {
  const lim = Math.min(args.limit ?? 15, LIST_LIMIT_MAX);
  let q = supabase
    .from('drivers')
    .select('id, name, cpf, phone, city, state, status, driver_type, primary_pharmacy_id, override_leader_id')
    .order('name', { ascending: true })
    .limit(lim);
  if (args.status) q = q.eq('status', args.status);
  if (args.city) q = q.eq('city', args.city);
  if (args.state) q = q.eq('state', args.state);
  if (args.name_search && args.name_search.trim().length >= 2) {
    q = q.ilike('name', `%${args.name_search.trim()}%`);
  }
  const { data, error } = await q;
  if (error) return { error: error.message };
  const rows = (data || []).map((r: Record<string, unknown>) => ({
    id: r.id,
    name: r.name,
    cpf: maskCpf(r.cpf as string | null),
    phone: maskPhone(r.phone as string | null),
    city: r.city,
    state: r.state,
    status: r.status,
    driver_type: r.driver_type,
    primary_pharmacy_id: r.primary_pharmacy_id,
    override_leader_id: r.override_leader_id,
  }));
  return { items: rows, limit: lim };
}

const countPharmaciesSchema = z.object({
  status: z.enum(['active', 'inactive']).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  leader_id: z.string().uuid().optional(),
});

async function countPharmacies(args: z.infer<typeof countPharmaciesSchema>): Promise<Record<string, unknown>> {
  let q = supabase.from('pharmacies').select('*', { count: 'exact', head: true });
  if (args.status) q = q.eq('status', args.status);
  if (args.city) q = q.eq('city', args.city);
  if (args.state) q = q.eq('state', args.state);
  if (args.leader_id) q = q.eq('leader_id', args.leader_id);
  const { count, error } = await q;
  if (error) return { error: error.message };
  return { count: count ?? 0 };
}

const listPharmaciesSchema = z.object({
  status: z.enum(['active', 'inactive']).optional(),
  name_search: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  leader_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(LIST_LIMIT_MAX).optional(),
});

async function listPharmacies(args: z.infer<typeof listPharmaciesSchema>): Promise<Record<string, unknown>> {
  const lim = Math.min(args.limit ?? 15, LIST_LIMIT_MAX);
  let q = supabase
    .from('pharmacies')
    .select('id, trade_name, city, state, status, leader_id, phone')
    .order('trade_name', { ascending: true })
    .limit(lim);
  if (args.status) q = q.eq('status', args.status);
  if (args.city) q = q.eq('city', args.city);
  if (args.state) q = q.eq('state', args.state);
  if (args.leader_id) q = q.eq('leader_id', args.leader_id);
  if (args.name_search && args.name_search.trim().length >= 2) {
    q = q.ilike('trade_name', `%${args.name_search.trim()}%`);
  }
  const { data, error } = await q;
  if (error) return { error: error.message };
  const rows = (data || []).map((r: Record<string, unknown>) => ({
    id: r.id,
    trade_name: r.trade_name,
    city: r.city,
    state: r.state,
    status: r.status,
    leader_id: r.leader_id,
    phone: maskPhone(r.phone as string | null),
  }));
  return { items: rows, limit: lim };
}

const countLeadersSchema = z.object({
  status: z.enum(['active', 'inactive']).optional(),
});

async function countLeaders(args: z.infer<typeof countLeadersSchema>): Promise<Record<string, unknown>> {
  let q = supabase.from('leaders').select('*', { count: 'exact', head: true });
  if (args.status) q = q.eq('status', args.status);
  const { count, error } = await q;
  if (error) return { error: error.message };
  return { count: count ?? 0 };
}

const listLeadersSchema = z.object({
  status: z.enum(['active', 'inactive']).optional(),
  name_search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LIST_LIMIT_MAX).optional(),
});

async function listLeaders(args: z.infer<typeof listLeadersSchema>): Promise<Record<string, unknown>> {
  const lim = Math.min(args.limit ?? 15, LIST_LIMIT_MAX);
  let q = supabase.from('leaders').select('id, name, phone, city, state, status').order('name', { ascending: true }).limit(lim);
  if (args.status) q = q.eq('status', args.status);
  if (args.name_search && args.name_search.trim().length >= 2) {
    q = q.ilike('name', `%${args.name_search.trim()}%`);
  }
  const { data, error } = await q;
  if (error) return { error: error.message };
  const rows = (data || []).map((r: Record<string, unknown>) => ({
    id: r.id,
    name: r.name,
    phone: maskPhone(r.phone as string | null),
    city: r.city,
    state: r.state,
    status: r.status,
  }));
  return { items: rows, limit: lim };
}

const countTicketsSchema = z.object({
  status: z.string().optional(),
  sector_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  since_iso: z.string().optional(),
  until_iso: z.string().optional(),
});

async function countTickets(args: z.infer<typeof countTicketsSchema>): Promise<Record<string, unknown>> {
  let sectorConvIds: string[] | null = null;
  let contactConvIds: string[] | null = null;

  if (args.sector_id) {
    const { data: convs, error: cErr } = await supabase.from('conversations').select('id').eq('sector_id', args.sector_id);
    if (cErr) return { error: cErr.message };
    sectorConvIds = (convs || []).map((c: { id: string }) => c.id);
    if (sectorConvIds.length === 0) return { count: 0 };
  }

  if (args.contact_id) {
    const { data: convs, error: cErr } = await supabase.from('conversations').select('id').eq('contact_id', args.contact_id);
    if (cErr) return { error: cErr.message };
    contactConvIds = (convs || []).map((c: { id: string }) => c.id);
    if (contactConvIds.length === 0) return { count: 0 };
  }

  let convIds: string[] | null = null;
  if (sectorConvIds && contactConvIds) {
    const set = new Set(contactConvIds);
    convIds = sectorConvIds.filter((id) => set.has(id));
    if (convIds.length === 0) return { count: 0 };
  } else if (sectorConvIds) {
    convIds = sectorConvIds;
  } else if (contactConvIds) {
    convIds = contactConvIds;
  }

  let q = supabase.from('tickets').select('*', { count: 'exact', head: true });
  if (args.status) q = q.eq('status', args.status);
  if (args.since_iso) q = q.gte('created_at', args.since_iso);
  if (args.until_iso) q = q.lte('created_at', args.until_iso);
  if (convIds) q = q.in('conversation_id', convIds);
  const { count, error } = await q;
  if (error) return { error: error.message };
  return { count: count ?? 0 };
}

const listTicketsSchema = z.object({
  status: z.string().optional(),
  contact_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(LIST_LIMIT_MAX).optional(),
});

async function listTickets(args: z.infer<typeof listTicketsSchema>): Promise<Record<string, unknown>> {
  const lim = Math.min(args.limit ?? 15, LIST_LIMIT_MAX);
  let convIds: string[] | null = null;
  if (args.contact_id) {
    const { data: convs, error: cErr } = await supabase.from('conversations').select('id').eq('contact_id', args.contact_id);
    if (cErr) return { error: cErr.message };
    convIds = (convs || []).map((c: { id: string }) => c.id);
    if (convIds.length === 0) return { items: [], limit: lim };
  }

  let q = supabase
    .from('tickets')
    .select('id, ticket_code, status, priority, persona, driver_id, pharmacy_id, leader_id, conversation_id, created_at')
    .order('created_at', { ascending: false })
    .limit(lim);
  if (args.status) q = q.eq('status', args.status);
  if (args.driver_id) q = q.eq('driver_id', args.driver_id);
  if (convIds) q = q.in('conversation_id', convIds);
  const { data, error } = await q;
  if (error) return { error: error.message };
  return { items: data || [], limit: lim };
}

const countConversationsSchema = z.object({
  status: z.string().optional(),
  sector_id: z.string().uuid().optional(),
  has_tag: z.string().optional(),
  since_iso: z.string().optional(),
});

async function countConversations(args: z.infer<typeof countConversationsSchema>): Promise<Record<string, unknown>> {
  let q = supabase.from('conversations').select('*', { count: 'exact', head: true });
  if (args.status) q = q.eq('status', args.status);
  if (args.sector_id) q = q.eq('sector_id', args.sector_id);
  if (args.has_tag) q = q.contains('tags', [args.has_tag]);
  if (args.since_iso) q = q.gte('opened_at', args.since_iso);
  const { count, error } = await q;
  if (error) return { error: error.message };
  return { count: count ?? 0 };
}

const countFinancialEntriesSchema = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  driver_id: z.string().uuid().optional(),
  since_iso: z.string().optional(),
  until_iso: z.string().optional(),
});

async function countFinancialEntries(
  args: z.infer<typeof countFinancialEntriesSchema>,
  ctx: CopilotToolContext,
): Promise<Record<string, unknown>> {
  if (!canViewFinancialData(ctx.user)) return { error: 'forbidden_financial' };
  let q = supabase.from('financial_entries').select('*', { count: 'exact', head: true });
  if (args.status) q = q.eq('status', args.status);
  if (args.type) q = q.eq('type', args.type);
  if (args.driver_id) q = q.eq('driver_id', args.driver_id);
  if (args.since_iso) q = q.gte('created_at', args.since_iso);
  if (args.until_iso) q = q.lte('created_at', args.until_iso);
  const { count, error } = await q;
  if (error) return { error: error.message };
  return { count: count ?? 0 };
}

const financialSummarySchema = z.object({
  driver_id: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

async function financialSummaryDriver(
  args: z.infer<typeof financialSummarySchema>,
  ctx: CopilotToolContext,
): Promise<Record<string, unknown>> {
  if (!canViewFinancialData(ctx.user)) return { error: 'forbidden_financial' };
  const now = new Date();
  const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const month = args.month ?? defaultMonth;
  try {
    const summary = await buildMonthlyDriverSummary(args.driver_id, month);
    return { summary };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro ao montar resumo' };
  }
}

const financialWeeklySchema = z.object({
  driver_id: z.string().uuid(),
  reference_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

async function financialWeeklySummaryDriver(
  args: z.infer<typeof financialWeeklySchema>,
  ctx: CopilotToolContext,
): Promise<Record<string, unknown>> {
  if (!canViewFinancialData(ctx.user)) return { error: 'forbidden_financial' };
  try {
    const summary = await buildWeeklyDriverSummary(args.driver_id, args.reference_date);
    return { summary };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro ao montar resumo semanal' };
  }
}

const findQuerySchema = z.object({
  query: z.string().min(1).max(200),
});

const driverSheetSchema = z.object({ driver_id: z.string().uuid() });
const pharmacySheetSchema = z.object({ pharmacy_id: z.string().uuid() });
const leaderSheetSchema = z.object({ leader_id: z.string().uuid() });

const listFinancialEntriesToolSchema = z.object({
  driver_id: z.string().uuid().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  since_iso: z.string().optional(),
  until_iso: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LIST_LIMIT_MAX).optional(),
});

async function findDriver(args: z.infer<typeof findQuerySchema>): Promise<Record<string, unknown>> {
  const raw = args.query.trim();
  const uuidInMessage = extractUuid(raw);
  const cpfDigits = extractCpfDigits(raw);
  const items: Array<Record<string, unknown>> = [];

  if (uuidInMessage) {
    const { data: d } = await supabase
      .from('drivers')
      .select('id, name, cpf, phone, city, state, status')
      .eq('id', uuidInMessage)
      .maybeSingle();
    if (d) {
      items.push({
        id: d.id,
        name: d.name,
        cpf: maskCpf(d.cpf),
        phone: maskPhone(d.phone),
        city: d.city,
        state: d.state,
        status: d.status,
      });
    }
  }

  if (cpfDigits) {
    const { data: driversByCpf } = await supabase
      .from('drivers')
      .select('id, name, cpf, phone, city, state, status')
      .ilike('cpf', `%${cpfDigits}%`)
      .limit(8);
    for (const r of driversByCpf || []) {
      if (items.some((x) => x.id === r.id)) continue;
      items.push({
        id: r.id,
        name: r.name,
        cpf: maskCpf(r.cpf),
        phone: maskPhone(r.phone),
        city: r.city,
        state: r.state,
        status: r.status,
      });
    }
  }

  const q = raw.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ' ').trim();
  if (q.length >= 2) {
    const { data: driversByName } = await supabase
      .from('drivers')
      .select('id, name, cpf, phone, city, state, status')
      .ilike('name', `%${q.slice(0, 80)}%`)
      .limit(8);
    for (const r of driversByName || []) {
      if (items.some((x) => x.id === r.id)) continue;
      items.push({
        id: r.id,
        name: r.name,
        cpf: maskCpf(r.cpf),
        phone: maskPhone(r.phone),
        city: r.city,
        state: r.state,
        status: r.status,
      });
    }
  }

  return { items: items.slice(0, 8) };
}

async function findPharmacy(args: z.infer<typeof findQuerySchema>): Promise<Record<string, unknown>> {
  const raw = args.query.trim();
  const uuidInMessage = extractUuid(raw);
  const items: Array<Record<string, unknown>> = [];

  if (uuidInMessage) {
    const { data: p } = await supabase
      .from('pharmacies')
      .select('id, trade_name, city, state, status')
      .eq('id', uuidInMessage)
      .maybeSingle();
    if (p) items.push({ id: p.id, trade_name: p.trade_name, city: p.city, state: p.state, status: p.status });
  }

  const q = raw.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ' ').trim();
  if (q.length >= 2) {
    const { data: rows } = await supabase
      .from('pharmacies')
      .select('id, trade_name, city, state, status')
      .ilike('trade_name', `%${q.slice(0, 80)}%`)
      .limit(8);
    for (const r of rows || []) {
      if (items.some((x) => x.id === r.id)) continue;
      items.push({ id: r.id, trade_name: r.trade_name, city: r.city, state: r.state, status: r.status });
    }
  }

  return { items: items.slice(0, 8) };
}

function isPharmacySectorAttendantsTableMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: string } | null)?.message || '').toLowerCase();
  return code === '42P01' || message.includes('does not exist') || message.includes('pharmacy_sector_attendants');
}

function maskPharmacyPhones(raw: Record<string, unknown>): Record<string, unknown> {
  const row = { ...raw };
  for (const k of ['phone', 'contact_expedition_phone', 'contact_financial_phone', 'contact_manager_phone'] as const) {
    if (k in row) row[k] = maskPhone(row[k] as string | null);
  }
  const leader = row.leader as Record<string, unknown> | null | undefined;
  if (leader && typeof leader === 'object' && 'phone' in leader) {
    row.leader = { ...leader, phone: maskPhone(leader.phone as string | null) };
  }
  const links = row.driver_pharmacy_links as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(links)) {
    row.driver_pharmacy_links = links.map((link) => {
      const drivers = link.drivers as Record<string, unknown> | undefined;
      if (drivers && typeof drivers === 'object' && 'phone' in drivers) {
        return { ...link, drivers: { ...drivers, phone: maskPhone(drivers.phone as string | null) } };
      }
      return link;
    });
  }
  const lpl = row.leader_pharmacy_links as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(lpl)) {
    row.leader_pharmacy_links = lpl.map((x) => {
      const leaders = x.leaders as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
      if (Array.isArray(leaders)) {
        return {
          ...x,
          leaders: leaders.map((l) =>
            typeof l === 'object' && l && 'phone' in l
              ? { ...l, phone: maskPhone(l.phone as string | null) }
              : l,
          ),
        };
      }
      if (leaders && typeof leaders === 'object' && 'phone' in leaders) {
        return { ...x, leaders: { ...leaders, phone: maskPhone(leaders.phone as string | null) } };
      }
      return x;
    });
  }
  return row;
}

function maskLeaderSheetPhones(payload: Record<string, unknown>): Record<string, unknown> {
  const row = { ...payload };
  row.phone = maskPhone(row.phone as string | null);
  const pwd = row.pharmacies_with_drivers as Array<{ drivers?: Array<{ phone?: string | null }> }> | undefined;
  if (Array.isArray(pwd)) {
    row.pharmacies_with_drivers = pwd.map((p) => ({
      ...p,
      drivers: Array.isArray(p.drivers)
        ? p.drivers.map((d) => ({
            ...d,
            phone: maskPhone(d.phone ?? null),
          }))
        : p.drivers,
    }));
  }
  return row;
}

async function getDriverSheet(
  args: z.infer<typeof driverSheetSchema>,
  ctx: CopilotToolContext,
): Promise<Record<string, unknown>> {
  const includeFinancial = canViewFinancialData(ctx.user);
  let select = `
        *,
        primary_pharmacy:pharmacies!primary_pharmacy_id(id, trade_name, city, primary_attendant_id, leader_id),
        override_attendant:users!override_attendant_id(id, name),
        override_leader:leaders!override_leader_id(id, name),
        driver_pharmacy_links(
          id, is_primary, is_active, started_at, ended_at, notes,
          pharmacies(id, trade_name, city)
        )
      `;
  if (includeFinancial) {
    select += `,
        financial_entries(id, type, total_amount, status, created_at, description, start_date)
      `;
  }
  const { data, error } = await supabase.from('drivers').select(select).eq('id', args.driver_id).maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'not_found' };
  const row = data as unknown as Record<string, unknown>;
  row.cpf = maskCpf(row.cpf as string | null);
  row.phone = maskPhone(row.phone as string | null);
  if (!includeFinancial) {
    row.financial_note =
      'Lancamentos financeiros da ficha omitidos: usuario sem permissao financeira. Use dados cadastrais ou peca a um perfil autorizado.';
  }
  return { sheet: row };
}

async function getPharmacySheet(args: z.infer<typeof pharmacySheetSchema>): Promise<Record<string, unknown>> {
  const pharmacyId = args.pharmacy_id;
  const { data, error } = await supabase
    .from('pharmacies')
    .select(
      `
        *,
        primary_attendant:users!primary_attendant_id(id, name, email),
        secondary_attendant:users!secondary_attendant_id(id, name, email),
        leader:leaders(id, name, phone),
        leader_pharmacy_links(leader_id, is_active, leaders(id, name, phone)),
        driver_pharmacy_links(
          id, is_primary, is_active, started_at,
          drivers(id, name, phone, status, work_schedule)
        )
      `,
    )
    .eq('id', pharmacyId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'not_found' };

  let pharmacySectorAttendants: Array<Record<string, unknown>> = [];
  const { data: sectorRows, error: sectorErr } = await supabase
    .from('pharmacy_sector_attendants')
    .select(
      `
        sector_id,
        attendant_id,
        sector:sectors(id, name),
        attendant:users!attendant_id(id, name)
      `,
    )
    .eq('pharmacy_id', pharmacyId);

  if (sectorErr && !isPharmacySectorAttendantsTableMissing(sectorErr)) {
    return { error: sectorErr.message };
  }
  if (sectorRows) pharmacySectorAttendants = sectorRows as Array<Record<string, unknown>>;

  const masked = maskPharmacyPhones(data as Record<string, unknown>);
  const links = (masked.leader_pharmacy_links || []) as Array<{ is_active?: boolean; leaders?: unknown }>;
  const linkedLeader =
    (masked as { leader?: Record<string, unknown> | null }).leader ||
    links.find((x) => x?.is_active)?.leaders ||
    null;

  return {
    sheet: {
      ...masked,
      leader: linkedLeader,
      pharmacy_sector_attendants: pharmacySectorAttendants,
    },
  };
}

async function getLeaderSheet(args: z.infer<typeof leaderSheetSchema>): Promise<Record<string, unknown>> {
  const leaderId = args.leader_id;
  const { data, error } = await supabase
    .from('leaders')
    .select(
      `
        *,
        leader_pharmacy_links(
          id, is_active,
          pharmacies(id, trade_name, city)
        )
      `,
    )
    .eq('id', leaderId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'not_found' };

  const pharmacies_with_drivers = await buildPharmaciesWithDriversForLeader(supabase, leaderId);
  const sheet = maskLeaderSheetPhones({
    ...(data as Record<string, unknown>),
    pharmacies_with_drivers,
  });
  return { sheet };
}

async function findLeader(args: z.infer<typeof findQuerySchema>): Promise<Record<string, unknown>> {
  const raw = args.query.trim();
  const uuidInMessage = extractUuid(raw);
  const items: Array<Record<string, unknown>> = [];

  if (uuidInMessage) {
    const { data: l } = await supabase
      .from('leaders')
      .select('id, name, phone, city, state, status')
      .eq('id', uuidInMessage)
      .maybeSingle();
    if (l) {
      items.push({
        id: l.id,
        name: l.name,
        phone: maskPhone(l.phone),
        city: l.city,
        state: l.state,
        status: l.status,
      });
    }
  }

  const q = raw.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ' ').trim();
  if (q.length >= 2) {
    const { data: rows } = await supabase
      .from('leaders')
      .select('id, name, phone, city, state, status')
      .ilike('name', `%${q.slice(0, 80)}%`)
      .limit(8);
    for (const r of rows || []) {
      if (items.some((x) => x.id === r.id)) continue;
      items.push({
        id: r.id,
        name: r.name,
        phone: maskPhone(r.phone),
        city: r.city,
        state: r.state,
        status: r.status,
      });
    }
  }

  return { items: items.slice(0, 8) };
}

async function listFinancialEntriesTool(
  args: z.infer<typeof listFinancialEntriesToolSchema>,
  ctx: CopilotToolContext,
): Promise<Record<string, unknown>> {
  if (!canViewFinancialData(ctx.user)) return { error: 'forbidden_financial' };
  const lim = Math.min(args.limit ?? 15, LIST_LIMIT_MAX);
  let q = supabase
    .from('financial_entries')
    .select('id, driver_id, type, description, total_amount, status, start_date, created_at')
    .order('created_at', { ascending: false })
    .limit(lim);
  if (args.status) q = q.eq('status', args.status);
  if (args.type) q = q.eq('type', args.type);
  if (args.driver_id) q = q.eq('driver_id', args.driver_id);
  if (args.since_iso) q = q.gte('created_at', args.since_iso);
  if (args.until_iso) q = q.lte('created_at', args.until_iso);
  const { data, error } = await q;
  if (error) return { error: error.message };
  return { items: data || [], limit: lim };
}

function parseArgs<T>(schema: z.ZodType<T>, raw: Record<string, unknown> | undefined): { ok: true; data: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.flatten().toString() };
  }
  return { ok: true, data: parsed.data };
}

export async function executeCopilotTool(
  name: string,
  rawArgs: Record<string, unknown> | undefined,
  ctx: CopilotToolContext,
): Promise<Record<string, unknown>> {
  if (isCommercialCopilotTool(name)) {
    const ws = ctx.workspaceId;
    if (!ws) return { error: 'workspace_required' };
    return (await executeCommercialCopilotTool(name, rawArgs ?? {}, { workspaceId: ws })) as Record<
      string,
      unknown
    >;
  }

  switch (name) {
    case 'count_drivers': {
      const p = parseArgs(countDriversSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return countDrivers(p.data);
    }
    case 'list_drivers': {
      const p = parseArgs(listDriversSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return listDrivers(p.data);
    }
    case 'count_pharmacies': {
      const p = parseArgs(countPharmaciesSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return countPharmacies(p.data);
    }
    case 'list_pharmacies': {
      const p = parseArgs(listPharmaciesSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return listPharmacies(p.data);
    }
    case 'count_leaders': {
      const p = parseArgs(countLeadersSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return countLeaders(p.data);
    }
    case 'list_leaders': {
      const p = parseArgs(listLeadersSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return listLeaders(p.data);
    }
    case 'count_tickets': {
      const p = parseArgs(countTicketsSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return countTickets(p.data);
    }
    case 'list_tickets': {
      const p = parseArgs(listTicketsSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return listTickets(p.data);
    }
    case 'count_conversations': {
      const p = parseArgs(countConversationsSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return countConversations(p.data);
    }
    case 'count_financial_entries': {
      const p = parseArgs(countFinancialEntriesSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return countFinancialEntries(p.data, ctx);
    }
    case 'financial_summary_driver': {
      const p = parseArgs(financialSummarySchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return financialSummaryDriver(p.data, ctx);
    }
    case 'financial_weekly_summary_driver': {
      const p = parseArgs(financialWeeklySchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return financialWeeklySummaryDriver(p.data, ctx);
    }
    case 'find_driver': {
      const p = parseArgs(findQuerySchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return findDriver(p.data);
    }
    case 'find_pharmacy': {
      const p = parseArgs(findQuerySchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return findPharmacy(p.data);
    }
    case 'find_leader': {
      const p = parseArgs(findQuerySchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return findLeader(p.data);
    }
    case 'get_driver_sheet': {
      const p = parseArgs(driverSheetSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return getDriverSheet(p.data, ctx);
    }
    case 'get_pharmacy_sheet': {
      const p = parseArgs(pharmacySheetSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return getPharmacySheet(p.data);
    }
    case 'get_leader_sheet': {
      const p = parseArgs(leaderSheetSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return getLeaderSheet(p.data);
    }
    case 'list_financial_entries': {
      const p = parseArgs(listFinancialEntriesToolSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      return listFinancialEntriesTool(p.data, ctx);
    }
    case 'get_driver_registration_requirements': {
      const ws = ctx.workspaceId;
      if (!ws) return { error: 'workspace_required' };
      return getDriverRegistrationRequirements(ws);
    }
    case 'analyze_driver_registration_gaps': {
      const p = parseArgs(driverSheetSchema, rawArgs);
      if (!p.ok) return { error: 'invalid_args', detail: p.error };
      const ws = ctx.workspaceId;
      if (!ws) {
        const { data: d } = await supabase.from('drivers').select('workspace_id').eq('id', p.data.driver_id).maybeSingle();
        if (!d?.workspace_id) return { error: 'workspace_required' };
        return analyzeDriverRegistrationGaps(p.data.driver_id, String(d.workspace_id));
      }
      return analyzeDriverRegistrationGaps(p.data.driver_id, ws);
    }
    default:
      return { error: 'unknown_tool', name };
  }
}
