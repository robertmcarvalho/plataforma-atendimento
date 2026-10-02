'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { X } from 'lucide-react';
import { FormControl } from '@/components/form/FormControl';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { Button } from '@/components/ui/button';
import { insertMentionAtCaret } from '@/lib/inbox/inboxMention';
import { humanizeInternalNoteContent } from '@plataforma/operational-notes';
import type { ApiConversationDetail, ApiSector, ApiUser, MentionCandidate } from '@/lib/inbox/types';

export type InboxModalsProps = {
  historyOpen: boolean;
  onCloseHistory: () => void;
  detail?: ApiConversationDetail;
  noteOpen: boolean;
  onCloseNote: () => void;
  noteText: string;
  onNoteTextChange: (value: string) => void;
  noteCaret: number;
  onNoteCaretChange: (caret: number) => void;
  noteTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  filteredMentionCandidates: MentionCandidate[];
  noteHint: string | null;
  isSending: boolean;
  onSubmitNote: () => void;
  transferOpen: boolean;
  onCloseTransfer: () => void;
  transferSectorId: string;
  onTransferSectorIdChange: (value: string) => void;
  transferAttendantId: string;
  onTransferAttendantIdChange: (value: string) => void;
  transferReason: string;
  onTransferReasonChange: (value: string) => void;
  sectors?: ApiSector[];
  users?: ApiUser[];
  onSubmitTransfer: () => void;
};

