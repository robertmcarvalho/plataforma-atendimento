# Plano Revisado de Implantacao e Redesign

## Norte de execucao

O projeto passa a seguir dois trilhos com gates obrigatorios:

1. Estabilidade tecnica
2. Experiencia operacional

Nenhuma fase de produto avanca sem `lint`, `build` e smoke test dos fluxos principais.

## Fase 0 - Fundacao revisada

- Formalizar contratos entre servicos:
  - topico
  - produtor
  - consumidor
  - payload
  - idempotencia
  - retry
  - falha terminal
- Definir modos do frontend:
  - `real`
  - `mock`
- Criar gate de qualidade por merge:
  - `npm run lint`
  - `npm run build`
  - smoke tests de login, inbox e envio

## Fase 1 - Estabilizacao tecnica

### Objetivo

Fazer o monorepo representar o sistema real e voltar a validar de ponta a ponta.

### Entregas

- Corrigir bloqueios de compilacao e lint
- Tirar mocks da trilha real do frontend
- Alinhar fluxo de campanha com o worker
- Corrigir ack/retry no consumidor do Pub/Sub
- Corrigir erros de contrato entre payloads e UI

### Gate de saida

- `npm run lint` verde
- `npm run build` verde
- Login real funcional
- Inbox lista conversas reais
- Envio de mensagem grava e atualiza conversa

### Comandos locais (Windows / PowerShell)

- Subir para validar UI (recomendado para desenvolvimento): `npm run dev:local`
- Subir modo prod local (requer build OK): `npm run start:local`
- Parar processos locais: `npm run stop:local`

## Fase 2 - Fluxos criticos operacionais

### Objetivo

Fechar os fluxos que sustentam a operacao diaria.

### Entregas

- Webhook Meta -> Pub/Sub -> orchestrator -> conversa
- Atualizacao de status entregue/lida
- Triagem e roteamento
- Inbox compartilhada
- Historico e resposta manual
- Campanha manual com disparo real

### Gate de saida

- Evento recebido nao se perde em falha transitiva
- Conversa aparece em tempo aceitavel
- Campanha entra em execucao de verdade
- Logs basicos permitem rastrear falhas

## Fase 3 - Redesign base

### Objetivo

Trocar o aspecto generico de dashboard por uma linguagem de console operacional.

### Direcao visual atualizada

- dark-first (`#0A0A0B`) como canvas principal
- azul eletrico como cor primaria operacional
- Inter para UI e JetBrains Mono para IDs, horarios e metricas
- hierarquia por contraste sutil, nao por cor decorativa
- listas densas, bordas discretas e zero sombra decorativa fora de overlays
- estrutura de SaaS premium denso, estilo Linear/Vercel/Height

### Entregas

- nova paleta global
- nova escala tipografica
- layout principal revisto
- navegacao mais densa e clara
- componentes base de status, paineis e chips

### Gate de saida

- Login, layout e inbox usando a nova linguagem
- Relatorios e financeiro alinhados ao mesmo sistema visual

### Checklist dark-first premium

- [x] Tokens HSL semanticos aplicados em `globals.css`
- [x] Fontes Inter e JetBrains Mono configuradas
- [x] Componentes base criados: `ChannelBadge`, `StatusDot`, `ConversationItem`, `MessageBubble`, `KpiCard`, `Sparkline`
- [x] Login redesenhado em linguagem dark-first
- [x] Inbox migrada para itens de conversa e bolhas tokenizadas
- [x] Dashboard/Relatorios migrado para KPI cards e graficos densos
- [x] Modais/drawers sem hidratacao fragil e com overlay dark
- [x] Hardcodes criticos removidos: `bg-white`, `text-white`, `bg-black`, `#bfdbfe`, branco hardcoded em componentes atuais
- [x] Atalhos da Inbox: `Ctrl/Cmd+K` busca, `J/K` navega, `E` resolve
- [x] Command palette de navegacao por modulos (`Ctrl/Cmd+K`, setas, Enter e Esc)
- [ ] Command palette com busca global de entidades (contatos, conversas e cadastros)
- [ ] Skeletons padronizados em todas as listas
- [ ] Toasts de acao para criar/editar/excluir/resolver
- [ ] Revisao visual final das paginas secundarias com QA em navegador

### Artefatos de planejamento

- Os artefatos antigos de wireframe e mapa visual foram removidos na higienização pré-produção.
- A execução visual atual deve seguir os componentes implementados no app e os runbooks operacionais mantidos em `docs/`.

## Fase 3c - Refatoracao visual orientada pelo prototipo `project-revive-main`

### Diagnostico

O diretorio `project-revive-main/project-revive-main` contem um prototipo Vite/React Router com mock data. Ele nao deve ser copiado diretamente para o app atual, que usa Next.js, API real, auth real e rotas protegidas. A adaptacao deve aproveitar a linguagem visual, componentes e composicao, descartando recursos sem backend.

