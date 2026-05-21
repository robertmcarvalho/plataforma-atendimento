# Scripts Operacionais

Este diretório contém scripts de desenvolvimento, migração, verificação e operação. Antes de rodar qualquer script contra staging ou produção, confirme a categoria abaixo.

## Dev-only

Scripts para bootstrap local ou criação de dados artificiais. Eles são bloqueados quando `NODE_ENV=production`, a menos que `ALLOW_DEV_SCRIPTS=true` seja definido explicitamente em um ambiente controlado.

- `create-dev-admin.mjs`
- `create-dev-admin-sql.mjs`
- `create-financial-samples.mjs`

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
