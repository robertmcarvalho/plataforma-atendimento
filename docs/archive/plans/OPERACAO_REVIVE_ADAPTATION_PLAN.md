# Operação — Plano de UI Revive por perfil (Aethera)

Referência visual: `project-revive-main/src/pages/Operacao.tsx` + `operacaoMock.ts`.  
Objetivo: **mesmo estilo de cards** (acompanhamento, tarefas, farmácias, alertas, compliance, assinaturas) em **todos** os perfis de `/operacao`, com dados reais e escopos distintos.

**Não portar:** rota/login app, status entregador em rota/disponível/offline, mapa, volume/hora logístico, `pedidosPendentes` sem fonte real, envio Autentique na UI do AG.

---

## 1. Camada visual compartilhada (`apps/web/src/components/operacao/revive/`)

Extrair do Revive **uma vez** e reutilizar em todos os perfis. Tokens já existentes (`bg-surface`, `border-border`, `font-mono`, `gradient-primary`).

### 1.1 Primitivos (design system global)

**`IconTile` e primitivos compartilhados** ficam em `apps/web/src/components/ui/` (rollout para comercial, financeiro, cadastros, settings, líder, inbox). Cards específicos de Operação em `components/operacao/revive/`.

| Arquivo | Origem Revive | Uso |
|---------|---------------|-----|
| `ui/IconTile.tsx` | `IconTile` (L49–71) | Títulos de seção, cards, ações rápidas (global) |
| `ui/SectionHeader.tsx` | padrão `h2` + IconTile | Seções em todo o projeto |
| `ui/FilterChips.tsx` | chips período/tipo | Filtros Revive |
| `ui/AvatarInitials.tsx` | círculo gradient + iniciais | Pessoas |
| `ui/ComplianceBadge.tsx` | Sim/Não compliance | Tabelas |
| `ui/EmptyState.tsx` | `border-dashed` | Listas vazias |
| `ui/PageHeader.tsx` (`variant="revive"`) | header live + ícone | Operação primeiro; demais áreas em ondas |
| `ui/KpiCard.tsx` (`variant="revive"`) | KPI spark + delta | Hubs Operação e rollout |
| `ui/Sparkline.tsx` | `Spark` SVG (L74–84) | KPIs via `KpiCard` |
| `OperacaoReviveLayout.tsx` | período Hoje/7d/30d + refresh | Shell Operação |

### 1.2 Cards (mesmo markup/classes do Revive)

| Componente | Classes Revive | Props principais |
|------------|----------------|------------------|
| `OperacaoKpiReviveCard` | `rounded-xl border bg-surface p-4` + spark + delta | `label`, `value`, `spark[]`, `delta`, `deltaTone`, `alert` |
| `OperacaoPharmacyReviveCard` | grid farmácia L257–301 | `trade_name`, `leader`, `sla_percent`, `drivers_active/total`, `open_conversations`, `pending_financial`, `href` |
| `OperacaoAlertReviveCard` | item alerta L323–336 | `tipo`, `nivel`, `descricao`, `farmacia`, `timestamp`, `href` |
| `OperacaoSignaturePendingCard` | notificação assinatura L362–393 | `driver`, `pharmacy`, `tipo`, `days_pending`, `deadline_days` |
| `OperacaoTaskReviveCard` | tarefa L531–589 | checklist %, SLA %, status pill, atendente, prazo, `signature_status` read-only (**implementado** — ver `docs/AUTENTIQUE_SIGNATURE_SYNC.md`) |
| `OperacaoComplianceStatCard` | mini-KPI compliance L436–452 | cert/MEI/matrícula agregado |
| `OperacaoAttendanceReviveCard` | **novo** (mesmo shell que tarefa, sem checklist) | contato, farmácia, SLA inbox, prioridade, link inbox |
| `OperacaoQuickActionCard` | ações rápidas L411–417 | ícone + label + href (analista: lançar ocorrência, inbox, farmácias) |

### 1.3 Layout shell

| Componente | Função |
|------------|--------|
| `OperacaoReviveLayout` | `max-w-7xl`, padding, `PageHeader` live + período + refresh |
| `OperacaoReviveTwoColumn` | `lg:grid-cols-3` — conteúdo 2/3 + aside alertas 1/3 (analista) |
| `OperacaoReviveTaskGrid` | `grid md:grid-cols-2 gap-3` para tarefas |

**Substituir** gradualmente: `OperacaoTaskCard` → `OperacaoTaskReviveCard`; KPIs inline → `OperacaoKpiReviveCard`; abas genéricas → seções scroll no estilo Revive (abas só onde fizer sentido no mobile).

---

## 2. Composição por perfil (o que cada um vê)