### O que sera aproveitado

- Design system dark-first de `src/index.css`: tokens HSL, superficies, bordas, glow, Inter, JetBrains Mono e animacoes discretas.
- Shell visual de `AppShell.tsx` + `Sidebar.tsx`: layout fixo, sidebar larga, busca/command palette e perfil no rodape.
- `PageHeader`, `StatusDot`, `ChannelBadge` e padroes de cards/tabelas como base de componentes compartilhados.
- Inbox 4 colunas como referencia de composicao: filtros, lista, thread e painel de contexto.
- Login split visual, mantendo somente usuario/senha.
- Campanhas, automacoes, financeiro e relatorios como referencia de densidade, status, progresso e metricas.

### O que sera descartado

- React Router/Vite e qualquer estrutura que conflite com Next.js.
- Dados mockados, metricas falsas e historicos inventados.
- Login Google, criar workspace, IA sugestoes, telefone/video e recursos sem endpoint real.
- Multicanais visuais sem suporte real no backend atual.
- Graficos com `Math.random()` ou datas variaveis no render, para evitar hydration mismatch.
- Copia literal de textos com encoding quebrado do prototipo.

### Ordem de execucao

- [x] 1. Salvar plano de adaptacao no `IMPLEMENTATION_REDESIGN_PLAN.md`
- [x] 2. Base visual: alinhar tokens globais e utilitarios ao prototipo sem quebrar CSS legado
- [x] 2.1. Limpeza: remover CSS legado nao referenciado (login/app-nav antigos) para reduzir conflitos
- [x] 3. Shell: substituir sidebar estreita por sidebar larga estilo prototipo, preservando RBAC, logout e command palette
- [x] 4. Componentes compartilhados base: `PageHeader`, badges, cards, bubbles e dots sem dependencias desnecessarias
- [x] 4.1. Estados compartilhados: empty/skeleton/toast padronizados
- [x] 5. Inbox: refatorar composicao para 4 colunas usando queries reais
- [x] 6. Login: aplicar split premium mantendo fluxo real de autenticacao
- [ ] 7. Cadastros: aplicar tabelas/listas densas + drawers com dados reais
- [ ] 8. Modulos operacionais: campanhas, automacoes, financeiro, relatorios e configuracoes no mesmo sistema visual
- [ ] 9. QA: build, lint, smoke visual e verificacao de hydration

### Correcao de rota

- A primeira iteracao visual nao ficou aderente ao modelo Zendesk/Umbler
- A prioridade passa a ser a `Inbox` como workspace real de atendimento
- A `Inbox` deve ser refeita antes de qualquer refinamento das telas secundarias
- A composicao correta passa a ser:
  - filas
  - lista de conversas
  - conversa ativa
  - contexto lateral persistente
- KPIs e cards de resumo nao devem competir com a operacao dentro da inbox

### Checklist de fechamento da Inbox

- Trabalho do agente
  - [x] assumir conversa
  - [x] transferir conversa por setor/atendente com motivo
  - [x] encerrar atendimento
  - [x] reabrir atendimento
  - [x] historico curto de ownership e SLA
- Composer
  - [x] texto livre
  - [x] assinatura do atendente
  - [x] emoji
  - [x] templates aprovados
  - [x] envio de contato
  - [x] upload de imagem
  - [x] upload de documento
  - [x] upload de audio
  - [x] gravacao de audio no browser
  - [x] respostas rapidas
  - [x] historico curto de uso
  - [x] foco automatico por modo responder/anotar
- Thread
  - [x] agrupamento temporal
  - [x] agrupamento de sequencias do mesmo autor
  - [x] estados de envio claros: enviada / entregue / lida / falhou
  - [x] render de imagem
  - [x] render de documento
  - [x] render de audio
  - [x] render de contato
  - [x] evitar salto excessivo com refresh / realtime
- Lista
  - [x] risco/SLA por aba
  - [x] nova mensagem / nao lida
  - [x] ownership pendente
  - [x] prioridade visivel
- Lateral
  - [x] resumo curto de contexto
  - [x] bloco de decisao
  - [x] historico curto
  - [x] notas recentes
  - [x] links rapidos para contato, farmacia, entregador e lider
  - [x] SLA com ultimo evento e notificacoes visiveis
- UX e robustez
  - [x] loading / empty / erro / retry
  - [x] teclado para navegar lista e trocar aba
  - [x] tablet / mobile utilizavel
  - [x] smoke do fluxo completo da inbox
- Gate de saida
  - [x] atendente resolve o ciclo completo sem sair da inbox
  - [x] `npm run lint` verde
  - [x] `npm run build` verde

