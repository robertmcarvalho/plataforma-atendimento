'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { BrPhoneInput } from '@/components/form/BrInputs';
import { formatBrazilPhone, normalizeBrazilPhone } from '@/lib/brFormat';

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

interface DriverHit {
  id: string;
  name: string;
  phone?: string | null;
}

interface PharmacyHit {
  id: string;
  trade_name: string;
  phone?: string | null;
}

interface LeaderHit {
  id: string;
  name: string;
  phone?: string | null;
}

export function NewConversationModal({
  open,
  onClose,
  sectors,
  templates,
  defaultSectorId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  sectors: SectorPickerOption[];
  templates: TemplatePickerOption[];
  defaultSectorId?: string | null;
  onCreated: (conversationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [contactType, setContactType] = useState<ContactStartType>('driver');
  const [sectorId, setSectorId] = useState('');

  const [driverQ, setDriverQ] = useState('');
  const [driverHits, setDriverHits] = useState<DriverHit[]>([]);
  const [driverId, setDriverId] = useState('');

  const [pharmacyQ, setPharmacyQ] = useState('');
  const [pharmacyHits, setPharmacyHits] = useState<PharmacyHit[]>([]);
  const [pharmacyId, setPharmacyId] = useState('');

  const [leaderQ, setLeaderQ] = useState('');
  const [leaderHits, setLeaderHits] = useState<LeaderHit[]>([]);
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

  useEffect(() => {
    if (contactType !== 'driver') {
      setDriverHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      const q = driverQ.trim();
      if (q.length < 2) {
        setDriverHits([]);
        return;
      }
      void (async () => {
        try {
          const { data } = await api.get<DriverHit[]>(`/api/drivers?search=${encodeURIComponent(q)}`);
          setDriverHits(Array.isArray(data) ? data.slice(0, 20) : []);
        } catch {
          setDriverHits([]);
        }
      })();
    }, 320);
    return () => window.clearTimeout(t);
  }, [driverQ, contactType]);

  useEffect(() => {
    if (contactType !== 'pharmacy') {
      setPharmacyHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      const q = pharmacyQ.trim();
      if (q.length < 2) {
        setPharmacyHits([]);
        return;
      }
      void (async () => {
        try {
          const { data } = await api.get<PharmacyHit[]>(`/api/pharmacies?search=${encodeURIComponent(q)}`);
          setPharmacyHits(Array.isArray(data) ? data.slice(0, 20) : []);
        } catch {
          setPharmacyHits([]);
        }
      })();
    }, 320);
    return () => window.clearTimeout(t);
  }, [pharmacyQ, contactType]);

  useEffect(() => {
    if (contactType !== 'leader') {
      setLeaderHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      const q = leaderQ.trim();
      if (q.length < 2) {
        setLeaderHits([]);
        return;
      }
      void (async () => {
        try {
          const { data } = await api.get<LeaderHit[]>(`/api/leaders?search=${encodeURIComponent(q)}`);
          setLeaderHits(Array.isArray(data) ? data.slice(0, 20) : []);
        } catch {
          setLeaderHits([]);
        }
      })();
    }, 320);
    return () => window.clearTimeout(t);
  }, [leaderQ, contactType]);

  const selectedTemplate = templates.find((x) => x.id === templateId);

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

  const startMutation = useMutation({
    mutationFn: async () => {
      const initial_message =
        msgMode === 'template'
          ? { template_id: templateId, template_variables: templateVars }
          : { content: textBody.trim() };

      const base = {
        contact_type: contactType,
        sector_id: sectorId || undefined,
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
    onError: (e: unknown) => {
      const ax = e as { response?: { data?: { error?: string } }; message?: string };
      const msg = ax.response?.data?.error || ax.message;
      setError(typeof msg === 'string' ? msg : 'Nao foi possivel iniciar a conversa.');
    },
  });

  if (!open) return null;

  const canSubmit =
    (contactType === 'driver' && driverId) ||
    (contactType === 'pharmacy' && pharmacyId) ||
    (contactType === 'leader' && leaderId) ||
    (contactType === 'phone' && normalizeBrazilPhone(waPhone).length >= 12);

  const varsOk =
    msgMode !== 'template' ||
    !selectedTemplate?.variables?.length ||
    selectedTemplate.variables.every((v) => (templateVars[v] || '').trim().length > 0);

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
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
            Fechar
          </button>
        </div>

        <div className="grid gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Contato</span>
            <select
              value={contactType}
              onChange={(e) => {
                setContactType(e.target.value as ContactStartType);
                setDriverId('');
                setPharmacyId('');
                setLeaderId('');
              }}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
            >
              <option value="driver">Entregador</option>
              <option value="pharmacy">Farmacia</option>
              <option value="leader">Lider</option>
              <option value="phone">Telefone (livre)</option>
            </select>
          </label>

          {contactType === 'driver' ? (
            <div className="grid gap-2">
              <input
                value={driverQ}
                onChange={(e) => setDriverQ(e.target.value)}
                placeholder="Buscar por nome, CPF ou telefone..."
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
              />
              <select
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="">Selecione o entregador</option>
                {driverHits.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} {d.phone ? `· ${formatBrazilPhone(d.phone) || d.phone}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {contactType === 'pharmacy' ? (
            <div className="grid gap-2">
              <input
                value={pharmacyQ}
                onChange={(e) => setPharmacyQ(e.target.value)}
                placeholder="Buscar farmacia..."
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
              />
              <select
                value={pharmacyId}
                onChange={(e) => setPharmacyId(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="">Selecione a farmacia</option>
                {pharmacyHits.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.trade_name} {p.phone ? `· ${formatBrazilPhone(p.phone) || p.phone}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {contactType === 'leader' ? (
            <div className="grid gap-2">
              <input
                value={leaderQ}
                onChange={(e) => setLeaderQ(e.target.value)}
                placeholder="Buscar lider..."
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
              />
              <select
                value={leaderId}
                onChange={(e) => setLeaderId(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="">Selecione o lider</option>
                {leaderHits.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.phone ? `· ${formatBrazilPhone(l.phone) || l.phone}` : ''}
                  </option>
                ))}
              </select>
            </div>
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
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
                />
              </label>
            </div>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Setor (opcional)</span>
            <select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
            >
              <option value="">Padrao (seu setor ou vazio)</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
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
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
                >
                  <option value="">Selecione o template aprovado</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                      {!tpl.meta_template_name ? ' (sem nome Meta)' : ''}
                    </option>
                  ))}
                </select>
                {selectedTemplate?.variables?.map((v) => (
                  <label key={v} className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-muted-foreground">{`{{${v}}}`}</span>
                    <input
                      value={templateVars[v] || ''}
                      onChange={(e) => setTemplateVars((prev) => ({ ...prev, [v]: e.target.value }))}
                      className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
                    />
                  </label>
                ))}
              </div>
            ) : (
              <textarea
                value={textBody}
                onChange={(e) => setTextBody(e.target.value)}
                rows={3}
                placeholder="Mensagem de texto (requer janela de 24h se Meta estiver ativa)"
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
              />
            )}
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted">
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
