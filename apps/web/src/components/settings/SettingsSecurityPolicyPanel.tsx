'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

type MfaPolicy = {
  enrollment_in_app: boolean;
  summary: string;
  docs: string[];
  roles_editing: { json_editor_enabled: boolean; note: string };
};

export function SettingsSecurityPolicyPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['auth-mfa-policy'],
    queryFn: async () => (await api.get<MfaPolicy>('/api/auth/mfa-policy')).data,
    staleTime: 300_000,
  });

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-surface p-6">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Autenticação em dois fatores (2FA)</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          {isLoading ? 'A carregar política…' : data?.summary}
        </p>
        {!isLoading && data?.enrollment_in_app === false ? (
          <p className="mt-2 text-[11px] text-subtle-foreground">
            Ativação de MFA nesta aplicação está desligada por política. Use o Supabase Dashboard ou os links oficiais
            abaixo para planear o rollout antes de expor controlos aqui.
          </p>
        ) : null}
        {data?.docs?.length ? (
          <ul className="mt-3 list-inside list-disc space-y-1 text-[11px] text-primary">
            {data.docs.map((href) => (
              <li key={href}>
                <a href={href} target="_blank" rel="noreferrer" className="underline">
                  {href}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Sessões e auditoria</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          Revogação de sessões continua centralizada no Supabase Auth. As alterações sensíveis (definições, tokens de
          API, perfis) são registadas na secção <span className="font-semibold">Auditoria</span> em Operação.
        </p>
      </div>

      {!isLoading && data?.roles_editing?.note ? (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground">Perfis (roles): </span>
          {data.roles_editing.note}
        </div>
      ) : null}
    </div>
  );
}