## Fase 3b - Telas Operacionais (padrão Inbox)

### Objetivo

Padronizar Contatos, Farmácias, Entregadores e Líderes no mesmo modelo de “workspace operacional”:

- layout fixo (sem scroll na página)
- scroll apenas dentro dos painéis
- navegação compacta (ícones + tooltip)
- densidade e leitura de fila/tabela, não dashboard

### Ordem segura de execução

- [x] 1. Layout global: nav compacta para todas as telas operacionais
- [x] 2. Farmácias: workspace + CRUD em drawer + leitura de vínculos
- [x] 3. Entregadores: workspace + CRUD em drawer + vínculos N:N
- [x] 4. Líderes: workspace + CRUD em drawer + vínculos N:N
- [x] 5. Contatos: ajustes finos (já em workspace) + ações e consistência

### Checklist por tela

#### Base (todas as telas operacionais)

- [x] layout fixo (sem scroll na página)
- [x] painel esquerdo: filtro + busca + lista/tabela densa
- [x] painel central: detalhe selecionado com ações rápidas (editar, vincular, etc)
- [x] painel direito: contexto e decisão (sem texto longo)
- [x] estados: loading / vazio / erro / retry
- [x] teclas: Enter para buscar; Esc fecha drawer
- [x] links rápidos para navegar entre cadastros relacionados

#### Contatos

- [x] manter `workspace-grid` 3 colunas
- [x] criar/editar em `Drawer` (modal central)
- [x] “Enviar contato” (na Inbox) consome a lista real de contatos (já existe)
- [x] reforçar leitura de bloqueio e vínculo (driver/farmácia/líder)

#### Farmácias

- [x] converter para `workspace-grid` 3 colunas
- [x] lista densa com filtros (ativo/inativo) + busca (trade/legal/cnpj)
- [x] detalhe mostra ownership (atendentes), líder e vínculos recentes de entregadores
- [x] CRUD via `Drawer` (modal central)

#### Entregadores

- [x] converter para `workspace-grid` 3 colunas
- [x] filtros por status e doc_status + busca (nome/cpf/telefone)
- [x] detalhe mostra farmácia principal e vínculos N:N
- [x] CRUD via `Drawer` (modal central)
- [x] gestão de vínculos (adicionar/remover + definir principal) via `Drawer` (modal central)

#### Líderes

- [x] converter para `workspace-grid` 3 colunas
- [x] busca por nome/telefone
- [x] detalhe mostra farmácias vinculadas (N:N)
- [x] CRUD via `Drawer` (modal central)
- [x] gestão de vínculos via `Drawer` (modal central)

### Checklist de Fechamento (Cadastros Operacionais)

Checklist (itens 1 a 5) para `Farmácias`, `Entregadores`, `Líderes` e `Contatos` (modal central + tabelas densas):

- [x] 1. Layout fixo (sem scroll na página) e scroll apenas dentro dos painéis
- [x] 2. Links rápidos e navegação cruzada (abrir cadastros relacionados a partir dos vínculos e resumos)
- [x] 3. Ações mínimas por entidade (vínculos N:N, definir principal, bloqueio, responsáveis, etc)
- [x] 4. Robustez UX (loading/empty/error/retry + teclado: Enter busca, Esc fecha modal)
- [x] 5. Validação local do módulo operacional (fluxos manuais no browser com API em execução)

## Fase 4 - Modulos (Execucao/Admin)

### Prerequisitos (gate)

- [ ] ambiente local consegue rodar `web` (dev ou start) sem `spawn EPERM`
- [x] `npm run lint` verde
- [x] schema aplicado no Supabase (inclui `002_chat_enhancements.sql`)

Diagnostico rapido (Windows):

- Se `npm -w apps/web run build` falhar com `Error: spawn EPERM` dentro do OneDrive, o `start:local` nao vai refletir mudancas (porque depende de build).
- Workaround imediato: use `npm run dev:web` (somente frontend) ou `npm run dev:local` (stack toda) para seguir evoluindo.
- Correcao definitiva: mover o repositorio para fora do OneDrive (ex: `C:\\dev\\plataforma_atendimento`) **ou** liberar `node.exe`/`cmd.exe` no Windows Security (Controlled Folder Access/antivirus).

Obs: `spawn EPERM` em Windows/OneDrive/antivirus costuma exigir mover o repo para fora do OneDrive (ex: `C:\dev\...`) ou adicionar excecao para `node.exe`.
Obs: se `npm run db:ensure` falhar com `getaddrinfo ENOENT` no host `db.<ref>.supabase.co`, use a connection string do **Transaction Pooler** no `.secrets/supabase-db-url.txt` (evita dependência de IPv6).

### Ordem segura (dependencias)

