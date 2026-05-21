# Matriz de acesso por papel (referência)

Papéis no modelo: `admin`, `supervisor`, `attendant`, `operational`, `financial`, e `leader` (portal do líder).

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

Regras em `apps/web/src/lib/roleNav.ts` (`sidebarHrefsForRole`, `roleHasSettingsAccess`).

- **leader**: apenas Portal do Líder e Suporte Operacional (`roleHasSettingsAccess` falso).
- **supervisor**: menu operacional completo + financeiro + `/settings`.
- **financial**, **operational**, **attendant**: incluem `/settings` para o grupo Conta e sistema; itens operacionais na própria página respeitam `canViewSettingsSection`.

## API — usuários

- `GET /api/users`: apenas **admin** (listagem completa).
- `GET /api/users/attendants`: autenticado; lista atendentes (`roles.name === 'attendant'`). **Supervisor** e **attendant** limitados ao mesmo `sector_id` do JWT quando existir (`scope=sector`, padrão).
- `GET /api/users/attendants?scope=workspace`: lista todos os atendentes ativos do workspace — exige `pharmacies.manage` (ou papel admin/operational). Usado nos selects do cadastro de farmácias.

## Manutenção

Ao alterar `requireRole` nas rotas Fastify (`apps/api-service/src/routes`), atualize `roleNav.ts` e esta matriz para evitar 403 surpresa na UI.
