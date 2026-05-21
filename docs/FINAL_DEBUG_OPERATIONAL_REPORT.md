# Relatório — Fase Final de Debug Operacional

**Data:** 2026-05-19  
**Escopo:** Auditoria técnica do repositório + gates locais; plano executável para STAGING (debug pesado) e PRODUÇÃO PILOTO (observacional).  
**Ambiente analisado em código:** branch atual do monorepo `plataforma_atendimento`.  
**Execução em STAGING/PROD GCP:** não realizada neste ciclo (credenciais/URLs de staging não disponíveis no agente).

---

## Status final

### **APROVADO COM RESSALVAS**

| Critério | Resultado |
|----------|-----------|
| Governança workspace (CI gate) | ✅ `findings: []` |
| Governança automações | ✅ ordem oficial + legacy congelado |
| Idempotência webhook (design) | ✅ claim PK `meta_message_id` |
| Correlation HTTP webhook | ✅ |
| Stress / chaos em staging | ⏳ **Pendente execução** |
| RLS em produção | ⏳ Rollout progressivo obrigatório |
| Pentest cross-tenant API | ⏳ Parcial (smoke DB apenas) |
| Observabilidade completa | ⏳ Baseline mínima |

**Bloqueia produção plena (tráfego amplo):** P0-001, P0-002, P0-003 até conclusão em staging.  
**Permite produção piloto controlada:** 1–3 workspaces, 1 canal WhatsApp, sem campanhas em massa, com monitoramento 24–72h.

---

## 1. Resumo executivo

A plataforma possui **fundação enterprise madura em código**: helpers de workspace, auditoria automática de rotas, ordem oficial de automação, idempotência de inbound, correlation ID no webhook/API, e runbooks de staging documentados.

**Gaps antes de go-live amplo:**

1. **Isolamento depende de service role + filtros no código** — RLS preparado mas não enforced.
2. **Testes de carga/chaos não estão automatizados** no repositório — dependem de execução manual em staging.
3. **Observabilidade GCP** tem apenas alerta base de 5xx — faltam dashboards Pub/Sub, workers, IA, DLQ.
4. **Bug potencial cross-tenant** em `refreshConversationSla` (carrega todas as `sla_policies` sem `workspace_id`).

---

## 2. O que foi executado neste ciclo

### Local (repositório)

```bash
npm run governance:workspace   # ok: true, findings: []
npm run governance:automations # ok: true, official_runtime_order confirmado
```

### Revisão estática

- `api-service`: `registerRequestContext`, `requireWorkspace`, `scoped*` em rotas principais.
- `webhook-service`: HMAC, correlation, Pub/Sub envelope.
- `orchestrator-service`: idempotência, flow runtime, catálogo por canal.
- Documentação: `GO_LIVE_CHECKLIST`, `STAGING_QA_RUNBOOK`, `OBSERVABILITY_AND_LOGGING`, `MULTITENANT_ISOLATION_RLS_PLAN`.

### Não executado (requer staging/prod)

- Stress (centenas de mensagens simultâneas).
- Chaos (Redis/Pub/Sub/worker/IA down).
- Métricas Cloud Run / Monitoring ao vivo.
- Pilot rollout em `aetheraai.online`.

---

## 3. Matriz de achados

Legenda: **Bloqueia** = impede go-live amplo sem correção ou mitigação documentada.

