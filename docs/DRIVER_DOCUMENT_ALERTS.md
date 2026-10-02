# Alertas de vencimento — CNH e certificado digital

Monitoramento diário de validade de **CNH** e **certificado digital** para entregadores **ativos**, com notificação **in-app** (sem Automações, sem WhatsApp em massa).

## Quem recebe

| Destinatário | Origem | Onde vê |
|--------------|--------|---------|
| **Atendente responsável** | `pharmacies.primary_attendant_id` da farmácia primária | Inbox → Pendências |
| **Líder responsável** | `drivers.override_leader_id` ou `pharmacies.leader_id` | Portal do líder (`/lider`) e lista de entregadores |

Canal: tabela `pending_tasks` (`task_type`: `driver_doc_expiry_warning` ou `driver_doc_expired`).

## Janelas de alerta

Timezone: `America/Sao_Paulo` (date-only).

| Estado | Condição |
|--------|----------|
| `warning_30` | Vence entre hoje+8 e hoje+30 dias |
| `warning_7` | Vence entre hoje+1 e hoje+7 dias |
| `expired` | Validade anterior a hoje |

- **CNH:** monitorada se `cnh_expires_at` preenchido.
- **Certificado:** monitorado se `has_digital_certificate` e `digital_certificate_expires_at`.

Campo agregado `drivers.doc_status`:

- `expired` — qualquer documento vencido
- `pending` — certificado sem data ou em `warning_7`
- `ok` — demais casos

## Job diário

- **Serviço:** `flux-farma-scheduler`
- **Cron:** `15 6 * * *` (06:15)
- **Arquivo:** `apps/scheduler-service/src/jobs/driverDocumentExpiryJobs.ts`

Para cada entregador ativo o job:

1. Recalcula `doc_status`
2. Cria até **duas** tarefas por alerta (atendente + líder), quando o responsável existir
3. **Dedup:** uma tarefa aberta por `(driver_id, assignee_id, metadata.alert_kind)`

Entregador **inativo/bloqueado:** não gera alertas; cancela tarefas abertas `driver_doc_*`.

## Renovação no cadastro

Ao salvar a ficha (`PUT /api/drivers/:id`), a API:

- Recalcula `doc_status`
- Cancela pendências do documento que voltou a válido
- Cancela todas as pendências se o entregador foi inativado

## Preferências de usuário

Em **Configurações → Notificações**:

- `driver_document_expiry_warning` — avisos 30/7 dias (padrão: ligado)
- `driver_document_expired` — documento vencido (padrão: ligado)

Com pref desligada, o job **não cria** tarefa para aquele usuário (atendente ou líder).

## UI

- Ficha staff `/drivers/[id]` — badges e seção Documentação
- Lista `/drivers` — filtro por `doc_status` e badge quando ≠ OK
- Portal líder — chip na lista, painel de detalhe, banner no dashboard
- Copilot — bloco `expiry_alerts` no catálogo de cadastro

## Endpoints úteis

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/api/drivers/:id/document-status` | Estado calculado (testes/ficha) |
| GET | `/api/leader-portal/document-alerts` | Alertas do líder logado |
| GET | `/api/tasks/:id/context` | `document_context` + link `/drivers/:id` |

## Deploy

Ordem sugerida:

1. Migration `045_driver_doc_status_index.sql`
2. **flux-farma-api**
3. **flux-farma-scheduler** (mín. 1 instância)
4. **flux-farma-web**

## Smoke test

1. Entregador teste com CNH vencida → 1 pendência na inbox do atendente + 1 no portal do líder
2. Atendente vê Inbox → Pendências
3. Líder vê alertas em `/lider` e `/lider/entregadores`
4. Atualizar validade no cadastro → tarefas canceladas
5. Desligar pref de documento → sem nova tarefa para aquele usuário

## Fora de escopo

- Módulo de **Automações** (`triggerAutomation`, eventos Meta)
- Campanhas / WhatsApp outbound
- Bloqueio automático do entregador
- Sync Flux Delivery para alertas
