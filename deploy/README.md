# Deploy — Cloud Build

Builds de imagem para `flux-farma-*` no Artifact Registry (`panel-services`, `us-central1`).

## Após o deploy

Cloud Build **só gera a imagem**. Quando a nova revisão estiver no Cloud Run, execute na raiz do monorepo:

```bash
npm run gcp:post-deploy:pilot
```

Sem este passo, o scaling pode regredir (custo ~R$ 900/mês nos workers).

Runbook completo: [docs/CLOUD_RUN_SCALING.md](../docs/CLOUD_RUN_SCALING.md).

## Rollback de scaling

```bash
npm run gcp:scaling:rollback
```

Depois do incidente, volte ao piloto: `npm run gcp:post-deploy:pilot`.
