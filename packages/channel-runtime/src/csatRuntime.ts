import type { SupabaseClient } from '@supabase/supabase-js';

export const CSAT_LIST_BUTTON_LABEL = 'Dar nota';
export const CSAT_LIST_SECTION_TITLE = 'Notas';
export const CSAT_ROW_ID_PREFIX = 'csat_';

export const CSAT_SCORE_LIST_ROWS: Array<{ id: string; title: string; description?: string }> = [
  { id: 'csat_1', title: '1 — Muito ruim', description: 'Insatisfeito' },
  { id: 'csat_2', title: '2 — Ruim' },
  { id: 'csat_3', title: '3 — Regular' },
  { id: 'csat_4', title: '4 — Bom' },
  { id: 'csat_5', title: '5 — Excelente', description: 'Muito satisfeito' },
];

const DEFAULT_CSAT_TIMEZONE = 'America/Sao_Paulo';

/** CSAT pendente expira após este prazo — evita interceptar inbound indefinidamente. */
export const CSAT_PENDING_TTL_HOURS = 72;

export function currentMonthKey(timeZone = DEFAULT_CSAT_TIMEZONE, ref = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(ref);
  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '1';
  return `${year}-${month}`;
}

export function monthKeyForIso(iso: string, timeZone = DEFAULT_CSAT_TIMEZONE): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return currentMonthKey(timeZone, d);
}

export function monthStartIso(timeZone = DEFAULT_CSAT_TIMEZONE, ref = new Date()): string {
  const key = currentMonthKey(timeZone, ref);
  const [year, month] = key.split('-');
  return `${year}-${String(month).padStart(2, '0')}-01T03:00:00.000Z`;
}

export function parseCsatScore(input: { text?: string | null; interactiveId?: string | null }): number | null {
  const id = String(input.interactiveId || '').trim();
  const fromId = id.match(/^csat_([1-5])$/i);
  if (fromId) return Number(fromId[1]);

  const text = String(input.text || '').trim();
  if (!text) return null;
  if (/^[1-5]$/.test(text)) return Number(text);

  // Título da lista WhatsApp: "4 — Bom", "1 - Muito ruim"
  const listTitleMatch = text.match(/^([1-5])\s*[—–\-]\s*/u);
  if (listTitleMatch) return Number(listTitleMatch[1]);

  const starMatch = text.match(/(?:nota\s*)?([1-5])\s*(?:\/\s*5|estrelas?)?/i);
  if (starMatch) return Number(starMatch[1]);

  return null;
}

export function extractInboundMessageText(msg: Record<string, unknown>): string {
  const type = String(msg.type || '');
  if (type === 'text') return String((msg.text as { body?: string })?.body || '').trim();
  if (type === 'interactive') {
    const interactive = msg.interactive as {
      button_reply?: { title?: string; id?: string };
      list_reply?: { title?: string; id?: string };
    };
    return (
      interactive?.list_reply?.title ||
      interactive?.button_reply?.title ||
      interactive?.list_reply?.id ||
      interactive?.button_reply?.id ||
      ''
    ).trim();
  }
  if (type === 'button') {
    const button = msg.button as { text?: string; payload?: string } | undefined;
    return String(button?.text || button?.payload || '').trim();
  }
  return '';
}

/** Extrai nota CSAT (1–5) de payload inbound Meta/WhatsApp. */
export function parseCsatScoreFromMessage(msg: Record<string, unknown>): number | null {
  return parseCsatScore({
    text: extractInboundMessageText(msg),
    interactiveId: extractInteractiveReplyId(msg),
  });
}

export function extractInteractiveReplyId(msg: Record<string, unknown>): string | undefined {
  if (msg.type !== 'interactive') return undefined;
  const interactive = msg.interactive as {
    button_reply?: { id?: string };
    list_reply?: { id?: string };
  };
  return interactive?.button_reply?.id || interactive?.list_reply?.id;
}

export type ContactCsatDispatchRow = {
  id: string;
  workspace_id: string;
  contact_id: string;
  sector_id: string | null;
  conversation_id: string;
  sent_at: string;
  responded_at: string | null;
  score: number | null;
};

export async function hasCsatSentThisMonthForSector(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
  sectorId: string | null | undefined,
  timeZone = DEFAULT_CSAT_TIMEZONE
): Promise<boolean> {
  const monthKey = currentMonthKey(timeZone);
  const lookback = new Date(Date.now() - 40 * 24 * 3600000).toISOString();
  let query = db
    .from('contact_csat_dispatches')
    .select('id, sent_at, sector_id')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .gte('sent_at', lookback);
  const { data } = await query;
  return (data || []).some((row: { sent_at?: string; sector_id?: string | null }) => {
    if (monthKeyForIso(String(row.sent_at || ''), timeZone) !== monthKey) return false;
    const rowSector = row.sector_id ? String(row.sector_id) : null;
    const targetSector = sectorId ? String(sectorId) : null;
    return rowSector === targetSector;
  });
}

export async function findPendingCsatDispatch(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string
): Promise<ContactCsatDispatchRow | null> {
  const sentAfter = new Date(Date.now() - CSAT_PENDING_TTL_HOURS * 3600 * 1000).toISOString();
  const { data } = await db
    .from('contact_csat_dispatches')
    .select('id, workspace_id, contact_id, sector_id, conversation_id, sent_at, responded_at, score')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .is('responded_at', null)
    .gte('sent_at', sentAfter)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ContactCsatDispatchRow | null) || null;
}
