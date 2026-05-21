# Contratos Entre Servicos

## Objetivo

Este documento define os contratos minimos entre servicos para evitar drift entre webhook, workers, API e frontend.

## Regras gerais

- Todo payload Pub/Sub deve ser JSON UTF-8.
- Todo consumidor deve tratar mensagens desconhecidas como erro de contrato.
- Todo worker em Cloud Run deve expor `GET /health`.
- Confirmacao de mensagem (`ack`) so deve ocorrer apos processamento bem sucedido.

## Topicos Pub/Sub

### `whatsapp.inbound`

- Produtor: `webhook-service`
- Consumidor: `orchestrator-service`
- Uso: mensagens recebidas da Meta

Payload:

```json
{
  "type": "message",
  "payload": {
    "id": "wamid.xxx",
    "from": "5534...",
    "type": "text"
  },
  "raw_entry": {}
}
```

### `whatsapp.status`

- Produtor: `webhook-service`
- Consumidor: `orchestrator-service`
- Uso: atualizacao de status entregue/lido

Payload:

```json
{
  "type": "status",
  "payload": {
    "id": "wamid.xxx",
    "status": "delivered",
    "timestamp": "1710000000"
  }
}
```

### `campaign.dispatch`

- Produtores: `api-service`, `scheduler-service`
- Consumidor: `campaign-worker`
- Uso: iniciar processamento real de campanha

Payload:

```json
{
  "campaign_id": "uuid"
}
```

Contrato importante:

- este topico nao deve receber `rule_id`
- o worker assume que existe uma campanha valida em estado `running`
- para automacoes, o `scheduler-service` cria a campanha e seus destinatarios antes de publicar

### `automation.trigger`

- Produtor: nenhum no fluxo atual
- Consumidor: reservado para implementacao dedicada futura
- Uso atual: topico reservado, sem papel no fluxo produtivo

Payload:

```json
{
  "rule_id": "uuid"
}
```

Observacao:

- o fluxo produtivo de automacao nao depende mais deste topico
- regras de automacao ativas sao materializadas em campanhas antes do envio

## Endpoints de health

| Servico | Endpoint |
|--------|----------|
| `api-service` | `/health` |
| `webhook-service` | `/health` |
| `orchestrator-service` | `/health` |
| `scheduler-service` | `/health` |
| `campaign-worker` | `/health` |

## Frontend: modo de integração

- O cliente fala com a API real e com Supabase real.
- Mocks runtime foram removidos da aplicação web; prototipação visual deve ficar fora do bundle produtivo.

## Gates recomendados

Antes de merge ou deploy:

1. `npm run lint`
2. `npm run build`
3. Testes manuais ou automatizados que a vossa equipa mantiver (não há scripts `smoke:*` no monorepo)

## Gaps conhecidos

- `automation.trigger` segue reservado apenas para uma implementacao futura realmente desacoplada
