'use client';

import { useRef, useState } from 'react';
import { Upload, Download, X } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

type ImportResult = {
  ok?: boolean;
  created: number;
  skipped: Array<{ row: number; reason: string }>;
  errors: Array<{ row: number; message: string }>;
};

export function CadastroImportModal({
  open,
  onClose,
  templatePath,
  importPath,
  entityLabel,
  downloadFilename,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  templatePath: string;
  importPath: string;
  entityLabel: string;
  downloadFilename?: string;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);

  if (!open) return null;

  const downloadTemplate = async () => {
    setMsg(null);
    try {
      const res = await api.get(templatePath, { responseType: 'blob' });
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const name =
        downloadFilename ??
        (templatePath.includes('pharmacies')
          ? 'template_farmacias.xlsx'
          : templatePath.includes('commercial')
            ? 'modelo_importacao_leads.xlsx'
            : 'template_entregadores.xlsx');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ tone: 'ok', text: 'Modelo baixado.' });
    } catch {
      setMsg({ tone: 'err', text: 'Falha ao baixar o modelo (verifique sessão e API).' });
    }
  };

  const runImport = async (file: File) => {
    setBusy(true);
    setMsg(null);
    setLastResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post<ImportResult>(importPath, fd);
      setLastResult(data);
      setMsg({
        tone: 'ok',
        text: `Importação concluída: ${data.created} criado(s), ${data.skipped?.length || 0} ignorado(s), ${data.errors?.length || 0} erro(s) de linha.`,
      });
      onImported();
    } catch (e: unknown) {
      const ax = e as { response?: { status?: number; data?: { error?: string } } };
      if (ax.response?.status === 403) {
        setMsg({ tone: 'err', text: 'Sem permissão para importar (apenas administrador ou supervisor).' });
      } else {
        setMsg({ tone: 'err', text: ax.response?.data?.error || 'Falha ao importar arquivo.' });
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Importar {entityLabel}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Use o modelo Excel (.xlsx). Linhas com CNPJ/CPF ou telefone já existentes serão ignoradas (não atualiza cadastro).
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <ol className="mt-4 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
          <li>Baixe o arquivo modelo e preencha a aba <span className="font-semibold text-foreground">Dados</span>.</li>
          <li>Mantenha a linha de cabeçalhos; remova linhas de exemplo antes de importar produção.</li>
          <li>Leia a aba <span className="font-semibold text-foreground">Instrucoes</span> para formatos aceitos.</li>
          <li>Limite de 2000 linhas de dados por arquivo.</li>
        </ol>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void downloadTemplate()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-sidebar-accent/60"
          >
            <Download className="h-3.5 w-3.5" /> Baixar modelo (.xlsx)
          </button>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            <Upload className="h-3.5 w-3.5" />
            {busy ? 'Importando…' : 'Selecionar arquivo…'}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void runImport(f);
              }}
            />
          </label>
        </div>

        {msg ? (
          <p className={cn('mt-3 text-xs font-medium', msg.tone === 'err' ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400')}>
            {msg.text}
          </p>
        ) : null}

        {lastResult && (lastResult.skipped?.length > 0 || lastResult.errors?.length > 0) ? (
          <div className="mt-4 max-h-40 overflow-auto rounded-md border border-border bg-muted/20 p-2 text-[11px]">
            {lastResult.skipped?.length ? (
              <div className="mb-2">
                <div className="font-semibold text-foreground">Ignorados</div>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {lastResult.skipped.slice(0, 30).map((s) => (
                    <li key={`s-${s.row}`}>
                      Linha {s.row}: {s.reason}
                    </li>
                  ))}
                  {lastResult.skipped.length > 30 ? <li>… e mais {lastResult.skipped.length - 30}</li> : null}
                </ul>
              </div>
            ) : null}
            {lastResult.errors?.length ? (
              <div>
                <div className="font-semibold text-destructive">Erros</div>
                <ul className="mt-1 space-y-0.5">
                  {lastResult.errors.slice(0, 30).map((s) => (
                    <li key={`e-${s.row}`}>
                      Linha {s.row}: {s.message}
                    </li>
                  ))}
                  {lastResult.errors.length > 30 ? <li>… e mais {lastResult.errors.length - 30}</li> : null}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-sidebar-accent/60">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

export function CadastroImportTrigger({
  canImport,
  templatePath,
  importPath,
  entityLabel,
  downloadFilename,
  onImported,
}: {
  canImport: boolean;
  templatePath: string;
  importPath: string;
  entityLabel: string;
  downloadFilename?: string;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!canImport) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-sidebar-accent/60 transition-colors"
      >
        <Upload className="h-3.5 w-3.5" /> Importar Excel
      </button>
      <CadastroImportModal
        open={open}
        onClose={() => setOpen(false)}
        templatePath={templatePath}
        importPath={importPath}
        entityLabel={entityLabel}
        downloadFilename={downloadFilename}
        onImported={onImported}
      />
    </>
  );
}
