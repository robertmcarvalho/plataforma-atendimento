import type { WorkspaceChannel } from '@/lib/integrations/channelsApi';
import type { Bloco } from '@/lib/conversation-flow/fluxo';
import { labelOf } from '@/lib/conversation-flow/fluxo';

export type CfTrigger = 'conversation_started' | 'message_received' | 'conversation_resolved';

export type CfFilterField = 'channel' | 'message_text';
export type CfFilterOp = 'eq' | 'ne' | 'contains' | 'starts_with';

export type CfFilterRow = {
  id: string;
  field: CfFilterField;
  op: CfFilterOp;
  channelId: string;
  textValue: string;
  /** Filtro UI: limita conexões por tipo (não vai para wizard_meta). */
  channelTypeFilter?: string;
};

export function newCfFilterRow(partial?: Partial<CfFilterRow>): CfFilterRow {
  return {
    id: `f-${Math.random().toString(36).slice(2, 10)}`,
    field: 'channel',
    op: 'eq',
    channelId: '',
    textValue: '',
    channelTypeFilter: '',
    ...partial,
  };
}

export function channelTypeLabel(channelType: string): string {
  const t = String(channelType || '').toLowerCase();
  if (t === 'whatsapp') return 'WhatsApp';
  if (t === 'instagram') return 'Instagram';
  if (t === 'email') return 'E-mail';
  if (t === 'webchat') return 'Webchat';
  if (t === 'llm') return 'LLM';
  return t || 'Canal';
}

export function formatChannelOption(ch: Pick<WorkspaceChannel, 'channel_type' | 'display_name'>): string {
  const base = channelTypeLabel(ch.channel_type);
  const name = (ch.display_name || '').trim();
  return name ? `${base} · ${name}` : base;
}

export type CfWizardMeta = {
  preset?: string;
  trigger: CfTrigger;
  binding_priority?: number;
  filters?: Array<{
    id?: string;
    field: CfFilterField;
    op: CfFilterOp;
    channel_id?: string | null;
    value?: string;
  }>;
};

export function buildWizardMeta(
  preset: string,
  trigger: CfTrigger,
  filters: CfFilterRow[],
  bindingPriority: number
): CfWizardMeta {
  const cleaned = filters
    .filter((f) => {
      if (f.field === 'channel') return Boolean(f.channelId) || f.op === 'ne';
      return Boolean(f.textValue.trim());
    })
    .map((f) => ({
      id: f.id,
      field: f.field,
      op: f.op,
      channel_id: f.field === 'channel' ? (f.channelId || null) : null,
      value: f.field === 'message_text' ? f.textValue.trim() : undefined,
    }));
  return {
    preset,
    trigger,
    filters: cleaned.length ? cleaned : undefined,
    binding_priority: bindingPriority,
  };
}

type BindingLike = {
  workspace_channel_id?: string | null;
  keywords?: string[] | null;
  trigger_type?: string | null;
  priority?: number | null;
};

export function decodeWizardFromGraphAndBinding(
  graph: Record<string, unknown> | undefined,
  binding: BindingLike | null | undefined
): {
  trigger: CfTrigger;
  filters: CfFilterRow[];
  bindingPriority: number;
} {
  const meta = (graph?.wizard_meta || {}) as Record<string, unknown>;
  let trigger: CfTrigger = 'message_received';
  if (meta.trigger === 'conversation_started') trigger = 'conversation_started';
  else if (meta.trigger === 'conversation_resolved') trigger = 'conversation_resolved';
  else {
    const bt = String(binding?.trigger_type || '');
    if (bt === 'conversation_started') trigger = 'conversation_started';
    if (bt === 'conversation_resolved') trigger = 'conversation_resolved';
  }
  const bp =
    typeof meta.binding_priority === 'number'
      ? meta.binding_priority
      : typeof binding?.priority === 'number'
        ? binding!.priority!
        : 0;

  const rows: CfFilterRow[] = [];
  if (Array.isArray(meta.filters)) {
    for (const row of meta.filters as Record<string, unknown>[]) {
      const op = String(row.op || 'eq');
      const field = row.field === 'message_text' ? 'message_text' : 'channel';
      rows.push(
        newCfFilterRow({
          id: String(row.id || `f-${Math.random().toString(36).slice(2)}`),
          field,
          op: (['eq', 'ne', 'contains', 'starts_with'].includes(op) ? op : 'eq') as CfFilterOp,
          channelId: String(row.channel_id || ''),
          textValue: String(row.value || ''),
        })
      );
    }
  }

  const hasChannelEq = (channelId: string) =>
    rows.some((r) => r.field === 'channel' && r.op === 'eq' && r.channelId === channelId);
  if (binding?.workspace_channel_id && !hasChannelEq(String(binding.workspace_channel_id))) {
    rows.unshift(
      newCfFilterRow({
        field: 'channel',
        op: 'eq',
        channelId: String(binding.workspace_channel_id),
      })
    );
  }

  const existingText = new Set(
    rows.filter((r) => r.field === 'message_text').map((r) => r.textValue.trim().toLowerCase())
  );
  for (const k of binding?.keywords || []) {
    const t = String(k || '').trim();
    if (!t) continue;
    if (existingText.has(t.toLowerCase())) continue;
    rows.push(newCfFilterRow({ field: 'message_text', op: 'contains', textValue: t }));
    existingText.add(t.toLowerCase());
  }

  return { trigger, filters: rows, bindingPriority: bp };
}

