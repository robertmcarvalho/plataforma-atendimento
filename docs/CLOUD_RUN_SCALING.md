# Cloud Run — scaling piloto Flux Farma

Runbook de **configuração de custo**, **pós-deploy** e **rollback** dos serviços `flux-farma-*` no projeto `rh-coopmob-bot` (`us-central1`).

## Estado atual (produção)

**Sim — o perfil piloto já está aplicado no GCP** (desde 2026-06-06):

| Serviço | min-instances | CPU throttling |
|---------|---------------|----------------|
| `flux-farma-scheduler` | 0 | ligado (Cloud Scheduler HTTP) |
| `flux-farma-orchestrator` | 1 | desligado (CPU 24h — latência inbox) |
| `flux-farma-campaign` | 0 | ligado |
| `flux-farma-webhook` | 1 | ligado (min=1 + throttle — economia ~R$ 200/mês vs CPU 24h) |
| `flux-farma-api` | 0 | ligado (default) |
| `flux-farma-web` | 0 | ligado (default) |

Validar a qualquer momento:

```powershell
$env:GCP_PROJECT_ID = "rh-coopmob-bot"
.\scripts\gcp\verify-run-scaling.ps1 -Profile pilot
```

Custo estimado Cloud Run com este perfil: **~R$ 800–950/mês** nos 3 workers com CPU 24h (`scheduler`, `orchestrator`, `webhook` — ~US$ 47–50/mês cada). O webhook pode usar `min=1` + cpu-throttling para economizar ~R$ 200/mês (ver `optimize-webhook-cost-pilot.ps1`). vs ~R$ 900/mês só no perfil production antigo com campaign também quente.

Auditoria: `npm run gcp:audit:cost` → `reports/cloud-run-cost-audit-*.json`

### Night mode (orchestrator 22:00–06:00 BRT)

Reduz custo do `flux-farma-orchestrator` (~33% da instância quente) sem perder mensagens: o **webhook** continua publicando no Pub/Sub (retenção 7 dias); o orchestrator sobe às 06:00 e drena a fila para a inbox.

| Horário (BRT) | Ação |
|---------------|------|
| 22:00 | `min-instances=0` no orchestrator |
| 05:55 | Warmup `GET /health` (cold start) |
| 06:00 | `min-instances=1` + CPU 24h |

Override via env no scheduler: `ORCHESTRATOR_NIGHT_OFF_CRON`, `ORCHESTRATOR_NIGHT_WARMUP_CRON`, `ORCHESTRATOR_NIGHT_ON_CRON`.

**Setup (recomendado — cron no scheduler-service):**

```powershell
$env:GCP_PROJECT_ID = "rh-coopmob-bot"
# 1. Deploy imagem scheduler (com orchestratorNightMode.ts)
# 2. IAM + env + remove jobs Cloud Scheduler legados:
.\scripts\gcp\configure-orchestrator-night-mode.ps1
npm run gcp:post-deploy:pilot
```

**Setup legado (Cloud Scheduler HTTP — não usar; PUT retorna 404 na Run API v2):**

```powershell
.\scripts\gcp\setup-orchestrator-night-scheduler.ps1
```

**Validar:** `npm run gcp:verify:night-mode`  
**Manual:** `.\scripts\gcp\orchestrator-night-scale.ps1 -Mode off|on|status`  
**Remover:** `.\scripts\gcp\setup-orchestrator-night-scheduler.ps1 -Remove`

O `post-deploy-pilot.ps1` reaplica `min=0` no orchestrator se o deploy ocorrer entre 22:00 e 06:00 BRT.

### Roadmap — scheduler `min=0` (Fase 4)

Plano completo: [`docs/plans/SCHEDULER_CLOUD_SCHEDULER_MIGRATION.md`](plans/SCHEDULER_CLOUD_SCHEDULER_MIGRATION.md)

Migrar `node-cron` → Cloud Scheduler + HTTP endpoints → `flux-farma-scheduler` em `min=0` (~US$ 49/mês de economia adicional).

---

## Quando rodar os scripts?

| Situação | Rodar `post-deploy-pilot`? |
|----------|----------------------------|
| **Deploy de nova imagem** em qualquer serviço `flux-farma-*` | **Sim — obrigatório** |
| `gcloud run deploy` / Cloud Build que cria nova revisão | **Sim** |
| Mudança só de secrets/env (`gcloud run services update --set-secrets`) | **Verificar** — pode preservar scaling; rode `verify-run-scaling.ps1` |
| `configure-workers-production.ps1` executado por engano | **Sim** — reaplicar piloto |
| Nenhum deploy há semanas; só conferir | Não — só `verify-run-scaling.ps1` |

### Por que após cada deploy de imagem?

`gcloud run deploy` e Cloud Build **criam nova revisão**. Dependendo de como o deploy foi feito, anotações de scaling (`min-instances`, `cpu-throttling`) podem **voltar ao default** ou ao que estiver no comando de deploy. O script piloto **reaplica o perfil de custo** sem alterar a imagem.