- [x] 1. Configuracoes (admin) — base para templates, assinatura, bot e SLA
- [x] 2. Campanhas — depende de templates aprovados e worker
- [x] 3. Automacoes — depende de campanhas + scheduler/trigger
- [x] 4. Financeiro — depende de cadastros operacionais e auditoria
- [x] 5. Relatorios — depende de dados reais dos modulos acima

### Checklist base (todas as telas)

- [x] layout fixo (sem scroll na pagina) e scroll interno por painel
- [x] lista/tabela densa + busca + filtros (sem “cards dashboard”)
- [x] detalhe selecionado com acoes rapidas no header
- [x] drawer/modal central para criar/editar (leitura/acao por abas; botao Editar no header)
- [x] estados: loading / vazio / erro / retry
- [x] teclado: Enter busca, Esc fecha drawer
- [x] links rapidos para navegar para entidade relacionada

### Campanhas

- [x] lista (esq): filtros por status (draft/scheduled/running/paused/completed/failed) + busca
- [x] detalhe (centro): template + audiencia + dispatch_config + progresso (sent/delivered/read/failed)
- [x] decisao (dir): disparar, pausar/retomar, reagendar (se houver), abrir destinatarios
- [x] drawer criar/editar: template aprovado + audiencia + preview + configuracao anti-ban
- [x] robustez: polling/realtime sem “pular” layout

### Automacoes

- [x] lista (esq): regras com trigger (cron/event) + ativo/inativo + busca
- [x] detalhe (centro): configuracao + ultimas runs (status e volume)
- [x] decisao (dir): ativar/desativar, rodar agora, editar
- [x] execucao: regra vira job (ex: cria campaign_id ou publica em `automation.trigger`)

### Financeiro

- [x] lista (esq): filtros por status (draft/pending_approval/active/settled/cancelled) + tipo + busca por entregador
- [x] detalhe (centro): lancamento + parcelas (pagar, historico) + auditoria curta
- [x] decisao (dir): enviar aprovacao, aprovar/rejeitar, cancelar, exportar
- [x] drawer criar/editar: geracao automatica de parcelas + validacoes

### Relatorios

- [x] seletor (esq): Atendimento, SLA, Produtividade, Financeiro
- [x] viewer (centro): tabela densa + grafico apenas quando ajudar decisao
- [x] filtros (dir): periodo, setor, atendente, status e exportacao

### Configuracoes (admin)

- [x] secoes (esq): Atendimento, Templates, SLA, Setores, Usuarios, Bot/Roteamento, Seguranca
- [x] conteudo (centro): forms densos e operacionais (sem texto longo)
- [x] decisao (dir): salvar, desfazer, “impacto” (o que muda) e ultimo update
- [x] assinatura (on/off) controlada via `app_settings.chat_signature_enabled`
- [x] intencao do bot baseada nos setores ativos (sem enum fixo), com compatibilidade para intents legados
- [x] Setores: CRUD + ativar/desativar (inclui `business_hours` em JSON)
- [x] SLA: CRUD de politicas
- [x] Usuarios: CRUD basico + ativar/desativar + select de role/setor

## Plano - Ticket Estruturado + Bot (Fase 5)

### Ticket (conversa) como chamado

- [x] Migration 003: `conversations.summary` (resumo curto) + `conversations.intent_sector_id` (FK setores)
- [x] Orchestrator: preencher `summary` na primeira inbound (e preencher `intent_sector_id` na 1a classificacao de setor do bot)
- [x] Inbox: editar Tipo (Setor), Prioridade e Resumo no painel de decisao

### Classificacao e roteamento

- [x] Classificar farmacia/lider/desconhecido por keywords simples (setor) antes do handoff
- [x] Evoluir `routing_rules.conditions` para `keywords_any` e `keywords_all` (configuravel no Admin)
- [ ] Roteamento completo: suportar `route_to=attendant` com seletor de atendente (target_id) e delete/reorder de regras

### Motor de flows

- [ ] Selecionar flow por `trigger_keywords` + perfil + setor (intent)
- [ ] Suportar multiplos steps (message/choice/ask_context/handoff)

### Operacao e compliance

- [ ] Fora de horario (usar `sectors.business_hours`) + mensagens padrao (recebido/em fila/retorno ate X)
- [ ] Templates oficiais quando necessario (proativo so com template aprovado)
- [ ] Controles admin (app_settings): `bot_enabled`, `bot_session_ttl_hours`, `bot_fallback_sector_id`, mensagens padrao
- [ ] Telemetria (decisoes): regra/flow aplicado, handoff, tempos (KPIs)

## Backlog de governanca

- criar DLQ para eventos falhos
- adicionar testes de contrato entre servicos
- instrumentar logs com correlation id
- adicionar health checks dependentes por servico
- criar checklist de release por ambiente

## Backlog executavel V2 - MCP + Inbox Unificado Financeiro