| ID | Sev. | Área | Descrição | Evidência | Impacto | Bloqueia | Esforço |
|----|------|------|-----------|-----------|---------|----------|---------|
| **P0-001** | CRÍTICO | Multi-tenant | RLS desabilitado; isolamento só via código + service role | `MULTITENANT_ISOLATION_RLS_PLAN.md` | Vazamento se rota omitir filtro | Sim (amplo) | Alto |
| **P0-002** | CRÍTICO | QA Staging | Stress/chaos não executados | Ausência scripts k6/chaos; runbook manual | Gargalos desconhecidos | Sim (amplo) | Médio |
| **P0-003** | ALTO | Observabilidade | Dashboards/alertas incompletos | `monitoring-baseline.json` só 5xx | MTTR alto | Ressalva | Médio |
| **P0-004** | ALTO | Segurança prod | `ENABLE_DEV_ROUTES` / dev-bootstrap | `api-service/src/index.ts` | Superfície ataque | Sim se `true` | Baixo |
| **P1-001** | ALTO | Multi-tenant | SLA orchestrator sem filtro `workspace_id` | `conversationSla.ts:66` `select('*')` | SLA errado cross-tenant | Ressalva piloto | Baixo |
| **P1-002** | ALTO | IA | Rate limit copiloto fallback in-memory | `copilotRateLimit.ts` | Bypass multi-réplica | Ressalva | Baixo |
| **P1-003** | ALTO | API | `leader-portal.ts` — IDOR em absences/dailies/supply (corrigido) | [LEADER_PORTAL_SECURITY_AUDIT.md](./LEADER_PORTAL_SECURITY_AUDIT.md) | Lançamentos indevidos | Mitigado | Médio |
| **P1-004** | ALTO | Performance | Orchestrator monolítico (~2.7k LOC) | `orchestrator-service/src/index.ts` | Concorrência/cold start | Ressalva | Alto |
| **P1-005** | MÉDIO | Automação | Flow runtime sem detector de loop explícito | `conversationFlowRuntime.ts` | Loop infinito possível | Ressalva | Médio |
| **P1-006** | MÉDIO | Workers | `console.*` no orchestrator | vários `console.log/warn` | Logs não estruturados | Não | Baixo |
| **P2-001** | MÉDIO | Testes | Sem suite fuzz API cross-tenant HTTP | só `smoke-multitenant-isolation-db` | Regressão | Ressalva | Médio |
| **P2-002** | BAIXO | Redis | Redis não referenciado nos apps runtime | grep apps/* | Fila = Pub/Sub | Não | — |
| **P2-003** | MELHORIA | Piloto | Rollout MCP por `pilot_tenants` | `mcp-tools.ts` | Bom padrão piloto | Não | — |

---

## 4. STAGING — Plano de debug pesado (executar)

Referência: [STAGING_QA_RUNBOOK.md](./STAGING_QA_RUNBOOK.md)

### 4.1 Pré-voo

- [ ] Backup staging identificado
- [ ] `CONFIRM_STAGING_MIGRATIONS=true` + migrations 033–036
- [ ] `npm run governance:workspace` / `governance:automations` / `db:audit:governance`
- [ ] Pub/Sub: `scripts/gcp/pubsub-bootstrap.ps1` + DLQ `platform.dead-letter`

### 4.2 Stress test (staging only)

| Cenário | Alvo | Critério aceite |
|---------|------|-----------------|
| 200+ inbound/min | webhook → Pub/Sub → orchestrator | p95 ingest < 3s, sem 5xx sustentado |
| 5 workspaces paralelos | isolamento inbox | zero conversa cross-tenant |
| 20 atendentes | API inbox + mensagens | p95 API < 800ms leitura |
| 3 campanhas pequenas | campaign-worker | sem duplicidade recipient |
| 10 chamadas copiloto/min | api copilot | rate limit + sem OOM |
| Fila artificial | backlog Pub/Sub | DLQ não cresce sem limite; recovery < 15min |

**Ferramenta sugerida:** k6 ou Artillery apontando `API_BASE_URL` / webhook staging; publicar envelopes Pub/Sub com `correlation_id` único.

### 4.3 Chaos test (staging only)

| Falha | Injeção | Validação |
|-------|---------|-----------|
| Worker down | scale orchestrator=0 5min | mensagens acumulam; recovery sem duplicar após scale up |
| Meta API | mock 503 | retry limitado; sem loop |
| IA provider | invalid key | fallback modelo / erro gracioso |
| Pub/Sub lento | ack deadline reduzido | nack + retry; DLQ após N |
| Supabase lento | throttle connection | timeout + log com correlation_id |

### 4.4 Multi-tenant malicioso (staging)

```bash
npm run smoke:multitenant-isolation-db
```

**Adicional manual/API:**

- JWT workspace A + `x-workspace-id` workspace B → esperado **403/412**
- `GET /api/conversations/:id` de outro tenant → **404**
- `PATCH` financeiro com `workspace_id` manipulado no body → ignorado/rejeitado
- Revisar `leader-portal` com tokens de líderes distintos

### 4.5 Automações — ordem oficial

1. `workspace_channels.config`
2. `conversation_flow_bindings` (priority DESC)
3. `conversation_flow_definitions` / versions published
4. `automation_rules`
5. fallback legado (`bot_flows`, `routing_rules`)

Validar: trigger por keyword, canal errado não executa fluxo, publicação gera sessão rastreável.

### 4.6 Workers e filas

- Idempotência: mesmo `meta_message_id` 2x → segundo ignorado (23505).
- Campanha: recipient não duplicado (`dedupeRecipients`).
- Scheduler: heartbeat / jobs SLA (`smoke:sla-jobs-direct`).

### 4.7 IA

```bash
npm run smoke:ai-api
npm run smoke:ai-analyzer-direct
```

Simular: timeout, rate limit, resposta inválida, prompt injection em copilot (resposta não deve executar tools não autorizadas).

### 4.8 Performance

- Cloud Run: CPU/mem p95 durante stress
- Supabase: queries > 500ms (pg_stat_statements)
- Índices `workspace_id` (migration 033)

---

## 5. PRODUÇÃO PILOTO — Debug observacional (sem stress)

### 5.1 Rollout gradual

| Fase | Workspaces | Canais | Automação | Duração |
|------|------------|--------|-----------|---------|
| P0 | 1 | 1 WhatsApp | intake + 1 fluxo | 72h |
| P1 | 2–3 | +1 canal | +campanha pequena | 1 semana |
| P2 | expansão | conforme métricas | flows adicionais | go/no-go |

### 5.2 Monitorar (somente leitura)

- Logs: `correlation_id`, `workspace_id`, `error_code`
- Pub/Sub backlog / DLQ
- Cloud Run 5xx / latência
- Custo IA (tokens)
- SLA vencidos vs criados
- Webhook volume vs inbox

### 5.3 Proibido em produção piloto

- Stress > 50 msg/min artificial
- Chaos (matar workers, derrubar Redis)
- Migrations sem backup
- `ENABLE_DEV_ROUTES=true`

---

## 6. Observabilidade e alertas

### Implementado

- `@plataforma/logger` com redaction
- `x-correlation-id` API + webhook
- `scripts/gcp/monitoring-baseline.json` (5xx Cloud Run)

### Criar/monitorar (GCP)

| Dashboard | Métricas |
|-----------|----------|
| Pub/Sub | backlog, oldest_unacked, dead_letter |
| Webhook | req/s, 401 HMAC, publish failures |
| Orchestrator | process latency, duplicate rate, errors |
| Campaign | send rate, Meta errors |
| API | p50/p95, 5xx por rota |
| IA | calls, latency, custo estimado |
| DB | slow queries, connections |

### Alertas mínimos (produção piloto)

- 5xx > 2% / 5min
- DLQ > 0 sustentado 10min
- Backlog Pub/Sub > limiar 10min
- Worker sem logs 2 ciclos scheduler
- IA custo diário > orçamento

---

## 7. Checklist go-live (consolidado)

Ver também [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md).

**Bloqueantes:**

- [ ] P0-002 stress/chaos staging verde
- [ ] P0-001 plano RLS ou aceite formal de compensating controls assinado
- [ ] P1-001 patch SLA `workspace_id` filter
- [ ] Secrets produção (`JWT_SECRET`, sem dev routes)
- [ ] Backup Supabase produção
- [ ] E2E WhatsApp real em staging → repetir 1x em piloto prod

**Piloto:**

- [ ] `pilot_tenants` MCP se usar finance/integrations
- [ ] Dashboards + on-call
- [ ] Runbook rollback deploy Cloud Run

---

## 8. Backlog priorizado (correção)

| Prioridade | Item | Ação |
|------------|------|------|
| P0 | P1-001 SLA cross-tenant | `.eq('workspace_id', workspaceId)` em `refreshConversationSla` |
| P0 | Stress/chaos staging | Executar runbook §4; registrar métricas |
| P0 | RLS rollout | Staging por grupos de tabelas (`036`) |
| P1 | P1-002 rate limit | Garantir `rate_limit_buckets` em prod; remover fallback memória |
| P1 | P1-003 leader-portal | `npm run security:leader-portal-idor` em staging pós-deploy |
| P1 | Stress staging | `npm run stress:staging` + `npm run stress:staging:pubsub` |
| P1 | Chaos staging | `npm run chaos:staging` (ver [CHAOS_STAGING_RUNBOOK.md](./CHAOS_STAGING_RUNBOOK.md)) |
| P1 | Observabilidade | Aplicar policies + dashboards completos |
| P2 | P1-004 orchestrator | Modularizar; limitar concorrência por subscription |
| P2 | P1-005 flow loops | max_steps / timeout por sessão |

---

## 9. Plano de rollback

1. **Cloud Run:** revisão anterior (`gcloud run services update-traffic --to-revisions=...`)
2. **Web:** idem
3. **Migrations:** não reverter em prod sem script; preferir forward-fix
4. **RLS:** `DISABLE ROW LEVEL SECURITY` por tabela (`036` rollback SQL)
5. **Piloto:** remover workspace de tráfego Meta / desativar canal

---

## 10. Comandos rápidos

```powershell
# Governança
npm run governance:workspace
npm run governance:automations

# Staging smokes (após env)
$env:API_BASE_URL="https://api-staging..."
npm run smoke:multitenant-isolation-db
npm run smoke:ticketing-mcp-api
npm run smoke:ai-api
npm run smoke:inbox-unificado-guided-api

# GCP readonly audit
npm run audit:gcp:readonly

# Gate CI
gcloud builds submit . --config=deploy/cloudbuild-governance-check.yaml
```

---

## 11. Conclusão técnica

A arquitetura **está alinhada** com operação enterprise (multi-tenant por `workspace_id`, automação governada, idempotência inbound, correlação distribuída). O repositório **não substitui** a validação em staging com carga e falhas reais.

**Recomendação:** iniciar **produção piloto** apenas após (1) patch P1-001, (2) stress moderado em staging verde, (3) secrets/flags de produção conferidos, (4) dashboards mínimos ativos.

**Reprovação para produção ampla** até P0-001 e P0-002 fechados.

---

*Gerado por auditoria estática + gates locais. Atualizar com evidências de staging (métricas, screenshots, logs correlation_id) após execução do runbook.*
