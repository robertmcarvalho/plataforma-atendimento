# CRM Comercial — Brief para Frontend

Documento de handoff para desenvolvimento das telas do módulo **CRM Comercial** na plataforma Aethera (`apps/web`).  
Backend em construção paralela — contratos abaixo são o **alvo**; validar com API antes de integrar.

**Referências de UI existentes:** `PageHeader`, `CadastroPrimitives`, `pharmacies/page.tsx` (master-detail), `ReportsRevivePage`, `OccurrenceWizard`, `inbox/page.tsx`, `ConversationFlowsPage`, `settings` (catálogos).

---

## 1. Princípios de produto (não negociáveis)

| Regra | Implicação na UI |
|--------|------------------|
| **Lead ≠ farmácia** | Ficha de lead (`/commercial/leads/*`) é entidade comercial; **não** reutilizar `/pharmacies/new` como cadastro de prospect. |
| **Conversão explícita** | Ação “Ganho” abre fluxo de conversão → cria/atualiza `pharmacies` só no fechamento. |
| **WhatsApp comercial separado** | Inbox do lead usa **canal comercial** (outro número); não misturar com inbox de suporte na mesma thread sem contexto. |
| **Pipeline configurável (SaaS)** | Estágios, campos customizados, motivos de perda e preços vêm de **config do workspace** — **não** hardcoded no front. |
| **SDR = fluxo visual** | Bot SDR configurado em **Automações / Fluxos**, com binding por `workspace_channel_id` comercial — não tela de script solta. |
| **Isolamento da operação** | Menu `/commercial/*` separado; feature flag `commercial_crm_enabled` no workspace (esconder menu se off). |

---

## 2. Papéis e menu

### Papéis com acesso (alvo)

| Papel | Menu CRM | Permissões típicas |
|--------|----------|-------------------|
| `admin` | Sim | Tudo + configuração pipeline/campos |
| `supervisor` | Sim (gestão) | Relatórios comerciais + config (se acordado) |
| Papel comercial novo (`sales` / `commercial`) | Sim | Pipeline, leads, propostas; sem settings operacionais |
| `attendant`, `operational`, `leader` | Não | Mantêm fluxo atual |

### Item de menu (Sidebar)

Adicionar em `baseNav` + `COMMERCIAL_SIDEBAR` em `roleNav.ts` (quando flag ativa):

```
/commercial          → Dashboard comercial (redirect ou overview)
/commercial/pipeline → Kanban (default)
/commercial/leads    → Lista master-detail
/commercial/settings → Config pipeline/campos (admin)
```

Ícone sugerido: `Briefcase` ou `Target` (lucide-react). Label: **Comercial**.

Guard: `requireRoleForPath` — permitir prefixo `/commercial` só para papéis autorizados.

---

## 3. Mapa de rotas e sessões

```text
apps/web/src/app/(app)/commercial/
├── page.tsx                    # Overview / KPIs comerciais
├── pipeline/
│   └── page.tsx                # Kanban por estágio
├── leads/
│   ├── page.tsx                # Lista + painel detalhe (master-detail)
│   ├── new/
│   │   └── page.tsx            # Cadastro manual de lead
│   └── [id]/
│       └── page.tsx            # Ficha completa (tabs)
├── proposals/
│   └── [id]/page.tsx           # Visualizar/editar proposta (opcional P2)
└── settings/
    └── page.tsx                # Pipeline, campos, motivos perda, catálogo preços
```

### Inbox comercial (reuso com contexto)

Não criar inbox duplicada inteira — usar **deep link** da ficha do lead:

- `/inbox?conversation_id=...` ou abrir **drawer/painel** de conversa na própria ficha (preferível).
- Query/context: `commercial_lead_id`, `contact_id`, canal comercial.

**Ações a partir da conversa (blueprint — prioridade média, sem unificar filas):**

