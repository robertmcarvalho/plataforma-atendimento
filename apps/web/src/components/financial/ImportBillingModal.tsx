'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parse, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  FileSpreadsheet,
  Info,
  Link2,
  MessageSquare,
  Settings2,
  Upload,
  X,
} from 'lucide-react';
import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { useAuth } from '@/store/auth';
import { formatBRL } from '@/lib/brFormat';
import { formatDateBr, formatDateTimeBr } from '@/lib/datetimeBr';
import {
  RULE_KIND_LABELS,
  type DiscountRule,
  type DiscountRuleKind,
} from '@/lib/financialCycle';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { buildDefaultRule, WEEK_DAYS } from '@/lib/financial/financialDiscountRules';
import { useEntryTypes, useTypeLabels } from '@/lib/financial/entryTypesContext';
import {
  absenceDispositionLabel,
  coverageRoleLabel,
  entryStatusLabel,
  frequencyLabel,
  inferEntryOrigin,
  occurrenceKindLabel,
  userRoleLabel,
} from '@/lib/financial/financialLabels';
import {
  buildCoverageMaps,
  coverageListHint,
  resolveCoverageAbsence,
  resolveCoverageDailies,
  resolveLinkedEntryId,
} from '@/lib/financial/financialCoverage';
import {
  formatRequestAtSaoPaulo,
  installmentStatusLabel,
  installmentsOnReferenceDate,
} from '@/lib/financial/financialInstallments';
import type { ApiEntry, DriverOption, PharmacyOption } from '@/lib/financial/types';

export function ImportBillingModal({ onClose, onImported }: { onClose: () => void, onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post('/api/financial/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      onImported();
      onClose();
    } catch (e: unknown) {
      alert(apiErrorMessage(e, 'Erro ao importar faturamento. Verifique o formato do arquivo.'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-md">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-success" />
            <h3 className="text-lg font-semibold">Importar Faturamento</h3>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-sidebar-accent/60"><X className="h-5 w-5" /></button>
        </div>

        <div 
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "group cursor-pointer rounded-xl border-2 border-dashed border-border bg-background/40 p-10 text-center transition-all hover:border-primary/50 hover:bg-primary/5",
            file && "border-success/50 bg-success/5"
          )}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".xlsx,.xls,.csv" 
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <div className="flex flex-col items-center gap-2">
            <Upload className={cn("h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors", file && "text-success")} />
            <div className="text-sm font-medium">{file ? file.name : 'Clique para selecionar o Excel'}</div>
            <div className="text-[10px] text-muted-foreground uppercase font-bold">Colunas esperadas: Nome, CPF, Valor</div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-md border border-border py-2 text-xs font-medium">Cancelar</button>
          <button 
            disabled={!file || uploading} 
            onClick={handleUpload}
            className="flex-1 rounded-md bg-primary py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
          >
            {uploading ? 'Processando...' : 'Iniciar Importação'}
          </button>
        </div>
      </div>
    </div>
  );
}