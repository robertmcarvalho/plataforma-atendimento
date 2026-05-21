# Plano Formal De Isolamento Multi-Tenant E RLS

## Diagnóstico

A plataforma usa `workspace_id` como chave de isolamento, mas os serviços backend operam com `SUPABASE_SERVICE_ROLE_KEY`. Isso significa que o isolamento efetivo depende dos filtros no código, não de RLS.

A auditoria read-only identificou:

- 60 tabelas públicas;
- 50 tabelas com `workspace_id`;
- 60 tabelas sem RLS habilitado;
- 22 tabelas tenantizadas sem índice explícito por `workspace_id` antes da migration `033_workspace_governance_indexes.sql`.

## Classificação

### Globais

- `workspaces`
- `users`
- `platform_settings`
- `conversation_tag_catalog`
- `ai_topics`
- `processed_webhook_events`

### Tenantizadas

- `app_settings`
- `workspace_memberships`
- `workspace_channels`
- `roles`
- `sectors`
- `contacts`
- `conversations`
- `messages`
- `drivers`
- `pharmacies`
- `leaders`
- `tickets`
- `ticket_events`
- `financial_entries`
- `financial_installments`
- `campaigns`
- `campaign_recipients`
- `campaign_dispatch_logs`
- `automation_rules`
- `automation_runs`
- `bot_flows`
- `routing_rules`
- `sla_policies`
- `sla_events`
- `api_tokens`
- `audit_logs`
- `conversation_flow_*`
- `workspace_* catalogs`

### Híbridas A Revisar

- `pending_tasks`
- `supply_requests`
- `financial_imports`
- `financial_import_rows`
- `email_delivery_log`
- `ai_topics`

## Estratégia Recomendada

Adotar modelo híbrido:

1. Curto prazo: controles compensatórios fortes no backend.
2. Médio prazo: RLS para qualquer acesso user-scoped/futuro.
3. Longo prazo: reduzir service role em rotas de usuário e manter service role apenas para workers internos/admin.

## Controles Compensatórios Obrigatórios

- Toda rota tenantizada deve chamar `requireWorkspace()`.
- Toda query tenantizada deve filtrar `workspace_id`.
- Inserts tenantizados devem preencher `workspace_id`.
- Updates/deletes tenantizados devem combinar `id` + `workspace_id`.
- `app_settings` operacional deve passar por helper workspace-aware.
- Rotas platform devem usar middleware explícito de platform role.
- CI deve detectar rotas com `supabase.from()` sem `requireWorkspace()` em domínios tenantizados.

## Rollout RLS

### Fase 1: Preparação

- Garantir índices por `workspace_id`.
- Classificar tabelas globais, tenantizadas e híbridas.
- Corrigir rotas sem escopo antes de habilitar policies.

### Fase 2: Policies De Leitura

Criar policies baseadas em `workspace_memberships` para tabelas tenantizadas, inicialmente em ambiente de staging.

### Fase 3: Escrita Controlada

Permitir escrita apenas para roles compatíveis e via funções/RPC quando necessário.

### Fase 4: Separação De Clients

- Client usuário/JWT para rotas user-scoped.
- Service role apenas para workers, webhooks, jobs e rotas platform/admin internas.

## Validação

- Testes cross-tenant: usuário A não lê workspace B.
- Testes de inserts sem `workspace_id` devem falhar.
- Auditoria de endpoints críticos: inbox, tickets, mensagens, financeiro, campanhas, automações e settings.
- Rollback por feature flag de client/RLS em staging antes de produção.

## Próximos Itens Críticos

- Revisar `apiTokens.ts` e `auditLogs.ts` para `requireWorkspace()`.
- Revisar `tickets.ts` e jobs de SLA para preencher e filtrar `workspace_id`.
- Migrar settings operacionais legadas para helpers workspace-aware.
