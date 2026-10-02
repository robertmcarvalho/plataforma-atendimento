# Autentique — sincronização de assinaturas

## Convenção de nomes

Documentos criados manualmente no Autentique devem usar o nome canônico (copiado no painel Operação):

```
AETHERA_MATRICULA_{driver_uuid}_{NOME_SLUG}
AETHERA_DESLIGAMENTO_{driver_uuid}_{NOME_SLUG}
```

- `NOME_SLUG`: nome do entregador em maiúsculas, sem acentos, espaços → `_`.
- O UUID **não** é exibido na UI; o botão copiar grava o nome completo no clipboard.

## Fluxo operacional

1. Líder ou analista dispara pré-cadastro/desligamento → bundles criam tarefas com `metadata.signature_status: awaiting_document` e `autentique_document_name_expected`.
2. Atendente AG copia o nome no card/dialog em `/operacao` e cria o documento no Autentique.
3. Webhook (tempo real) ou job de polling (15 min) atualiza `signature_status` na tarefa.
4. Notificações in-app respeitam preferências em Configurações.

**Sem botões copiar** em `/lider/*` nem nos modais do analista — apenas no painel Operação.

## Variáveis de ambiente

| Variável | Serviço | Descrição |
|----------|---------|-----------|
| `AUTENTIQUE_SYNC_ENABLED` | api-service, scheduler-service | `false` pausa polling e reconcile (default `true`) |
| `AUTENTIQUE_API_KEY` | api-service, scheduler-service | Token GraphQL Autentique |
| `AUTENTIQUE_WEBHOOK_SECRET` | api-service | Secret do endpoint registrado no Autentique |
| `AUTENTIQUE_COOP_EMAIL` | api-service, scheduler-service | Representante da cooperativa no Autentique (default `gustavo.rezende@rezendeas.com.br`) |
| `AUTENTIQUE_LAWYER_EMAIL` | api-service, scheduler-service | Contador/advogado adicional, se houver papel separado (opcional) |
| `AUTENTIQUE_IGNORED_SIGNER_EMAILS` | api-service, scheduler-service | E-mails convidados que não bloqueiam o fluxo (default inclui `cooperativacoopmob@gmail.com`) |
| `WEBHOOK_PUBLIC_BASE_URL` | — | Base pública para registrar webhook |

## Webhook

- **URL:** `{WEBHOOK_PUBLIC_BASE_URL}/api/webhooks/autentique`
- **Método:** `POST` (sem JWT)
- **Validação:** header `x-autentique-secret` ou `x-webhook-secret`
- **Idempotência:** tabela `processed_webhook_events` (`meta_message_id`)
- Eventos: `signature.viewed`, `signature.accepted`, `signature.rejected`, `document.created`, `document.finished`

## Jobs (scheduler-service)

| Cron | Job | Função |
|------|-----|--------|
| `*/15 * * * *` | `signatureSyncJobs` | Polling fallback — cruza docs `AETHERA_*` com tarefas abertas |
| `30 7 * * *` | `signatureDeadlineJobs` | Notifica `driver_signature_overdue` quando `signature_deadline_days` estoura |

## Status normalizados (`metadata.signature_status`)

| Status | Significado |
|--------|-------------|
| `awaiting_document` | Tarefa criada; doc ainda não detectado |
| `awaiting_view` | Doc existe; entregador não abriu |
| `pending` / `awaiting_signature` | Aguardando assinatura |
| `signed` | Entregador assinou |
| `rejected` | Recusou |
| `document_finished` | Todos signatários concluíram |

## Match de documentos

1. UUID parseado do nome → `drivers.id`
2. Fallback: e-mail do signatário entregador
3. Fallback legado: nome normalizado + e-mail

## Código compartilhado (api-service + scheduler)

A lógica de **match**, atualização de `metadata` e loop de polling vive em
`packages/operational-notes/src/signatureSyncCore.ts`.

Cada serviço injeta apenas o **pós-update**:

| Serviço | Callback | Responsabilidade |
|---------|----------|------------------|
| `api-service` | `handleSignatureStatusTransition` | Webhook + reconciliação admin; notas internas / side-effects da API |
| `scheduler-service` | `onSchedulerSignatureTransition` | Job `*/15` — sync de status + acerto financeiro pós-assinatura |

Wrappers finos: `apps/api-service/src/lib/signatureStatusSync.ts` e
`apps/scheduler-service/src/lib/signatureStatusSync.ts`.

## Reconciliação admin

`POST /api/ops-analytics/signatures/reconcile` (admin/supervisor) — dispara sync e retorna amostra de docs `AETHERA_*` não parseáveis.

## Checklist QA

1. Líder pré-cadastro → 2 tarefas em `/operacao` (cadastro + matrícula)
2. Analista pré-cadastro na carteira → mesmas 2 tarefas
3. Líder/analista desligamento → par operacional + financeiro
4. Sem botão copiar em `/lider/*` nem modais analista
5. AG cria “Preparar matrícula” avulsa → copia nos passos 2/3 do modal
6. Doc no Autentique → webhook/poll atualiza status no card
7. `finalizar_cadastro` sem botão Autentique
8. Docs legados → match por e-mail
9. Pendências de assinatura → painel `signature_pending` no hub (não cria `pending_tasks` extras)
