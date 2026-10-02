import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import api from '@/lib/api';
import { formatUploadClientError, uploadMessageMedia } from '@/lib/inbox/uploadMessageMedia';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import type { TemplatePickerOption } from '@/components/inbox/NewConversationModal';
import { resolveTemplateVariableKeys } from '@/lib/inbox/templateVariables';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function formatUploadStatus(filename: string, file: File | Blob): string {
  const mime = String(file.type || '').toLowerCase();
  const lowerName = filename.toLowerCase();
  if (mime.startsWith('audio/')) return 'Enviando áudio…';
  if (mime.startsWith('image/')) return 'Enviando imagem…';
  if (mime.startsWith('video/')) return 'Enviando vídeo…';
  if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) return 'Enviando documento…';
  return 'Enviando arquivo…';
}

function uploadErrorMessage(err: unknown): string {
  return formatUploadClientError(err, 'Falha ao enviar arquivo.');
}

type ComposerMode = 'text' | 'template';

type UseInboxComposerOptions = {
  activeId: string;
  selectedChannelId?: string | null;
  chatSignatureEnabled: boolean;
  signatureName?: string;
  refetchAfterMutation: () => Promise<unknown>;
  beforeFilePicker?: () => void;
  whatsappWindowOpen: boolean;
  templates: TemplatePickerOption[];
};

