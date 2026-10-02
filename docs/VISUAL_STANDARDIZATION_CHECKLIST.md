# Checklist visual — Revive

Referência única: `apps/web/` e `docs/REVIVE_DESIGN_SYSTEM.md`.

```bash
npm run check:visual
npm run build --workspace=apps/web
```

## Primitivos (propagam para todo o app)

- [x] `FormControl` = Revive `input.tsx`
- [x] `CadastroSection` / `CadastroField` = Revive `Section` / `Field`
- [x] `PageHeader` = Revive `components/PageHeader.tsx`
- [x] `Button` / `Switch` = Revive `ui/button` / `ui/switch`
- [x] `--surface` distinto de `--card` (dark)

## Páginas por onda (comparar arquivo ↔ arquivo)

### Onda 1 — cadastro entregador
- [x] `EntregadorCadastro.tsx` → `drivers/new/page.tsx`
- [x] `EntregadorFicha.tsx` → `drivers/[id]/page.tsx`

### Onda 2 — listagens e farmácias + inbox
- [x] `Entregadores.tsx` → `drivers/page.tsx`
- [x] `FarmaciaCadastro.tsx` → `pharmacies/new/page.tsx`
- [x] `FarmaciaFicha.tsx` → `pharmacies/[id]/page.tsx`
- [x] `Farmacias.tsx` → `pharmacies/page.tsx`
- [x] `Inbox.tsx` → `inbox/page.tsx` (tokens; layout funcional mantido)

### Onda 3 — líderes, operação, financeiro, configurações
- [x] `Lideres.tsx` / `LiderFicha.tsx` → `leaders/*`
- [x] `Operacao.tsx` → `operacao/page.tsx` + `components/operacao/*`
- [x] `Financeiro.tsx` → `financial/page.tsx` (shell principal; modais/drawers mantêm estrutura)
- [x] `Configuracoes.tsx` → `settings/page.tsx` + painéis filhos

### Onda 4 — dashboard, CRM, comercial, login, campanhas
- [x] `Dashboard.tsx` → `dashboard/page.tsx` (IconTile, `bg-surface`, barras `bg-background/60`)
- [x] `Contatos.tsx` → `contacts/page.tsx` (KPIs, tabela, toolbars)
- [x] `comercial/Dashboard.tsx` → `CommercialDashboardPage.tsx` (shell principal)
- [x] `comercial/Leads.tsx` → `CommercialLeadsPage.tsx` + `CommercialLeadSidebarPanel` (master-detail Revive)
- [x] `comercial/LeadFicha.tsx` → `CommercialLeadFichaPage` + `CommercialLeadDetailPanel` (campos, tabs, botões)
- [x] Configuração comercial → `CommercialSettingsPage.tsx` (surface, botões Revive)
- [x] `Login.tsx` → `login/page.tsx` (glass card `bg-surface/40`)
- [x] `Campanhas.tsx` → `campaigns/page.tsx` (listagem)
- [x] `Automacoes.tsx` → `automations/page.tsx` (listagem)

### Onda 5 — portal líder, relatórios, modais, automações detalhe, usuários
- [x] Portal líder (`lider/*`, `leader/*`) — `bg-card-2` → `bg-muted`/`bg-surface`; chat/support alinhados
- [x] Relatórios (`reports/*`) — `ReportsRevivePage` + API `/api/reports/*` (Revive `relatorios/Atendimento.tsx`)
- [x] Comercial modais — `CommercialLossModal`, `CommercialConvertWizard`, `CommercialGenerateProposalModal` (botões/campos Revive)
- [x] Automações detalhe — `AutomationDetailPage.tsx` (`PageHeader`, `bg-surface`, tabs underline)
- [x] Automações listagem — `AutomationsListPage.tsx` (`bg-surface`)
- [x] `settings/users/*` — `UsersManagementPanel` + `UserDetailPanel` (KPI/tabela/ficha Revive `Usuarios.tsx` / `UsuarioFicha.tsx`)
- [x] `settings/automations/new` — stepper/painéis `bg-surface`, inputs `bg-background/40`, botões `reviveOutlineButtonClassName`
- [x] `ConversationFlowsPage` — KPI/tabela/painéis `bg-surface`, busca `bg-background/40`
- [x] Drawers comerciais — `CommercialChatDrawer`, `CommercialCopilotDrawer` (shell `bg-card`, footer `bg-surface`)

### Onda 6 — sweep final (automações aux., plataforma, operação, intake)
- [x] `AttendanceJourneyPage` + `CatalogsEditor` + `SimulateIntakeModal` (`bg-surface` / modal `bg-card`)
- [x] `LeaderIntakeWizard` — linhas selecionáveis `bg-background/40` (Revive `lider/Chat.tsx`)
- [x] `operacaoReviveTokens` — painéis `bg-surface` (Revive `Operacao.tsx`)
- [x] Console plataforma — `platform/settings`, `platform/workspaces`
- [x] `SurfacePanel` — `bg-surface` por padrão
- [x] `CommercialProposalPage` — aside valores `bg-surface`

### Onda 7 — financeiro (modais/drawers)
- [x] `financial/page.tsx` — painéis internos `bg-surface` / `bg-background/40`; shells de modal/drawer mantêm `bg-card`; botões `reviveOutlineButtonClassName`

### Onda 8b — portal líder (Visão geral, farmácias, entregadores, nova conversa)
- [x] `lider/page.tsx` — KPIs/quick actions com `IconTile`; **Tarefas dos entregadores** + **Assinaturas pendentes** (`GET /api/leader-portal/dashboard`); alertas/escala `bg-background/40` (Revive `lider/Dashboard.tsx`)
- [x] `lider/farmacias/page.tsx` — ficha `LeaderDetailField`; equipe em pills; lista Revive
- [x] `lider/entregadores/page.tsx` + `LeaderDriverDetailPanel` — ficha Revive `lider/Entregadores.tsx`
- [x] `lider/chat/page.tsx` + `LeaderIntakeWizard` — modal central Revive (`bg-card shadow-glow`, stepper, linhas `bg-background/30`); CTA `Nova conversa` + `shadow-glow`

### Onda 8 — inbox (refino de tokens)
- [x] `inbox/page.tsx` — notas via `MessageBubble`; composer `bg-surface/40`; histórico/itens `bg-background/40`; modais mantêm shell `bg-card`; textarea nota `bg-background/40`; hovers `hover:bg-surface-hover`
- [x] `MessageBubble.tsx` — inbound `bg-surface-elevated`; anexos/contato `bg-background/40`
- [x] `ConversationItem.tsx` — avatar tile `bg-surface-elevated`
- [x] `ContactProfileModal` — painéis `bg-surface`; nested `bg-background/40`
- [x] `InboxDriverRegistrationForm`, `InboxRequestInfoPanel`, `InboxAdvanceDecisionBar`, `InboxTaskWorkspace`, `TicketHistoryCard`

## Removido (não usar)

- `reports/design-preferences.json` (preferências capturadas)
- `reports/design-preferences.json`
- `/design-system/preferencias`
- `PageHeader variant="plain"`