export function groupWorkspaceChannelsByType(
  chans: WorkspaceChannel[]
): Array<{ type: string; label: string; items: WorkspaceChannel[] }> {
  const g = new Map<string, WorkspaceChannel[]>();
  for (const ch of chans) {
    const t = ch.channel_type || 'outros';
    if (!g.has(t)) g.set(t, []);
    g.get(t)!.push(ch);
  }
  return [...g.entries()]
    .map(([type, items]) => ({
      type,
      label: channelTypeLabel(type),
      items: items.slice().sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'pt-BR')),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

export function priorityTierFromBinding(p: number): 'low' | 'medium' | 'high' {
  if (!Number.isFinite(p)) return 'medium';
  if (p >= 70) return 'high';
  if (p >= 35) return 'medium';
  return 'low';
}

export function bindingPriorityFromTier(t: 'low' | 'medium' | 'high'): number {
  if (t === 'high') return 90;
  if (t === 'low') return 10;
  return 50;
}

/** Linhas numeradas para pré-visualização (passo 3 / resumo). */
export function revivePreviewNumberedLines(blocos: Bloco[], limit = 16): string[] {
  const out: string[] = [];
  let n = 0;
  const walk = (list: Bloco[], depth: number) => {
    for (const b of list) {
      if (out.length >= limit) return;
      n += 1;
      out.push(`${n}. ${b.tipo} — ${labelOf(b.tipo)}`);
      if (b.ramos) {
        for (const [rama, kids] of Object.entries(b.ramos)) {
          if (out.length >= limit) return;
          out.push(`${'  '.repeat(Math.min(depth + 1, 4))}[${rama}]`);
          walk(kids, depth + 1);
        }
      }
    }
  };
  walk(blocos, 0);
  return out;
}

export function formatFilterPreviewLine(
  f: CfFilterRow,
  channels: Pick<WorkspaceChannel, 'id' | 'channel_type' | 'display_name'>[]
): string | null {
  const opPt = (op: CfFilterOp) => {
    switch (op) {
      case 'eq':
        return 'é';
      case 'ne':
        return 'não é';
      case 'contains':
        return 'contém';
      case 'starts_with':
        return 'começa com';
    }
  };
  if (f.field === 'channel') {
    if (f.op === 'ne' && !f.channelId.trim()) return null;
    if (f.op !== 'ne' && !f.channelId.trim()) return null;
    const ch = channels.find((c) => c.id === f.channelId);
    const name = ch ? formatChannelOption(ch) : '(canal)';
    return `canal ${opPt(f.op)} "${name}"`;
  }
  const t = f.textValue.trim();
  if (!t) return null;
  return `mensagem ${opPt(f.op)} "${t}"`;
}

export function bindingPayloadFromWizard(
  trigger: CfTrigger,
  filters: CfFilterRow[],
  bindingPriority: number,
  isActive: boolean
): {
  workspace_channel_id: string | null;
  trigger_type: CfTrigger | 'keyword';
  keywords: string[];
  priority: number;
  is_active: boolean;
} {
  const channelEq = filters.find((f) => f.field === 'channel' && f.op === 'eq' && f.channelId.trim());
  const workspace_channel_id = channelEq?.channelId.trim() ? channelEq.channelId.trim() : null;

  const keywords: string[] = [];
  for (const f of filters) {
    if (f.field !== 'message_text') continue;
    const v = f.textValue.trim();
    if (!v) continue;
    if (!keywords.includes(v)) keywords.push(v);
  }

  return {
    workspace_channel_id,
    trigger_type: trigger,
    keywords,
    priority: bindingPriority,
    is_active: isActive,
  };
}