### Objetivo

Adicionar ao escopo atual:

- Inbox Unificado com contexto financeiro embutido (`contexto_snap`)
- Ticket operacional estruturado com classificacao automatica
- Motor de SLA com 3 jobs (alerta 80%, escalonamento, relatorio diario) com foco em `supervisor`
- MCP Enablement no backend e na UI (tool call, governanca e rastreabilidade)
- Cadastro de entregador com classificacao `fixo | diarista`

### Regras fechadas de SLA (vigentes)

- Job 1 - alerta de 80%: notificar atendente responsavel e supervisor
- Job 2 - escalonamento automatico: vencido escala de `atendente -> supervisor`
- Job 3 - relatorio diario: no fechamento, supervisor recebe abertos/resolvidos/vencidos + tempo medio por tipo
- Exemplo: alta prioridade com `sla_minutos=120` alerta em `96` minutos

### Priorizacao (P0/P1/P2)

#### P0 - Fundacao obrigatoria (sem isso nao entra em producao)

- **Dados e API (tickets + SLA + MCP base)**
  - Arquivos:
    - `supabase/migrations/018_financial_tickets_and_driver_type.sql`
    - `apps/api-service/src/routes/tickets.ts`
    - `apps/api-service/src/routes/mcp-tools.ts`
    - `apps/api-service/src/lib/mcpCatalog.ts`
    - `apps/api-service/src/server.ts`
  - Tarefas:
    - criar tabelas `tickets` e `ticket_events` com `context_snap`
    - adicionar `drivers.driver_type` (`fixed|daily`)
    - expor `POST /api/tickets/open-from-message`
    - expor `GET /api/tickets`, `GET /api/tickets/:id`, `PATCH /api/tickets/:id`, `GET /api/tickets/:id/timeline`
    - expor `GET /api/mcp/tools`, `POST /api/mcp/execute`, `GET /api/mcp/executions`
    - registrar rotas no bootstrap da API

- **Classificacao e abertura automatica**
  - Arquivos:
    - `apps/orchestrator-service/src/ticketing/classifier.ts`
    - `apps/orchestrator-service/src/ticketing/mappings.ts`
    - `apps/orchestrator-service/src/ticketing/contextSnapshot.ts`
    - `apps/orchestrator-service/src/ticketing/sla.ts`
    - `apps/orchestrator-service/src/processBotSession.ts`
  - Tarefas:
    - mapear keywords para `tipo/prioridade/sla`
    - abrir ticket com `context_snap` para casos humanos
    - responder via bot em duvidas financeiras simples (`prioridade=bot`) sem abrir ticket humano

- **SLA jobs**
  - Arquivos:
    - `apps/scheduler-service/src/jobs/ticketsSlaJobs.ts`
    - `apps/scheduler-service/src/index.ts` (registro/agenda)
  - Tarefas:
    - job alerta 80%
    - job vencimento + escalonamento `atendente -> supervisor`
    - job relatorio diario para supervisor
    - gravar eventos em `ticket_events`

- **UI minima operacional**
  - Arquivos:
    - `apps/web/src/app/(app)/inbox-unificado/page.tsx`
    - `apps/web/src/app/(app)/inbox-unificado/components/TicketHeader.tsx`
    - `apps/web/src/app/(app)/inbox-unificado/components/FinancialContextCard.tsx`
    - `apps/web/src/app/(app)/inbox-unificado/components/TicketTimeline.tsx`
    - `apps/web/src/app/(app)/inbox-unificado/components/EscalationBadge.tsx`
    - `apps/web/src/app/(app)/settings/page.real.tsx` (driver_type no cadastro)
  - Tarefas:
    - exibir conversa + ticket + contexto financeiro na mesma tela
    - exibir status do ticket e risco de SLA (80%/vencido)
    - permitir mudanca de status (`aberto -> em_atendimento -> resolvido`)
    - permitir classificar entregador como `fixo` ou `diarista`

#### P1 - Personalizacao e governanca (entra logo apos P0)

- **MCP no motor de fluxo + editor**
  - Arquivos:
    - `apps/orchestrator-service/src/flow-engine/nodes/toolCallMcp.ts`
    - `apps/orchestrator-service/src/flow-engine/nodes/index.ts`
    - `apps/web/src/components/flow-builder/nodes/ToolCallMcpNode.tsx`
    - `apps/web/src/components/flow-builder/schemas/nodeSchemas.ts`
  - Tarefas:
    - criar no `Tool Call (MCP)` no engine e UI
    - validar schema de input/output da ferramenta antes de publicar
    - registrar telemetria de tool call (latencia, erro, fallback)

