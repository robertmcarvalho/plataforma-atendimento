'use client';

import { useRef, useState } from 'react';
import { FileText, Mic, Paperclip, Send, Smile, Sparkles, Tag } from 'lucide-react';
import { SuggestReplyButton } from '@/components/inbox/ai/SuggestReplyButton';
import type { TemplatePickerOption } from '@/components/inbox/NewConversationModal';
import { FormControl } from '@/components/form/FormControl';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { Button } from '@/components/ui/button';
import { features } from '@/lib/features';
import { cn } from '@/lib/utils';
import { resolveTemplateVariableKeys, hasInvalidEmptyPlaceholders } from '@/lib/inbox/templateVariables';

const EMOJI_OPTIONS = ['👍', '😊', '🙏', '😅', '🎉', '❤️', '😮', '😢', '✅', '🔥', '👏', '💬', '🚚', '📦'] as const;

export type MessageComposerProps = {
  activeId: string;
  composerText: string;
  onComposerTextChange: (value: string) => void;
  sendError: string | null;
  uploadError: string | null;
  recordingError: string | null;
  isSending: boolean;
  isUploading: boolean;
  uploadStatusLabel?: string | null;
  isRecording: boolean;
  recordingSec: number;
  canEditConversationTags: boolean;
  suggestReplyEnabled: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: () => void;
  onFileChange: (ev: React.ChangeEvent<HTMLInputElement>) => void;
  openFilePicker: () => void;
  insertEmoji: (emoji: string) => void;
  stopRecording: () => void;
  toggleRecording: () => void;
  onInsertSuggestion: (text: string) => void;
  onToggleTagPicker: () => void;
  whatsappWindowOpen: boolean;
  composerMode: 'text' | 'template';
  onComposerModeChange: (mode: 'text' | 'template') => void;
  templates: TemplatePickerOption[];
  templateId: string;
  onTemplateIdChange: (id: string) => void;
  templateVars: Record<string, string>;
  onTemplateVarsChange: (vars: Record<string, string>) => void;
  selectedTemplate?: TemplatePickerOption;
  onSendTemplate: () => void;
  canSendTemplate: boolean;
};