export function useInboxComposer({
  activeId,
  selectedChannelId,
  chatSignatureEnabled,
  signatureName,
  refetchAfterMutation,
  beforeFilePicker,
  whatsappWindowOpen,
  templates,
}: UseInboxComposerOptions) {
  const [composerText, setComposerText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatusLabel, setUploadStatusLabel] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<ComposerMode>('text');
  const [templateId, setTemplateId] = useState('');
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const activeIdRef = useRef(activeId);
  const selectedChannelIdRef = useRef(selectedChannelId);

  const selectedTemplate = useMemo(
    () => templates.find((tpl) => tpl.id === templateId),
    [templateId, templates],
  );
  const selectedTemplateVars = useMemo(
    () => resolveTemplateVariableKeys(selectedTemplate),
    [selectedTemplate],
  );

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    selectedChannelIdRef.current = selectedChannelId;
  }, [selectedChannelId]);

  useEffect(() => {
    setComposerMode('text');
    setTemplateId('');
    setTemplateVars({});
    setSendError(null);
    setUploadError(null);
    setRecordingError(null);
  }, [activeId]);

  // Se o canal/lista mudou, limpa seleção que não existe mais no picker filtrado.
  useEffect(() => {
    if (!templateId) return;
    if (templates.some((tpl) => tpl.id === templateId)) return;
    setTemplateId('');
    setTemplateVars({});
  }, [templates, templateId]);

  useEffect(() => {
    if (!activeId) return;
    if (!whatsappWindowOpen) setComposerMode('template');
  }, [activeId, whatsappWindowOpen]);

  useEffect(() => {
    if (!selectedTemplateVars.length) {
      setTemplateVars({});
      return;
    }
    setTemplateVars((prev) => {
      const next = { ...prev };
      for (const v of selectedTemplateVars) {
        if (next[v] === undefined) next[v] = '';
      }
      return next;
    });
  }, [selectedTemplateVars]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      try {
        recorderRef.current?.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  const templateVarsOk =
    !selectedTemplateVars.length ||
    selectedTemplateVars.every((v) => (templateVars[v] || '').trim().length > 0);

  const canSendTemplate = Boolean(activeId && templateId && templateVarsOk);

  const appendToComposer = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setComposerText((prev) => {
      if (!prev.trim()) return t;
      return `${prev.trimEnd()}\n\n${t}`;
    });
  };

  const onSend = async () => {
    if (!activeId || isSending) return;
    const content = composerText.trim();
    if (!content) return;
    setIsSending(true);
    setSendError(null);
    try {
      await api.post('/api/messages/send', {
        conversation_id: activeId,
        ...(selectedChannelId ? { workspace_channel_id: selectedChannelId } : {}),
        type: 'text',
        content,
        signature: chatSignatureEnabled ? signatureName || undefined : undefined,
      });
      setComposerText('');
      await refetchAfterMutation();
    } catch (e: unknown) {
      const message = apiErrorMessage(e, 'Falha ao enviar mensagem.');
      setSendError(message);
      if (/janela de 24h/i.test(message)) setComposerMode('template');
    } finally {
      setIsSending(false);
    }
  };

  const onSendTemplate = async () => {
    if (!activeId || isSending || !templateId || !templateVarsOk) return;
    setIsSending(true);
    setSendError(null);
    try {
      await api.post('/api/messages/send', {
        conversation_id: activeId,
        ...(selectedChannelId ? { workspace_channel_id: selectedChannelId } : {}),
        type: 'template',
        template_id: templateId,
        template_variables: templateVars,
      });
      setTemplateId('');
      setTemplateVars({});
      if (whatsappWindowOpen) setComposerMode('text');
      await refetchAfterMutation();
    } catch (e: unknown) {
      setSendError(apiErrorMessage(e, 'Falha ao enviar template.'));
    } finally {
      setIsSending(false);
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setComposerText((t) => `${t}${emoji}`);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = `${el.value.slice(0, start)}${emoji}${el.value.slice(end)}`;
    setComposerText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const uploadFile = async (file: File | Blob, filename: string, attempt = 0) => {
    const conversationId = activeIdRef.current || activeId;
    if (!conversationId || isUploading) {
      if (!conversationId) setUploadError('Selecione uma conversa antes de enviar o arquivo.');
      return;
    }
    if (!whatsappWindowOpen) {
      setUploadError('Fora da janela de 24h: use um template aprovado para retomar o contato.');
      setComposerMode('template');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      setUploadError(`Arquivo muito grande (${mb} MB). O limite é 10 MB.`);
      return;
    }
    setUploadError(null);
    setRecordingError(null);
    setUploadStatusLabel(formatUploadStatus(filename, file));
    setIsUploading(true);
    try {
      const form = new FormData();
      const channelId = selectedChannelIdRef.current || selectedChannelId;
      form.append('conversation_id', conversationId);
      if (channelId) form.append('workspace_channel_id', channelId);
      const caption = composerText.trim();
      if (caption) form.append('caption', caption);
      if (chatSignatureEnabled && signatureName) form.append('signature', signatureName);
      form.append('file', file, filename);
      await uploadMessageMedia(conversationId, form);
      setComposerText('');
      await refetchAfterMutation();
    } catch (e: unknown) {
      const canRetry = attempt === 0 && /^network error$/i.test(apiErrorMessage(e, ''));
      if (canRetry) {
        setUploadStatusLabel('Reenviando arquivo…');
        await new Promise((r) => setTimeout(r, 800));
        return uploadFile(file, filename, attempt + 1);
      }
      const message = uploadErrorMessage(e);
      setUploadError(message);
      if (/janela de 24h/i.test(message)) setComposerMode('template');
    } finally {
      setIsUploading(false);
      setUploadStatusLabel(null);
    }
  };

  const onFileChange = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    await uploadFile(file, file.name);
  };

  const openFilePicker = () => {
    if (!whatsappWindowOpen) {
      setUploadError('Fora da janela de 24h: use um template aprovado para retomar o contato.');
      setComposerMode('template');
      return;
    }
    beforeFilePicker?.();
    fileInputRef.current?.click();
  };

  const startRecording = async () => {
    if (isRecording || isUploading) return;
    if (!whatsappWindowOpen) {
      setRecordingError('Fora da janela de 24h: use um template aprovado para retomar o contato.');
      setComposerMode('template');
      return;
    }
    setRecordingError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setRecordingError('Seu navegador não suporta gravação de áudio.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = ['audio/ogg;codecs=opus', 'audio/ogg', 'audio/webm;codecs=opus', 'audio/webm'];
      const mimeType = candidates.find((t) =>
        (window as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder?.isTypeSupported?.(t)
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordChunksRef.current = [];

      recorder.addEventListener('dataavailable', (ev) => {
        if (ev.data && ev.data.size > 0) recordChunksRef.current.push(ev.data);
      });

      recorder.addEventListener('stop', async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
        await uploadFile(blob, `audio.${ext}`);
      });

      recorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSec(0);
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = window.setInterval(() => setRecordingSec((s) => s + 1), 1000);
      recorder.start();
    } catch {
      setRecordingError('Permissão de microfone negada ou indisponível.');
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    try {
      recorderRef.current?.stop();
    } catch {
      // ignore
    } finally {
      recorderRef.current = null;
      setIsRecording(false);
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else void startRecording();
  };

  const isComposerBusy = isSending || isUploading || isRecording;

  return {
    composerText,
    setComposerText,
    sendError,
    setSendError,
    isSending,
    setIsSending,
    uploadError,
    uploadStatusLabel,
    isUploading,
    isRecording,
    recordingSec,
    recordingError,
    isComposerBusy,
    fileInputRef,
    textareaRef,
    onSend,
    onSendTemplate,
    insertEmoji,
    onFileChange,
    openFilePicker,
    stopRecording,
    toggleRecording,
    appendToComposer,
    composerMode,
    setComposerMode,
    templateId,
    setTemplateId,
    templateVars,
    setTemplateVars,
    selectedTemplate,
    canSendTemplate,
    whatsappWindowOpen,
    templates,
  };
}