- **Inbox com contexto operacional + explicabilidade**
  - Arquivos:
    - `apps/web/src/app/(app)/inbox-unificado/components/OperationalContextPanel.tsx`
    - `apps/web/src/app/(app)/inbox-unificado/components/RoutingExplainCard.tsx`
  - Tarefas:
    - painel lateral com contexto operacional via `mcp-operacao`
    - bloco "por que foi roteado" via `mcp-routing`
    - acoes rapidas (criar pendencia, transferir, registrar ocorrencia)

- **Governanca MCP**
  - Arquivos:
    - `apps/api-service/src/routes/mcp-governance.ts`
    - `apps/web/src/app/(app)/settings/mcp-tools/page.tsx`
    - `apps/web/src/app/(app)/audit/operational/page.tsx`
  - Tarefas:
    - catalogo de ferramentas por tenant (on/off, timeout, retry)
    - permissao por papel para invocacao de tools
    - auditoria operacional (flow change/publish/rollback/policy/tool execution)

#### P2 - Escala, analytics e integracoes externas

- **MCPs adicionais**
  - Arquivos:
    - `apps/api-service/src/lib/mcpCatalog.ts`
    - `apps/api-service/src/routes/mcp-tools.ts`
  - Tarefas:
    - P1: `mcp-messaging`, `mcp-knowledge`, `mcp-analytics`
    - P2: `mcp-finance`, `mcp-integrations` por tenant

- **Observabilidade avancada**
  - Arquivos:
    - `apps/api-service/src/routes/flows.ts`
    - `apps/api-service/src/routes/tickets.ts`
    - `apps/api-service/src/routes/mcp-metrics.ts`
  - Tarefas:
    - metricas por no/tool (p50/p95, erro, fallback)
    - metricas de SLA (on-time, escalonamento, tempo medio por tipo)
    - alertas operacionais para erro MCP e backlog em risco

### Criterios de aceite por tela

#### Tela: Inbox Unificado
- mostra conversa ativa + ticket + `contexto_snap` na mesma tela
- mostra `tipo`, `prioridade`, `status`, `sla_minutos`, tempo restante
- mostra alerta visual em 80% e vencido
- exibe timeline unificada (mensagens + automacao + tool calls MCP + acoes humanas)
- permite transicao de status e registra `ticket_events`

#### Tela: Lider e Entregadores
- exibe arvore por farmacia com vinculos ativos
- indica inconsistencia (lider sem farmacia, entregador sem vinculo)
- acao "corrigir vinculo" registra auditoria
- cadastro de entregador permite `fixo|diarista`

#### Tela: Configuracoes MCP (tenant)
- lista tools por tenant com estado on/off
- permite definir timeout e retry por tool
- aplica permissao por papel (quem pode invocar)
- salva e mostra ultimo autor/horario da alteracao

#### Tela: Auditoria Operacional
- lista alteracoes de fluxo, publish, rollback e policy
- lista execucoes MCP com status, latencia e erro
- possui filtros por periodo, tenant, usuario, entidade e tipo de evento

#### Tela: Dashboard de SLA e Operacao
- mostra abertos/resolvidos/vencidos e tempo medio por tipo
- mostra cumprimento de SLA por setor/supervisor
- mostra taxa de escalonamento e resolucao bot vs humano
- mostra saude MCP (erro/timeout/fallback por tool)

### Definicao de pronto (DoD) do backlog

- migrations idempotentes e scripts `ensure-*` atualizados
- `npm run lint` e `npm run build` verdes
- smoke tests:
  - abertura automatica de ticket com `contexto_snap`
  - alerta 80% e escalonamento para supervisor
  - relatorio diario entregue ao supervisor
  - execucao MCP registrada em auditoria
- criterios de aceite por tela validados em QA

### Planejamento em sprints semanais (execucao sugerida)

#### Sprint 1 (Semana 1) - Base de dados + APIs P0

- Escopo:
  - migration `018_financial_tickets_and_driver_type.sql`
  - rotas `tickets.ts` (CRUD base + open-from-message)
  - rotas `mcp-tools.ts` (catalogo/execute/executions)
  - `mcpCatalog.ts` + registro em `server.ts`
- Dependencias criticas:
  - nenhuma (inicia imediatamente)
- Criterio de saida:
  - migrations aplicadas em dev/staging sem erro
  - endpoints P0 respondendo 200 com auth valida
  - smoke API de tickets e MCP passando

#### Sprint 2 (Semana 2) - Classificador + SLA jobs + orchestrator

- Escopo:
  - `classifier.ts`, `mappings.ts`, `contextSnapshot.ts`, `sla.ts`
  - integracao no `processBotSession.ts`
  - `ticketsSlaJobs.ts` com 3 jobs (80%, escalonamento, relatorio diario)
  - registro no `scheduler-service/src/index.ts`
- Dependencias criticas:
  - Sprint 1 concluida (schema e APIs base)