| Ação na inbox | Comportamento |
|---------------|----------------|
| Vincular a lead existente | `PATCH` conversa com `context_commercial_lead_id` |
| Criar lead da conversa | `POST /api/commercial/leads` com telefone/nome da thread + redirect ficha |
| Mover estágio | `PATCH /api/commercial/leads/:id` `{ stage_id }` (menu rápido no contexto) |

Manter **canal comercial** separado do suporte; não misturar filas na UI.

---

## 4. Sessões — especificação por tela

### 4.1 Dashboard comercial — `/commercial`

**Objetivo:** visão do gestor/vendedor no período.

**Layout:** grid de KPI cards + 2 gráficos (recharts, como `ReportsRevivePage`).

| Bloco | Métricas (API alvo) |
|-------|---------------------|
| Hero KPIs | pipeline ponderado (R$), fechado no período, conversão %, quentes+urgentes — com Δ% e sparkline |
| Mini KPIs | criados, ganhos, perdidos, propostas, ciclo médio, estagnados |
| Gráfico 1 | Funil horizontal (Recharts) com % entre estágios |
| Gráfico 2 | Area chart: criados vs ganhos |
| Gráfico 3 | Donut origem + donut temperatura |
| Gráfico 4 | Pipeline R$ por vendedor |
| Listas | Top 5 negócios abertos + bloco “Atenção agora” |
| Filtros | período (7/30/90), comparar anterior, owner, origem |

**Componentes:** `PageHeader`, cards `rounded-xl border border-border bg-card`, `useQuery` + `commercialAnalyticsApi.ts` (criar).

**Empty:** workspace sem leads — CTA “Cadastrar primeiro lead”.

---

### 4.2 Pipeline Kanban — `/commercial/pipeline`

**Objetivo:** arrastar negócios entre estágios; visão principal do vendedor.

**Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│ PageHeader: Pipeline · [Filtros] [+ Novo lead] [Config⚙]    │
├─────────────────────────────────────────────────────────────┤
│ scroll horizontal →                                         │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│ │ Estágio │ │ Estágio │ │ Estágio │ │ Estágio │  ...      │
│ │  (12)   │ │  (5)    │ │  (3)    │ │  (1)    │           │
│ │ ┌─────┐ │ │ ┌─────┐ │ │         │ │         │           │
│ │ │ card│ │ │ │ card│ │ │         │ │         │           │
│ │ └─────┘ │ │ └─────┘ │ │         │ │         │           │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
└─────────────────────────────────────────────────────────────┘
```

**Card do deal/lead (coluna):**

- Nome fantasia / contato
- Cidade, volume entregas (se preenchido)
- **Valor estimado** (`deal_value_cents`) e **previsão de fechamento** (`expected_close_at`)
- **Temperatura** (frio / morno / quente / urgente) derivada do score IA + recência de mensagem
- Owner (avatar/iniciais)
- Dias no estágio + badge **Estagnado** (≥ 14 dias sem mudança, fora de ganho/perda)
- Badge origem (Instagram, Manual, …)
- Indicador “última msg” / SLA comercial (opcional)

**Interações:**

- Drag-and-drop entre colunas → `PATCH /api/commercial/deals/:id` `{ stage_id }`
- Clique no card → navega para `/commercial/leads/[id]` ou abre drawer
- Colunas = estágios de `GET /api/commercial/pipeline-stages` (ordenados por `sort_order`)

**Filtros (barra):** busca, owner, origem, tags, **temperatura**.

**Colunas especiais (fixas no fim):** `Ganho`, `Perdido` — podem ser estágios terminais com `is_won` / `is_lost` na API.

**Referência visual:** Trello/HubSpot kanban; usar `@dnd-kit/core` se já no projeto, senão HTML5 DnD simples.

---

### 4.3 Lista de leads — `/commercial/leads`

**Objetivo:** busca rápida e ficha lateral (padrão `pharmacies/page.tsx`).

**Layout master-detail (lg+):**

| Lista (esq) | Detalhe (dir) |
|-------------|----------------|
| Busca + filtros status/owner/origem | Tabs da ficha resumida |
| Tabela ou cards compactos | Atalhos: WhatsApp, Mover estágio, Gerar proposta |

**Colunas da lista:**

- Nome, CNPJ (mascarado), cidade, estágio, owner, atualizado em

**Mobile:** lista full-screen; detalhe em `/commercial/leads/[id]`.

---

### 4.4 Nova lead — `/commercial/leads/new`

**Objetivo:** cadastro comercial enxuto (prospecção).

**Eyebrow:** `Comercial · Novo lead` (não “Operação · Cadastro”).

**Seções (`CadastroSection`):**

| Seção | Campos obrigatórios | Opcionais |
|--------|---------------------|-----------|
| Identificação | nome fantasia, telefone WhatsApp, cidade/UF | razão social, CNPJ |
| Contato | nome do decisor, e-mail | cargo |
| Operação (estimativa) | — | volume entregas/mês, nº entregadores, ERP, horário pico |
| Comercial | owner (select usuários comercial) | origem, campanha, **valor estimado**, **previsão fechamento**, notas |
| Campos custom | render dinâmico de `GET /api/commercial/field-definitions` | |

**Não incluir nesta tela:** líder operacional, taxas delivery, horário farmácia, vínculo entregador.

**Submit:** `POST /api/commercial/leads` → redirect `/commercial/leads/[id]`.

**Componentes a reutilizar:** `BrPhoneInput`, `BrCnpjInput`, `CadastroField`, `CadastroSection`, `PageHeader`.

---

### 4.5 Ficha do lead — `/commercial/leads/[id]`

**Objetivo:** hub do vendedor — dados, conversa, histórico, proposta, viabilidade.

**PageHeader:**

- Título: nome fantasia
- Badges: estágio, origem, owner
- Actions: **Abrir WhatsApp**, **Copiloto comercial**, **Gerar proposta**, **Marcar ganho**, **Marcar perdido**, **Editar**

**Tabs:**

| Tab | Conteúdo |
|-----|----------|
| **Resumo** | Dados do lead + valor/previsão + campos custom + score IA + **temperatura** + notas |
| **Conversa** | Thread de mensagens (embed estilo inbox reduzido) ou link “Abrir na caixa” com `context_commercial_lead_id` |
| **Atividades** | Timeline: mudanças de estágio, msgs enviadas, propostas, reuniões (lista cronológica) |
| **Proposta** | Última proposta + botão gerar/regenerar PDF ou HTML |
| **Viabilidade** | Resultado consulta Flux (cidade, volume) — read-only cards |
| **Arquivos** | Upload contrato/anexo (P3) |

**Painel lateral / drawer Copiloto:** resumo do lead, próxima ação, rascunho WhatsApp (reuso `POST /api/copilot/chat` com `commercial_lead_id` — não o inbox de suporte).

**Alertas estagnados:** banner no pipeline e overview quando lead ≥ N dias no mesmo estágio (config workspace, default 14).

**Marcar perdido:** modal com `loss_reason_id` (select de config) + notas.

**Marcar ganho:** wizard em 2 passos:

1. Confirmar dados mínimos para farmácia (pré-preenche do lead)
2. `POST /api/commercial/leads/:id/convert` → sucesso com link para `/pharmacies/[newId]`

---

### 4.6 Configurações comerciais — `/commercial/settings`

**Objetivo:** SaaS — workspace edita funil e catálogos sem deploy.

**Sub-seções (tabs verticais ou horizontal):**

#### A) Pipeline (estágios)

- Lista ordenável (drag para `sort_order`)
- CRUD estágio: nome, cor, probabilidade %, flags `is_won`, `is_lost`, `is_entry`
- Validação: pelo menos 1 estágio de entrada; ganho/perdido únicos

#### B) Campos customizados

- Tabela: slug, label, tipo (`text`, `number`, `select`, `date`, `boolean`), obrigatório, ordem
- Usados no form de lead e na ficha

#### C) Motivos de perda

- Lista editável (nome, ativo)

#### D) Catálogo de preços / pacotes (opcional P2)

- Faixas por volume, MDR, setup — para gerador de proposta

#### E) Integrações (read-only + link)

- Card Instagram Lead Ads: status webhook, último evento
- Card Flux: “Testar viabilidade” (admin)

**Padrão UI:** espelhar `settings/page.tsx` (menu + `bg-surface` cards).

---

### 4.7 Proposta comercial — `/commercial/proposals/[id]` (P2)

**Objetivo:** preview antes de enviar PDF/link ao lead.

- Template HTML renderizado (dados lead + pricing + viabilidade Flux)
- Botões: Enviar por WhatsApp (template Meta), Download PDF, Voltar à ficha

---

### 4.8 SDR / Bot (não é sessão CRM separada)

Configuração no fluxo existente:

- `settings/automations` ou `/automacoes/fluxos`
- Ao publicar fluxo: binding **Canal WhatsApp Comercial** (`workspace_channels` type whatsapp, flag `purpose=commercial`)
- Documentar para o front: filtro de canais no seletor de binding = mostrar só canal comercial para fluxos `flow_runtime_mode: commercial_sdr`

**Blocos de fluxo CRM (extensão orchestrator — UI no editor):**

- Saudação SDR
- Perguntas qualificação (salvar em `commercial_leads.custom_fields`)
- Handoff para vendedor (criar task + notificar)

---

## 5. Contratos API (alvo para integração)

Prefixo: `/api/commercial/*`  
Auth: JWT + `requireRole('admin', 'commercial', 'supervisor')` (confirmar nomes).

| Método | Rota | Uso na UI |
|--------|------|-----------|
| GET | `/pipeline-stages` | Colunas kanban + selects |
| PUT | `/pipeline-stages` | Config (batch reorder) |
| GET | `/leads` | Lista (query: q, stage_id, owner_id, source) |
| POST | `/leads` | Novo lead |
| GET | `/leads/:id` | Ficha |
| PATCH | `/leads/:id` | Editar / mudar estágio |
| POST | `/leads/:id/convert` | Ganho → farmácia |
| POST | `/leads/:id/lose` | Perdido + motivo |
| GET | `/leads/:id/activities` | Timeline tab |
| GET | `/leads/:id/conversation` | Thread WA (ou reutilizar `/api/conversations/:id`) |
| POST | `/leads/:id/conversation/start` | Iniciar WA com telefone do lead |
| GET | `/field-definitions` | Forms dinâmicos |
| PUT | `/field-definitions` | Config |
| GET | `/loss-reasons` | Modal perdido |
| GET | `/dashboard` | Overview KPIs |
| POST | `/proposals` | Gerar proposta |
| GET | `/proposals/:id` | Preview |
| POST | `/viability/check` | Tab viabilidade (body: city, volume, …) |
| GET | `/leads/:id/scoring` | Score + temperatura + explicação (Wave 2) |
| POST | `/copilot/chat` | Body: `commercial_lead_id`, `message` (reuso copilot plataforma) |

**Conversas:** criar conversa com `contact.profile_type = commercial_lead` e `context_commercial_lead_id` (campo novo em conversations — alinhar com backend).

**Campos lead (extensão blueprint):**

| Campo | Tipo | UI |
|-------|------|-----|
| `deal_value_cents` | int | Form + card kanban + overview pipeline ponderado |
| `expected_close_at` | ISO date | Form + card |
| `ai_score` | 0–100 | Badge |
| `lead_temperature` | `frio` \| `morno` \| `quente` \| `urgente` | Badge (API ou derivado no front até Wave 2) |

---

## 6. Componentes novos sugeridos (`apps/web/src/components/commercial/`)

| Componente | Responsabilidade |
|------------|------------------|
| `CommercialPipelineBoard.tsx` | Kanban + DnD |
| `CommercialLeadCard.tsx` | Card coluna |
| `CommercialLeadForm.tsx` | Form create/edit + custom fields |
| `CommercialLeadDetail.tsx` | Tabs da ficha |
| `CommercialLeadTimeline.tsx` | Atividades |
| `CommercialLeadChatPanel.tsx` | Mensagens (reusa `MessageBubble`, API messages) |
| `CommercialConvertWizard.tsx` | Ganho → farmácia |
| `CommercialLossModal.tsx` | Perdido |
| `CommercialDashboard.tsx` | KPIs + charts |
| `CommercialSettingsPipeline.tsx` | CRUD estágios |
| `CommercialSettingsFields.tsx` | CRUD campos |
| `CommercialTemperatureBadge.tsx` | Temperatura frio/morno/quente/urgente |
| `CommercialCopilotDrawer.tsx` | Copiloto na ficha (protótipo → API) |
| `CommercialStagnantBanner.tsx` | Alertas deals estagnados |
| `commercialScoring.ts` | Derivação temperatura + estagnação (protótipo) |
| `commercialApi.ts` | `apps/web/src/lib/commercial/commercialApi.ts` |

---

## 7. O que reaproveitar vs não copiar

| Reaproveitar | Não copiar literalmente |
|--------------|-------------------------|
| `PageHeader`, `CadastroSection`, `BrInputs` | `/pharmacies/new` inteiro |
| Padrão master-detail `pharmacies/page.tsx` | Inbox completa como página CRM |
| `MessageBubble`, envio msg inbox | Relatórios operacionais `/reports` |
| `ReportMultiSelect`, charts recharts | Portal `/lider` |
| Permissões `canManageCadastro` → criar `canManageCommercial` | |

---

## 8. Estados de UI obrigatórios

- Loading: skeleton em lista, kanban e ficha
- Empty lista: ilustração + CTA novo lead
- Empty kanban estágio: coluna vazia sem placeholder pesado
- Erro API: `apiErrorMessage` (já existe)
- 403: “Sem permissão comercial”
- Flag off: menu Comercial oculto; rota `/commercial` → redirect `/inbox`

---

## 9. Fases sugeridas para o frontend

| Fase | Entregável UI | Dependência API |
|------|---------------|-----------------|
| **P0** | Menu + rotas vazias + settings pipeline (CRUD estágios) + lista leads simples | stages, leads CRUD |
| **P1** | Kanban + ficha tabs Resumo/Atividades + novo lead | PATCH stage, activities |
| **P2** | Tab Conversa + iniciar WA + Gerar proposta + Perdido/Ganho | conversations, proposals, convert |
| **P2b** | **Blueprint alta/média:** temperatura, valor/previsão, estagnados, copiloto ficha, deep link inbox | scoring, copilot, alerts |
| **P3** | Dashboard + viabilidade Flux + campos custom dinâmicos | dashboard, viability, field-definitions |
| **P4** | Instagram badge origem + polish mobile | webhooks metadata |
| **P4b** | Ações inbox → criar/vincular lead, mover estágio | conversations context |

Desenvolver com **mocks** (`msw` ou fixtures em `commercialApi.ts`) se API atrasar — tipos em `commercialTypes.ts`.

---

## 10. Tipos TypeScript (esboço)

```ts
export type CommercialPipelineStage = {
  id: string;
  name: string;
  sort_order: number;
  color?: string;
  probability_pct?: number;
  is_won?: boolean;
  is_lost?: boolean;
  is_entry?: boolean;
};

export type CommercialLead = {
  id: string;
  trade_name: string;
  legal_name?: string | null;
  cnpj?: string | null;
  phone: string;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  source: 'manual' | 'instagram' | 'referral' | 'other';
  stage_id: string;
  owner_id: string;
  owner?: { id: string; name: string };
  estimated_monthly_deliveries?: number | null;
  estimated_drivers?: number | null;
  erp_name?: string | null;
  custom_fields?: Record<string, unknown>;
  ai_score?: number | null;
  lead_temperature?: 'frio' | 'morno' | 'quente' | 'urgente' | null;
  deal_value_cents?: number | null;
  expected_close_at?: string | null;
  ai_sentiment_last?: string | null;
  pharmacy_id?: string | null; // preenchido após conversão
  created_at: string;
  updated_at: string;
};
```

---

## 11. Checklist de aceite (por sessão)

- [ ] Pipeline: drag muda estágio e persiste; filtros funcionam
- [ ] Novo lead: validação telefone BR; não exige CNPJ
- [ ] Ficha: WhatsApp abre conversa no canal comercial (não suporte)
- [ ] Ganho: wizard conversão; link para farmácia criada
- [ ] Perdido: exige motivo configurável
- [ ] Settings: reordenar estágios sem reload completo
- [ ] Responsivo: lista mobile + ficha full page
- [ ] Feature flag desliga menu
- [ ] Acessibilidade: foco em modais e DnD keyboard fallback (mover via menu)
- [ ] Temperatura visível no card e ficha; filtro por temperatura no pipeline
- [ ] Valor estimado e previsão de fechamento no form e cards
- [ ] Banner/lista de leads estagnados (≥ 14 dias)
- [ ] Copiloto comercial na ficha (contexto `commercial_lead_id`)
- [ ] Deep link inbox com `commercial_lead_id` (sem unificar com suporte)

---

## 12. Alinhamento blueprint (`crm_blueprint_produto.html`)

Referência enterprise genérica (vendas + suporte unificados). **Recorte Aethera:** lead ≠ farmácia, WhatsApp comercial separado, tickets na operação.

### Itens incorporados ao backlog (prioridade alta e média)

| Prioridade | Blueprint | Adaptação Aethera | Status protótipo |
|------------|-----------|-------------------|------------------|
| **Alta** | Lead scoring + frio/morno/quente/urgente | `deriveLeadTemperature` + badge; API `lead_temperature` na Wave 2 | Implementado (mock) |
| **Alta** | Valor deal + data prevista | `deal_value_cents`, `expected_close_at` no form/kanban | Implementado (mock) |
| **Média** | Alerta deal estagnado | `STAGNANT_STAGE_DAYS=14`, banner pipeline + KPI overview | Implementado (mock) |
| **Média** | Copiloto agente | Drawer na ficha; API com `commercial_lead_id` | Protótipo mock; API pendente |
| **Média** | Criar deal / mover estágio da conversa | Deep link + tabela de ações inbox (§3) | Deep link OK; ações inbox P4b |

### Explicitamente fora do escopo imediato (blueprint)

- Inbox omnichannel **único** vendas + suporte
- Perfil 360° com tickets de suporte na mesma ficha
- Múltiplos pipelines, rotação automática de leads, forecast AI
- Integrações Zapier / calendar / SDK

### Onde está no código (protótipo)

- `apps/web/src/lib/commercial/commercialScoring.ts`
- `apps/web/src/components/commercial/CommercialTemperatureBadge.tsx`
- `apps/web/src/components/commercial/CommercialCopilotDrawer.tsx`
- `apps/web/src/components/commercial/CommercialStagnantBanner.tsx`

---

## 13. Contatos

- Produto / escopo CRM: documento original “AETHERA — CRM COMERCIAL INTELIGENTE” + thread de decisões (lead vs farmácia, WA comercial, pipeline SaaS).
- Padrões UI: `project-revive-main` (referência visual legada gitignored).
- Backend: equipe API — prefixo `/api/commercial`; não usar rotas `/pharmacies` para persistir lead.

---

*Última atualização: backlog blueprint (alta/média) incorporado — scoring/temperatura, deal value, estagnados, copiloto ficha; protótipo em `/commercial`.*
