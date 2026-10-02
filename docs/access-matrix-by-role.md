# Matriz de acesso por papel (referência)

Papéis no modelo: `admin`, `supervisor`, `attendant`, `operational`, `financial`, `financial_auditor` (Auditor financeiro), e `leader` (portal do líder).

## Configurações (`/settings` — `apps/web/src/app/(app)/settings/page.tsx`)

Layout alinhado ao mock em `project-revive-main` (PageHeader **Sistema / Configurações**, grid 12 colunas, menu com descrição + chevron, cartão `bg-surface`).

### Grupo **Conta e sistema** (placeholders e leitura parcial)

Visível a todos os perfis com acesso à página de configurações, exceto **leader** (sem entrada em `/settings`).

| Seção (id) | Conteúdo | API / persistência |
|------------|----------|-------------------|
| `workspace` | Identidade (logo, nome, slug, CNPJ mock); **fuso** editável | `workspace_timezone` via `GET/PUT /api/settings` (PUT só **admin**); demais campos mock até haver modelo |
| `profile`, `appearance` | Placeholder “Em breve” | — |
| `channels` | Lista de canais (estado parcial) | Ex.: WhatsApp pode refletir env no futuro; hoje indicador genérico |
| `notifications` | Toggles de referência (UI) | Persistência por usuário em breve |
| `security_2fa` | 2FA e sessões (mock) | Backend dedicado em breve |
| `api_tokens` | Lista de tokens (mock) | Rota de API real em breve |

### Grupo **Operação** (domínio atual)

| Seção / API | admin | supervisor | attendant / operational / financial |
|-------------|-------|------------|----------------------------------------|
| Atendimento (`PUT /api/settings` assinatura) | sim | — | — |
| Templates | sim | sim (POST/PUT) | só leitura do grupo Conta; sem esta seção |
| SLA | sim | sim (DELETE só admin) | — |
| Setores | CRUD / leitura | leitura + status | — |
| Permissões (nav; id `users`) | tabela usuários | — | — |
| Roteamento / Bot / Auditoria (`security`) | sim | — | — |

Implementação: `settingsSectionsForRole`, `canViewSettingsSection`, `SYSTEM_SETTINGS_SECTIONS`, `OPS_SETTINGS_SECTIONS` no topo de `page.tsx`.

## Menu lateral (`apps/web/src/components/shell/Sidebar.tsx`)

Regras em `apps/web/src/lib/roleNav.ts` (`sidebarHrefsForRole`, `roleHasSettingsAccess`). Permissões granulares do perfil (JSON em `roles.permissions`) complementam o papel — ex.: `financial.view` libera `/financial` para `attendant`.

- **leader**: apenas Portal do Líder (`/lider/*`); sem `/operacao`, `/reports` nem `/settings`.
- **supervisor**: `/operacao` (coordenação de campo), `/reports` (BI atendimento), dashboard, financeiro, cadastros, `/settings`.
- **attendant**: `/operacao` — visual conforme setor (ver abaixo); sem `/reports` nem `/dashboard`. Com permissão **`financial.view`** no perfil, também `/financial` (menu e rota).
- **financial**: `/operacao` (gestão financeira + tarefas) + cadastros, `/financial`, `/settings`.
- **financial_auditor** (Auditor financeiro): somente `/billing` com subnav filtrada (conciliação, relatórios, DRE, acertos/a pagar/a receber em leitura). Pode conciliar baixas e importar extrato (`financial.reconcile`). Sem inbox, cadastros, `/reports`, aprovar acerto, mark_paid, fechar DRE ou enviar recibo.
- **operational** (analista operacional): `/operacao` (carteira), cadastros, financeiro, `/settings` (grupo Conta); sem `/reports`.

## Painéis de operação (`/operacao` + `/reports`)

Roteamento UI (`apps/web/src/lib/operacao/operacaoMode.ts` + `apps/web/src/app/(app)/operacao/page.tsx`):

| Setor principal (ou papel) | Visual |
|----------------------------|--------|
| Operacional | Carteira do analista — resumo + **tarefas** + **atendimentos** (`OperacaoCarteiraPage` + hub) |
| Atendimento Geral | Execução — **só gestão de tarefas** (sem envio Autentique na UI) |
| Financeiro (attendant) | Execução financeira (filtro `task_type`) |
| `financial` | Gestor financeiro — escopo **global** (`OperacaoFinanceiroGestorPage` + `financial-hub`) |
| `supervisor` / `admin` | Gestor operacional (`OperacaoGestorOperacionalPage` — carteira agregada de todos os analistas + filtro) |

Deep link: `/operacao?task={uuid}` abre o drawer da tarefa.

Plano UI operação (arquivado): `docs/archive/plans/OPERACAO_REVIVE_ADAPTATION_PLAN.md` — implementação em `components/operacao/revive/`.

| Rota / API | attendant | supervisor | admin | financial |
|------------|-----------|------------|-------|-----------|
| `GET /api/ops-analytics/portfolio` | sim (carteira) | — | — | — |
| `GET /api/ops-analytics/portfolio/hub` | sim (carteira + KPIs + pharmacy_cards + compliance + tarefas) | — | — | — |
| `GET /api/ops-analytics/financial-hub` | — | — | sim | sim |
| `GET /api/ops-analytics/execution-board` | sim (fila AG ou financeiro conforme setor) | — | — | — |
| `GET /api/ops-analytics/tasks/launch-context` | sim (`scope=portfolio` analista, `scope=ag` AG) | — | — | — |
| `POST /api/ops-analytics/tasks` (criação manual, `source: operacao_manual`) | sim (AG + analista; desligamento operacional só analista) | — | — | — |
| `GET /api/ops-analytics/portfolio/launch-context` | sim | — | — | — |
| `POST /api/ops-analytics/occurrences` (+ `on_behalf_of_leader_id`) | sim | — | — | — |
| `GET /api/ops-analytics/gestor-operacional/hub` | — | sim | sim |
| `GET /api/ops-analytics/gestor-operacional/attendants` | — | sim | sim |
| `GET /api/settings/operacao-task-config` | — | sim | sim |
| `PUT /api/settings` (`ops_task_playbooks`, `ops_task_sla_config`) | — | — | admin |
| `PATCH /api/tasks/:id/playbook-progress` | sim | sim | sim |
| `GET /api/ops-analytics/coordination` | — | sim | sim (legado BI) |
| `GET /api/tasks` (pendências do setor) | sim | sim | sim | sim |
| `GET /api/reports/*` | — | sim | sim | — |
| UI `/reports` | — | sim | sim | — |

Carteira do analista: farmácias onde é `primary_attendant_id`, `secondary_attendant_id` ou `pharmacy_sector_attendants.attendant_id`.

## API — usuários

- `GET /api/users`: apenas **admin** (listagem completa).
- `GET /api/users/attendants`: autenticado; lista atendentes (`roles.name === 'attendant'`). **Supervisor** e **attendant** limitados ao mesmo `sector_id` do JWT quando existir (`scope=sector`, padrão).
- `GET /api/users/attendants?scope=workspace`: lista todos os atendentes ativos do workspace — exige `pharmacies.manage` (ou papel admin/operational). Usado nos selects do cadastro de farmácias.

## Manutenção

Ao alterar `requireRole` nas rotas Fastify (`apps/api-service/src/routes`), atualize `roleNav.ts` e esta matriz para evitar 403 surpresa na UI.