- Criterio de saida:
  - abertura automatica com `contexto_snap`
  - regra bot-first para duvida financeira simples ativa
  - alerta 80% e escalonamento `atendente -> supervisor` funcionando
  - relatorio diario para supervisor validado

#### Sprint 3 (Semana 3) - Inbox Unificado P0 (UI operacional)

- Escopo:
  - `inbox-unificado/page.tsx`
  - `TicketHeader.tsx`, `FinancialContextCard.tsx`, `TicketTimeline.tsx`, `EscalationBadge.tsx`
  - ajuste em `settings/page.real.tsx` para `driver_type`
- Dependencias criticas:
  - Sprint 1 e 2 concluidas (dados reais de tickets/SLA)
- Criterio de saida:
  - atendente opera ticket sem sair da inbox
  - status e risco SLA visiveis
  - transicao de status grava `ticket_events`
  - cadastro de entregador salva `fixo|diarista`

#### Sprint 4 (Semana 4) - P1 MCP no fluxo + explicabilidade + governanca

- Escopo:
  - `toolCallMcp.ts` + registry de nos no orchestrator
  - `ToolCallMcpNode.tsx` + schema no flow builder
  - `OperationalContextPanel.tsx` + `RoutingExplainCard.tsx`
  - `mcp-governance.ts`, `settings/mcp-tools/page.tsx`, `audit/operational/page.tsx`
- Dependencias criticas:
  - Sprint 1 (catalogo MCP pronto)
  - Sprint 3 (inbox unificado pronto para incorporar contexto/explicacao)
- Criterio de saida:
  - publish bloqueia contrato invalido de tool
  - inbox exibe contexto operacional + "por que foi roteado"
  - governanca por tenant/perfil ativa
  - auditoria operacional navegavel na UI

#### Sprint 5 (Semana 5) - P2 metricas, alertas e hardening

- Escopo:
  - `mcp-metrics.ts` + expansao de metricas em `flows.ts` e `tickets.ts`
  - dashboard operacional com bloco MCP/SLA
  - alertas operacionais de erro MCP e backlog/SLA
  - inclusao P1 MCPs (`mcp-messaging`, `mcp-knowledge`, `mcp-analytics`)
- Dependencias criticas:
  - Sprint 4 (telemetria de tools e auditoria)
- Criterio de saida:
  - metricas p50/p95 erro/fallback por tool
  - dashboard operacional completo para supervisor
  - alertas criticos acionando corretamente

#### Sprint 6 (Semana 6+) - Expansao externa por tenant

- Escopo:
  - `mcp-finance` e `mcp-integrations` (ERP/CRM)
  - politicas por tenant para ferramentas externas
  - rollout gradual por feature flag
- Dependencias criticas:
  - Sprint 4 e 5
- Criterio de saida:
  - integracoes externas ativas em tenants piloto
  - isolamento por tenant validado
  - sem regressao no fluxo operacional principal

### Dependencias transversais (obrigatorias em todas as sprints)

- `npm run lint` e `npm run build` verdes por merge
- smoke de inbox/ticket/SLA/MCP antes de promover para staging
- logs com correlation id para rotas e jobs novos
- sem deploy de UI sem endpoint correspondente em staging

### Checklist de etapas de producao (go-live)

- **Etapa 1 - Pre-producao (T-5 a T-3)**
  - congelar escopo da release e branch de corte
  - validar migrations novas em staging com backup/restaure testado
  - executar smoke tecnico (tickets, SLA jobs, MCP execute, inbox unificado)
- **Etapa 2 - Homologacao funcional (T-2)**
  - validar criterios por tela com operacao (Inbox, Builder, SLA Dashboard, Auditoria)
  - validar escalonamento para supervisor e relatorio diario
  - aprovar checklist de seguranca (permissoes por papel, logs sem dado sensivel)
- **Etapa 3 - Janela de deploy (T-1/T0)**
  - aplicar migration em producao
  - deploy em ordem: `api-service` -> `orchestrator-service` -> `scheduler-service` -> `web`
  - habilitar feature flags por lote (tenant piloto antes de geral)
- **Etapa 4 - Monitoramento assistido (T+0 a T+1)**
  - monitorar erros 5xx, latencia MCP, backlog de tickets, SLA em risco
  - confirmar recebimento de alerta 80% e relatorio diario do supervisor
  - executar plano de rollback se qualquer gate critico falhar
- **Etapa 5 - Estabilizacao (T+2 a T+5)**
  - revisar incidentes, falso-positivo de alertas e tuning de threshold
  - consolidar metricas de bot vs humano, escalonamento e tempo medio por tipo
  - registrar retro e ajustes para ciclo seguinte

### Checklist diario por sprint (D1..D5)

#### Sprint 1 (Semana 1) - Base de dados + APIs P0

