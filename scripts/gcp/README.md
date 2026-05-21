# Scripts GCP (Cloud Run / Pub/Sub)

- **`pubsub-bootstrap.sh`** — Cria tópicos, subscrições pull e dead-letter (`platform.dead-letter`, `MAX_DELIVERY_ATTEMPTS=5`). Requer `gcloud` autenticado e `GCP_PROJECT_ID`.
- **`deploy-production-api.ps1`** — Atualiza `flux-farma-api` com `--set-secrets` (Secret Manager) e env de produção (`ENABLE_DEV_ROUTES=false`, `ALLOWED_ORIGINS`, etc.).
- **`configure-workers-production.ps1`** — `min-instances=1` e `--no-cpu-throttling` em orchestrator, scheduler e campaign-worker.
- **`monitoring-baseline.json`** — Policy base de alerta Cloud Monitoring para erros 5xx em Cloud Run.
- **`dashboard-baseline.json`** — Dashboard base com Cloud Run requests e Pub/Sub backlog.

## Cloud Build

- **`deploy/cloudbuild-governance-check.yaml`** — Gate: `governance:workspace`, `governance:automations`, lint, build.
- **`deploy/cloudbuild-flux-farma-api-gated.yaml`** — Governança + imagem API.
- **`deploy/cloudbuild-flux-farma-web.yaml`** — Web com `NEXT_PUBLIC_API_URL` via `--substitutions`.

Checklist pós-deploy: [docs/GO_LIVE_CHECKLIST.md](../../docs/GO_LIVE_CHECKLIST.md).

Documentação completa: [docs/DEPLOY_CLOUD_RUN.md](../../docs/DEPLOY_CLOUD_RUN.md).
