'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formControlCompactClassName } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { cn } from '@/lib/utils';
import type { Bloco } from '@/lib/conversation-flow/fluxo';
import {
  useDemandsFromMessagingWebhooks,
  useSectorsFromMessagingWebhooks,
} from '@/lib/integrations/useSectorsFromMessagingWebhooks';

type Perfil = 'entregador' | 'farmacia' | 'lider';

const perfis: { id: Perfil; nome: string }[] = [
  { id: 'entregador', nome: 'Entregador' },
  { id: 'farmacia', nome: 'Farmácia' },
  { id: 'lider', nome: 'Líder' },
];

const perfisFarmacia = ['Gestor', 'Expedição', 'Financeiro'];

interface Props {
  bloco: Bloco;
  onChange: (key: string, value: unknown) => void;
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-1">
    <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">{label}</label>
    {children}
  </div>
);

const inputCls = cn(formControlCompactClassName, 'w-full');

function SelecionarSetorConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const { data: setoresOpts = [], isLoading, isError, error } = useSectorsFromMessagingWebhooks(true);
  const setoresIds = Array.isArray(config.setoresIds) ? (config.setoresIds as string[]) : [];
  const modo = String(config.modo ?? 'menu');
  return (
    <div className="space-y-3">
      <Field label="Modo de seleção">
        <FormSelect
          size="sm"
          value={modo}
          onChange={(v) => onChange('modo', v)}
          options={[
            { value: 'menu', label: 'Apresentar menu ao cliente' },
            { value: 'fixo', label: 'Setor fixo' },
          ]}
        />
      </Field>
      <Field label="Setores disponíveis">
        {isLoading ? (
          <p className="text-[11px] text-muted-foreground">
            Carregando setores das filas (WhatsApp, Instagram, e-mail)…
          </p>
        ) : isError ? (
          <p className="text-[11px] text-destructive">
            {error instanceof Error ? error.message : 'Não foi possível carregar os setores.'}
          </p>
        ) : setoresOpts.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Nenhum setor vinculado às filas dos webhooks. Configure filas em Configurações → Canais.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {setoresOpts.map((s) => {
              const sel = setoresIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    onChange(
                      'setoresIds',
                      sel ? setoresIds.filter((x) => x !== s.id) : [...setoresIds, s.id]
                    );
                  }}
                  className={
                    'rounded-full border px-2 py-0.5 text-[11px] transition-colors ' +
                    (sel
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border text-muted-foreground hover:border-border-strong')
                  }
                >
                  {s.nome}
                </button>
              );
            })}
          </div>
        )}
      </Field>
    </div>
  );
}

function SelecionarDemandaConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const { data: demandasOpts = [], isLoading, isError, error } = useDemandsFromMessagingWebhooks(true);
  const perfil = (config.perfil as Perfil) || 'entregador';
  const demandas = Array.isArray(config.demandas) ? (config.demandas as string[]) : [];
  const setorIds = Array.isArray(config.setorIds)
    ? (config.setorIds as string[])
    : Array.isArray(config.setoresIds)
      ? (config.setoresIds as string[])
      : [];
  const filtered = setorIds.length
    ? demandasOpts.filter((d) => d.sector_ids.some((sid) => setorIds.includes(sid)))
    : demandasOpts;

  return (
    <div className="space-y-3">
      <Field label="Perfil de origem">
        <FormSelect
          size="sm"
          value={perfil}
          onChange={(v) => onChange('perfil', v)}
          options={perfis.map((p) => ({ value: p.id, label: p.nome }))}
        />
      </Field>
      <Field label={`Demandas do webhook (${filtered.length} ativas)`}>
        {isLoading ? (
          <p className="text-[11px] text-muted-foreground">Carregando demandas configuradas nos webhooks…</p>
        ) : isError ? (
          <p className="text-[11px] text-destructive">
            {error instanceof Error ? error.message : 'Não foi possível carregar as demandas.'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Nenhuma demanda ativa para estes setores. Configure em Configurações → Canais → webhook.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {filtered.map((d) => {
              const sel = demandas.includes(d.id) || demandas.includes(d.title);
              return (
                <button
                  key={`${d.channel_id}:${d.id}`}
                  type="button"
                  title={d.channel_label}
                  onClick={() => {
                    onChange('demandas', sel ? demandas.filter((x) => x !== d.id && x !== d.title) : [...demandas, d.id]);
                  }}
                  className={
                    'rounded-full border px-2 py-0.5 text-[11px] transition-colors ' +
                    (sel
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border text-muted-foreground hover:border-border-strong')
                  }
                >
                  {d.title}
                </button>
              );
            })}
          </div>
        )}
      </Field>
    </div>
  );
}

function MenuFarmaciasConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const pharmaciesQuery = useQuery({
    queryKey: ['conversation-flow-pharmacies-cities'],
    queryFn: async () => {
      const { data } = await api.get<Array<{ city?: string | null }>>('/api/pharmacies');
      return Array.from(new Set((data || []).map((p) => String(p.city || '').trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'pt-BR')
      );
    },
    staleTime: 60_000,
  });

  return (
    <Field label="Variável que contém a cidade">
      <FormSelect
        size="sm"
        value={String(config.variavelCidade ?? 'cidade')}
        onChange={(v) => onChange('variavelCidade', v)}
        options={[
          { value: 'cidade', label: 'cidade' },
          { value: 'endereco_cidade', label: 'endereco_cidade' },
        ]}
      />
      <p className="mt-1 text-[10px] text-muted-foreground">
        {pharmaciesQuery.isLoading
          ? 'Carregando cidades das farmácias cadastradas…'
          : pharmaciesQuery.data?.length
            ? `Cidades com farmácias cadastradas: ${pharmaciesQuery.data.join(', ')}.`
            : 'Nenhuma cidade de farmácia retornada pela API.'}
      </p>
    </Field>
  );
}

function AtribuirFilaConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const dinamica = Boolean(config.dinamica);
  const { data: setoresOpts = [], isLoading, isError } = useSectorsFromMessagingWebhooks(!dinamica);
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={dinamica} onChange={(e) => onChange('dinamica', e.target.checked)} />
        Fila dinâmica (resolve a partir do setor escolhido)
      </label>
      {!dinamica ? (
        <Field label="Fila operacional">
          <FormSelect
            size="sm"
            value={String(config.filaId ?? '')}
            onChange={(v) => onChange('filaId', v)}
            placeholder="Selecione…"
            options={[
              { value: '', label: 'Selecione…' },
              ...setoresOpts.map((s) => ({ value: s.id, label: s.nome })),
            ]}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {isLoading
              ? 'Carregando filas dos webhooks…'
              : isError
                ? 'Não foi possível carregar as filas dos webhooks.'
                : 'Opções vindas dos setores vinculados aos webhooks.'}
          </p>
        </Field>
      ) : null}
    </div>
  );
}

function EscalarGestorConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const attendantsQuery = useQuery({
    queryKey: ['conversation-flow-attendants'],
    queryFn: async () => (await api.get<Array<{ id: string; name: string }>>('/api/users/attendants')).data,
    staleTime: 60_000,
  });

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Responsável">
        <FormSelect
          size="sm"
          value={String(config.gestorId ?? '')}
          onChange={(v) => onChange('gestorId', v)}
          placeholder="Selecione…"
          options={[
            { value: '', label: 'Selecione…' },
            ...(attendantsQuery.data || []).map((user) => ({ value: user.id, label: user.name })),
          ]}
        />
        {attendantsQuery.isError ? (
          <p className="mt-1 text-[10px] text-destructive">Não foi possível carregar responsáveis da API.</p>
        ) : null}
      </Field>
      <Field label="Canal de aviso">
        <FormSelect
          size="sm"
          value={String(config.canal ?? '')}
          onChange={(v) => onChange('canal', v)}
          options={[
            { value: 'email', label: 'E-mail' },
            { value: 'painel', label: 'Painel' },
            { value: 'whatsapp', label: 'WhatsApp' },
          ]}
        />
      </Field>
    </div>
  );
}

export function BlocoConfig({ bloco, onChange }: Props) {
  const c = bloco.config;

  switch (bloco.tipo) {
    case 'identificar':
      return (
        <Field label="Origem da identificação">
          <FormSelect
            size="sm"
            value={String(c.origem ?? '')}
            onChange={(v) => onChange('origem', v)}
            options={[
              { value: 'telefone', label: 'Telefone do contato' },
              { value: 'email', label: 'E-mail' },
              { value: 'documento', label: 'Documento (CPF/CNPJ)' },
            ]}
          />
        </Field>
      );

    case 'escolha-perfil':
      return (
        <div className="space-y-3">
          <Field label="Título do menu">
            <input className={inputCls} value={String(c.titulo ?? '')} onChange={(e) => onChange('titulo', e.target.value)} />
          </Field>
          <Field label="Instrução ao cliente">
            <input className={inputCls} value={String(c.instrucao ?? '')} onChange={(e) => onChange('instrucao', e.target.value)} />
          </Field>
          <p className="text-[10px] text-muted-foreground">
            Ramos fixos: Entregador, Farmácia, Líder e Não entendi — cada um com a sua sub-árvore no editor.
          </p>
        </div>
      );

    case 'selecionar-setor':
      return <SelecionarSetorConfig config={c} onChange={onChange} />;

    case 'selecionar-demanda':
      return <SelecionarDemandaConfig config={c} onChange={onChange} />;

    case 'pergunta':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pergunta exibida">
            <input className={inputCls} value={String(c.rotulo ?? '')} onChange={(e) => onChange('rotulo', e.target.value)} />
          </Field>
          <Field label="Variável de saída">
            <input
              className={inputCls}
              value={String(c.variavel ?? '')}
              onChange={(e) => onChange('variavel', e.target.value)}
            />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={Boolean(c.obrigatorio)}
              onChange={(e) => onChange('obrigatorio', e.target.checked)}
            />
            Resposta obrigatória
          </label>
        </div>
      );

    case 'menu-farmacias':
      return <MenuFarmaciasConfig config={c} onChange={onChange} />;

    case 'enviar-mensagem':
      return (
        <div className="space-y-3">
          <Field label="Mensagem">
            <textarea
              rows={3}
              className={inputCls + ' resize-none'}
              value={String(c.texto ?? '')}
              onChange={(e) => onChange('texto', e.target.value)}
            />
          </Field>
          <Field label="Aguardar antes de enviar (segundos)">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={Number(c.delaySeg ?? 0)}
              onChange={(e) => onChange('delaySeg', Number(e.target.value))}
            />
          </Field>
        </div>
      );

    case 'script-bot': {
      const mensagens = Array.isArray(c.mensagens) ? (c.mensagens as string[]) : [];
      return (
        <Field label="Mensagens (uma por linha)">
          <textarea
            rows={4}
            className={inputCls + ' resize-none'}
            value={mensagens.join('\n')}
            onChange={(e) => onChange('mensagens', e.target.value.split('\n'))}
          />
        </Field>
      );
    }

    case 'ia-resposta':
      return (
        <div className="space-y-3">
          <Field label="Modelo">
            <FormSelect
              size="sm"
              value={String(c.modelo ?? '')}
              onChange={(v) => onChange('modelo', v)}
              options={[
                { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
                { value: 'gpt-4o', label: 'gpt-4o' },
                { value: 'claude-3-5-sonnet', label: 'claude-3-5-sonnet' },
              ]}
            />
          </Field>
          <Field label="Instruções">
            <textarea
              rows={3}
              className={inputCls + ' resize-none'}
              value={String(c.instrucoes ?? '')}
              onChange={(e) => onChange('instrucoes', e.target.value)}
            />
          </Field>
        </div>
      );

    case 'criar-precadastro': {
      const tipo = String(c.tipo ?? 'entregador');
      return (
        <div className="space-y-3">
          <Field label="Tipo de cadastro">
            <FormSelect
              size="sm"
              value={tipo}
              onChange={(v) => onChange('tipo', v)}
              options={[
                { value: 'entregador', label: 'Entregador' },
                { value: 'farmacia', label: 'Farmácia' },
              ]}
            />
          </Field>
          {tipo === 'farmacia' ? (
            <Field label="Perfis aceitos na farmácia">
              <div className="text-[11px] text-muted-foreground">{perfisFarmacia.join(' · ')}</div>
            </Field>
          ) : null}
          <Field label="Campos extras (separados por vírgula)">
            <input
              className={inputCls}
              value={String(c.camposExtras ?? '')}
              onChange={(e) => onChange('camposExtras', e.target.value)}
              placeholder="ex.: cnh, placa, banco"
            />
          </Field>
        </div>
      );
    }

    case 'aplicar-tag':
      return (
        <Field label="Tag">
          <input className={inputCls} value={String(c.tag ?? '')} onChange={(e) => onChange('tag', e.target.value)} />
        </Field>
      );

    case 'notificar-atendente':
      return (
        <div className="space-y-3">
          <Field label="Canal de notificação">
            <FormSelect
              size="sm"
              value={String(c.canal ?? '')}
              onChange={(v) => onChange('canal', v)}
              options={[
                { value: 'painel', label: 'Painel do atendente' },
                { value: 'email', label: 'E-mail' },
                { value: 'slack', label: 'Slack' },
              ]}
            />
          </Field>
          <Field label="Mensagem">
            <input className={inputCls} value={String(c.mensagem ?? '')} onChange={(e) => onChange('mensagem', e.target.value)} />
          </Field>
        </div>
      );

    case 'atribuir-fila': {
      return <AtribuirFilaConfig config={c} onChange={onChange} />;
    }

    case 'sla-etapa':
    case 'sla-fila':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tempo limite (minutos)">
            <input
              type="number"
              min={1}
              className={inputCls}
              value={Number(c.tempoMin ?? 0)}
              onChange={(e) => onChange('tempoMin', Number(e.target.value))}
            />
          </Field>
          <Field label="Ação ao estourar">
            <FormSelect
              size="sm"
              value={String(c.acaoEstouro ?? '')}
              onChange={(v) => onChange('acaoEstouro', v)}
              options={[
                { value: 'notificar', label: 'Notificar gestor' },
                { value: 'escalar', label: 'Escalar atendimento' },
                { value: 'mover', label: 'Mover para outra fila' },
                { value: 'mensagem', label: 'Enviar mensagem ao cliente' },
              ]}
            />
          </Field>
        </div>
      );

    case 'escalar-gestor':
      return <EscalarGestorConfig config={c} onChange={onChange} />;

    case 'csat':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pergunta">
            <input className={inputCls} value={String(c.pergunta ?? '')} onChange={(e) => onChange('pergunta', e.target.value)} />
          </Field>
          <Field label="Escala">
            <FormSelect
              size="sm"
              value={String(c.escala ?? '')}
              onChange={(v) => onChange('escala', v)}
              options={[
                { value: '1-5', label: '1 a 5 estrelas' },
                { value: '0-10', label: 'NPS · 0 a 10' },
                { value: 'binario', label: 'Bom / Ruim' },
              ]}
            />
          </Field>
        </div>
      );

    default:
      return null;
  }
}