### 2.1 Analista operacional — `OperacaoCarteiraPage` (carteira)

**Título Revive:** “Painel Operacional” / “Farmácias sob sua responsabilidade”.

| Seção Revive | Implementar | Fonte de dados |
|--------------|-------------|----------------|
| PageHeader + período + refresh | Sim | hub + `period` query |
| Context bar | Sim — breadcrumb `{N} farmácias` | `summary.totals.pharmacies` |
| **6 KPIs** com spark | Sim | Estender `portfolio/hub` → `kpis[]` |
| **Farmácias sob responsabilidade** (cards 2 col) | Sim — substituir tabela | `pharmacy_cards[]` |
| **Alertas operacionais** (aside) | Sim — `OperacaoAlertReviveCard` | `notifications` + alertas derivados |
| **Pendências de assinatura** (aside) | Sim — status externo only | `signature_pending[]` |
| **Ações rápidas** | Sim — links Aethera | ocorrência, inbox, `/pharmacies` |
| **Compliance documental** | Sim — 3 stat cards + tabela | `compliance[]` drivers da carteira |
| **Tarefas** (cards estilo Revive, escopo carteira) | Sim — não “Fila AG” no título | `tasks[]` do hub |
| **Nova tarefa** (modal) | Sim — incl. desligamento operacional | `POST /api/ops/tasks` |
| **Atendimentos** (cards, não só tabela) | Sim — `OperacaoAttendanceReviveCard` | `conversations[]` |
| Líderes (tabela Revive) | Sim — enriquecer com SLA se API tiver | `summary.leaders` + extensão |
| Entregadores + filtro rota/offline | **Não** | Excluído |
| Gráficos volume/hora, mapa | **Não** | Excluído |

**Layout alvo:** página **única scroll** como Revive (remover abas Resumo/Tarefas/Atendimentos no desktop; opcional sticky nav âncoras `#tarefas` `#atendimentos`).

---

### 2.2 Atendente Atendimento geral — `OperacaoExecucaoPage` (`execucao_geral`)

**Título seção:** “Tarefas · Fila Atendimento Geral” (mesmo visual).

| Bloco | Implementar |
|-------|-------------|
| PageHeader + período + refresh | Sim |
| 4–6 KPIs do setor (tarefas abertas, atrasadas, minhas, concluídas período) | Sim |
| **Nova tarefa** (modal) | Sim — cadastro, matrícula, desligamento prep |
| **Grid `OperacaoTaskReviveCard`** | Sim — filtros chips mapeados de `task_type` → labels Revive |
| Drawer execução (mantém `InboxTaskWorkspace`) | Sim — clique no card |
| Alertas laterais (opcional coluna) | Sim — tarefas SLA + assinatura pendente read-only |
| Compliance / farmácias / entregadores | **Não** neste perfil |
| Envio Autentique | **Não** |

**Mapeamento `task_type` → label Revive:**

| API `task_type` | Label chip |
|-----------------|------------|
| `driver_registration_completion` | Finalizar cadastro |
| `driver_doc_*` | (agrupar ou chip “Documentos”) |
| `guided_demand` | Demanda guiada |
| Futuro `driver_enrollment_*` | Gerar matrícula |
| Futuro `driver_termination_signature` | Termo de desligamento |

---

### 2.3 Atendente financeiro (attendant) — `OperacaoExecucaoPage` (`execucao_financeiro`)

**Mesmo shell visual** que AG, título: “Tarefas · Fila Financeiro”.

| Bloco | Implementar |
|-------|-------------|
| KPIs setor financeiro | Sim |
| `OperacaoTaskReviveCard` | Sim — `financial_advance_request`, `driver_termination_financial_review` |
| Alertas: adiantamentos pendentes, acertos atrasados | Sim — aside |
| Farmácias / compliance | **Não** |

---

### 2.4 Gestor financeiro — `OperacaoFinanceiroGestorPage` (global)

**Mesmo design system**, escopo workspace (sem carteira de farmácias).

| Seção | Estilo Revive | Dados |
|-------|---------------|-------|
| PageHeader “Operação · Gestão financeira” | Sim | — |
| 6 KPIs globais (pendências, atrasadas, adiantamentos, lançamentos, atendimentos setor, funil) | `OperacaoKpiReviveCard` | `financial-hub` estendido |
| **Tarefas** grid 2 col | `OperacaoTaskReviveCard` | `tasks[]` |
| **Atendimentos** grid cards | `OperacaoAttendanceReviveCard` | `conversations[]` setor Financeiro |
| **Alertas operacionais** (coluna ou bloco) | `OperacaoAlertReviveCard` | `notifications[]` |
| **Ações rápidas** | `/financial`, `/inbox`, relatórios | links |
| Farmácias cards | **Não** (global) | — |
| Compliance rede inteira (opcional fase 2) | Tabela global MEI/acerto | workspace-wide |

