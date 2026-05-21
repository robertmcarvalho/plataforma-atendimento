export type InboundAssistPayload = {
  draft_reply: string;
  next_actions: string[];
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, 6);
}

/** Extrai e valida JSON { draft_reply, next_actions } da resposta do modelo. */
export function parseInboundAssistJson(raw: string): InboundAssistPayload | null {
  const t = raw.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : t;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const draft = typeof o.draft_reply === 'string' ? o.draft_reply.trim() : '';
  const actions = asStringArray(o.next_actions);
  if (!draft && actions.length === 0) return null;
  return {
    draft_reply: draft.slice(0, 1200),
    next_actions: actions.length ? actions.slice(0, 4) : ['Revisar o contexto da conversa no painel antes de responder.'],
  };
}

export function normalizeInboundAssistPayload(p: InboundAssistPayload): InboundAssistPayload {
  return {
    draft_reply: p.draft_reply.replace(/\s+/g, ' ').trim().slice(0, 600),
    next_actions: p.next_actions.slice(0, 4).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean),
  };
}
