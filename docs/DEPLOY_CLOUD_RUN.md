# Deploy no Google Cloud Run (cenário A, uma instância)

Este guia alinha o monorepo com **Cloud Run**, **Secret Manager**, **Pub/Sub** e as mesmas variáveis usadas em desenvolvimento (ver [`scripts/check-local-env.mjs`](../scripts/check-local-env.mjs) e os `.env.example` de cada app).

## Ordem recomendada

1. GCP: projecto, APIs (Run, Artifact Registry, Secret Manager, Pub/Sub).
2. Pub/Sub: tópicos e subscrições (script ou consola).
3. Secret Manager: criar secrets e versões (não commitar valores).
4. Artifact Registry: repositório de imagens.
5. Build e push das **6** imagens.
6. Deploy Cloud Run (env + secrets + CPU/mínimo de instâncias).
7. `ALLOWED_ORIGINS` + URL do **web**; URL do **webhook** na Meta.
8. Validação manual (ou pipeline de QA) contra as URLs HTTPS de produção.

## Pub/Sub e IAM

### Criar tópicos e subscrições

```bash
export GCP_PROJECT_ID=your-gcp-project-id
bash scripts/gcp/pubsub-bootstrap.sh
```

Nomes por defeito (iguais aos [`.env.example`](../apps/webhook-service/.env.example)):

| Recurso | Variável |
|---------|----------|
| Tópico | `PUBSUB_TOPIC_INBOUND` → `whatsapp.inbound` |
| Tópico | `PUBSUB_TOPIC_STATUS` → `whatsapp.status` |
| Tópico | `PUBSUB_TOPIC_CAMPAIGN` → `campaign.dispatch` |
| Subscrição pull | `PUBSUB_SUBSCRIPTION_INBOUND` → `whatsapp.inbound-sub` |
| Subscrição pull | `PUBSUB_SUBSCRIPTION_STATUS` → `whatsapp.status-sub` |
| Subscrição pull | `PUBSUB_SUBSCRIPTION_CAMPAIGN` → `campaign.dispatch-sub` |

### Service accounts e roles (mínimo)

Crie uma SA por serviço (ou uma SA partilhada com permissões agregadas) e use-a em **Cloud Run → Security → Service account**.

| Serviço Cloud Run | Pub/Sub |
|-------------------|---------|
| `webhook-service` | **Publisher** nos tópicos `TOPIC_INBOUND` e `TOPIC_STATUS` |
| `api-service` | **Publisher** no tópico `PUBSUB_TOPIC_CAMPAIGN` |
| `scheduler-service` | **Publisher** no tópico `PUBSUB_TOPIC_CAMPAIGN` |
| `orchestrator-service` | **Subscriber** nas subscrições inbound (+ status se usar) |
| `campaign-worker` | **Subscriber** na subscrição `PUBSUB_SUBSCRIPTION_CAMPAIGN` |

Comandos típicos (substitua `SA@...` e nomes de tópicos):

```bash
gcloud pubsub topics add-iam-policy-binding whatsapp.inbound \
  --member="serviceAccount:webhook-run@GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher" --project=GCP_PROJECT_ID
```

Repita para `whatsapp.status`. Para subscrições, use `roles/pubsub.subscriber` no **tópico** ou ligue a SA à subscrição conforme a vossa política de IAM.

**Workers**: defina **mínimo 1 instância** e **CPU sempre alocada** em `orchestrator-service`, `scheduler-service` e `campaign-worker` para não perder pulls de Pub/Sub nem timers.

## Seis serviços e imagens

| Serviço | Contexto Docker | Dockerfile |
|---------|-------------------|--------------|
| Web | `apps/web` | [`apps/web/Dockerfile`](../apps/web/Dockerfile) |
| API | `apps/api-service` | [`apps/api-service/Dockerfile`](../apps/api-service/Dockerfile) |
| Webhook | `apps/webhook-service` | [`apps/webhook-service/Dockerfile`](../apps/webhook-service/Dockerfile) |
| Orchestrator | `apps/orchestrator-service` | [`apps/orchestrator-service/Dockerfile`](../apps/orchestrator-service/Dockerfile) |
| Scheduler | `apps/scheduler-service` | [`apps/scheduler-service/Dockerfile`](../apps/scheduler-service/Dockerfile) |
| Campaign worker | `apps/campaign-worker` | [`apps/campaign-worker/Dockerfile`](../apps/campaign-worker/Dockerfile) |