**Importante:** gestor usa **os mesmos componentes** que o analista; só muda o payload e títulos.

---

### 2.5 Supervisor / admin — `OperacaoCoordenacaoPage`

Fase 2 do plano UI: aplicar `OperacaoKpiReviveCard`, tabelas em `rounded-xl border bg-surface`, `OperacaoSectionHeader`. Escopo de coordenação mantido.

---

## 3. API — extensões para alimentar os cards

### 3.1 `GET /api/ops-analytics/portfolio/hub` (analista)

Adicionar ao payload atual:

```ts
kpis: Array<{
  label: string;
  value: string | number;
  delta?: string;
  delta_tone?: 'up' | 'down' | 'neutral';
  spark: number[];
  alert?: boolean;
}>;

pharmacy_cards: Array<{
  id: string;
  trade_name: string;
  city?: string;
  leader_id: string | null;
  leader_name: string | null;
  leader_initials: string;
  sla_percent: number;
  drivers_active: number;
  drivers_total: number;
  open_conversations: number;
  pending_financial: number;
}>;

signature_pending: Array<{
  id: string;
  driver_id: string;
  driver_name: string;
  driver_initials: string;
  pharmacy_name: string;
  type: 'matricula' | 'termo_desligamento';
  days_pending: number;
  deadline_days: number;
}>;

compliance: Array<{
  driver_id: string;
  name: string;
  initials: string;
  pharmacy_name: string;
  cert_digital: boolean;
  mei: boolean;
  matricula_signed: boolean;
}>;

// tasks / conversations — enriquecer para OperacaoTaskReviveCard:
// checklist from playbook, sla_minutes from due_at-created_at, assignee_name, pharmacy_name
```

### 3.2 `GET /api/ops-analytics/financial-hub` (gestor)

Mesma forma de `tasks` enriquecidas + `kpis[]` + `signature_pending` global (opcional) + `alerts[]` tipados como Revive (`nivel`, `tipo`, `descricao`).

### 3.3 `GET /api/ops-analytics/execution-board` (AG + attendant financeiro) — novo

Payload unificado para `OperacaoExecucaoPage` com KPIs + tarefas enriquecidas + alertas setor, evitando múltiplos fetches na UI Revive.

### 3.4 Criação manual de tarefas (sem demanda do líder)

Quando matrícula, desligamento ou finalização de cadastro **não** vier do portal do líder, o **atendente AG** e o **analista operacional** devem poder abrir a tarefa no painel Operação.

| Endpoint | Função |
|----------|--------|
| `POST /api/ops/tasks` | Criar tarefa (`source: operacao_manual`, `leader_id` opcional) |
| `GET /api/ops/tasks/launch-context` | Entregadores/farmácias no escopo (carteira ou setor AG) |

**Tipos (`task_kind` → `task_type`):**

- `finalizar_cadastro` → `driver_registration_completion` (AG + analista)
- `preparar_matricula` → `driver_enrollment_prep` *(novo playbook)*
- `preparar_desligamento` → `driver_termination_prep` *(novo playbook)*
- `iniciar_desligamento_operacional` → par operacional + financeiro *(só analista; espelha fluxo do líder sem `leader_id` obrigatório)*

**UI:** `OperacaoCreateTaskModal` + botão **Nova tarefa** no header e ações rápidas (AG + analista). Sem envio Autentique na criação.

**Regras:** escopo carteira para analista (`attendantPortfolio`); idempotência (409 se tarefa aberta duplicada); auditoria `ops.task.create_manual`.

### 3.5 Séries para sparklines

`GET /api/ops-analytics/portfolio/hub?period=7|30` agrega por dia: diárias, faltas, conversas abertas, tarefas abertas (carteira). Gestor: mesma lógica workspace-wide.

---

## 4. Fases de implementação

### Fase UI-0 — Design system (1 sprint)

- [ ] Criar pasta `components/operacao/revive/` com primitivos §1.1
- [ ] `OperacaoTaskReviveCard`, `OperacaoPharmacyReviveCard`, `OperacaoAlertReviveCard`, `OperacaoSignaturePendingCard`
- [ ] `OperacaoKpiReviveCard`, `OperacaoAttendanceReviveCard`
- [ ] Storybook ou página dev `/operacao` com fixtures JSON espelhando `operacaoMock.ts` (só dev)

### Fase UI-1 — Analista (1–2 sprints)

