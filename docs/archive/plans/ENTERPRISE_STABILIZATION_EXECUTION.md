# Execução De Estabilização Enterprise

## Sumário Executivo

A etapa elevou a plataforma para um padrão mais forte de governança SaaS: operações tenantizadas passam a ter helpers oficiais de workspace, logging estruturado foi reforçado, redaction é obrigatória no logger central, correlation ID foi iniciado no HTTP/Pub/Sub, automações legadas foram congeladas para criação e RLS foi preparado para rollout progressivo.

## Implementado

- Workspace guard layer em `workspaceContext`: `requireWorkspace`, `scopedQuery`, `scopedSelect`, `scopedInsert`, `scopedUpdate` e `scopedDelete`.
- Auditoria automática `npm run governance:workspace` para localizar rotas com `supabase.from()` sem escopo.
- Logger enterprise em `@plataforma/logger` com campos obrigatórios, redaction, `PlatformError`, error taxonomy, child logger e helpers Pub/Sub.
- Middleware HTTP de contexto no `api-service`, gerando `x-request-id` e `x-correlation-id`.
- Propagação Pub/Sub no `webhook-service` e consumo contextual no `orchestrator-service`.
- `audit_logs` passa a aceitar `correlation_id` e `request_id` dentro de `metadata`.
- Congelamento de criação de `routing_rules` e `bot_flows` legados por padrão.
- Auditoria automática `npm run governance:automations`.
- Tenantização operacional via migration `034`.
- Policies RLS preparadas via `035` e controle progressivo/rollback via `036`.

## RLS Progressivo

RLS global não deve ser habilitado diretamente em produção. A migration `036_progressive_rls_control.sql` mantém policies preparadas e desabilita enforcement global, registrando as tabelas em `rls_rollout_control`.

Rollout recomendado:

1. Aplicar em staging.
2. Rodar testes cross-tenant por tabela crítica.
3. Habilitar RLS por grupos pequenos.
4. Monitorar erros 403/401, latência e queries.
5. Promover para produção apenas após validação.

Rollback:

```sql
ALTER TABLE public.<tabela> DISABLE ROW LEVEL SECURITY;
UPDATE public.rls_rollout_control
SET desired_state = 'rolled_back', updated_at = now()
WHERE table_name = '<tabela>';
```

## Automações

Runtime oficial:

1. `workspace_channels.config`
2. `conversation_flow_bindings`
3. `conversation_flow_definitions`
4. `automation_rules`
5. fallback legado

Criação de `bot_flows` e `routing_rules` fica bloqueada por padrão. Para manutenção excepcional:

```bash
ALLOW_LEGACY_AUTOMATION_WRITES=true
```

## Observabilidade

Artefatos disponíveis:

- `scripts/audit-gcp-readonly.mjs`
- `scripts/gcp/monitoring-baseline.json`

Aplicação do alerta base:

```bash
gcloud alpha monitoring policies create --policy-from-file=scripts/gcp/monitoring-baseline.json
```

## Backlog Priorizado

- P0: aplicar inventário real GCP read-only com credenciais do projeto.
- P0: validar RLS em staging com testes cross-tenant.
- P1: expandir uso dos helpers `scoped*` para todas as rotas tenantizadas.
- P1: remover `console.*` residual em workers após estabilização.
- P1: criar dashboards Cloud Monitoring completos para API, Pub/Sub, workers, IA e banco.
- P2: reduzir uso de service role em rotas user-scoped.
