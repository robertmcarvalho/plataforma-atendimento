# AGENTS.md — plataforma_atendimento

Instrucoes para agentes (Cursor, CI, operadores).

## Deploy GCP / Cloud Run (Flux Farma)

**Scaling piloto ja configurado** em `rh-coopmob-bot`. Runbook completo: [`docs/CLOUD_RUN_SCALING.md`](docs/CLOUD_RUN_SCALING.md).

### Regra pos-deploy

Apos **qualquer deploy de nova imagem** em servicos `flux-farma-*` (build + nova revisao Cloud Run), executar:

```powershell
$env:GCP_PROJECT_ID = "rh-coopmob-bot"
.\scripts\gcp\post-deploy-pilot.ps1
```

```bash
npm run gcp:post-deploy:pilot
```

Nao e necessario se nao houve deploy — apenas validar com `verify-run-scaling.ps1` se houver duvida.

### Rollback de scaling

Incidente operacional → `scripts/gcp/configure-workers-rollback.ps1` (perfil caro temporario).

Apos estabilizar → `scripts/gcp/post-deploy-pilot.ps1` novamente.

### Nao fazer no piloto Flux

- Executar `configure-workers-production.ps1` sem pedido explicito de alta escala.

## Documentacao

- Deploy: [`docs/DEPLOY_CLOUD_RUN.md`](docs/DEPLOY_CLOUD_RUN.md)
- Checklist: [`docs/GO_LIVE_CHECKLIST.md`](docs/GO_LIVE_CHECKLIST.md)
- Scripts GCP: [`scripts/gcp/README.md`](scripts/gcp/README.md)
