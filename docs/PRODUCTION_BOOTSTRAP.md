# Bootstrap de produção (Aethera)

Runbook executado para separar staging de produção, limpar dados de teste e criar o primeiro `platform_owner`.

## Importante: onde ficaram os cadastros

Se você importou planilhas com a API apontando para `apps/api-service/.env` (projeto **omhlb…** / `plataforma_atendimento`), os dados ficaram no **banco de desenvolvimento**, não no que a UI em **aetheraai.online** usa (**ojzzx…** / Secret Manager).

Para copiar cadastros dev → prod:

```powershell
npm run migrate:cadastros:dev-to-prod              # dry-run
$env:CONFIRM_MIGRATE_CADASTROS_DEV_TO_PROD = "true"
npm run migrate:cadastros:dev-to-prod -- --execute
```

Dados de smoke (`SMOKE STAGING`, `FARMACIA TESTE`, tag `smoke-staging`) foram removidos de produção com `cleanup:prod-test-data`.

## Mapa de bancos (após cutover 2026-05-20)

| Uso | Supabase ref | Secrets |
|-----|--------------|---------|
| **Produção** | `omhlbavfsttwcnybzvcd` (**plataforma_atendimento**) | `.secrets/production-api.env`, `.secrets/production-db-url.txt` |
| **Legado (pausável)** | `ojzzxqqatqncchnspkch` | não usar em produção |
| **Local / scripts** | `omhlbavfsttwcnybzvcd` | `apps/api-service/.env`, `.secrets/supabase-db-url.txt` |

> **dash_financeiro** permanece como outro projeto Supabase — não é desativado pelo cutover.

Cutover: `npm run flip:prod:plataforma-atendimento` com `CONFIRM_FLIP_PROD_DATABASE=true --execute --update-gcloud`.

## Comandos úteis

```powershell
# Sincronizar secrets de staging (dev) vs produção
npm run staging:secrets:sync

# Snapshot de contagens (produção)
npm run prod:snapshot

# Limpeza de seeds/teste (dry-run)
npm run cleanup:prod-test-data
npm run cleanup:prod-test-data -- --delete-test-users

# Limpeza real
$env:CONFIRM_PROD_TEST_DATA_CLEANUP = "true"
npm run cleanup:prod-test-data -- --execute --delete-test-users

# Platform owner (produção)
$env:PLATFORM_OWNER_EMAIL = "seu@email.com"
$env:PLATFORM_OWNER_PASSWORD = "SenhaForte@2026!"
$env:CONFIRM_PROD_PLATFORM_BOOTSTRAP = "true"
npm run bootstrap:platform-owner
```

## Credenciais do platform owner

Geradas em **`reports/platform-owner-bootstrap.txt`** (gitignored). Troque a senha após o primeiro login.

## Configuração na UI (pós-login)

1. Login em https://aetheraai.online com `platform_owner`.
2. **Plataforma** → Workspaces: revisar workspace default (`Flux Farma`).
3. **Plataforma** → Settings: branding, timezone, políticas globais.
4. **Configurações** → Usuários: provisionar atendentes, supervisores, admins de workspace.
5. **Canais / Integrações**: WhatsApp Meta (secrets já no GCP).
6. **E-mail (UOL SMTP)**: variáveis em `.cloud-env-api-production.yaml` + secret `smtp-pass` no Secret Manager; deploy via `deploy-production-api.ps1`. Convites usam o **canal de e-mail padrão do workspace** (fallback: plataforma → env). Sincronizar secret com o canal: `CONFIRM_PROD_SMTP_SYNC=true node scripts/sync-prod-smtp-pass-from-channel.mjs`. Teste em Configurações → Canais → E-mail.
7. **Líderes**: vincular `leaders.user_id` a usuários reais (não usar scripts `@fluxfarma.local` em prod).
8. Validar inbox, copiloto e portal do líder (OTP).

## Testes automatizados

Rodar **somente** contra staging (`omhlb`):

```powershell
$env:USE_STAGING_SUPABASE = "true"
$env:API_BASE_URL = "http://localhost:3001"   # ou URL Cloud Run staging
npm run validate:local
```

Nunca apontar stress/chaos para `aetheraai.online` sem `CONFIRM_PRODUCTION_STRESS=true`.

## Deploy

Ver [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md) e [DEPLOY_CLOUD_RUN.md](./DEPLOY_CLOUD_RUN.md).

```powershell
npm run governance:check
.\scripts\gcp\deploy-production-api.ps1
.\scripts\gcp\configure-workers-production.ps1
```

Garantir `ENABLE_DEV_ROUTES=false` em `.cloud-env-api-production.yaml`.
