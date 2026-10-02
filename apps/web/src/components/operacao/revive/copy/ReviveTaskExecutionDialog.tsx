'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  ArrowUpFromLine,
  AtSign,
  CheckCircle2,
  MessageSquare,
  Send,
  StickyNote,
  Timer,
  X,
} from 'lucide-react';
import { AvatarInitials } from '@/components/ui/AvatarInitials';
import api from '@/lib/api';
import { tarefaMeta, tarefaStatusMeta } from '@/components/operacao/revive/copy/ReviveTaskCard';
import type { Comentario, TarefaAtendimento } from '@/lib/operacao/reviveCopy/operacaoReviveTypes';
import {
  formControlCompactClassName,
  formControlFlexClassName,
  formTextareaClassName,
} from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AutentiqueDocumentNameCopy } from '@/components/operacao/AutentiqueDocumentNameCopy';
import { useAuth } from '@/store/auth';

type MentionCandidate = { id: string; name: string };
type AttendantOption = { id: string; name: string };
type StoredComment = {
  id: string;
  author_id?: string;
  author_name: string;
  author_initials?: string;
  text: string;
  mentions?: string[];
  created_at?: string;
};

const parseMencoes = (texto: string) =>
  Array.from(texto.matchAll(/@([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)?)/g)).map((m) => m[1]);

