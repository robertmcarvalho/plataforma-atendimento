# Scripts GCP (Cloud Run / Pub/Sub)

## Pós-deploy (leia primeiro)

Perfil piloto **já configurado** no GCP. Após **nova imagem** em `flux-farma-*`:

```powershell
npm run gcp:post-deploy:pilot
```

Detalhes, rollback e quando **não** rodar: [docs/CLOUD_RUN_SCALING.md](../../docs/CLOUD_RUN_SCALING.md).

- **`post-deploy-pilot.ps1`** — **padrão pós-deploy**: `configure-workers-pilot` + `verify-run-scaling`
- **`pubsub-bootstrap.sh`** — Cria tópicos, subscrições pull e dead-letter (`platform.dead-letter`, `MAX_DELIVERY_ATTEMPTS=5`). Requer `gcloud` autenticado e `GCP_PROJECT_ID`.
- **`deploy-production-api.ps1`** — Atualiza `flux-farma-api` com `--set-secrets` (Secret Manager) e env de produção (`ENABLE_DEV_ROUTES=false`, `ALLOWED_ORIGINS`, etc.).
- **`configure-workers-pilot.ps1`** — **padrão Flux Farma**: scheduler `min=1` + CPU 24h; orchestrator `min=1` + throttle; campaign/webhook `min=0`. ~R$ 160/mês Cloud Run.
- **`configure-workers-production.ps1`** — alta escala: `min=1` + `--no-cpu-throttling` nos 3 workers (~R$ 900/mês). Não usar no piloto.
- **`configure-workers-rollback.ps1`** — atalho para o perfil production (emergência).
- **`verify-run-scaling.ps1`** — valida anotações de scaling (`-Profile pilot|production`).
- **`create-cloud-run-budget-alert.ps1`** — budget BRL para SKU Cloud Run (requer `GCP_BILLING_ACCOUNT_ID`).
- **`audit-cloud-run-cost.mjs`** — auditoria read-only. `npm run gcp:audit:cost`
- **`cleanup-artifact-registry-tags.mjs`** — dry-run tags antigas no Artifact Registry
- **`remove-orphan-vpc-connector.ps1`** — remove connector sem uso
- **`optimize-webhook-cost-pilot.ps1`** — webhook `min=1` + cpu-throttling (economia)
- **`setup-orchestrator-night-scheduler.ps1`** — Cloud Scheduler: orchestrator `min=0` 00:00–06:00 BRT
- **`orchestrator-night-scale.ps1`** — escala manual off/on/status
- **`verify-orchestrator-night-mode.ps1`** — valida night mode + backlog Pub/Sub
- **`monitoring-baseline.json`** — Policy base de alerta Cloud Monitoring para erros 5xx em Cloud Run.
- **`dashboard-baseline.json`** — Dashboard base com Cloud Run requests e Pub/Sub backlog.

## Cloud Build

- **`deploy/cloudbuild-governance-check.yaml`** — Gate: `governance:workspace`, `governance:automations`, lint, build.
- **`deploy/cloudbuild-flux-farma-api-gated.yaml`** — Governança + imagem API.
- **`deploy/cloudbuild-flux-farma-web.yaml`** — Web com `NEXT_PUBLIC_API_URL` via `--substitutions`.

Checklist pós-deploy: [docs/GO_LIVE_CHECKLIST.md](../../docs/GO_LIVE_CHECKLIST.md).

Documentação completa: [docs/DEPLOY_CLOUD_RUN.md](../../docs/DEPLOY_CLOUD_RUN.md).
