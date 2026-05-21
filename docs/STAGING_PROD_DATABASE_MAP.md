# Mapa de bancos: staging vs produção

> **Não commitar** arquivos em `.secrets/` (contêm URLs e chaves).

## Resumo (atualizado 2026-05-20)

| Ambiente | Supabase ref | Nome no Dashboard | Secrets |
|----------|--------------|-------------------|---------|
| **Produção** (Cloud Run, [aetheraai.online](https://www.aetheraai.online)) | `omhlbavfsttwcnybzvcd` | **plataforma_atendimento** | `production-api.env`, `production-db-url.txt` |
| **Legado / QA opcional** (projeto pausável) | `ojzzxqqatqncchnspkch` | plataforma-atendimento-staging | backup em `production-api.env.ojzzx-backup` |
| **Pooler local (scripts)** | `omhlbavfsttwcnybzvcd` | — | `supabase-db-url.txt`, `apps/api-service/.env` |

### Outros projetos Supabase

- **dash_financeiro** — projeto separado; **não é alterado** pelos scripts deste repo.
- Limite free: 2 projetos ativos → manter **plataforma_atendimento** + **dash_financeiro** ativos; **ojzzx** pode permanecer pausado.

### Cutover produção → plataforma_atendimento

```powershell
node scripts/flip-production-to-plataforma-atendimento.mjs
$env:CONFIRM_FLIP_PROD_DATABASE = "true"
node scripts/flip-production-to-plataforma-atendimento.mjs --execute --update-gcloud
```

Depois: redeploy API + Web (ver [PRODUCTION_BOOTSTRAP.md](./PRODUCTION_BOOTSTRAP.md)).

### Migrar tudo do banco antigo (ojzzx) → produção (omhlb)

O projeto **ojzzx** precisa estar **ativo** no Supabase (DNS responde). No plano free só 2 projetos ativos: pode **pausar temporariamente** outro projeto (ex. dash_financeiro) só durante a exportação — **não apaga dados**.

1. `npm run prepare:legacy-ojzzx-secrets` — restaura API keys do Secret Manager (v1).
2. Dashboard → ojzzx → **Restore** → Database → connection string (pooler 6543) → `.secrets/legacy-db-url.txt`
3. `npm run migrate:legacy-ojzzx-to-prod` (dry-run)
4. `$env:CONFIRM_MIGRATE_LEGACY_OJZZX_TO_PROD="true"; npm run migrate:legacy-ojzzx-to-prod -- --execute`

Migra: **senhas** (`auth.users`), usuários, `app_settings`, `platform_settings`, `workspace_channels` (webhook/e-mail/WhatsApp), fluxos e cadastros (merge por CNPJ/telefone).

**dash_financeiro** não é alterado pelo script.

## Verificação

```powershell
gcloud secrets versions access latest --secret=supabase-url --project=rh-coopmob-bot
# Deve conter: omhlbavfsttwcnybzvcd

Get-Content .secrets\production-api.env | Select-String SUPABASE_URL
node scripts/check-db-migration-state.mjs --url-file .secrets/production-db-url.txt
```

## Runbooks relacionados

- [PRODUCTION_BOOTSTRAP.md](./PRODUCTION_BOOTSTRAP.md)
- [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md)