Build exemplo (região e repositório Artifact Registry ajustados):

```bash
export REGION=europe-west1
export REPO=aethera
export TAG=$(date +%Y%m%d-%H%M)

docker build -t $REGION-docker.pkg.dev/$GCP_PROJECT_ID/$REPO/api:$TAG -f apps/api-service/Dockerfile apps/api-service
docker push $REGION-docker.pkg.dev/$GCP_PROJECT_ID/$REPO/api:$TAG
```

### Web: variáveis `NEXT_PUBLIC_*` no **build** da imagem

O Next inlinha `NEXT_PUBLIC_*` na compilação. O **contexto de build tem de ser a raiz do monorepo** (o `postbuild` chama [`scripts/prepare-web-standalone.mjs`](../scripts/prepare-web-standalone.mjs), que também suporta o layout `standalone/` plano do Linux). O [`apps/web/Dockerfile`](../apps/web/Dockerfile) define `ENV CI=true` para activar `output: 'standalone'` em [`next.config.ts`](../apps/web/next.config.ts).

```bash
docker build -f apps/web/Dockerfile . \
  --build-arg NEXT_PUBLIC_API_URL=https://api.seudominio.com \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
  --build-arg NEXT_PUBLIC_ENABLE_INSTAGRAM=false \
  --build-arg NEXT_PUBLIC_ENABLE_EMAIL=false \
  --build-arg NEXT_PUBLIC_ENABLE_AI_SUGGESTIONS=false \
  --build-arg NEXT_PUBLIC_AI_ANALYSIS_BADGES=true \
  --build-arg NEXT_PUBLIC_AI_SUGGEST_REPLY=true \
  --build-arg NEXT_PUBLIC_AI_INBOUND_ASSIST=true \
  --build-arg NEXT_PUBLIC_ENABLE_TICKETING_PANEL=true \
  -t $REGION-docker.pkg.dev/$GCP_PROJECT_ID/$REPO/web:$TAG
```

O container escuta na porta definida por `PORT` (Cloud Run injecta **8080** por defeito). O runner copia `.next_local/standalone` completo para `/app` (`node server.js`).

### Deploy Cloud Run (esboço)

```bash
gcloud run deploy api-service \
  --image=$REGION-docker.pkg.dev/$GCP_PROJECT_ID/$REPO/api:$TAG \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated=false \
  --service-account=api-run@$GCP_PROJECT_ID.iam.gserviceaccount.com \
  --set-secrets="SUPABASE_URL=supabase-url:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-sr:latest,JWT_SECRET=jwt-secret:latest" \
  --set-env-vars="GOOGLE_CLOUD_PROJECT_ID=$GCP_PROJECT_ID,PUBSUB_TOPIC_CAMPAIGN=campaign.dispatch,ALLOWED_ORIGINS=https://app.seudominio.com"
```

Repita o padrão (`--set-secrets` / `--set-env-vars`) por serviço. Não coloque tokens Meta ou JWT em `--set-env-vars` sem encriptação; use **Secret Manager** e referências `--set-secrets`.

## Matriz de variáveis → Secret Manager (referência)

Valores sensíveis devem ser secrets; o resto pode ser env literal.

### `api-service`