function mapStoredComments(rows: StoredComment[]): Comentario[] {
  return rows.map((c) => ({
    id: c.id,
    autor: c.author_name,
    iniciais: c.author_initials || c.author_name.slice(0, 2).toUpperCase(),
    texto: c.text,
    mencoes: c.mentions || [],
    timestamp: c.created_at
      ? new Date(c.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '',
  }));
}

export function ReviveTaskExecutionDialog({
  tarefa,
  open,
  onOpenChange,
  onChanged,
}: {
  tarefa: TarefaAtendimento | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const [draft, setDraft] = useState<TarefaAtendimento | null>(tarefa);
  const [comentario, setComentario] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [stepIds, setStepIds] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const comentarioRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(tarefa);
    setComentario('');
    setTransferTo('');
    setTransferError(null);
    setStepIds([]);
  }, [tarefa]);

  useEffect(() => {
    if (!open || !tarefa) return;
    void api.get(`/api/tasks/${tarefa.id}/context`).then((res) => {
      const task = res.data?.task as { metadata?: Record<string, unknown> } | undefined;
      const meta = task?.metadata || {};
      const steps = (res.data?.playbook?.steps || []) as Array<{ id: string; label: string }>;
      const progress = Array.isArray(meta.playbook_progress)
        ? (meta.playbook_progress as Array<{ id?: string }>)
        : [];
      const idsFromProgress = progress.map((p, i) => String(p.id || steps[i]?.id || '')).filter(Boolean);
      setStepIds(idsFromProgress.length ? idsFromProgress : steps.map((s) => s.id));
      const stored = Array.isArray(meta.task_comments) ? (meta.task_comments as StoredComment[]) : [];
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              anotacoes: String(meta.notes || ''),
              comentarios: mapStoredComments(stored),
            }
          : prev
      );
    });
  }, [open, tarefa]);

  const attendantsQuery = useQuery({
    queryKey: ['users', 'attendants', 'task-transfer'],
    enabled: open,
    queryFn: async () => {
      const { data } = await api.get<AttendantOption[]>('/api/users/attendants', {
        params: { include_supervisors: '1' },
      });
      return data || [];
    },
    staleTime: 60_000,
  });

  const mentionCandidatesQuery = useQuery({
    queryKey: ['users', 'mention-candidates', 'task-comments'],
    enabled: open,
    queryFn: async () => {
      const { data } = await api.get<MentionCandidate[]>('/api/users/mention-candidates');
      return data || [];
    },
    staleTime: 60_000,
  });

  const filteredMentions = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    const rows = mentionCandidatesQuery.data || [];
    if (!q) return rows.slice(0, 8);
    return rows.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionCandidatesQuery.data, mentionQuery]);

  if (!open || !draft) return null;

  const meta = tarefaMeta[draft.tipo];
  const TaskIcon = meta.icon;
  const checkPct = Math.round((draft.checklist.filter((c) => c.done).length / draft.checklist.length) * 100);
  const pct = Math.min(100, Math.round((draft.decorridoMinutos / draft.slaMinutos) * 100));

  const toggleItem = (i: number) =>
    setDraft({
      ...draft,
      checklist: draft.checklist.map((c, idx) => (idx === i ? { ...c, done: !c.done } : c)),
    });

  const insertMention = (name: string) => {
    const el = comentarioRef.current;
    const at = el?.selectionStart ?? comentario.length;
    const before = comentario.slice(0, at).replace(/@([^\s@]*)$/, '');
    const after = comentario.slice(at);
    const next = `${before}@${name} ${after}`;
    setComentario(next);
    setMentionOpen(false);
    setMentionQuery('');
  };

  const addComentario = () => {
    if (!comentario.trim()) return;
    const authorName = user?.name || 'Você';
    const novo: Comentario = {
      id: `c${Date.now()}`,
      autor: authorName,
      iniciais: authorName
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() || '')
        .join('') || 'EU',
      texto: comentario.trim(),
      mencoes: parseMencoes(comentario),
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };
    setDraft({ ...draft, comentarios: [...(draft.comentarios ?? []), novo] });
    setComentario('');
  };

  const persistChecklist = async () => {
    if (!stepIds.length) return;
    for (let i = 0; i < draft.checklist.length; i++) {
      const stepId = stepIds[i];
      if (!stepId) continue;
      await api.patch(`/api/tasks/${draft.id}/playbook-progress`, {
        step_id: stepId,
        done: draft.checklist[i].done,
      });
    }
  };

  const persistMetadata = async () => {
    const task_comments: StoredComment[] = (draft.comentarios || []).map((c) => ({
      id: c.id,
      author_id: user?.id,
      author_name: c.autor,
      author_initials: c.iniciais,
      text: c.texto,
      mentions: c.mencoes,
      created_at: new Date().toISOString(),
    }));
    await api.patch(`/api/tasks/${draft.id}/metadata`, {
      notes: draft.anotacoes ?? '',
      task_comments,
    });
  };

  const salvar = async () => {
    setSaving(true);
    try {
      await persistChecklist();
      await persistMetadata();
      void qc.invalidateQueries({ queryKey: ['ops-analytics'] });
      onChanged?.();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const finalizar = async () => {
    setSaving(true);
    try {
      await persistChecklist();
      await persistMetadata();
      await api.patch(`/api/tasks/${draft.id}`, { status: 'done' });
      void qc.invalidateQueries({ queryKey: ['ops-analytics'] });
      onChanged?.();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const transferir = async () => {
    if (!transferTo.trim()) return;
    setSaving(true);
    setTransferError(null);
    try {
      try {
        await persistMetadata();
      } catch {
        /* anotações/comentários não bloqueiam transferência */
      }
      try {
        await persistChecklist();
      } catch {
        /* checklist desatualizado não bloqueia transferência */
      }
      await api.patch(`/api/tasks/${draft.id}/assign`, { assignee_id: transferTo });
      void qc.invalidateQueries({ queryKey: ['ops-analytics'] });
      onChanged?.();
      onOpenChange(false);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err instanceof Error ? err.message : 'Não foi possível transferir a tarefa.');
      setTransferError(msg);
    } finally {
      setSaving(false);
    }
  };

  const escalar = async () => {
    setSaving(true);
    try {
      await persistMetadata();
      onChanged?.();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => onOpenChange(false)}>
      <div
        role="dialog"
        aria-modal="true"
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100"
          onClick={() => onOpenChange(false)}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Fechar</span>
        </button>

        <div className="mb-4 flex flex-col space-y-1.5 text-left">
          <div className="flex items-start gap-3 pr-8">
            <TaskIcon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <div className="flex-1">
              <h2 className="text-base font-semibold leading-none tracking-tight">
                {meta.label} · {draft.entregadorNome}
              </h2>
              <p className="text-xs text-muted-foreground">
                {draft.farmacia} · prazo {draft.prazo}
              </p>
            </div>
            <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-medium', tarefaStatusMeta[draft.status].cls)}>
              {tarefaStatusMeta[draft.status].label}
            </span>
          </div>
        </div>

        {draft.entregadorId &&
        (draft.tipo === 'gerar_matricula' || draft.tipo === 'gerar_termo_desligamento') ? (
          <div className="mb-4">
            <AutentiqueDocumentNameCopy
              driverId={draft.entregadorId}
              driverName={draft.entregadorNome}
              variant={draft.tipo === 'gerar_matricula' ? 'MATRICULA' : 'DESLIGAMENTO'}
              signatureStatus={draft.signatureStatus}
            />
          </div>
        ) : null}

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Timer className="h-3 w-3" strokeWidth={1.75} /> SLA
              </span>
              <span className="font-mono">{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full transition-all', pct >= 100 ? 'bg-destructive' : pct >= 75 ? 'bg-warning' : 'bg-primary')}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between text-xs">
              <h4 className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Checklist
              </h4>
              <span className="font-mono text-muted-foreground">{checkPct}%</span>
            </div>
            <ul className="space-y-1.5 rounded-xl border border-border bg-background p-3">
              {draft.checklist.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={c.done}
                    onChange={() => toggleItem(i)}
                    className="h-3.5 w-3.5 rounded border-border"
                  />
                  <span className={cn(c.done && 'text-muted-foreground line-through')}>{c.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold">
              <StickyNote className="h-3.5 w-3.5 text-warning" /> Anotações
            </h4>
            <textarea
              value={draft.anotacoes ?? ''}
              onChange={(e) => setDraft({ ...draft, anotacoes: e.target.value })}
              placeholder="Anotações internas sobre a tarefa…"
              className={cn('min-h-20 text-xs', formTextareaClassName)}
            />
          </section>

          <section>
            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold">
              <MessageSquare className="h-3.5 w-3.5 text-primary" /> Comentários · {draft.comentarios?.length ?? 0}
            </h4>
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-border bg-background p-3">
              {(draft.comentarios ?? []).length === 0 && (
                <div className="text-center text-[11px] text-muted-foreground">Sem comentários.</div>
              )}
              {(draft.comentarios ?? []).map((c) => (
                <div key={c.id} className="flex gap-2 text-xs">
                  <AvatarInitials initials={c.iniciais} size="sm" className="bg-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.autor}</span>
                      <span className="text-[10px] text-muted-foreground">{c.timestamp}</span>
                    </div>
                    <p className="text-[11px]">
                      {c.texto.split(/(@[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)?)/g).map((part, i) =>
                        part.startsWith('@') ? (
                          <span key={i} className="rounded bg-primary/15 px-1 text-primary">
                            {part}
                          </span>
                        ) : (
                          <span key={i}>{part}</span>
                        )
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="relative mt-2 flex gap-2">
              <div className="relative flex-1">
                <AtSign className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={comentarioRef}
                  value={comentario}
                  onChange={(e) => {
                    const v = e.target.value;
                    setComentario(v);
                    const m = v.match(/@([^\s@]*)$/);
                    if (m) {
                      setMentionOpen(true);
                      setMentionQuery(m[1] || '');
                    } else {
                      setMentionOpen(false);
                      setMentionQuery('');
                    }
                  }}
                  placeholder="Comente e use @nome para mencionar"
                  className={cn('h-8 w-full pl-7 pr-2 text-xs', formControlCompactClassName)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addComentario())}
                />
                {mentionOpen && filteredMentions.length > 0 ? (
                  <ul className="absolute bottom-full left-0 z-20 mb-1 max-h-36 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md">
                    {filteredMentions.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-1.5 text-left text-xs hover:bg-sidebar-accent/60"
                          onClick={() => insertMention(m.name)}
                        >
                          {m.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <Button type="button" variant="secondary" className="px-2" onClick={addComentario}>
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <h4 className="flex items-center gap-2 font-semibold">
                <ArrowRightLeft className="h-3.5 w-3.5 text-warning" /> Transferir tarefa
              </h4>
            </div>
            <div className="flex gap-2">
              <FormSelect
                value={transferTo}
                onChange={setTransferTo}
                placeholder="Selecione o atendente"
                options={(attendantsQuery.data || []).map((a) => ({ value: a.id, label: a.name }))}
                className="h-8 flex-1 text-xs"
              />
              <Button type="button" variant="secondary" className="text-xs" onClick={transferir} disabled={!transferTo.trim() || saving}>
                Transferir
              </Button>
            </div>
            {transferError ? <p className="mt-2 text-[11px] text-destructive">{transferError}</p> : null}
          </section>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" className="text-xs" onClick={escalar} disabled={saving}>
              <ArrowUpFromLine className="mr-1 inline h-3.5 w-3.5" /> Escalar p/ gestor
            </Button>
            <Button type="button" variant="secondary" className="text-xs" onClick={salvar} disabled={saving}>
              Salvar
            </Button>
            <Button type="button" className="text-xs" onClick={finalizar} disabled={saving}>
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> Finalizar tarefa
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
