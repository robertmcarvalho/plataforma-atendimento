# Inventário Externo Read-Only

Este checklist orienta a coleta externa da plataforma sem alterar produção. Use contas com permissão somente leitura sempre que possível.

## Cloud Run E GCP

Coletar:

- Serviços Cloud Run, região, imagem, service account, ingress, env vars, secrets referenciados, min/max instances, concurrency, timeout e CPU.
- Pub/Sub topics/subscriptions, dead-letter policy, ack deadline, backlog e consumidores.
- Artifact Registry, imagens antigas e política de retenção.
- Secret Manager, lista de secrets e última rotação.
- Cloud Logging/Monitoring, alertas e dashboards.
- Custos por serviço e por SKU nos últimos 30/90 dias.

Comandos sugeridos:

```bash
gcloud run services list --platform=managed --format=json
gcloud run services describe SERVICE --region=REGION --format=json
gcloud pubsub topics list --format=json
gcloud pubsub subscriptions list --format=json
gcloud secrets list --format=json
gcloud artifacts repositories list --format=json
```

## Supabase / PostgreSQL

Coletar:

- Ambientes/projetos Supabase separados por dev/staging/prod.
- Tabelas, índices, RLS, policies, funções, extensions, storage buckets e backups.
- Chaves e service roles em uso, com data de rotação.
- Top queries, locks, tamanho de tabelas, índices grandes e uso de storage.

Scripts locais:

```bash
npm run db:audit:governance
node scripts/cleanup-prod-test-data.mjs
node scripts/cleanup-prod-test-data.mjs --delete-test-users
```

Os scripts acima são read-only por padrão.

## n8n

Coletar:

- Workflows ativos/inativos, owner, credenciais usadas, triggers, frequência, último sucesso/erro.
- Webhooks públicos, tokens, URLs chamadas e dependências de APIs internas.
- Workflows duplicados, sem execução recente ou apontando para endpoints obsoletos.
- Estratégia de backup/export JSON por workflow.

## Redis

Coletar:

- Instâncias, ambiente, plano, região, memória usada, eviction policy, TTL médio e comandos dominantes.
- Chaves por prefixo, filas, locks, rate limits e sessões.
- Clientes conectados e serviços consumidores.

## MySQL / PostgreSQL Externos

Coletar:

- Hosts, schemas, tabelas, tamanho, owners, usuários e permissões.
- Integrações que leem/escrevem nesses bancos.
- Replicações, dumps, backups, jobs e dados duplicados com Supabase.

## Buckets E Arquivos

Coletar:

- Buckets, regras de lifecycle, objetos temporários, exports, anexos, NFs, logs e backups.
- Objetos sem referência em banco.
- Dados sensíveis ou PII sem política de retenção.

## Critério Para Remoção Externa

Nenhum recurso externo deve ser removido sem:

- Evidência de não uso nos últimos 30/90 dias.
- Dono funcional confirmado.
- Backup/export validado.
- Dry-run ou plano de rollback.
- Janela de mudança aprovada.
