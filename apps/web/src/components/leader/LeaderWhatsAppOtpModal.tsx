'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, MessageCircle, Send } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { BrPhoneInput } from '@/components/form/BrInputs';
import { normalizeBrazilPhone } from '@/lib/brFormat';
import type { LeaderWhatsAppStatus } from './LeaderWhatsAppStatusButton';

function digits(v: string) {
  return v.replace(/\D/g, '');
}

function errMessage(e: unknown) {
  const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
  if (msg) return msg;
  return e instanceof Error ? e.message : 'Falha na verificação.';
}

function Step({ n, label, done, active }: { n: number; label: string; done?: boolean; active?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <div
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold',
          done
            ? 'border-success bg-success/10 text-success'
            : active
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background text-muted-foreground'
        )}
      >
        {done ? <Check className="h-4 w-4" /> : n}
      </div>
      <span className={cn('text-[10px]', active ? 'font-medium text-foreground' : 'text-muted-foreground')}>{label}</span>
    </div>
  );
}

export function LeaderWhatsAppOtpModal({
  open,
  status,
  initialPhone,
  onClose,
  onDone,
}: {
  open: boolean;
  status: LeaderWhatsAppStatus;
  initialPhone?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [phone, setPhone] = useState(initialPhone || '');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'phone' | 'code' | 'connected'>(status === 'verified' ? 'connected' : status === 'pending' ? 'code' : 'phone');
  const [error, setError] = useState<string | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhone(initialPhone || '');
    setCode('');
    setPhase(status === 'verified' ? 'connected' : status === 'pending' ? 'code' : 'phone');
    setError(null);
    setDebugCode(null);
  }, [open, initialPhone, status]);

  const startMut = useMutation({
    mutationFn: async (phone_e164: string) => {
      const { data } = await api.post<{ status: string; phone_e164: string; debug_code?: string }>('/api/leader-portal/whatsapp/otp/start', {
        phone_e164,
      });
      return data;
    },
    onSuccess: (data) => {
      setPhone(data.phone_e164);
      setDebugCode(data.debug_code || null);
      setPhase('code');
      setError(null);
      onDone();
    },
    onError: (e) => setError(errMessage(e)),
  });

  const verifyMut = useMutation({
    mutationFn: async (otp: string) => {
      const { data } = await api.post('/api/leader-portal/whatsapp/otp/verify', { code: otp });
      return data;
    },
    onSuccess: () => {
      setPhase('connected');
      setError(null);
      onDone();
    },
    onError: (e) => setError(errMessage(e)),
  });

  const reconnectMut = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ phone_e164: string; debug_code?: string }>('/api/leader-portal/whatsapp/reconnect', {
        phone_e164: normalizeBrazilPhone(phone || initialPhone || ''),
      });
      return data;
    },
    onSuccess: (data) => {
      setPhone(data.phone_e164);
      setDebugCode(data.debug_code || null);
      setPhase('code');
      setError(null);
      onDone();
    },
    onError: (e) => setError(errMessage(e)),
  });

  if (!open) return null;

  const canSend = digits(phone).length >= 10;
  const busy = startMut.isPending || verifyMut.isPending || reconnectMut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-border bg-surface shadow-glow">
        <div className="p-5">
          <div className="mb-5 flex items-center justify-between">
            <Step n={1} label="Login portal" done />
            <div className="h-px flex-1 bg-border mx-2" />
            <Step n={2} label="Informar número" done={phase !== 'phone'} active={phase === 'phone'} />
            <div className="h-px flex-1 bg-border mx-2" />
            <Step n={3} label="Verificar código" done={phase === 'connected'} active={phase === 'code'} />
            <div className="h-px flex-1 bg-border mx-2" />
            <Step n={4} label="Conectado" done={phase === 'connected'} active={phase === 'connected'} />
          </div>

          <div className="rounded-xl border border-border bg-background p-5 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-channel-whatsapp/10 text-channel-whatsapp">
              <MessageCircle className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold">
              {phase === 'connected' ? 'WhatsApp vinculado' : phase === 'code' ? 'Digite o código' : 'Vincular seu WhatsApp'}
            </h3>
            <p className="mx-auto mt-2 max-w-[300px] text-xs leading-relaxed text-muted-foreground">
              {phase === 'connected'
                ? 'Seu número foi verificado. Você pode usar o chat do portal normalmente.'
                : phase === 'code'
                  ? 'Enviamos um código de confirmação via WhatsApp Business da plataforma.'
                  : 'Informe seu número de WhatsApp. Vamos enviar um código de confirmação.'}
            </p>

            {phase === 'phone' ? (
              <div className="mt-5 text-left">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Seu número de WhatsApp</label>
                <div className="mt-1 flex gap-2">
                  <BrPhoneInput
                    value={phone}
                    onChange={setPhone}
                    placeholder="(11) 99000-0000"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={!canSend || busy}
                  onClick={() => startMut.mutate(normalizeBrazilPhone(phone))}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-success/50 bg-success/10 px-4 py-2 text-xs font-semibold text-success disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" /> Enviar código de verificação
                </button>
              </div>
            ) : null}

            {phase === 'code' ? (
              <div className="mt-5 text-left">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Código recebido</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.35em]"
                />
                {debugCode ? <p className="mt-1 text-center text-[10px] text-muted-foreground">Dev: {debugCode}</p> : null}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={code.length !== 6 || busy}
                    onClick={() => verifyMut.mutate(code)}
                    className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Verificar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => reconnectMut.mutate()}
                    className="rounded-lg border border-border px-4 py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    Reenviar
                  </button>
                </div>
              </div>
            ) : null}

            {phase === 'connected' ? (
              <div className="mt-5 grid gap-2">
                <button type="button" className="button-primary" onClick={onClose}>
                  Continuar
                </button>
                <button type="button" className="button-secondary" disabled={busy} onClick={() => reconnectMut.mutate()}>
                  Reconectar / trocar número
                </button>
              </div>
            ) : null}

            {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
            {phase !== 'connected' ? (
              <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
                Você receberá uma mensagem do número WhatsApp Business da plataforma com o código. Não compartilhe com ninguém.
              </p>
            ) : null}
          </div>
        </div>
        <div className="border-t border-border bg-surface-2 p-3">
          <button type="button" onClick={onClose} className="w-full button-secondary">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
