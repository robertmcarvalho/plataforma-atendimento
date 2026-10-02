'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { onApiError } from '@/lib/apiErrorMessage';
import { FormControl } from '@/components/form/FormControl';
import { formatBrazilPhone } from '@/lib/brFormat';
import {
  buildProspeccaoTemplateVariables,
  leadFirstName,
  pickProspeccaoTemplate,
  type ProspeccaoTemplateOption,
} from '@/lib/commercial/commercialProspeccao';
import { startCommercialLeadProspeccao } from '@/lib/commercial/commercialApi';
import { useAuth } from '@/store/auth';
import {
  commercialReviveOutlineButtonClassName,
  commercialRevivePrimaryButtonClassName,
} from '@/components/commercial/CommercialRevivePrimitives';

type Props = {
  open: boolean;
  onClose: () => void;
  leadId: string;
  tradeName: string;
  contactName?: string | null;
  phone: string;
  onStarted?: (conversationId: string) => void;
};

export function CommercialProspeccaoModal({
  open,
  onClose,
  leadId,
  tradeName,
  contactName,
  phone,
  onStarted,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuth((s) => s.user);
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ['commercial-prospeccao-templates'],
    enabled: open,
    queryFn: () =>
      api
        .get('/api/templates/list/approved', { params: { purpose: 'commercial' } })
        .then((r) => r.data as ProspeccaoTemplateOption[]),
  });

  const selectedTemplate = useMemo(
    () => pickProspeccaoTemplate(templatesQuery.data ?? []),
    [templatesQuery.data],
  );

  const leadName = leadFirstName(contactName, tradeName);
  const sellerName = (user?.name || '').trim();

  useEffect(() => {
    if (!open || !selectedTemplate) return;
    setTemplateVars(
      buildProspeccaoTemplateVariables(selectedTemplate.variables ?? [], leadName, sellerName),
    );
  }, [open, selectedTemplate, leadName, sellerName]);

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate) throw new Error('Nenhum template de prospecção aprovado encontrado.');
      const varsOk = (selectedTemplate.variables ?? []).every((v) => (templateVars[v] || '').trim().length > 0);
      if (!varsOk) throw new Error('Preencha todas as variáveis do template.');
      return startCommercialLeadProspeccao({
        commercial_lead_id: leadId,
        template_id: selectedTemplate.id,
        template_variables: templateVars,
      });
    },
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['commercial', 'leads', leadId] }),
        queryClient.invalidateQueries({ queryKey: ['commercial', 'leads', leadId, 'conversation'] }),
      ]);
      const conversationId = data.id;
      if (onStarted) onStarted(conversationId);
      onClose();
      router.push(`/inbox?commercial_lead_id=${leadId}&conversation_id=${conversationId}`);
    },
    onError: onApiError(setError, 'Não foi possível enviar a prospecção.'),
  });

  if (!open) return null;

  const previewBody = selectedTemplate?.body
    ? (selectedTemplate.variables ?? []).reduce((body, key, idx) => {
        const val = templateVars[key] || `{{${key}}}`;
        return body.replaceAll(`{{${key}}}`, val).replaceAll(`{{${idx + 1}}}`, val);
      }, selectedTemplate.body)
    : '';

  const canSend =
    Boolean(selectedTemplate) &&
    Boolean(phone?.trim()) &&
    (selectedTemplate?.variables?.length
      ? selectedTemplate.variables.every((v) => (templateVars[v] || '').trim().length > 0)
      : true);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Comercial</p>
          <h2 className="text-lg font-semibold">Iniciar prospecção</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Envia o template aprovado para <span className="font-medium text-foreground">{tradeName}</span> ({formatBrazilPhone(phone)}).
          </p>
        </div>

        <div className="space-y-4 p-5">
          {templatesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando templates…</p>
          ) : null}

          {!templatesQuery.isLoading && !selectedTemplate ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Nenhum template aprovado. Sincronize em Configurações → Templates.
            </p>
          ) : null}

          {selectedTemplate ? (
            <>
              <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
                <p className="font-medium text-foreground">{selectedTemplate.name}</p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{previewBody}</p>
              </div>

              {(selectedTemplate.variables ?? []).map((v) => (
                <label key={v} className="flex flex-col gap-1.5 text-xs">
                  <span className="font-medium text-muted-foreground">{`{{${v}}}`}</span>
                  <FormControl
                    value={templateVars[v] || ''}
                    onChange={(e) => setTemplateVars((prev) => ({ ...prev, [v]: e.target.value }))}
                  />
                </label>
              ))}
            </>
          ) : null}

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={commercialReviveOutlineButtonClassName}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={!canSend || startMutation.isPending}
              onClick={() => {
                setError(null);
                startMutation.mutate();
              }}
              className={commercialRevivePrimaryButtonClassName}
            >
              {startMutation.isPending ? 'Enviando…' : 'Enviar e abrir inbox'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