| Variável | Origem | Notas |
|----------|--------|--------|
| `SUPABASE_URL` | Secret | Obrigatório |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Obrigatório |
| `JWT_SECRET` | Secret | Obrigatório |
| `INTEGRATIONS_ENCRYPTION_KEY` | Secret | Obrigatório em produção |
| `USER_TEMP_PASSWORD_RESPONSE_ENABLED` | Env | `false` em produção |
| `JWT_EXPIRES_IN` | Env | Opcional (`8h`) |
| `ALLOWED_ORIGINS` | Env | Lista HTTPS do front, vírgulas; **obrigatório** para CORS em prod |
| `PORT` | Cloud Run | Injectado (8080) |
| `GOOGLE_CLOUD_PROJECT_ID` | Env | Pub/Sub |
| `PUBSUB_TOPIC_CAMPAIGN` | Env | Nome do tópico |
| `META_PHONE_NUMBER_ID` | Secret ou env | Envio WhatsApp |
| `META_ACCESS_TOKEN` | Secret | Envio WhatsApp |
| `STORAGE_BUCKET` | Env | Ver [`.env.example`](../apps/api-service/.env.example) |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Secret | Copiloto |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, `COPILOT_ENABLED` | Env | Copiloto |
| `META_VERIFY_TOKEN`, `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_APP_ACCESS_TOKEN`, `WEBHOOK_SERVICE_PUBLIC_URL`, `META_GRAPH_VERSION`, … | Secret/env | Rotas em [`integrations.ts`](../apps/api-service/src/routes/integrations.ts) se usarem registo de webhook pela API |

### `webhook-service`

| Variável | Secret? |
|----------|---------|
| `META_VERIFY_TOKEN`, `META_APP_SECRET` | Sim |
| `GOOGLE_CLOUD_PROJECT_ID`, `PUBSUB_TOPIC_INBOUND`, `PUBSUB_TOPIC_STATUS` | Env |
| `PORT` | Cloud Run |

Em produção **não** defina `WEBHOOK_SKIP_SIGNATURE_VERIFY=true` (só bypass em desenvolvimento).

### `orchestrator-service`

`SUPABASE_*`, `GOOGLE_CLOUD_PROJECT_ID`, `PUBSUB_SUBSCRIPTION_INBOUND`, `PUBSUB_SUBSCRIPTION_STATUS` (opcional), `PUBSUB_TOPIC_CAMPAIGN`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`, `BOT_SESSION_TTL_HOURS`.

### `scheduler-service`

`SUPABASE_*`, `GOOGLE_CLOUD_PROJECT_ID`, `PUBSUB_TOPIC_CAMPAIGN`, `TZ`.

### `campaign-worker`

`SUPABASE_*`, `GOOGLE_CLOUD_PROJECT_ID`, `PUBSUB_SUBSCRIPTION_CAMPAIGN`, `META_*`, defaults `DEFAULT_*` opcionais.

### `web`

Apenas build-args (tabela acima). Opcionalmente `NODE_ENV=production` já na imagem.

## Meta webhook e CORS

1. **URL pública HTTPS** do serviço `webhook-service` (Cloud Run com domínio mapeado ou URL `run.app` estável).
2. Na Meta, configure o callback e o **Verify Token** igual a `META_VERIFY_TOKEN`.
3. Na API, `ALLOWED_ORIGINS` deve incluir a origem exacta do front (`https://app...`, sem barra final se a API for estrita).
4. Se usarem [`integrations.ts`](../apps/api-service/src/routes/integrations.ts) para montar URLs do webhook, preencham `WEBHOOK_SERVICE_PUBLIC_URL` / `WEBHOOK_PUBLIC_BASE_URL` com a URL pública do webhook no Cloud Run.

## Validação pós-deploy

- `GET /health` (ou rota equivalente) em cada serviço Cloud Run.
- Login no web, inbox e fluxos críticos conforme o vosso checklist interno.

**WhatsApp E2E**: após webhook + orchestrator + API com Meta, envie uma mensagem de teste ao número e confirme conversa na inbox.

## Ficheiros relacionados

- Script Pub/Sub: [`scripts/gcp/pubsub-bootstrap.sh`](../scripts/gcp/pubsub-bootstrap.sh)
- Docker web (standalone + build-args): [`apps/web/Dockerfile`](../apps/web/Dockerfile)
- Checklist env local: [`scripts/check-local-env.mjs`](../scripts/check-local-env.mjs)
