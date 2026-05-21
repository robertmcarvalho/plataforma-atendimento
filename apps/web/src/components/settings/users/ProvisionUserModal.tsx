'use client';

import { useQuery } from '@tanstack/react-query';
import { Crown, Headphones, Mail, Shield, UserCog, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { listChannels, parseChannelOperationalConfig } from '@/lib/integrations/channelsApi';
import {
  listRoles,
  provisionUser,
  saveChannelAssignments,
  type ChannelAssignmentRow,
  type RoleRecord,
} from '@/lib/users/usersApi';
import { FilasSetoresPicker } from '@/components/settings/users/FilasSetoresPicker';
import api from '@/lib/api';
import { BrPhoneInput } from '@/components/form/BrInputs';
import { formatBrazilPhone, normalizeBrazilPhone } from '@/lib/brFormat';

type RoleKey = 'admin' | 'supervisor' | 'attendant' | 'leader';

const ROLE_UI: Record<RoleKey, { label: string; color: string; icon: typeof Shield }> = {
  admin: { label: 'Administrador', color: 'bg-destructive/15 text-destructive', icon: Shield },
  supervisor: { label: 'Gestor', color: 'bg-primary/15 text-primary', icon: UserCog },
  attendant: { label: 'Atendente', color: 'bg-success/15 text-success', icon: Headphones },
  leader: { label: 'Líder', color: 'bg-warning/15 text-warning', icon: Crown },
};

type Sector = { id: string; name: string };
type LeaderRow = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  user_id?: string | null;
  leader_pharmacy_links?: Array<{ pharmacies?: { trade_name?: string } | null }>;
};

function buildChannelRows(channels: Awaited<ReturnType<typeof listChannels>>): ChannelAssignmentRow[] {
  return channels
    .filter((c) => c.channel_type === 'whatsapp')
    .map((c) => ({
      workspace_channel_id: c.id,
      display_name: c.display_name,
      channel_type: c.channel_type,
      enabled: false,
      sector_ids: [],
    }));
}

