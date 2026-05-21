'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
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

const inputCls = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs';
const selectCls = inputCls;

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
        <select className={selectCls} value={modo} onChange={(e) => onChange('modo', e.target.value)}>
          <option value="menu">Apresentar menu ao cliente</option>
          <option value="fixo">Setor fixo</option>
        </select>
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
        <select className={selectCls} value={perfil} onChange={(e) => onChange('perfil', e.target.value)}>
          {perfis.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
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
      <select
        className={selectCls}
        value={String(config.variavelCidade ?? 'cidade')}
        onChange={(e) => onChange('variavelCidade', e.target.value)}
      >
        <option value="cidade">cidade</option>
        <option value="endereco_cidade">endereco_cidade</option>
      </select>
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
          <select className={selectCls} value={String(config.filaId ?? '')} onChange={(e) => onChange('filaId', e.target.value)}>
            <option value="">Selecione…</option>
            {setoresOpts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
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
        <select className={selectCls} value={String(config.gestorId ?? '')} onChange={(e) => onChange('gestorId', e.target.value)}>
          <option value="">Selecione…</option>
          {(attendantsQuery.data || []).map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        {attendantsQuery.isError ? (
          <p className="mt-1 text-[10px] text-destructive">Não foi possível carregar responsáveis da API.</p>
        ) : null}
      </Field>
      <Field label="Canal de aviso">
        <select className={selectCls} value={String(config.canal ?? '')} onChange={(e) => onChange('canal', e.target.value)}>
          <option value="email">E-mail</option>
          <option value="painel">Painel</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
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
          <select
            className={selectCls}
            value={String(c.origem ?? '')}
            onChange={(e) => onChange('origem', e.target.value)}
          >
            <option value="telefone">Telefone do contato</option>
            <option value="email">E-mail</option>
            <option value="documento">Documento (CPF/CNPJ)</option>
          </select>
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
            <select className={selectCls} value={String(c.modelo ?? '')} onChange={(e) => onChange('modelo', e.target.value)}>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
            </select>
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
            <select className={selectCls} value={tipo} onChange={(e) => onChange('tipo', e.target.value)}>
              <option value="entregador">Entregador</option>
              <option value="farmacia">Farmácia</option>
            </select>
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
            <select className={selectCls} value={String(c.canal ?? '')} onChange={(e) => onChange('canal', e.target.value)}>
              <option value="painel">Painel do atendente</option>
              <option value="email">E-mail</option>
              <option value="slack">Slack</option>
            </select>
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
            <select
              className={selectCls}
              value={String(c.acaoEstouro ?? '')}
              onChange={(e) => onChange('acaoEstouro', e.target.value)}
            >
              <option value="notificar">Notificar gestor</option>
              <option value="escalar">Escalar atendimento</option>
              <option value="mover">Mover para outra fila</option>
              <option value="mensagem">Enviar mensagem ao cliente</option>
            </select>
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
            <select className={selectCls} value={String(c.escala ?? '')} onChange={(e) => onChange('escala', e.target.value)}>
              <option value="1-5">1 a 5 estrelas</option>
              <option value="0-10">NPS · 0 a 10</option>
              <option value="binario">Bom / Ruim</option>
            </select>
          </Field>
        </div>
      );

    default:
      return null;
  }
}
