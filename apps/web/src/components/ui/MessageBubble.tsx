import { CheckCheck, FileText } from 'lucide-react';

type Direction = 'inbound' | 'outbound';

export type MessageBubbleModel =
  | {
      kind: 'message';
      id: string;
      direction: Direction;
      type: string;
      content: string;
      media_url?: string | null;
      created_at: string;
      status?: string | null;
      grouped?: boolean;
    }
  | {
      kind: 'note';
      id: string;
      content: string;
      created_at: string;
      authorLabel?: string | null;
      grouped?: boolean;
    }
  | { kind: 'separator'; id: string; label: string };

function deliveryLabel(status?: string | null) {
  if (status === 'read') return { label: 'Lida', tone: 'text-success' };
  if (status === 'delivered') return { label: 'Entregue', tone: 'text-primary' };
  if (status === 'failed') return { label: 'Falhou', tone: 'text-destructive' };
  return { label: 'Enviada', tone: 'text-muted-foreground' };
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function renderBody(model: Extract<MessageBubbleModel, { kind: 'message' }>) {
  if (model.type === 'image' && model.media_url) {
    return (
      <div className="grid gap-2">
        <img
          src={model.media_url}
          alt={model.content || 'Imagem'}
          className="max-h-64 w-full rounded-xl border border-border object-cover"
        />
        {model.content ? <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{model.content}</p> : null}
      </div>
    );
  }

  if (model.type === 'audio' && model.media_url) {
    return (
      <div className="grid gap-2">
        <audio controls src={model.media_url} className="w-full" />
        {model.content ? <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{model.content}</p> : null}
      </div>
    );
  }

  if (model.type === 'document' && model.media_url) {
    return (
      <a
        href={model.media_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-[13px] font-semibold tracking-tight text-foreground hover:bg-surface-hover"
      >
        <FileText size={16} className="text-muted-foreground" />
        {model.content || 'Abrir documento'}
      </a>
    );
  }

  if (model.type === 'contact') {
    try {
      const parsed = JSON.parse(model.content || '{}') as { name?: string; phone?: string };
      return (
        <div className="rounded-xl border border-border bg-surface px-3 py-2">
          <div className="text-[13px] font-semibold tracking-tight text-foreground">{parsed.name || 'Contato'}</div>
          <div className="mono mt-1 text-[11px] text-muted-foreground">{parsed.phone || ''}</div>
        </div>
      );
    } catch {
      return <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{model.content}</p>;
    }
  }

  return <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{model.content}</p>;
}

export function MessageBubble({ model }: { model: MessageBubbleModel }) {
  if (model.kind === 'separator') {
    return (
      <div className="my-5 flex items-center justify-center">
        <span className="mono rounded-full border border-border bg-surface px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-subtle-foreground">
          {model.label}
        </span>
      </div>
    );
  }

  if (model.kind === 'note') {
    return (
      <div className={`flex ${model.grouped ? 'mt-1' : 'mt-4'} justify-center`}>
        <div className="max-w-[min(540px,90%)] rounded-2xl border border-warning/25 bg-warning/8 px-4 py-3 text-foreground">
          {!model.grouped ? (
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-warning">Nota interna</div>
          ) : null}
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{model.content}</p>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-subtle-foreground">
            <span className="truncate">{model.authorLabel || 'Sistema'}</span>
            <span className="mono">{timeLabel(model.created_at)}</span>
          </div>
        </div>
      </div>
    );
  }

  const outbound = model.direction === 'outbound';
  const delivery = outbound ? deliveryLabel(model.status) : null;

  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'} ${model.grouped ? 'mt-1' : 'mt-4'}`}>
      <div
        className={`max-w-[min(620px,92%)] rounded-2xl border px-4 py-3 ${
          outbound
            ? 'border-primary/25 bg-[linear-gradient(180deg,hsl(var(--primary)/0.18),hsl(var(--primary)/0.08))] text-foreground'
            : 'border-border bg-surface-elevated text-foreground'
        }`}
      >
        {!model.grouped ? (
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle-foreground">
            {outbound ? 'Time' : 'Contato'}
          </div>
        ) : null}

        {renderBody(model)}

        <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-subtle-foreground">
          <span className="mono">{timeLabel(model.created_at)}</span>
          {delivery ? (
            <span className={`inline-flex items-center gap-1 ${delivery.tone}`}>
              <CheckCheck size={14} />
              <span className="font-semibold tracking-tight">{delivery.label}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
