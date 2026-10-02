# Contributing

Obrigado por contribuir com o monorepo **plataforma_atendimento**.

## Branch e commits

- Trabalhe em branches descritivas (`feat/…`, `fix/…`, `chore/…`).
- Commits em português ou inglês, no imperativo, focados no *porquê*.
- Não commite `.env`, `.secrets/` (exceto [`.secrets/README.md`](.secrets/README.md)), `reports/`, nem `.cloud-env-api-production.yaml`.

## Antes de abrir PR

```bash
npm install
npm run governance:check
npm run lint
```

Se a PR altera schema, inclua migration em `supabase/migrations/` e documente no corpo do PR.

## Secrets

- Use apenas arquivos `*.example` no repositório.
- Tokens Supabase (`sbp_…`), service role keys e connection strings Postgres ficam em `.secrets/` local ou GCP Secret Manager.
- Nunca cole chaves reais em issues, PRs ou documentação.

## Documentação

- Runbook operacional: [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md)
- Índice completo: [docs/README.md](docs/README.md)

## Deploy

Deploy de produção é manual via Cloud Build / scripts em `deploy/` — não há deploy automático no GitHub Actions na v1.

**Pós-deploy (obrigatório após nova imagem Cloud Run):**

```bash
npm run gcp:post-deploy:pilot
```

Scaling piloto, quando rodar scripts e rollback: [docs/CLOUD_RUN_SCALING.md](docs/CLOUD_RUN_SCALING.md).
