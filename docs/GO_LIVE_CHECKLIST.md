# Checklist Go-Live (Produção)

Execute após deploy das Ondas 0–2. Marque cada item antes de liberar tráfego real.

**Bootstrap (staging isolado, limpeza, platform owner):** [PRODUCTION_BOOTSTRAP.md](./PRODUCTION_BOOTSTRAP.md)

## Banco de dados (staging vs produção)

Ver mapa detalhado: [STAGING_PROD_DATABASE_MAP.md](./STAGING_PROD_DATABASE_MAP.md)

- [ ] Confirmar que Secret Manager `supabase-url` aponta para o projeto Supabase de **produção** (ref dedicado)
- [ ] Confirmar que `.secrets/staging-*` **não** reutiliza o mesmo ref de produção sem decisão explícita
- [ ] Rodar `node scripts/check-db-migration-state.mjs --url-file .secrets/supabase-db-url.txt` antes de migrations em prod

## Infra e secrets

- [ ] Backup Supabase produção documentado
- [ ] Secrets no Secret Manager (sem tokens em `--set-env-vars`)
- [ ] `JWT_SECRET` forte (≥32 caracteres, novo)
- [ ] `LEADER_WHATSAPP_OTP_SECRET` configurado
- [ ] `ENABLE_DEV_ROUTES=false` em todos os serviços Cloud Run
- [ ] `USER_TEMP_PASSWORD_RESPONSE_ENABLED=false`
- [ ] `ALLOWED_ORIGINS` com domínio final do web
- [ ] Workers com perfil de scaling correto: `.\scripts\gcp\configure-workers-pilot.ps1` + `.\scripts\gcp\verify-run-scaling.ps1 -Profile pilot`
  - Piloto Flux: scheduler `min=1` (CPU 24h); orchestrator `min=1` + throttle; campaign `min=0`
  - Alta escala (>2k conversas/mês): `configure-workers-production.ps1` (3× min=1, CPU 24h)

## Governança (CI / local)

```bash
npm run governance:workspace    # findings: []
npm run governance:automations  # ok: true
```

## Staging — stress / chaos / segurança (pré go-live)

Ver [STAGING_QA_RUNBOOK.md](./STAGING_QA_RUNBOOK.md) e [CHAOS_STAGING_RUNBOOK.md](./CHAOS_STAGING_RUNBOOK.md).

```bash
npm run stress:staging              # HTTP
npm run stress:staging:pubsub         # Pub/Sub inbound (CONFIRM_STAGING_PUBSUB_STRESS)
npm run chaos:staging                 # suite chaos (CONFIRM_STAGING_CHAOS)
npm run security:leader-portal-idor
npm run security:api-cross-tenant
```

## Funcional

- [ ] Login admin e atendente
- [ ] Troca de workspace (se aplicável)
- [ ] Inbox: conversa visível por setor/canal
- [ ] Webhook WhatsApp E2E (mensagem real → inbox)
- [ ] Copiloto: briefing operacional (sem JSON cru)
- [ ] Portal líder: OTP + desligamento com setores do workspace correto
- [ ] `GET /api/audit-logs` (admin)

## Pub/Sub

- [ ] Tópicos e subscrições criados (`scripts/gcp/pubsub-bootstrap.sh`)
- [ ] Dead-letter topic `platform.dead-letter` configurado

## Scripts úteis

- `scripts/gcp/bootstrap-production-secrets.ps1` — cria/atualiza secrets + rotaciona JWT/OTP
- `scripts/gcp/deploy-production-api.ps1` — API com Secret Manager
- `scripts/gcp/configure-workers-pilot.ps1` — scaling piloto (padrão Flux)
- `scripts/gcp/configure-workers-production.ps1` — scaling alta escala (custo ~R$ 900/mês Run)
- `scripts/gcp/verify-run-scaling.ps1` — gate pós-deploy
- `scripts/gcp/create-cloud-run-budget-alert.ps1` — alerta billing Cloud Run
- `scripts/gcp/pubsub-bootstrap.ps1` — Pub/Sub + DLQ (Windows)
- `node scripts/db/apply-migration-038.mjs --execute` — rate limit table (requer `CONFIRM_PRODUCTION_MIGRATION_038=true`)
- `deploy/cloudbuild-governance-check.yaml` — gate CI (`gcloud builds submit . --config=...`)
- `deploy/cloudbuild-flux-farma-api-gated.yaml` — build API com governança

## Cloud Build trigger

Repositório sem trigger GitHub configurado para esta plataforma. Use:

```bash
gcloud builds submit . --config=deploy/cloudbuild-governance-check.yaml --project=rh-coopmob-bot
```

Ou crie trigger no Console após conectar o repositório GitHub.
