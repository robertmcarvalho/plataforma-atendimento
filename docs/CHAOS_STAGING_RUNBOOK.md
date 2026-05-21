# Chaos Testing — Staging (controlado)

**Não executar em produção.** Use o projeto GCP e Supabase de **staging** exclusivamente.

## Pré-requisitos

- `gcloud auth application-default login`
- `CONFIRM_STAGING_CHAOS=true` ou `CONFIRM_STAGING_PUBSUB_STRESS=true`
- Variáveis em `.secrets/staging-api.env` ou shell
- Orchestrator com ≥1 instância consumindo `whatsapp.inbound-sub`

## Suite automatizada

```powershell
$env:CONFIRM_STAGING_CHAOS="true"
$env:API_BASE_URL="https://api-staging..."
$env:API_ADMIN_EMAIL="..."
$env:API_ADMIN_PASSWORD="..."
$env:WEBHOOK_BASE_URL="https://webhook-staging..."   # recomendado
$env:META_APP_SECRET="..."                            # HMAC válido/inválido
$env:GCP_PROJECT_ID="rh-coopmob-bot"
$env:STRESS_WORKSPACE_ID="<uuid-workspace-staging>"
npm run chaos:staging
```

### O que valida

| Teste | Esperado |
|-------|----------|
| API health | 200 ok |
| JWT inválido | 401/403 |
| Burst 25× presence | &lt;5% erro, p95 &lt;5s |
| Webhook HMAC ruim | 401 |
| Webhook HMAC ok (payload vazio) | 200 |
| Pub/Sub mesma `meta_message_id` 2× | 1 linha em `processed_webhook_events` |
| Backlog subscription | `numUndeliveredMessages` &lt; 500 (ajustável) |

## Flood Pub/Sub (stress de fila)

```powershell
$env:CONFIRM_STAGING_PUBSUB_STRESS="true"
$env:GCP_PROJECT_ID="..."
$env:STRESS_WORKSPACE_ID="..."
$env:STRESS_MESSAGE_COUNT="100"
$env:STRESS_PUBLISH_CONCURRENCY="15"
npm run stress:staging:pubsub
```

Monitore:

```bash
gcloud pubsub subscriptions describe whatsapp.inbound-sub --project=PROJECT --format="yaml(numUndeliveredMessages,ackDeadlineSeconds)"
```

## Chaos manual (impresso pela suite)

### Worker morto

```bash
# Staging only
gcloud run services update orchestrator-service \
  --region=us-central1 --min-instances=0 --max-instances=0

# Publicar 20 msgs (npm run stress:staging:pubsub) → backlog sobe

# Restaurar
gcloud run services update orchestrator-service \
  --region=us-central1 --min-instances=1 --max-instances=3

# Validar: backlog → 0, inbox sem duplicatas (mesmo meta_message_id)
```

### Meta API indisponível

- Canal de teste com token inválido → OTP líder / outbound deve falhar com log `META_API_ERROR` sem travar worker
- Webhook ainda ack 200 se publicação Pub/Sub ok

### IA offline

- Remover chave LLM do secret staging → copilot retorna erro gracioso, sem loop retry infinito
- Verificar `rate_limit_buckets` e fallback memória documentado

### Dead-letter

```bash
gcloud pubsub topics list --filter="name:dead-letter"
gcloud pubsub subscriptions pull platform.dead-letter-sub --auto-ack --limit=5
```

## Critérios de aceite pós-chaos

- [ ] Backlog drenado em &lt;15 min após restaurar workers
- [ ] Sem crescimento anormal de `processed_webhook_events` duplicados
- [ ] Erros com `correlation_id` nos logs Cloud Run
- [ ] DLQ vazia ou apenas mensagens de teste conhecidas
- [ ] `npm run security:leader-portal-idor` verde após deploy

## Rollback

- Revisão Cloud Run anterior
- Purge opcional de mensagens teste: `meta_message_id` prefix `wamid.stress-` / `wamid.chaos-`
