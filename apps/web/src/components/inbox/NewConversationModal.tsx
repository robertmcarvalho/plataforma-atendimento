'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { onApiError } from '@/lib/apiErrorMessage';
import { BrPhoneInput } from '@/components/form/BrInputs';
import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { FormSelect } from '@/components/form/FormSelect';
import { normalizeBrazilPhone } from '@/lib/brFormat';
import { CadastroSearchCombobox } from '@/components/cadastro/CadastroSearchCombobox';
import {
  buildOperacionalInstalacaoTemplateVariables,
  pharmacyContactFirstName,
  pickOperacionalInstalacaoTemplate,
} from '@/lib/operacao/operationalInstalacao';
import { resolveTemplateVariableKeys, hasInvalidEmptyPlaceholders } from '@/lib/inbox/templateVariables';

type ContactStartType = 'driver' | 'pharmacy' | 'leader' | 'phone';

export interface SectorPickerOption {
  id: string;
  name: string;
}

export interface TemplatePickerOption {
  id: string;
  name: string;
  body: string;
  variables: string[];
  meta_template_name?: string | null;
}

export function NewConversationModal({
  open,
  onClose,
  sectors,
  templates,
  defaultSectorId,
  workspaceChannelId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  sectors: SectorPickerOption[];
  templates: TemplatePickerOption[];
  defaultSectorId?: string | null;
  workspaceChannelId?: string | null;
  onCreated: (conversationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [contactType, setContactType] = useState<ContactStartType>('driver');
  const [sectorId, setSectorId] = useState('');

  const [driverId, setDriverId] = useState('');
  const [pharmacyId, setPharmacyId] = useState('');
  const [leaderId, setLeaderId] = useState('');

  const [waPhone, setWaPhone] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [msgMode, setMsgMode] = useState<'template' | 'text'>('template');
  const [templateId, setTemplateId] = useState('');
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [textBody, setTextBody] = useState('');

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSectorId(defaultSectorId || '');
      setError(null);
    }
  }, [open, defaultSectorId]);

  // Canal trocado / lista filtrada: não manter template de outra WABA selecionado.
  useEffect(() => {
    if (!templateId) return;
    if (templates.some((tpl) => tpl.id === templateId)) return;
    setTemplateId('');
    setTemplateVars({});
  }, [templates, templateId]);

  const selectedTemplate = templates.find((x) => x.id === templateId);
  const selectedTemplateVars = useMemo(
    () => resolveTemplateVariableKeys(selectedTemplate),
    [selectedTemplate]
  );
  const operacionalInstalacaoTemplate = useMemo(() => pickOperacionalInstalacaoTemplate(templates), [templates]);

  const pharmacyQuery = useQuery({
    queryKey: ['inbox-new-conversation-pharmacy', pharmacyId],
    enabled: open && contactType === 'pharmacy' && Boolean(pharmacyId),
    queryFn: () =>
      api
        .get<{
          trade_name?: string | null;
          contact_expedition_name?: string | null;
          contact_manager_name?: string | null;
          contact_financial_name?: string | null;
        }>(`/api/pharmacies/${pharmacyId}`)
        .then((r) => r.data),
  });

  const pharmacyContactName = pharmacyQuery.data ? pharmacyContactFirstName(pharmacyQuery.data) : '';
  const pharmacyTradeName = (pharmacyQuery.data?.trade_name || '').trim();

  useEffect(() => {
    if (!open || contactType !== 'pharmacy' || !operacionalInstalacaoTemplate || templateId) return;
    setMsgMode('template');
    setTemplateId(operacionalInstalacaoTemplate.id);
  }, [open, contactType, operacionalInstalacaoTemplate, templateId]);

  useEffect(() => {
    if (!selectedTemplate?.variables?.length) {
      setTemplateVars({});
      return;
    }
    setTemplateVars((prev) => {
      const next = { ...prev };
      for (const v of selectedTemplate.variables) {
        if (next[v] === undefined) next[v] = '';
      }
      return next;
    });
  }, [selectedTemplate]);

  useEffect(() => {
    if (!open || contactType !== 'pharmacy' || !selectedTemplate || !pharmacyQuery.data) return;
    if (selectedTemplate.meta_template_name !== operacionalInstalacaoTemplate?.meta_template_name) return;
    setTemplateVars(
      buildOperacionalInstalacaoTemplateVariables(
        selectedTemplate.variables ?? [],
        pharmacyContactName,
        pharmacyTradeName,
      ),
    );
  }, [
    open,
    contactType,
    selectedTemplate,
    operacionalInstalacaoTemplate?.meta_template_name,
    pharmacyQuery.data,
    pharmacyContactName,
    pharmacyTradeName,
  ]);

  const startMutation = useMutation({
    mutationFn: async () => {
      const initial_message =
        msgMode === 'template'
          ? { template_id: templateId, template_variables: templateVars }
          : { content: textBody.trim() };

      const base = {
        contact_type: contactType,
        sector_id: sectorId || undefined,
        ...(workspaceChannelId ? { workspace_channel_id: workspaceChannelId } : {}),
        initial_message,
      };

      const body =
        contactType === 'driver'
          ? { ...base, driver_id: driverId }
          : contactType === 'pharmacy'
            ? { ...base, pharmacy_id: pharmacyId }
            : contactType === 'leader'
              ? { ...base, leader_id: leaderId }
              : { ...base, wa_phone: normalizeBrazilPhone(waPhone), display_name: displayName.trim() || undefined };

      const { data } = await api.post<{ id: string }>('/api/conversations/start', body);
      return data;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (data?.id) {
        await queryClient.invalidateQueries({ queryKey: ['conversation', data.id] });
        onCreated(data.id);
      }
      onClose();
    },
    onError: onApiError(setError, 'Nao foi possivel iniciar a conversa.'),
  });

  if (!open) return null;

  const canSubmit =
    (contactType === 'driver' && driverId) ||
    (contactType === 'pharmacy' && pharmacyId) ||
    (contactType === 'leader' && leaderId) ||
    (contactType === 'phone' && normalizeBrazilPhone(waPhone).length >= 12);

  const varsOk =
    msgMode !== 'template' ||
    !selectedTemplateVars.length ||
    selectedTemplateVars.every((v) => (templateVars[v] || '').trim().length > 0);

  const canSend =
    canSubmit &&
    (msgMode === 'template' ? Boolean(templateId) && varsOk : textBody.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Inbox</p>
            <h2 className="text-lg font-semibold text-foreground">Nova conversa</h2>
            <p className="mt-1 text-xs text-muted-foreground">Abre ou reaproveita conversa aberta e envia a primeira mensagem.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground">
            Fechar
          </button>
        </div>

        <div className="grid gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Contato</span>
            <FormSelect
              value={contactType}
              onChange={(v) => {
                setContactType(v as ContactStartType);
                setDriverId('');
                setPharmacyId('');
                setLeaderId('');
              }}
              options={[
                { value: 'driver', label: 'Entregador' },
                { value: 'pharmacy', label: 'Farmacia' },
                { value: 'leader', label: 'Lider' },
                { value: 'phone', label: 'Telefone (livre)' },
              ]}
            />
          </label>

          {contactType === 'driver' ? (
            <CadastroSearchCombobox entity="driver" value={driverId} onChange={setDriverId} />
          ) : null}

          {contactType === 'pharmacy' ? (
            <CadastroSearchCombobox entity="pharmacy" value={pharmacyId} onChange={setPharmacyId} />
          ) : null}

          {contactType === 'leader' ? (
            <CadastroSearchCombobox entity="leader" value={leaderId} onChange={setLeaderId} />
          ) : null}

          {contactType === 'phone' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-muted-foreground">WhatsApp (DDD + número)</span>
                <BrPhoneInput
                  value={waPhone}
                  onChange={setWaPhone}
                  className="mt-0 bg-background font-mono"
                  placeholder="(11) 99999-9999"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-muted-foreground">Nome exibido (opcional)</span>
                <FormControl
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Setor (opcional)</span>
            <FormSearchCombobox
              value={sectorId}
              onChange={setSectorId}
              placeholder="Buscar setor (opcional)…"
              options={[
                { value: '', label: 'Padrao (seu setor ou vazio)' },
                ...sectors.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </label>

          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Primeira mensagem</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMsgMode('template')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${msgMode === 'template' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              >
                Template Meta
              </button>
              <button
                type="button"
                onClick={() => setMsgMode('text')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${msgMode === 'text' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              >
                Texto livre
              </button>
            </div>

            {msgMode === 'template' ? (
              <div className="grid gap-2">
                <FormSearchCombobox
                  value={templateId}
                  onChange={setTemplateId}
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
                    Este template na Meta usa <code>{'{{}}'}</code> (inválido). A Meta espera{' '}
                    <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>… Corrija no Gerenciador da Meta, aprove de novo e
                    sincronize em Configurações → Templates. Enquanto isso, o envio vai sem parâmetros.
                  </div>
                ) : null}
                {selectedTemplateVars.map((v) => (
                  <label key={v} className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-muted-foreground">{`{{${v}}}`}</span>
                    <FormControl
                      value={templateVars[v] || ''}
                      onChange={(e) => setTemplateVars((prev) => ({ ...prev, [v]: e.target.value }))}
                      placeholder={`Valor para {{${v}}}`}
                    />
                  </label>
                ))}
                {selectedTemplate && selectedTemplateVars.length === 0 && !hasInvalidEmptyPlaceholders(selectedTemplate.body || '') ? (
                  <p className="text-[11px] text-muted-foreground">
                    Este template não tem variáveis.
                  </p>
                ) : null}
              </div>
            ) : (
              <textarea
                value={textBody}
                onChange={(e) => setTextBody(e.target.value)}
                rows={3}
                placeholder="Mensagem de texto (requer janela de 24h se Meta estiver ativa)"
                className={formTextareaClassName}
              />
            )}
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!canSend || startMutation.isPending}
              onClick={() => {
                setError(null);
                startMutation.mutate();
              }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {startMutation.isPending ? 'Iniciando...' : 'Iniciar conversa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
