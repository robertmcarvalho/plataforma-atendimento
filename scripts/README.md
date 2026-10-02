# Scripts Operacionais

Este diretório contém scripts de desenvolvimento, migração, verificação e operação. Antes de rodar qualquer script contra staging ou produção, confirme a categoria abaixo.

## Dev-only

Scripts para bootstrap local ou criação de dados artificiais. Eles são bloqueados quando `NODE_ENV=production`, a menos que `ALLOW_DEV_SCRIPTS=true` seja definido explicitamente em um ambiente controlado.

- `create-dev-admin.mjs`
- `create-dev-admin-sql.mjs`
- `create-financial-samples.mjs`

## Módulo billing (dev-only — **proibido escrever em produção**)

Desenvolvimento do `/billing` usa **somente** banco dev (`.secrets/billing-dev-db-url.txt` ou staging). Produção (`omhlb`) é **read-only** para amostragem de fixture.

- `lib/billingDbGuard.mjs`: bloqueia destino de escrita = produção; envolve client pg read-only na origem.
- `sample-billing-fixture-from-prod.mjs`: copia amostra operacional prod → dev (farmácias, entregadores, links, `financial_entries` 21d, settings financeiros).
- `apply-migration-084-billing-foundation.mjs`: aplica schema billing **somente no banco dev** (`npm run billing:migrate:084`).

- `restore-billing-dev-supabase.mjs`: restaura projeto Supabase INACTIVE (ojzzx) e atualiza billing-dev secrets.
- `verify-billing-dev-env.mjs`: valida tabelas `billing_*` e contagens no dev.
- `sync-billing-dev-api-env.mjs`: aponta `apps/api-service/.env` para ojzzx (Supabase + `BILLING_MODULE_ENABLED`).

```powershell
# Restaurar staging ojzzx (se INACTIVE)
npm run billing:restore-dev

# Migration billing (084) + dependência PIX (044)
npm run billing:migrate:084
npm run billing:migrate:044

# Fixture prod → dev (dry-run, depois execute)
npm run billing:fixture:sample
$env:CONFIRM_BILLING_FIXTURE_IMPORT="true"
npm run billing:fixture:sample:execute

# API + web local → ojzzx; seed CC de teste (opcional)
npm run billing:sync-api-env
npm run billing:seed-dev-config
npm run billing:seed-dev-config:execute
npm run billing:verify-dev
```

Secrets: `.secrets/production-db-url.txt` (origem, SELECT only) + `.secrets/billing-dev-db-url.txt` (destino). Ver `.secrets/README.md`.

## Operação Protegida

Scripts que alteram dados reais devem rodar em dry-run por padrão ou exigir confirmação explícita.

- `cleanup-prod-test-data.mjs`: dry-run por padrão; aplica somente com `--execute`.
- `fix-quota-status.js`: dry-run por padrão; aplica somente com `--execute` e `CONFIRM_FIX_QUOTA_STATUS=true`.
- `provision-supervisor-user.mjs`: provisionamento pontual; validar variáveis e alvo antes de executar.

## CI / Smoke / Auditoria

Scripts de validação podem ser usados em CI ou manualmente para confirmar saúde do ambiente.

- `smoke-*.mjs`
- `check-*.mjs`
- `audit-*.mjs`
- `verify-*.mjs`
- `audit-gcp-readonly.mjs`: coleta inventário GCP/Cloud Run/Pub/Sub/Secrets/Cloud Build/Scheduler somente leitura. Não lê valores de secrets e mascara variáveis de ambiente.

## Migração / Ensure

Scripts `ensure-*.mjs` e `db:ensure:*` devem ser tratados como migrações operacionais idempotentes. Execute primeiro em staging e mantenha logs de saída anexados ao runbook de release.