**Não é necessário** rodar os scripts se você **não** fez deploy nem mudou configuração do Cloud Run.

---

## Fluxo pós-deploy (obrigatório)

Após **qualquer** deploy de imagem dos serviços Flux Farma:

```powershell
$env:GCP_PROJECT_ID = "rh-coopmob-bot"
$env:GCP_REGION = "us-central1"

# Um comando — reaplica scaling + valida
.\scripts\gcp\post-deploy-pilot.ps1
```

Ou via npm (na raiz do monorepo):

```bash
npm run gcp:post-deploy:pilot
```

O script executa:

1. `configure-workers-pilot.ps1` — scaling do perfil piloto
2. `verify-run-scaling.ps1 -Profile pilot` — falha (exit 1) se algo divergir

### Deploy típico (ordem completa)

```powershell
# 1. Build + push imagem (exemplo orchestrator)
gcloud builds submit . --config=deploy/cloudbuild-flux-farma-orchestrator.yaml --project=rh-coopmob-bot

# 2. Deploy da revisão no Cloud Run (se o cloudbuild não fizer deploy automático)
#    ... conforme o seu fluxo atual ...

# 3. SEMPRE após nova revisão nos workers ou webhook:
.\scripts\gcp\post-deploy-pilot.ps1
```

Serviços que **exigem** o pós-deploy quando recebem nova imagem:

- `flux-farma-orchestrator`
- `flux-farma-scheduler`
- `flux-farma-campaign`
- `flux-farma-webhook`

Para `flux-farma-api` e `flux-farma-web`, o pós-deploy é **recomendado** (idempotente) mas o risco de regressão de scaling é menor.

---

## Rollback de scaling (emergência)

Se após mudança de scaling houver problema (mensagens atrasadas, campanhas, etc.):

### Opção A — Perfil caro temporário (~R$ 900/mês Run)

Restaura `min=1` + CPU 24h nos 3 workers:

```powershell
$env:GCP_PROJECT_ID = "rh-coopmob-bot"
.\scripts\gcp\configure-workers-rollback.ps1
```

Equivalente a `configure-workers-production.ps1`.

### Opção B — Restaurar YAML de backup

Backups locais (não versionados): `scripts/gcp/backups/run-config-YYYYMMDD-HHmm/`.

```powershell
# Inspecionar backup
Get-Content scripts\gcp\backups\run-config-20260606-1437\flux-farma-orchestrator.yaml

# Reaplicar manualmente via gcloud com os valores do backup, ou:
.\scripts\gcp\configure-workers-rollback.ps1
```

### Depois do incidente

Quando estabilizar, **volte ao piloto**:

```powershell
.\scripts\gcp\post-deploy-pilot.ps1
```

---

## Scripts (referência)

| Script | Uso |
|--------|-----|
| [`post-deploy-pilot.ps1`](../scripts/gcp/post-deploy-pilot.ps1) | **Pós-deploy** — reaplica + valida |
| [`configure-workers-pilot.ps1`](../scripts/gcp/configure-workers-pilot.ps1) | Só scaling piloto |
| [`verify-run-scaling.ps1`](../scripts/gcp/verify-run-scaling.ps1) | Validação (`-Profile pilot` ou `production`) |
| [`configure-workers-production.ps1`](../scripts/gcp/configure-workers-production.ps1) | Alta escala — **não usar no piloto** |
| [`configure-workers-rollback.ps1`](../scripts/gcp/configure-workers-rollback.ps1) | Atalho para production/rollback |
| [`setup-orchestrator-night-scheduler.ps1`](../scripts/gcp/setup-orchestrator-night-scheduler.ps1) | Cloud Scheduler night mode (00–06 BRT) |
| [`orchestrator-night-scale.ps1`](../scripts/gcp/orchestrator-night-scale.ps1) | Escala manual off/on/status |
| [`verify-orchestrator-night-mode.ps1`](../scripts/gcp/verify-orchestrator-night-mode.ps1) | Valida jobs + scaling noturno |
| [`create-cloud-run-budget-alert.ps1`](../scripts/gcp/create-cloud-run-budget-alert.ps1) | Alerta billing (requer conta com Billing Admin) |

---

## Para agentes / Cursor

Ao executar ou planejar **deploy GCP** deste repositório:

1. Considerar o deploy **incompleto** sem `post-deploy-pilot.ps1` (ou `npm run gcp:post-deploy:pilot`).
2. Não executar `configure-workers-production.ps1` no piloto Flux Farma salvo pedido explícito de alta escala ou rollback.
3. Em rollback de incidente, documentar se usou `configure-workers-rollback.ps1` e quando voltou ao piloto.

Ver também: [DEPLOY_CLOUD_RUN.md](./DEPLOY_CLOUD_RUN.md), [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md).
