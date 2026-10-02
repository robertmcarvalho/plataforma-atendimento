import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { readFile, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  isMetaWhatsAppUploadMime,
  normalizeMimeType,
} from '@plataforma/channel-runtime';

type PreparedMedia = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
};

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let ffmpegPath = 'ffmpeg';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const staticPath = require('ffmpeg-static') as string | null;
      if (staticPath) ffmpegPath = staticPath;
    } catch {
      // usa ffmpeg do PATH
    }

    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exit ${code}`));
    });
  });
}

async function convertWebmToOgg(buffer: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inPath = join(tmpdir(), `wa-in-${id}.webm`);
  const outPath = join(tmpdir(), `wa-out-${id}.ogg`);
  try {
    await writeFile(inPath, buffer);
    await runFfmpeg(['-y', '-i', inPath, '-c:a', 'libopus', '-f', 'ogg', outPath]);
    return await readFile(outPath);
  } finally {
    await unlink(inPath).catch(() => undefined);
    await unlink(outPath).catch(() => undefined);
  }
}

function withExtension(fileName: string, ext: string): string {
  const base = String(fileName || 'arquivo').replace(/\.[^.]+$/, '');
  return `${base}.${ext}`;
}

/**
 * Normaliza buffer/MIME para upload na Meta.
 * Converte audio/webm (gravação do navegador) para audio/ogg (opus).
 */
export async function prepareOutboundMediaForMeta(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<PreparedMedia> {
  const base = normalizeMimeType(mimeType);
  if (isMetaWhatsAppUploadMime(base)) {
    return { buffer, mimeType: base, fileName };
  }

  if (base === 'audio/webm' || base === 'video/webm') {
    const oggBuffer = await convertWebmToOgg(buffer);
    return {
      buffer: oggBuffer,
      mimeType: 'audio/ogg',
      fileName: withExtension(fileName, 'ogg'),
    };
  }

  throw new Error(
    `Formato não suportado pelo WhatsApp (${mimeType}). Envie áudio OGG/MP3, imagem JPEG/PNG/WebP ou documento PDF.`
  );
}
