# Plano: migrar crons do scheduler-service → Cloud Scheduler + `min=0`

Projeto: `rh-coopmob-bot` / `flux-farma-scheduler`  
Data: 2026-07-15  
Objetivo: eliminar ~**US$ 49/mês** da instância quente 24h mantendo jobs críticos.

---

## Situação atual

O `flux-farma-scheduler` roda com **`min-instances=1`** e **`cpu-throttling=false`** porque usa **`node-cron` dentro do processo**. Enquanto o relógio estiver no container, o Cloud Run precisa ficar ligado 24h.

| Componente | Custo warm estimado |
|------------|---------------------|
| `flux-farma-scheduler` | ~US$ 49/mês |
| Cloud Scheduler (alvo) | centavos / poucos US$/mês |

**Meta pós-migração:** scheduler em `min=0`; Cloud Scheduler dispara HTTP nos horários certos.

---

## Inventário de jobs (18 crons + 1 evaluador dinâmico)

Legenda de prioridade:
- **P0** — latência / SLA / custo crítico; migrar com teste rigoroso
- **P1** — operação diária importante
- **P2** — batch / baixa frequência; migrar por último

| # | Job | Cron (BRT) | Freq. | Exec/dia | Módulo | P |
|---|-----|------------|-------|----------|--------|---|
| 1 | SLA adiantamento | `* * * * *` | 1 min | ~1.440 | `advanceTasksSlaJobs` | P0 |
| 2 | SLA queue_sla | `* * * * *` | 1 min | ~1.440 | `queueSlaJobs` | P0 |
| 3 | SLA conversas (warning/breach) | `*/2 * * * *` | 2 min | ~720 | inline `index.ts` | P0 |
| 4 | SLA tickets (80% + escalonamento) | `*/2 * * * *` | 2 min | ~720 | `ticketsSlaJobs` | P0 |
| 5 | Night mode orchestrator **off** | `0 22 * * *` | diário 22:00 | 1 | `orchestratorNightMode` | P0 |
| 6 | Night mode **warmup** | `55 5 * * *` | diário 05:55 | 1 | `orchestratorNightMode` | P0 |
| 7 | Night mode orchestrator **on** | `0 6 * * *` | diário 06:00 | 1 | `orchestratorNightMode` | P0 |
| 8 | Automações `trigger_type=schedule` | `*/5 * * * *` | 5 min | ~288 | inline + `shouldRunNow` | P1 |
| 9 | Sync assinaturas Autentique | `*/15 * * * *` | 15 min | ~96 | `signatureSyncJobs` | P1 |
| 10 | Rescore leads comerciais | `*/30 * * * *` | 30 min | ~48 | `commercialLeadScoringJobs` | P1 |
| 11 | Relatório diário tickets supervisor | `0 18 * * *` | diário 18:00 | 1 | `ticketsSlaJobs` | P1 |
| 12 | Alertas CNH/certificado entregadores | `15 6 * * *` | diário 06:15 | 1 | `driverDocumentExpiryJobs` | P1 |
| 13 | Sync entregadores Flux | `0 */6 * * *` | 6 h | ~4 | `fluxDriverSyncJobs` | P1 |
| 14 | Sync entregas Flux → billing | `30 6 * * *` | diário 06:30 | 1 | `fluxDeliverySyncJobs` | P1 |
| 15 | Prazo assinatura Autentique | `30 7 * * *` | diário 07:30 | 1 | `signatureDeadlineJobs` | P1 |
| 16 | Parcelas vencidas (financeiro) | `5 0 * * *` | diário 00:05 | 1 | inline | P2 |
| 17 | Aviso desconto semanal | `0 8 * * 1` | seg 08:00 | ~0,14 | inline | P2 |
| 18 | Limpeza `processed_webhook_events` | `0 3 * * 0` | dom 03:00 | ~0,14 | inline | P2 |