- **D1**
  - fechar schema final de `tickets`, `ticket_events`, `drivers.driver_type`
  - revisar impacto em indices e FKs
- **D2**
  - implementar migration `018_financial_tickets_and_driver_type.sql`
  - criar/ajustar script `ensure-*` correspondente
- **D3**
  - implementar `tickets.ts` (open-from-message, list, detail, update, timeline)
  - registrar rotas no bootstrap
- **D4**
  - implementar `mcpCatalog.ts` e `mcp-tools.ts` (`tools`, `execute`, `executions`)
  - incluir auditoria basica em execucao de tool
- **D5**
  - rodar smoke API (`tickets` + MCP), corrigir edge cases
  - preparar PR com evidencias de teste

#### Sprint 2 (Semana 2) - Classificador + SLA jobs + orchestrator

- **D1**
  - definir dicionario inicial de keywords por `tipo/prioridade/sla`
  - alinhar casos que devem ser resolvidos por bot sem ticket humano
- **D2**
  - implementar `classifier.ts` + `mappings.ts`
  - implementar `contextSnapshot.ts` com snapshot financeiro
- **D3**
  - integrar no `processBotSession.ts` (abertura automatica + bot-first para `duvida`)
  - testar fluxo completo inbound -> classificacao -> ticket/bot
- **D4**
  - implementar `ticketsSlaJobs.ts` (80%, escalonamento, diario)
  - registrar agendas no `scheduler-service`
- **D5**
  - validar SLA de ponta a ponta em staging (incluindo 96 min para prioridade alta)
  - ajustar notificacoes para supervisor

#### Sprint 3 (Semana 3) - Inbox Unificado P0 (UI operacional)

- **D1**
  - montar esqueleto da pagina `inbox-unificado/page.tsx`
  - integrar queries de conversa + ticket
- **D2**
  - implementar `TicketHeader.tsx` + `EscalationBadge.tsx`
  - exibir status, prioridade, SLA e tempo restante
- **D3**
  - implementar `FinancialContextCard.tsx` com leitura de `contexto_snap`
  - implementar `TicketTimeline.tsx` com eventos de ticket
- **D4**
  - habilitar transicao de status do ticket e refletir no timeline
  - ajustar `settings/page.real.tsx` para `driver_type` (`fixo|diarista`)
- **D5**
  - QA funcional da operacao sem sair da inbox
  - correcoes de UX (loading/empty/error/retry) e fechamento da sprint

#### Sprint 4 (Semana 4) - P1 MCP no fluxo + explicabilidade + governanca

- **D1**
  - implementar no de engine `toolCallMcp.ts` + registry
  - definir contrato tecnico de `tool/action/input/context`
- **D2**
  - implementar `ToolCallMcpNode.tsx` + schema no builder
  - validar bloqueio de publish em contrato invalido
- **D3**
  - implementar `OperationalContextPanel.tsx`
  - integrar chamadas `mcp-operacao`
- **D4**
  - implementar `RoutingExplainCard.tsx` e integrar `mcp-routing`
  - validar explicabilidade no inbox
- **D5**
  - implementar governanca (`mcp-governance.ts`, tela de tools por tenant, auditoria operacional)
  - QA de permissoes por papel

#### Sprint 5 (Semana 5) - P2 metricas, alertas e hardening

- **D1**
  - definir KPIs finais de ticket/SLA/MCP com lideranca operacional
  - fechar contratos dos endpoints de metricas
- **D2**
  - implementar agregacoes em `flows.ts`, `tickets.ts`, `mcp-metrics.ts`
  - incluir p50/p95, erro, fallback por tool
- **D3**
  - implementar dashboard operacional (SLA, escalonamento, bot vs humano, saude MCP)
  - ajustar filtros por setor/supervisor/periodo
- **D4**
  - implementar alertas operacionais (erro MCP, backlog, SLA em risco)
  - validar thresholds e canais de notificacao
- **D5**
  - hardening final (performance, logs, falhas transientes)
  - fechamento com evidencias e checklist de release

#### Sprint 6+ (Semana 6 em diante) - Integracoes externas por tenant

- **D1**
  - priorizar conectores externos (ERP/CRM/financeiro) por valor de negocio
- **D2**
  - implementar `mcp-finance` com controles por tenant
- **D3**
  - implementar `mcp-integrations` (primeiro conector ERP/CRM)
- **D4**
  - validar isolamento por tenant, timeout/retry e auditoria
- **D5**
  - rollout piloto por feature flag e monitoramento assistido

## Gate local antes de testes integrados

- validar `.env` por servico com `npm run check:env`
- usar frontend em modo real
- confirmar schema aplicado no Supabase
- confirmar topicos e subscriptions do Pub/Sub
- validar health/login e fluxos críticos manualmente ou com o vosso pipeline de QA
