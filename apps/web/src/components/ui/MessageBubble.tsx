'use client';

import { useState } from 'react';
import Image from 'next/image';
import { CheckCheck, Download, ExternalLink, FileText, X } from 'lucide-react';
import { parseStaffMessageSignature } from '@/lib/messageSignature';
import { cn } from '@/lib/utils';

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
  if (status === 'read') return { label: 'Lida', tone: 'text-emerald-400' };
  if (status === 'delivered') return { label: 'Entregue', tone: 'text-sidebar-accent-foreground/80' };
  if (status === 'failed') return { label: 'Falhou', tone: 'text-destructive' };
  return { label: 'Enviada', tone: 'text-sidebar-accent-foreground/70' };
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function mediaUnavailableCard(label: string) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background/30 px-3 py-2 text-[13px] text-muted-foreground">
      {label} — carregando ou indisponível
    </div>
  );
}

function fileNameFromMedia(url: string, label: string, fallback: string): string {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const base = path.split('/').pop() || '';
    if (base.includes('.')) return base;
  } catch {
    // ignore
  }
  const clean = label.trim();
  if (clean && !clean.startsWith('[')) return clean;
  return fallback;
}

function isPdfMedia(url: string, label: string): boolean {
  const probe = `${url} ${label}`.toLowerCase();
  return probe.includes('.pdf');
}

const actionLinkClass =
  'inline-flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-sidebar-accent/60';

function MediaActionBar({ url, fileName }: { url: string; fileName: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a href={url} download={fileName} target="_blank" rel="noreferrer" className={actionLinkClass}>
        <Download className="h-3.5 w-3.5 shrink-0" />
        Baixar
      </a>
      <a href={url} target="_blank" rel="noreferrer" className={actionLinkClass}>
        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        Abrir
      </a>
    </div>
  );
}

function ImageLightbox({
  open,
  src,
  alt,
  fileName,
  onClose,
}: {
  open: boolean;
  src: string;
  alt: string;
  fileName: string;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Visualização da imagem"
      onClick={onClose}
    >
      <div className="mb-3 flex items-center justify-between gap-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="truncate text-sm font-medium">{fileName}</span>
        <div className="flex shrink-0 items-center gap-2">
          <a href={src} download={fileName} className={cn(actionLinkClass, 'border-white/20 bg-white/10 text-white hover:bg-white/20')}>
            <Download className="h-3.5 w-3.5" />
            Baixar
          </a>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/20 text-white hover:bg-white/10"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
      </div>
    </div>
  );
}