**Volume estimado:** ~4.800 invocações HTTP/dia se cada cron virar um job Cloud Scheduler separado.

**Nota:** jobs de 1–2 min são o maior desafio (cold start + custo de invocação). Recomenda-se **agrupar** em poucos endpoints tick (ver Fase 2).

---

## Arquitetura alvo

```
Cloud Scheduler (America/Sao_Paulo)
  ├── POST /jobs/tick-minute     (1 min)  → advance SLA + queue SLA
  ├── POST /jobs/tick-2min       (2 min)  → conversation SLA + tickets SLA
  ├── POST /jobs/tick-5min       (5 min)  → automation rules schedule
  ├── POST /jobs/...             (diários / opcionais)
  └── OIDC (SA scheduler → run.invoker)

flux-farma-scheduler (min=0)
  └── executa handler e desliga
```

Autenticação: Cloud Scheduler com **OIDC token** da SA do scheduler; rota valida audience/issuer.

---

## Fases de migração

### Fase 0 — Preparação (1–2 dias)

- [ ] Criar `apps/scheduler-service/src/http/jobsRouter.ts` com rotas `POST /jobs/:name`
- [ ] Extrair handlers dos `cron.schedule` para funções exportáveis (sem duplicar lógica)
- [ ] Middleware de auth (`Authorization: Bearer` OIDC ou header interno `X-Scheduler-Token`)
- [ ] `GET /health` já existe; adicionar `GET /jobs` (catálogo read-only para ops)
- [ ] Feature flag `SCHEDULER_HTTP_JOBS_ENABLED=true` (cron + HTTP em paralelo)

### Fase 1 — Jobs de baixa frequência (baixo risco)

Migrar primeiro (validar padrão HTTP + cold start):

| Endpoint | Cloud Scheduler | Cron equivalente |
|----------|-----------------|------------------|
| `POST /jobs/financial-overdue` | `5 0 * * *` | parcelas vencidas |
| `POST /jobs/installment-weekly` | `0 8 * * 1` | desconto semanal |
| `POST /jobs/webhook-cleanup` | `0 3 * * 0` | limpeza webhooks |
| `POST /jobs/tickets-daily-report` | `0 18 * * *` | relatório supervisor |
| `POST /jobs/driver-doc-expiry` | `15 6 * * *` | CNH/certificado |
| `POST /jobs/signature-deadline` | `30 7 * * *` | prazo Autentique |
| `POST /jobs/flux-delivery-sync` | `30 6 * * *` | entregas Flux |
| `POST /jobs/flux-driver-sync` | `0 */6 * * *` | entregadores Flux |
| `POST /jobs/commercial-scoring` | `*/30 * * * *` | rescore leads |
| `POST /jobs/signature-sync` | `*/15 * * * *` | sync Autentique |

**Critério de saída:** 7 dias sem falha; remover `cron.schedule` correspondente.

### Fase 2 — Jobs de alta frequência (crítico)

| Endpoint | Cloud Scheduler | Conteúdo |
|----------|-----------------|----------|
| `POST /jobs/tick-minute` | `* * * * *` | `advanceSla` + `queueSla` |
| `POST /jobs/tick-2min` | `*/2 * * * *` | conversation SLA + tickets SLA |
| `POST /jobs/tick-5min` | `*/5 * * * *` | automation rules schedule |

**Validação obrigatória:**
- SLA tickets/adiantamento: zero regressão em `sla_events` / escalonamentos
- Cold start p95 < 5s (scheduler 512Mi)
- Idempotência (retry do Scheduler não duplica alertas)

### Fase 3 — Night mode (já parcialmente isolado)

| Endpoint | Cron |
|----------|------|
| `POST /jobs/orchestrator-night-off` | `0 22 * * *` |
| `POST /jobs/orchestrator-night-warmup` | `55 5 * * *` |
| `POST /jobs/orchestrator-night-on` | `0 6 * * *` |