function sectorsFromWhatsAppWebhooks(channels: Awaited<ReturnType<typeof listChannels>>): Sector[] {
  const map = new Map<string, Sector>();
  for (const channel of channels.filter((c) => c.channel_type === 'whatsapp')) {
    const operational = parseChannelOperationalConfig(channel.config);
    for (const sector of operational.sectors.filter((s) => s.is_active !== false)) {
      map.set(sector.id, { id: sector.id, name: sector.name });
    }
    for (const queue of operational.queues) {
      for (const sectorId of queue.sector_ids) {
        if (!map.has(sectorId)) map.set(sectorId, { id: sectorId, name: sectorId });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function ProvisionUserModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const { data: userSectors = [] } = useQuery({
    queryKey: ['sectors'],
    queryFn: async () => (await api.get<Sector[]>('/api/sectors')).data || [],
  });
  const { data: leaders = [] } = useQuery({
    queryKey: ['leaders-unlinked'],
    queryFn: async () => {
      const rows = (await api.get<LeaderRow[]>('/api/leaders')).data || [];
      return rows.filter((l) => !l.user_id);
    },
  });
  const { data: channelData = [] } = useQuery({
    queryKey: ['integrations', 'channels'],
    queryFn: listChannels,
  });
  const waChannels = useMemo(() => buildChannelRows(channelData), [channelData]);
  const webhookSectors = useMemo(() => sectorsFromWhatsAppWebhooks(channelData), [channelData]);

  const [roleKey, setRoleKey] = useState<RoleKey>('attendant');
  const [leaderId, setLeaderId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [sectorIds, setSectorIds] = useState<string[]>([]);
  const [channelAssignments, setChannelAssignments] = useState<ChannelAssignmentRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ username: string; password?: string; emailSent: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedLeader = useMemo(() => leaders.find((l) => l.id === leaderId), [leaders, leaderId]);

  useEffect(() => {
    if (waChannels.length) setChannelAssignments(waChannels);
  }, [waChannels]);

  const roleId = useMemo(() => {
    const r = roles.find((x) => x.name === roleKey);
    return r?.id || '';
  }, [roles, roleKey]);

  const toggleSector = (id: string) => {
    setSectorIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async () => {
    const finalName = roleKey === 'leader' && selectedLeader ? selectedLeader.name : name.trim();
    const finalEmail = roleKey === 'leader' && selectedLeader?.email ? selectedLeader.email : email.trim();
    const finalPhone =
      roleKey === 'leader' && selectedLeader?.phone ? normalizeBrazilPhone(String(selectedLeader.phone)) : normalizeBrazilPhone(phone) || undefined;

    if (!finalName || !finalEmail || !roleId) {
      setError(roleKey === 'leader' && !selectedLeader ? 'Selecione um líder cadastrado ou preencha os dados.' : 'Preencha nome, e-mail e perfil.');
      return;
    }
    if (roleKey === 'leader' && !leaderId) {
      setError('Selecione um líder pré-cadastrado.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await provisionUser({
        name: finalName,
        email: finalEmail,
        phone: finalPhone,
        role_id: roleId,
        sector_ids: sectorIds.length ? sectorIds : undefined,
        primary_sector_id: sectorIds[0],
        leader_id: roleKey === 'leader' && leaderId ? leaderId : undefined,
        send_email: true,
      });

      if ((roleKey === 'attendant' || roleKey === 'supervisor') && channelAssignments.some((c) => c.enabled)) {
        await saveChannelAssignments(
          res.user.id,
          channelAssignments.map((c) => ({
            workspace_channel_id: c.workspace_channel_id,
            enabled: c.enabled,
            sector_ids: c.sector_ids,
          }))
        );
      }

      setResult({
        username: res.username,
        password: res.temporary_password,
        emailSent: res.email_sent,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao provisionar usuário');
    } finally {
      setSaving(false);
    }
  };

  const leaderTeamLabel = selectedLeader?.leader_pharmacy_links?.length
    ? `${selectedLeader.leader_pharmacy_links.length} farmácia(s)`
  : '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-surface shadow-xl"
      >
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold">Novo usuário</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Login e senha são gerados automaticamente e enviados por e-mail.
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-5 p-6">
          {result ? (
            <div className="rounded-md border border-success/30 bg-success/10 p-4 text-sm">
              <p className="font-medium text-success">Usuário criado</p>
              <p className="mt-2 font-mono text-xs">
                Usuário: <strong>{result.username}</strong>
              </p>
              {result.password ? (
                <p className="mt-1 font-mono text-xs">
                  Senha temporária: <strong>{result.password}</strong>
                </p>
              ) : null}
              <p className="mt-2 text-[11px] text-muted-foreground">
                {result.emailSent
                  ? 'E-mail de acesso enviado. A senha temporária não é exibida pela API em produção.'
                  : result.password
                    ? 'E-mail não enviado — copie as credenciais acima.'
                    : 'E-mail não enviado. Reenvie o convite após configurar o serviço de e-mail.'}
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Perfil</label>
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {(Object.keys(ROLE_UI) as RoleKey[]).map((key) => {
                    const m = ROLE_UI[key];
                    const Icon = m.icon;
                    const disabled = !roles.some((r: RoleRecord) => r.name === key);
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={disabled}
                        onClick={() => setRoleKey(key)}
                        className={cn(
                          'flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs transition-colors disabled:opacity-40',
                          roleKey === key ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-elevated'
                        )}
                      >
                        <Icon className="h-4 w-4" /> {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {roleKey === 'leader' && (
                <div className="rounded-md border border-warning/30 bg-warning/5 p-4">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-warning">
                    Selecionar líder cadastrado
                  </label>
                  <select
                    value={leaderId}
                    onChange={(e) => setLeaderId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm"
                  >
                    <option value="">— escolher líder —</option>
                    {leaders.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} {l.phone ? `· ${formatBrazilPhone(l.phone) || l.phone}` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedLeader ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 rounded-md bg-background/40 p-3 md:grid-cols-2">
                      <Field label="Nome" value={selectedLeader.name} readOnly />
                      <Field label="Telefone" value={formatBrazilPhone(selectedLeader.phone || '') || '—'} readOnly />
                      <Field label="E-mail" value={selectedLeader.email || '—'} readOnly />
                      <Field label="Equipe" value={leaderTeamLabel} readOnly />
                    </div>
                  ) : null}
                </div>
              )}

              {roleKey !== 'leader' && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Nome completo" value={name} onChange={setName} placeholder="Ex.: Maria Silva" />
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Telefone</label>
                    <BrPhoneInput value={phone} onChange={setPhone} placeholder="(11) 98765-4321" />
                  </div>
                  <div className="md:col-span-2">
                    <Field label="E-mail" value={email} onChange={setEmail} placeholder="maria@empresa.com" />
                  </div>
                </div>
              )}

              {roleKey === 'admin' && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-1.5 text-destructive">
                    <Shield className="h-3.5 w-3.5" /> <span className="font-medium">Acesso administrativo total</span>
                  </div>
                  <p className="mt-1">
                    Administradores não realizam atendimento. Têm visão global de todos os tickets, conversas, filas e setores da plataforma.
                  </p>
                </div>
              )}

              {roleKey === 'leader' && (
                <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-1.5 text-warning">
                    <Crown className="h-3.5 w-3.5" /> <span className="font-medium">Usuário do Portal do Líder</span>
                  </div>
                  <p className="mt-1">
                    Líderes não atuam em filas de atendimento. Este cadastro gera o acesso ao Portal do Líder para gestão de equipe e escalas.
                  </p>
                </div>
              )}

              {(roleKey === 'attendant' || roleKey === 'supervisor') && (
                <>
                  <FilasSetoresPicker
                    channels={waChannels}
                    sectors={webhookSectors}
                    value={channelAssignments}
                    onChange={setChannelAssignments}
                    perfil={roleKey === 'supervisor' ? 'supervisor' : 'attendant'}
                  />
                  {userSectors.length > 0 && (
                    <div>
                      <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
                        Setores do usuário (opcional)
                      </label>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {userSectors.map((s) => {
                          const on = sectorIds.includes(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => toggleSector(s.id)}
                              className={cn(
                                'rounded-md border px-2 py-1 text-[10px]',
                                on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                              )}
                            >
                              {on && '✓ '}
                              {s.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1.5 text-primary">
                  <Mail className="h-3.5 w-3.5" /> <span className="font-medium">Credenciais automáticas</span>
                </div>
                <p className="mt-1">Ao salvar, geramos usuário + senha temporária e enviamos ao e-mail cadastrado.</p>
              </div>

              {error ? <p className="text-xs text-destructive">{error}</p> : null}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface-hover">
            {result ? 'Fechar' : 'Cancelar'}
          </button>
          {!result ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? 'Criando…' : 'Criar e enviar acesso'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">{label}</label>
      <input
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={readOnly ? undefined : (e) => onChange?.(e.target.value)}
        className={cn(
          'mt-1 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-primary/60',
          readOnly ? 'bg-muted/30' : 'bg-background/40'
        )}
      />
    </div>
  );
}