function MessageMediaBody({
  model,
  displayContent,
}: {
  model: Extract<MessageBubbleModel, { kind: 'message' }>;
  displayContent: string;
}) {
  const [imageOpen, setImageOpen] = useState(false);
  const mediaUrl = model.media_url || '';

  if (model.type === 'image' || model.type === 'sticker') {
    if (!mediaUrl) return mediaUnavailableCard('Imagem');
    const fileName = fileNameFromMedia(mediaUrl, model.content, 'imagem.jpg');
    return (
      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => setImageOpen(true)}
          className="group relative block w-full overflow-hidden rounded-lg border border-border text-left"
          title="Ampliar imagem"
        >
          <Image
            src={mediaUrl}
            alt={model.content || 'Imagem'}
            width={400}
            height={256}
            unoptimized
            className="max-h-64 w-full object-cover transition-opacity group-hover:opacity-90"
          />
          <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/55 px-2 py-0.5 text-[10px] text-white">
            Ampliar
          </span>
        </button>
        <MediaActionBar url={mediaUrl} fileName={fileName} />
        {displayContent && !displayContent.startsWith('[') ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{displayContent}</p>
        ) : null}
        <ImageLightbox
          open={imageOpen}
          src={mediaUrl}
          alt={model.content || 'Imagem'}
          fileName={fileName}
          onClose={() => setImageOpen(false)}
        />
      </div>
    );
  }

  if (model.type === 'audio') {
    if (!mediaUrl) return mediaUnavailableCard('Áudio');
    const fileName = fileNameFromMedia(mediaUrl, model.content, 'audio.ogg');
    return (
      <div className="grid gap-2">
        <audio controls src={mediaUrl} className="w-full" />
        <MediaActionBar url={mediaUrl} fileName={fileName} />
        {displayContent && !displayContent.startsWith('[') ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{displayContent}</p>
        ) : null}
      </div>
    );
  }

  if (model.type === 'video') {
    if (!mediaUrl) return mediaUnavailableCard('Vídeo');
    const fileName = fileNameFromMedia(mediaUrl, model.content, 'video.mp4');
    return (
      <div className="grid gap-2">
        <video controls src={mediaUrl} className="max-h-64 w-full rounded-lg border border-border" />
        <MediaActionBar url={mediaUrl} fileName={fileName} />
        {displayContent && !displayContent.startsWith('[') ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{displayContent}</p>
        ) : null}
      </div>
    );
  }

  if (model.type === 'document') {
    if (!mediaUrl) return mediaUnavailableCard('Documento');
    const label = model.content || 'Documento';
    const fileName = fileNameFromMedia(mediaUrl, label, 'documento');
    const pdf = isPdfMedia(mediaUrl, label);

    if (pdf) {
      return (
        <div className="grid gap-2">
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <iframe
              src={mediaUrl}
              title={label}
              className="h-72 w-full bg-white"
              loading="lazy"
            />
          </div>
          <MediaActionBar url={mediaUrl} fileName={fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`} />
          {displayContent && !displayContent.startsWith('[') && displayContent !== label ? (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{displayContent}</p>
          ) : null}
        </div>
      );
    }

    return (
      <div className="grid gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2">
          <FileText size={16} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight">{label}</span>
        </div>
        <MediaActionBar url={mediaUrl} fileName={fileName} />
      </div>
    );
  }

  if (model.type === 'contact') {
    try {
      const parsed = JSON.parse(model.content || '{}') as { name?: string; phone?: string };
      return (
        <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
          <div className="text-[13px] font-semibold tracking-tight text-foreground">{parsed.name || 'Contato'}</div>
          <div className="mono mt-1 text-[11px] text-muted-foreground">{parsed.phone || ''}</div>
        </div>
      );
    } catch {
      return <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{displayContent}</p>;
    }
  }

  return <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{displayContent}</p>;
}

export type MessageBubbleViewerRole = 'staff' | 'leader';

export function MessageBubble({
  model,
  viewerRole = 'staff',
}: {
  model: MessageBubbleModel;
  viewerRole?: MessageBubbleViewerRole;
}) {
  if (model.kind === 'separator') {
    return (
      <div className="my-5 flex items-center justify-center">
        <span className="mono rounded-full border border-border bg-muted px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {model.label}
        </span>
      </div>
    );
  }

  if (model.kind === 'note') {
    return (
      <div className={`flex ${model.grouped ? 'mt-1' : 'mt-4'} justify-center`}>
        <div className="max-w-[min(540px,90%)] rounded-lg border border-warning/25 bg-warning/8 px-4 py-3 text-foreground">
          {!model.grouped ? (
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-warning">Nota interna</div>
          ) : null}
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{model.content}</p>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span className="truncate">{model.authorLabel || 'Sistema'}</span>
            <span className="mono">{timeLabel(model.created_at)}</span>
          </div>
        </div>
      </div>
    );
  }

  const isOutbound = model.direction === 'outbound';
  const isLeaderView = viewerRole === 'leader';
  const alignEnd = isLeaderView ? !isOutbound : isOutbound;
  const delivery = isOutbound && !isLeaderView ? deliveryLabel(model.status) : null;

  const bubbleClass = alignEnd
    ? isLeaderView
      ? 'border-channel-whatsapp/35 bg-channel-whatsapp/12 text-foreground'
      : 'border-sidebar-accent/40 bg-sidebar-accent/60 text-sidebar-accent-foreground'
    : 'border-border/60 bg-muted/70 text-foreground';

  const metaClass = alignEnd && !isLeaderView ? 'text-sidebar-accent-foreground/70' : 'text-muted-foreground';

  const rawContent = model.content || '';
  const parsed = parseStaffMessageSignature(rawContent);
  const showStaffSignature = isOutbound && !isLeaderView && Boolean(parsed.signature);
  const bodyText = showStaffSignature || (!isOutbound && parsed.signature) ? parsed.body : rawContent.trim();

  return (
    <div className={`flex ${alignEnd ? 'justify-end' : 'justify-start'} ${model.grouped ? 'mt-1' : 'mt-4'}`}>
      <div className={`max-w-[min(620px,92%)] rounded-lg border px-4 py-3 ${bubbleClass}`}>
        {showStaffSignature && !model.grouped ? (
          <div className="mb-1.5 text-[11px] font-medium text-sidebar-accent-foreground/85">{parsed.signature}</div>
        ) : null}

        <MessageMediaBody model={model} displayContent={bodyText} />

        <div className={`mt-2 flex items-center justify-end gap-2 text-[11px] ${metaClass}`}>
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