Pode migrar **antes** da Fase 3 geral (já está em `orchestratorNightMode.ts`).

### Fase 4 — `min=0` no scheduler

1. Confirmar **todos** os crons removidos do `node-cron`
2. `configure-workers-pilot.ps1`: scheduler `min=0` + `cpu-throttling=true`
3. `post-deploy-pilot.ps1` + `verify-run-scaling.ps1` atualizados
4. Monitorar 7 dias: falhas Scheduler, latência jobs, custo Cloud Run

**Rollback:** `configure-workers-pilot.ps1` com scheduler `min=1`; reativar crons via deploy anterior.

---

## Script GCP: criar jobs Cloud Scheduler

Exemplo (após Fase 1):

```powershell
$project = "rh-coopmob-bot"
$region = "us-central1"
$schedulerUrl = gcloud run services describe flux-farma-scheduler --region=$region --format="value(status.url)"
$sa = "713561463013-compute@developer.gserviceaccount.com"

gcloud scheduler jobs create http flux-scheduler-financial-overdue `
  --location=$region --project=$project `
  --schedule="5 0 * * *" --time-zone="America/Sao_Paulo" `
  --uri="$schedulerUrl/jobs/financial-overdue" --http-method=POST `
  --oidc-service-account-email=$sa --oidc-token-audience=$schedulerUrl
```

Repetir para cada endpoint. Naming: `flux-scheduler-<job-name>`.

---

## Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| Cold start atrasa SLA 1 min | Agrupar ticks; `min=0` só após métricas OK |
| Duplo disparo (cron + Scheduler) | Feature flag; remover cron só após validação |
| Job falha silenciosa | Log estruturado + alerta em `severity>=ERROR` |
| Deploy reseta scaling | Manter `post-deploy-pilot.ps1` |
| Night mode 22–06h acumula mais fila Pub/Sub | Webhook `min=1`; drain 06:00; monitorar backlog |

---

## Economia esperada

| Item | Antes | Depois |
|------|-------|--------|
| Scheduler warm | ~US$ 49/mês | ~US$ 2–5/mês (invocações + cold starts) |
| Cloud Scheduler | ~US$ 0 | ~US$ 1–3/mês |
| **Total scheduler** | **~US$ 49** | **~US$ 3–8** |

Combinado com night mode orchestrator **22:00–06:00** (~8h/dia, ~33% do dia):

| Item | Economia adicional orchestrator |
|------|----------------------------------|
| Antes (00–06, 6h) | ~US$ 12/mês |
| Agora (22–06, 8h) | ~**US$ 16/mês** |

**Economia total potencial (scheduler migrado + night 22–06):** ~**US$ 55–60/mês** vs baseline jul/01.

---

## Ordem recomendada de execução

1. **Deploy night mode 22–06** (código já neste PR) — ganho imediato ~US$ 4/mês extra
2. Fase 0 + Fase 1 (HTTP + jobs diários)
3. Fase 2 (ticks 1/2/5 min) com monitoramento SLA
4. Fase 3 night mode → Cloud Scheduler (opcional; cron interno já funciona)
5. Fase 4 `min=0` scheduler

---

## Checklist de validação pós-migração

```powershell
$env:GCP_PROJECT_ID = "rh-coopmob-bot"
npm run gcp:verify:night-mode
.\scripts\gcp\verify-run-scaling.ps1 -Profile pilot
npm run gcp:audit:cost
# Logs: flux-farma-scheduler [Cron] / [NightMode] / POST /jobs/*
```

---

## Referências

- [`apps/scheduler-service/src/index.ts`](../../apps/scheduler-service/src/index.ts)
- [`docs/DEPLOY_CLOUD_RUN.md`](../DEPLOY_CLOUD_RUN.md) — Fase 4 roadmap
- [`docs/CLOUD_RUN_SCALING.md`](../CLOUD_RUN_SCALING.md) — night mode 22–06
