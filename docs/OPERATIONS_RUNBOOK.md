# Operations runbook

Procedimentos pós-cutover para o projeto Supabase **plataforma_atendimento** (`omhlb`). Credenciais ficam em `.secrets/` (ver [`.secrets/README.md`](../.secrets/README.md)) — nunca commitar.

## Mapa rápido de ambientes

| Ref | Projeto Dashboard | Uso |
|-----|-------------------|-----|
| `omhlbavfsttwcnybzvcd` | plataforma_atendimento | **Produção** (Cloud Run) |
| `ojzzxqqatqncchnspkch` | plataforma-atendimento-staging | Legado (pausável); export pontual |

Detalhes: [STAGING_PROD_DATABASE_MAP.md](./STAGING_PROD_DATABASE_MAP.md).

## Cutover para produção (`omhlb`)

1. Confirmar secrets em `.secrets/production-api.env` e ref em `production-supabase-project-ref.txt`.
2. Flip de variáveis Cloud Run + redeploy:

```powershell
npm run flip:prod:plataforma-atendimento
```

3. Validar login, canais WhatsApp/email e inbox em https://www.aetheraai.com.br.

Ver também [PRODUCTION_BOOTSTRAP.md](./PRODUCTION_BOOTSTRAP.md) e [DEPLOY_CLOUD_RUN.md](./DEPLOY_CLOUD_RUN.md).

## Migração legado `ojzzx` → produção

Quando o projeto legado estiver ativo:

```powershell
npm run prepare:legacy-ojzzx-secrets
npm run migrate:legacy-ojzzx-to-prod
```

Backfill de campos estendidos de farmácias (atendentes, taxas, horários):

```powershell
npm run backfill:pharmacy-extended
```

## Sanitizar estado operacional em produção

Remove usuários/canais/conversas de teste. **Destrutivo** — exige confirmação explícita:

```powershell
$env:CONFIRM_PROD_SANITIZE="true"
npm run sanitize:prod
```

Revise o dry-run no script antes de confirmar.

## Reset de senha (platform owner / usuário)

```powershell
npm run reset:prod-user-password
# ou script dedicado documentado em PRODUCTION_BOOTSTRAP
```

Senhas geradas vão para `reports/` (gitignored) — não versionar.

## Deploy web/API após mudança de env

```powershell
node scripts/deploy-production-web-cutover.mjs
```

(ou pipeline Cloud Build em `deploy/`).

## Checks antes de release

- [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md)
- `npm run governance:check`
- `npm run lint`

## Pausar / reativar legado

```powershell
npm run restore:legacy-ojzzx
```

Use apenas para export ou backfill; não apontar Cloud Run para `ojzzx` após cutover.