export function InboxModals({
  historyOpen,
  onCloseHistory,
  detail,
  noteOpen,
  onCloseNote,
  noteText,
  onNoteTextChange,
  noteCaret,
  onNoteCaretChange,
  noteTextareaRef,
  filteredMentionCandidates,
  noteHint,
  isSending,
  onSubmitNote,
  transferOpen,
  onCloseTransfer,
  transferSectorId,
  onTransferSectorIdChange,
  transferAttendantId,
  onTransferAttendantIdChange,
  transferReason,
  onTransferReasonChange,
  sectors,
  users,
  onSubmitTransfer,
}: InboxModalsProps) {
  const transferUsers = (users || []).filter((u) => {
    if (!transferSectorId) return true;
    const ids = u.sector_ids || [];
    if (!ids.length) return true;
    return ids.includes(transferSectorId);
  });

  return (
    <>
      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-4 shadow-md">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold tracking-tight">Histórico da conversa</div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={onCloseHistory} className="text-muted-foreground" title="Fechar">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-3 max-h-[70vh] overflow-y-auto space-y-4">
              <div>
                <div className="inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">
                  Atribuições / Transferências
                </div>
                {detail?.conversation_assignments?.length ? (
                  <div className="mt-2 space-y-2">
                    {detail.conversation_assignments.slice(0, 30).map((h) => (
                      <div key={h.id} className="rounded-lg border border-border bg-background/40 p-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-foreground">
                            {(h.from_attendant?.name || '—') + ' → ' + (h.to_attendant?.name || '—')}
                          </span>
                          <span className="font-mono inbox-t-meta text-subtle-foreground">
                            {format(new Date(h.created_at), 'dd/MM HH:mm', { locale: ptBR })}
                          </span>
                        </div>
                        <div className="mt-1 inbox-t-control text-muted-foreground">
                          {(h.from_sector?.name || '—') + ' → ' + (h.to_sector?.name || '—')}
                        </div>
                        {h.reason ? <div className="mt-1 inbox-t-control text-muted-foreground">Motivo: {h.reason}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">Sem eventos ainda.</div>
                )}
              </div>
              <div>
                <div className="inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">Notas internas</div>
                {detail?.internal_notes?.length ? (
                  <div className="mt-2 space-y-2">
                    {detail.internal_notes.slice(0, 30).map((n) => (
                      <div key={n.id} className="rounded-lg border border-warning/25 bg-warning/8 p-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-foreground">{n.author?.name || '—'}</span>
                          <span className="font-mono inbox-t-meta text-subtle-foreground">
                            {format(new Date(n.created_at), 'dd/MM HH:mm', { locale: ptBR })}
                          </span>
                        </div>
                        <div className="mt-1 inbox-t-control text-muted-foreground whitespace-pre-line">
                          {humanizeInternalNoteContent(n.content)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">Sem notas internas.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {noteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-4 shadow-md">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold tracking-tight">Nota interna</div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={onCloseNote} className="text-muted-foreground" title="Fechar">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-3 space-y-3">
              <p className="inbox-t-control text-muted-foreground">Use @ para avisar um colega (ex.: @Nome Completo).</p>
              <div className="relative">
                <textarea
                  rows={5}
                  value={noteText}
                  ref={noteTextareaRef}
                  onChange={(e) => {
                    onNoteTextChange(e.target.value);
                    onNoteCaretChange(e.target.selectionStart ?? e.target.value.length);
                  }}
                  onClick={(e) => onNoteCaretChange(e.currentTarget.selectionStart ?? noteText.length)}
                  onKeyUp={(e) => onNoteCaretChange(e.currentTarget.selectionStart ?? noteText.length)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && filteredMentionCandidates[0]) {
                      e.preventDefault();
                      const pick = filteredMentionCandidates[0];
                      const next = insertMentionAtCaret(noteText, noteCaret, pick.name);
                      onNoteTextChange(next.text);
                      onNoteCaretChange(next.caret);
                      requestAnimationFrame(() => {
                        const el = noteTextareaRef.current;
                        if (!el) return;
                        el.focus();
                        el.setSelectionRange(next.caret, next.caret);
                      });
                    }
                  }}
                  placeholder="Escreva uma nota visível apenas para a equipe…"
                  className="w-full resize-none rounded-xl border border-border bg-background/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 placeholder:text-muted-foreground"
                />
                {filteredMentionCandidates.length ? (
                  <ul className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md">
                    {filteredMentionCandidates.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="flex w-full px-3 py-1.5 text-left text-xs hover:bg-sidebar-accent/60"
                          onClick={() => {
                            const next = insertMentionAtCaret(noteText, noteCaret, c.name);
                            onNoteTextChange(next.text);
                            onNoteCaretChange(next.caret);
                            requestAnimationFrame(() => {
                              const el = noteTextareaRef.current;
                              if (!el) return;
                              el.focus();
                              el.setSelectionRange(next.caret, next.caret);
                            });
                          }}
                        >
                          @{c.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {noteHint ? <p className="text-xs text-primary">{noteHint}</p> : null}
              <div className="flex items-center justify-between">
                <button type="button" onClick={onCloseNote} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  Cancelar
                </button>
                <Button size="xs" onClick={() => void onSubmitNote()} disabled={!noteText.trim() || isSending}>
                  Salvar nota
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {transferOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-4 shadow-md">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold tracking-tight">Transferir conversa</div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={onCloseTransfer} className="text-muted-foreground" title="Fechar">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">Setor</div>
                  <FormSearchCombobox
                    inputSize="sm"
                    value={transferSectorId}
                    onChange={onTransferSectorIdChange}
                    placeholder="Buscar setor…"
                    options={[
                      { value: '', label: 'Manter' },
                      ...(sectors || []).map((s) => ({ value: s.id, label: s.name })),
                    ]}
                  />
                </div>
                <div>
                  <div className="mb-1 inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">Atendente</div>
                  <FormSearchCombobox
                    inputSize="sm"
                    value={transferAttendantId}
                    onChange={onTransferAttendantIdChange}
                    placeholder="Buscar atendente…"
                    options={[
                      { value: '', label: 'Sem dono' },
                      ...(transferUsers || []).map((u) => ({ value: u.id, label: `${u.name} (${u.role})` })),
                    ]}
                  />
                </div>
              </div>
              <div>
                <div className="mb-1 inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">Motivo (opcional)</div>
                <FormControl
                  value={transferReason}
                  onChange={(e) => onTransferReasonChange(e.target.value)}
                  placeholder="Ex.: Escalar para N2 / Financeiro / etc"
                  inputSize="sm"
                  className="text-xs placeholder:text-muted-foreground"
                />
              </div>
              <div className="flex items-center justify-between">
                <button type="button" onClick={onCloseTransfer} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  Cancelar
                </button>
                <Button
                  size="xs"
                  onClick={() => void onSubmitTransfer()}
                  disabled={isSending || (!transferSectorId && !transferAttendantId)}
                >
                  Transferir
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
