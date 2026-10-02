import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractInboundDisplayContent,
  extractInboundMediaRef,
  isMetaWhatsAppUploadMime,
  normalizeMimeType,
  resolveOutboundUploadMime,
} from './whatsappMedia';

describe('whatsappMedia', () => {
  it('extractInboundMediaRef — imagem com caption', () => {
    const ref = extractInboundMediaRef({
      type: 'image',
      image: { id: 'meta-img-1', mime_type: 'image/jpeg', caption: 'Comprovante' },
    });
    assert.equal(ref?.mediaId, 'meta-img-1');
    assert.equal(ref?.mimeType, 'image/jpeg');
    assert.equal(ref?.caption, 'Comprovante');
  });

  it('extractInboundDisplayContent — prioriza caption/filename', () => {
    assert.equal(
      extractInboundDisplayContent({
        type: 'document',
        document: { id: 'd1', filename: 'contrato.pdf' },
      }),
      'contrato.pdf'
    );
    assert.equal(
      extractInboundDisplayContent({ type: 'audio', audio: { id: 'a1' } }),
      '[Áudio]'
    );
  });

  it('normalizeMimeType remove codecs', () => {
    assert.equal(normalizeMimeType('audio/webm;codecs=opus'), 'audio/webm');
  });

  it('isMetaWhatsAppUploadMime', () => {
    assert.equal(isMetaWhatsAppUploadMime('audio/ogg'), true);
    assert.equal(isMetaWhatsAppUploadMime('audio/webm'), false);
  });

  it('resolveOutboundUploadMime infere PDF quando browser envia octet-stream', () => {
    assert.equal(resolveOutboundUploadMime('application/octet-stream', 'nota.pdf'), 'application/pdf');
    assert.equal(resolveOutboundUploadMime('application/pdf', 'nota.pdf'), 'application/pdf');
  });
});