export function MessageComposer({
  activeId,
  composerText,
  onComposerTextChange,
  sendError,
  uploadError,
  recordingError,
  isSending,
  isUploading,
  uploadStatusLabel,
  isRecording,
  recordingSec,
  canEditConversationTags,
  suggestReplyEnabled,
  fileInputRef,
  textareaRef,
  onSend,
  onFileChange,
  openFilePicker,
  insertEmoji,
  stopRecording,
  toggleRecording,
  onInsertSuggestion,
  onToggleTagPicker,
  whatsappWindowOpen,
  composerMode,
  onComposerModeChange,
  templates,
  templateId,
  onTemplateIdChange,
  templateVars,
  onTemplateVarsChange,
  selectedTemplate,
  onSendTemplate,
  canSendTemplate,
}: MessageComposerProps) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiPanelRef = useRef<HTMLDivElement | null>(null);

  const composerDisabled = !activeId || isSending || isUploading || isRecording;
  const templateMode = composerMode === 'template';
  const mediaDisabled = composerDisabled || !whatsappWindowOpen;

  return (
    <div className="safe-area-bottom border-t border-border bg-surface/40 p-4">
      <div className="mx-auto max-w-3xl">
        {features.aiSuggestReply || features.aiSuggestions ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {features.aiSuggestReply && suggestReplyEnabled && !templateMode ? (
              <SuggestReplyButton
                conversationId={activeId || null}
                disabled={composerDisabled}
                onInsert={onInsertSuggestion}
              />
            ) : features.aiSuggestions ? (
              <button
                type="button"
                disabled
                className="flex cursor-not-allowed items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 inbox-t-meta font-medium text-muted-foreground opacity-60"
              >
                <Sparkles className="h-3 w-3 text-primary" />
                Sugerir resposta
              </button>
            ) : null}
            {features.aiSuggestions ? (
              <button
                type="button"
                disabled
                className="rounded-md border border-border bg-surface px-2 py-1 inbox-t-meta font-medium text-muted-foreground opacity-60"
              >
                Respostas prontas
              </button>
            ) : null}
          </div>
        ) : null}

        {!whatsappWindowOpen && activeId ? (
          <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            Janela de 24h encerrada. Envie um template aprovado pela Meta para retomar o contato nesta conversa.
          </div>
        ) : null}

        {sendError ? <div className="mb-2 text-xs text-destructive">{sendError}</div> : null}
        {uploadError ? <div className="mb-2 text-xs text-destructive">{uploadError}</div> : null}
        {recordingError ? <div className="mb-2 text-xs text-destructive">{recordingError}</div> : null}

        <div className="rounded-xl border border-border bg-background/40 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
            onChange={onFileChange}
          />

          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <button
              type="button"
              onClick={() => onComposerModeChange('text')}
              disabled={!whatsappWindowOpen}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                templateMode
                  ? 'text-muted-foreground hover:bg-sidebar-accent/60'
                  : 'bg-primary text-primary-foreground',
                !whatsappWindowOpen && 'cursor-not-allowed opacity-50',
              )}
            >
              Texto livre
            </button>
            <button
              type="button"
              onClick={() => onComposerModeChange('template')}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                templateMode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60',
              )}
            >
              Template Meta
            </button>
          </div>

          {templateMode ? (
            <div className="space-y-3 px-4 py-3">
              {templates.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum template aprovado. Sincronize em Configurações → Templates.
                </p>
              ) : (
                <>
                  <FormSearchCombobox
                    value={templateId}
                    onChange={onTemplateIdChange}
                    placeholder="Buscar template aprovado…"
                    options={[
                      { value: '', label: 'Selecione o template aprovado' },
                      ...templates.map((tpl) => ({
                        value: tpl.id,
                        label: `${tpl.name}${!tpl.meta_template_name ? ' (sem nome Meta)' : ''}`,
                      })),
                    ]}
                  />
                  {selectedTemplate?.body ? (
                    <p className="whitespace-pre-wrap rounded-md border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground">
                      {selectedTemplate.body}
                    </p>
                  ) : null}
                  {selectedTemplate && hasInvalidEmptyPlaceholders(selectedTemplate.body || '') ? (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
                      Template Meta com <code>{'{{}}'}</code> inválido. Use <code>{'{{1}}'}</code> no Gerenciador da
                      Meta, aprove e sincronize em Configurações → Templates.
                    </div>
                  ) : null}
                  {resolveTemplateVariableKeys(selectedTemplate).map((v) => (
                    <label key={v} className="flex flex-col gap-1 text-xs">
                      <span className="font-medium text-muted-foreground">{`{{${v}}}`}</span>
                      <FormControl
                        value={templateVars[v] || ''}
                        onChange={(e) => onTemplateVarsChange({ ...templateVars, [v]: e.target.value })}
                        placeholder={`Valor para {{${v}}}`}
                      />
                    </label>
                  ))}
                </>
              )}
            </div>
          ) : (
            <>
              {isRecording ? (
                <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs">
                  <div className="flex items-center gap-2 text-destructive">
                    <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                    <span className="font-medium">Gravando…</span>
                    <span className="font-mono text-muted-foreground">
                      {String(Math.floor(recordingSec / 60)).padStart(2, '0')}:
                      {String(recordingSec % 60).padStart(2, '0')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="rounded-md border border-border bg-surface px-2 py-1 inbox-t-meta font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  >
                    Parar e enviar
                  </button>
                </div>
              ) : isUploading ? (
                <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                  {uploadStatusLabel || 'Enviando arquivo…'}
                </div>
              ) : null}
              <textarea
                rows={2}
                value={composerText}
                onChange={(e) => onComposerTextChange(e.target.value)}
                placeholder="Escreva uma mensagem..."
                data-testid="inbox-composer"
                ref={textareaRef}
                className="block w-full resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </>
          )}

          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <div className="relative flex items-center gap-0.5">
              {!templateMode ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={openFilePicker}
                    disabled={mediaDisabled}
                    className="text-muted-foreground"
                    title={whatsappWindowOpen ? 'Anexar' : 'Disponível apenas na janela de 24h'}
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={toggleRecording}
                    disabled={!activeId || isUploading || !whatsappWindowOpen}
                    className={cn(isRecording ? 'text-destructive' : 'text-muted-foreground')}
                    title={
                      whatsappWindowOpen
                        ? isRecording
                          ? 'Parar gravação'
                          : 'Gravar áudio'
                        : 'Disponível apenas na janela de 24h'
                    }
                  >
                    <Mic className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setEmojiOpen((v) => !v)}
                    disabled={composerDisabled}
                    className="text-muted-foreground"
                    title="Emoji"
                  >
                    <Smile className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled
                  className="text-muted-foreground opacity-60"
                  title="Templates Meta"
                >
                  <FileText className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  if (!canEditConversationTags) return;
                  onToggleTagPicker();
                }}
                disabled={!activeId || isUploading || isRecording || !canEditConversationTags}
                className="text-muted-foreground"
                title={canEditConversationTags ? 'Tags' : 'Apenas administrador ou supervisor pode alterar tags'}
              >
                <Tag className="h-3.5 w-3.5" />
              </Button>

              {emojiOpen && !templateMode ? (
                <div
                  ref={emojiPanelRef}
                  className="absolute left-0 bottom-10 z-40 grid w-44 grid-cols-7 gap-1 rounded-xl border border-border bg-popover p-2 shadow-md"
                >
                  {EMOJI_OPTIONS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => {
                        insertEmoji(em);
                        setEmojiOpen(false);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-sidebar-accent/60 text-base"
                      title={em}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {templateMode ? (
              <Button
                size="xs"
                onClick={() => void onSendTemplate()}
                disabled={composerDisabled || !canSendTemplate}
                data-testid="inbox-send-template"
              >
                Enviar template
                <Send className="h-3 w-3" />
              </Button>
            ) : (
              <Button
                size="xs"
                onClick={() => void onSend()}
                disabled={composerDisabled || composerText.trim().length === 0}
                data-testid="inbox-send"
              >
                Enviar
                <Send className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