- [ ] Estender API `portfolio/hub` (§3.1)
- [ ] `POST /api/ops/tasks` + `OperacaoCreateTaskModal` (Nova tarefa no analista, incl. desligamento operacional)
- [ ] Refatorar `OperacaoCarteiraPage` → layout Revive single-page
- [ ] Remover tabela simples de farmácias; remover abas desktop
- [ ] Compliance + assinaturas + alertas aside

### Fase UI-2 — Execução AG + Atendente financeiro (1 sprint)

- [ ] `execution-board` API ou enriquecer `/api/tasks` list
- [ ] `POST /api/ops/tasks` + `OperacaoCreateTaskModal` (Nova tarefa no AG)
- [ ] Refatorar `OperacaoExecucaoPage` com `OperacaoTaskReviveCard` + filtros chips Revive
- [ ] Coluna alertas (opcional)

### Fase UI-3 — Gestor financeiro (1 sprint)

- [ ] Estender `financial-hub`
- [ ] Refatorar `OperacaoFinanceiroGestorPage` — **mesmos cards** que analista (tarefas + atendimentos + KPIs + alertas)
- [ ] Sem `pharmacy_cards`

### Fase UI-4 — Coordenação + polish (1 sprint)

- [ ] Aplicar shell Revive em `OperacaoCoordenacaoPage`
- [ ] Deep link `?task=` abre card selecionado
- [ ] Mobile: seções colapsáveis se scroll longo
- [ ] Remover componentes legados (`OperacaoTaskCard` antigo, KPI inline duplicado)

---

## 5. Checklist visual (paridade Revive)

Para considerar **done** em cada perfil:

- [ ] `IconTile` em todo título de seção
- [ ] Cards `rounded-xl border bg-surface p-5` com hover `border-primary/40`
- [ ] Tarefas: checklist com ícones CheckCircle2/Circle, barras % checklist + SLA
- [ ] Status pill com bordas `bg-* /15` (mesmas classes `tarefaStatusMeta`)
- [ ] Alertas: badge `tipo` uppercase + farmácia + relógio
- [ ] Assinaturas: barra dias `Timer` + SLA estourado
- [ ] Farmácias (analista): bloco líder com avatar + SLA badge `font-mono`
- [ ] KPIs: sparkline à direita, delta com setas
- [ ] Filtros: `border-primary/40 bg-primary/15` quando ativo
- [ ] Tipografia: `text-[10px]`/`text-[11px]` labels, `font-mono` números

---

## 6. Princípios de produto (inalterados)

| Tema | Regra |
|------|--------|
| Assinatura | Status read-only; webhook alimenta cards de pendência |
| AG | Gestão de tarefa only; sem botão enviar Autentique |
| Gestor financeiro | Global, sem carteira |
| Analista | Carteira + tarefas + atendimentos + compliance + **criar tarefa** manual |
| Criação de tarefa | AG e analista via modal Operação; `leader_id` opcional; sem Autentique no POST |
| Exclusões Revive | Rota, app, entregadores status telemetria, gráficos logísticos |

---

## 7. Arquivos a tocar (resumo)

| Área | Arquivos |
|------|----------|
| UI compartilhada | `apps/web/src/components/operacao/revive/*` |
| Páginas | `OperacaoCarteiraPage`, `OperacaoExecucaoPage`, `OperacaoFinanceiroGestorPage`, `OperacaoCoordenacaoPage` |
| API | `opsAnalyticsAggregate.ts`, `ops-analytics.ts`, `execution-board`, `POST /api/ops/tasks`, `taskPlaybooks.ts` |
| Criar tarefa UI | `OperacaoCreateTaskModal.tsx` |
| Tipos web | `opsAnalyticsApi.ts`, `operacaoTaskMeta.ts` (mapa task_type → ícone/label/tone) |
| Docs | `access-matrix-by-role.md` (atualizar quando UI-1 concluir) |

---

## 8. Estado atual vs alvo

| Item | Hoje | Alvo |
|------|------|------|
| Estilo cards Revive | Parcial / básico | Paridade §5 |
| Analista farmácias | Tabela | `OperacaoPharmacyReviveCard` grid |
| Compliance | Ausente | Seção completa Revive |
| Alertas / assinaturas aside | Lista simples | Cards Revive |
| AG / Fin attendant | `OperacaoTaskCard` simples | `OperacaoTaskReviveCard` |
| Gestor financeiro | Abas + KPIs básicos | Mesmo layout analista, escopo global |
| APIs | hub básico | hub enriquecido + execution-board + criar tarefa |
| Nova tarefa manual | Só via líder/inbox/nota | Modal no Operação (AG + analista) |

---

*Referência: `project-revive-main/src/pages/Operacao.tsx`. Implementação atual: `apps/web/src/components/operacao/*`, hubs em `opsAnalyticsAggregate.ts`.*
