import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const MESSAGE_MEDIA_BUCKET = 'message-media';

/** MIME types aceitos pelo endpoint de upload de mídia da Meta (WhatsApp Cloud API). */
export const META_WHATSAPP_UPLOAD_MIMES = new Set([
  'audio/aac',
  'audio/mp4',
  'audio/mpeg',
  'audio/amr',
  'audio/ogg',
  'audio/opus',
  'application/vnd.ms-powerpoint',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'text/plain',
  'application/vnd.ms-excel',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/3gpp',
]);

export type InboundMediaRef = {
  mediaId: string;
  mimeType?: string;
  filename?: string;
  caption?: string;
};

const MEDIA_MESSAGE_TYPES = new Set(['image', 'audio', 'document', 'video', 'sticker']);

export function normalizeMimeType(mimeType: string): string {
  return String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

export function isMetaWhatsAppUploadMime(mimeType: string): boolean {
  return META_WHATSAPP_UPLOAD_MIMES.has(normalizeMimeType(mimeType));
}

export function isMediaMessageType(type: string): boolean {
  return MEDIA_MESSAGE_TYPES.has(String(type || '').trim().toLowerCase());
}

export function resolveOutboundUploadMime(mimeType: string, fileName: string): string {
  const base = normalizeMimeType(mimeType);
  if (base && base !== 'application/octet-stream') return base;

  const ext = String(fileName || '')
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/)?.[1];
  const byExt: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    '3gp': 'video/3gpp',
    txt: 'text/plain',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  if (ext && byExt[ext]) return byExt[ext];
  return base || 'application/octet-stream';
}

export function detectMessageTypeFromMime(mimeType: string): 'image' | 'audio' | 'video' | 'document' {
  const base = normalizeMimeType(mimeType);
  if (base.startsWith('image/')) return 'image';
  if (base.startsWith('audio/')) return 'audio';
  if (base.startsWith('video/')) return 'video';
  return 'document';
}

function mediaBlock(msg: Record<string, unknown>, key: string): { id?: string; mime_type?: string; caption?: string; filename?: string } | null {
  const block = msg[key];
  if (!block || typeof block !== 'object') return null;
  return block as { id?: string; mime_type?: string; caption?: string; filename?: string };
}

export function extractInboundMediaRef(msg: Record<string, unknown>): InboundMediaRef | null {
  const type = String(msg.type || '').trim().toLowerCase();
  if (!isMediaMessageType(type)) return null;

  const key = type === 'sticker' ? 'sticker' : type;
  const block = mediaBlock(msg, key);
  const mediaId = String(block?.id || '').trim();
  if (!mediaId) return null;

  return {
    mediaId,
    mimeType: block?.mime_type ? normalizeMimeType(block.mime_type) : undefined,
    filename: block?.filename ? String(block.filename).trim() : undefined,
    caption: block?.caption ? String(block.caption).trim() : undefined,
  };
}

export function extractInboundDisplayContent(msg: Record<string, unknown>): string {
  const type = String(msg.type || '').trim().toLowerCase();

  if (type === 'text') return String((msg.text as { body?: string })?.body || '').trim();

  if (type === 'interactive') {
    const interactive = msg.interactive as {
      button_reply?: { title?: string };
      list_reply?: { title?: string };
    };
    return (interactive?.button_reply?.title || interactive?.list_reply?.title || '').trim();
  }

  if (type === 'button') {
    const button = msg.button as { text?: string; payload?: string } | undefined;
    return String(button?.text || button?.payload || '').trim();
  }

  const media = extractInboundMediaRef(msg);
  if (media?.caption) return media.caption;
  if (media?.filename) return media.filename;

  const labels: Record<string, string> = {
    image: '[Imagem]',
    audio: '[Áudio]',
    document: '[Documento]',
    video: '[Vídeo]',
    sticker: '[Figurinha]',
  };
  return labels[type] || `[${type}]`;
}

function extensionForMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/amr': 'amr',
    'audio/opus': 'opus',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'application/pdf': 'pdf',
  };
  return map[normalizeMimeType(mimeType)] || 'bin';
}

export function buildInboundMediaFileName(args: {
  messageType: string;
  mimeType: string;
  filename?: string | null;
  mediaId: string;
}): string {
  const preferred = String(args.filename || '').trim();
  if (preferred) return preferred.replace(/[^\w.\-()+\s]/g, '_');
  const ext = extensionForMime(args.mimeType);
  const prefix = args.messageType === 'sticker' ? 'sticker' : args.messageType;
  return `${prefix}-${args.mediaId.slice(0, 12)}.${ext}`;
}

export async function fetchMetaMediaBuffer(args: {
  accessToken: string;
  mediaId: string;
  graphVersion?: string;
  filenameHint?: string | null;
  messageTypeHint?: string;
}): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const token = String(args.accessToken || '').trim();
  const mediaId = String(args.mediaId || '').trim();
  if (!token || !mediaId) throw new Error('Token ou media_id ausente para download Meta.');

  const version = args.graphVersion?.trim() || process.env.META_GRAPH_VERSION?.trim() || 'v19.0';
  const metaRes = await fetch(`https://graph.facebook.com/${version}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) {
    const detail = await metaRes.json().catch(() => null);
    throw new Error(
      `Meta media metadata falhou (${metaRes.status}): ${(detail as { error?: { message?: string } })?.error?.message || metaRes.statusText}`
    );
  }

  const metaJson = (await metaRes.json()) as { url?: string; mime_type?: string };
  const downloadUrl = String(metaJson.url || '').trim();
  const mimeType = normalizeMimeType(metaJson.mime_type || 'application/octet-stream');
  if (!downloadUrl) throw new Error('Meta media metadata sem URL de download.');

  const fileRes = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!fileRes.ok) {
    throw new Error(`Meta media download falhou (${fileRes.status}).`);
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fileName = buildInboundMediaFileName({
    messageType: args.messageTypeHint || detectMessageTypeFromMime(mimeType),
    mimeType,
    filename: args.filenameHint,
    mediaId,
  });

  return { buffer, mimeType, fileName };
}

export async function ensureMessageMediaBucket(supabase: SupabaseClient, bucket = MESSAGE_MEDIA_BUCKET): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((row) => row.name === bucket)) return;
  await supabase.storage.createBucket(bucket, { public: true, fileSizeLimit: 16 * 1024 * 1024 });
}

export async function uploadMessageMediaToStorage(args: {
  supabase: SupabaseClient;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  bucket?: string;
}): Promise<string> {
  const bucket = args.bucket || MESSAGE_MEDIA_BUCKET;
  await ensureMessageMediaBucket(args.supabase, bucket);
  const safeName = String(args.fileName || 'arquivo').replace(/[^\w.\-()+\s]/g, '_');
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
  const { error } = await args.supabase.storage.from(bucket).upload(path, args.buffer, {
    contentType: normalizeMimeType(args.mimeType),
    upsert: false,
  });
  if (error) throw new Error(error.message);
  const { data } = args.supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
