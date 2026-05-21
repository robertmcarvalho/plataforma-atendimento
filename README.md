# Plataforma Atendimento (Aethera / Flux Farma)

Plataforma de suporte e atendimento multicanal (WhatsApp, e-mail, LLM), com roteamento, automações, financeiro parcelado e campanhas com anti-ban.

**Produção:** [https://www.aetheraai.online](https://www.aetheraai.online) · Supabase **plataforma_atendimento** (`omhlbavfsttwcnybzvcd`) · GCP `rh-coopmob-bot`

Documentação operacional: [docs/README.md](docs/README.md) · [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                        Google Cloud Run                         │
│  web · api-service · webhook-service · orchestrator-service     │
│  scheduler-service · campaign-worker                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────▼──────────────┐
              │    Supabase (Postgres)      │
              │  Auth · Realtime · Storage  │
              └─────────────────────────────┘
```

| Serviço | Porta | Responsabilidade |
|---------|-------|------------------|
| `web` | 3000 | Frontend Next.js |
| `api-service` | 3001 | API principal |
| `webhook-service` | 3002 | Webhook Meta (WhatsApp) |
| `orchestrator-service` | 3003 | Bot, fluxos, roteamento |
| `scheduler-service` | 3004 | Crons (SLA, parcelas) |
| `campaign-worker` | 3005 | Disparos em massa |

## Setup local (5 passos)

### 1. Instalar dependências

```bash
npm install
```

### 2. Variáveis de ambiente

Copie os exemplos (sem valores reais):

```bash
cp apps/api-service/.env.example apps/api-service/.env
cp apps/webhook-service/.env.example apps/webhook-service/.env
cp apps/orchestrator-service/.env.example apps/orchestrator-service/.env
cp apps/scheduler-service/.env.example apps/scheduler-service/.env
cp apps/campaign-worker/.env.example apps/campaign-worker/.env
cp apps/web/.env.local.example apps/web/.env.local
```

Para scripts de produção/staging, crie arquivos em `.secrets/` conforme [`.secrets/README.md`](.secrets/README.md).

### 3. Banco Supabase

No SQL Editor (projeto dev ou `omhlb`), aplique as migrations em ordem:

`supabase/migrations/001_initial_schema.sql` … `039_pharmacy_commercial_delivery.sql`

Ou use os helpers `npm run db:ensure:*` documentados em [scripts/README.md](scripts/README.md).

### 4. Usuário admin (dev)

```bash
npm run create:dev-admin
```

### 5. Subir o ambiente

```bash
npm run dev:local
```

Validação: `npm run governance:check` e `npm run lint`.

## Operações (produção)

| Comando | Uso |
|---------|-----|
| `npm run flip:prod:plataforma-atendimento` | Cutover Cloud Run para `omhlb` |
| `npm run migrate:legacy-ojzzx-to-prod` | Migração dados legado → prod |
| `npm run backfill:pharmacy-extended` | Backfill farmácias (legado) |
| `npm run sanitize:prod` | Limpeza QA em prod (`CONFIRM_PROD_SANITIZE=true`) |

Nunca commitar senhas nem arquivos em `reports/`.

## Estrutura

```
plataforma_atendimento/
├── apps/           # web, api, webhook, orchestrator, scheduler, campaign-worker
├── packages/       # channel-runtime, operational-notes, logger
├── supabase/migrations/
├── scripts/        # ops, smoke, governança
├── docs/
└── deploy/         # Cloud Build
```

## Deploy

Ver [docs/DEPLOY_CLOUD_RUN.md](docs/DEPLOY_CLOUD_RUN.md) e [docs/GO_LIVE_CHECKLIST.md](docs/GO_LIVE_CHECKLIST.md).
